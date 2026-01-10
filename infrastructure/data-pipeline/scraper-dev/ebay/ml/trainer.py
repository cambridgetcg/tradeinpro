"""
Training Loop for Multi-Task Card Recognition

Implements:
- Three-phase progressive fine-tuning
- Mixed precision training
- Gradient accumulation
- Early stopping
- Checkpoint management
- W&B logging
"""

import torch
import torch.nn as nn
from torch.cuda.amp import autocast, GradScaler
from torch.optim import AdamW
from torch.optim.lr_scheduler import OneCycleLR
from tqdm import tqdm
from pathlib import Path
from typing import Dict, Optional, Tuple
import numpy as np
from dataclasses import dataclass

from model import CardRecognitionModel, ModelOutput, save_checkpoint
from losses import create_loss_function
from augmentation import cutmix_data


@dataclass
class TrainingMetrics:
    """Container for training metrics."""
    loss: float
    card_loss: float
    variant_loss: float
    condition_loss: float
    card_accuracy: float
    variant_accuracy: float
    condition_accuracy: float


class Trainer:
    """
    Multi-phase trainer for EfficientNet card recognition.

    Training phases:
    1. Frozen backbone - train heads only
    2. Partial fine-tuning - unfreeze top layers
    3. Full fine-tuning - unfreeze all
    """

    def __init__(
        self,
        model: CardRecognitionModel,
        config,
        train_loader,
        val_loader,
        device: str = "cuda",
    ):
        self.model = model.to(device)
        self.config = config
        self.train_loader = train_loader
        self.val_loader = val_loader
        self.device = device

        # Loss function
        self.criterion = create_loss_function(config).to(device)

        # Mixed precision
        self.use_amp = config.training.use_amp and device == "cuda"
        self.scaler = GradScaler() if self.use_amp else None

        # Tracking
        self.current_epoch = 0
        self.current_phase = 0
        self.best_val_loss = float("inf")
        self.patience_counter = 0

        # Checkpoints
        self.checkpoint_dir = Path(config.logging.checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

        # W&B
        self.use_wandb = config.logging.use_wandb
        if self.use_wandb:
            try:
                import wandb
                wandb.init(
                    project=config.logging.wandb_project,
                    entity=config.logging.wandb_entity,
                    name=config.experiment_name,
                    config=self._config_to_dict(config),
                )
                self.wandb = wandb
            except ImportError:
                print("wandb not installed, disabling logging")
                self.use_wandb = False

    def _config_to_dict(self, config) -> dict:
        """Convert dataclass config to dict for logging."""
        return {
            "model": {
                "backbone": config.model.backbone,
                "input_size": config.model.input_size,
                "dropout": config.model.dropout,
            },
            "training": {
                "phase1_epochs": config.training.phase1_epochs,
                "phase2_epochs": config.training.phase2_epochs,
                "phase3_epochs": config.training.phase3_epochs,
                "batch_size": config.training.batch_size,
                "accumulation_steps": config.training.accumulation_steps,
            },
            "loss": {
                "weighting_strategy": config.loss.weighting_strategy,
            },
        }

    def train(self):
        """Run full training with all phases."""
        print("=" * 60)
        print("Starting Training")
        print("=" * 60)

        # Phase 1: Frozen backbone
        print("\n📦 Phase 1: Training heads only (backbone frozen)")
        self._run_phase(
            phase=1,
            epochs=self.config.training.phase1_epochs,
            lr=self.config.training.phase1_lr,
            freeze_mode="full",
        )

        # Phase 2: Partial fine-tuning
        print("\n🔓 Phase 2: Partial fine-tuning (top layers unfrozen)")
        self._run_phase(
            phase=2,
            epochs=self.config.training.phase2_epochs,
            lr=self.config.training.phase2_lr,
            freeze_mode="partial",
        )

        # Phase 3: Full fine-tuning
        print("\n🚀 Phase 3: Full fine-tuning (all layers unfrozen)")
        self._run_phase(
            phase=3,
            epochs=self.config.training.phase3_epochs,
            lr=self.config.training.phase3_lr,
            freeze_mode="none",
        )

        print("\n" + "=" * 60)
        print(f"Training complete! Best val loss: {self.best_val_loss:.4f}")
        print("=" * 60)

    def _run_phase(
        self,
        phase: int,
        epochs: int,
        lr: float,
        freeze_mode: str,
    ):
        """Run a single training phase."""
        self.current_phase = phase

        # Configure model freezing
        if freeze_mode == "full":
            self.model.freeze_backbone()
        elif freeze_mode == "partial":
            self.model.unfreeze_top_layers(num_blocks=2)
        else:
            self.model.unfreeze_all()

        trainable_params = self.model.get_trainable_params()
        print(f"  Trainable parameters: {trainable_params:,}")

        # Create optimizer for trainable params only
        optimizer = AdamW(
            filter(lambda p: p.requires_grad, self.model.parameters()),
            lr=lr,
            weight_decay=self.config.training.weight_decay,
            betas=self.config.training.betas,
        )

        # Learning rate scheduler
        total_steps = epochs * len(self.train_loader)
        scheduler = OneCycleLR(
            optimizer,
            max_lr=lr,
            total_steps=total_steps,
            pct_start=self.config.training.pct_start,
            anneal_strategy='cos',
        )

        # Training loop
        for epoch in range(epochs):
            self.current_epoch += 1

            # Train
            train_metrics = self._train_epoch(optimizer, scheduler)

            # Validate
            val_metrics = self._validate()

            # Log
            self._log_metrics(train_metrics, val_metrics, optimizer.param_groups[0]['lr'])

            # Checkpoint
            if val_metrics.loss < self.best_val_loss:
                self.best_val_loss = val_metrics.loss
                self.patience_counter = 0
                save_checkpoint(
                    self.model,
                    optimizer,
                    self.current_epoch,
                    val_metrics.loss,
                    self.config,
                    str(self.checkpoint_dir / "best_model.pt"),
                )
                print(f"  ✅ New best model saved (val_loss: {val_metrics.loss:.4f})")
            else:
                self.patience_counter += 1

            # Early stopping
            if self.patience_counter >= self.config.training.patience:
                print(f"  ⏹️ Early stopping triggered after {epoch + 1} epochs")
                break

    def _train_epoch(self, optimizer, scheduler) -> TrainingMetrics:
        """Train for one epoch."""
        self.model.train()

        total_loss = 0
        task_losses = {"card": 0, "variant": 0, "condition": 0}
        correct = {"card": 0, "variant": 0, "condition": 0}
        total_samples = 0
        total_condition_samples = 0

        accumulation_steps = self.config.training.accumulation_steps
        optimizer.zero_grad()

        pbar = tqdm(self.train_loader, desc=f"Epoch {self.current_epoch}")

        for step, batch in enumerate(pbar):
            # Move to device
            images = batch["image"].to(self.device)
            labels = {
                "card_label": batch["card_label"].to(self.device),
                "variant_label": batch["variant_label"].to(self.device),
                "condition_label": batch["condition_label"].to(self.device),
            }

            # Apply CutMix
            lam = 1.0
            if np.random.random() < self.config.training.cutmix_prob:
                images, labels, lam = cutmix_data(
                    images, labels,
                    alpha=self.config.training.cutmix_alpha,
                )

            # Forward pass
            with autocast(enabled=self.use_amp):
                outputs = self.model(images)
                outputs_dict = {
                    "card_logits": outputs.card_logits,
                    "variant_logits": outputs.variant_logits,
                    "condition_logits": outputs.condition_logits,
                }
                loss, losses = self.criterion(outputs_dict, labels, lam)
                loss = loss / accumulation_steps

            # Backward pass
            if self.use_amp:
                self.scaler.scale(loss).backward()
            else:
                loss.backward()

            # Gradient accumulation
            if (step + 1) % accumulation_steps == 0:
                if self.use_amp:
                    self.scaler.step(optimizer)
                    self.scaler.update()
                else:
                    optimizer.step()
                optimizer.zero_grad()
                scheduler.step()

            # Track metrics
            batch_size = images.size(0)
            total_loss += loss.item() * accumulation_steps * batch_size
            total_samples += batch_size

            for task in ["card", "variant", "condition"]:
                task_losses[task] += losses[task].item() * batch_size

            # Accuracy (only for non-CutMix or primary labels)
            with torch.no_grad():
                if "card_label_b" not in labels:
                    card_pred = outputs.card_logits.argmax(dim=1)
                    correct["card"] += (card_pred == labels["card_label"]).sum().item()

                    variant_pred = outputs.variant_logits.argmax(dim=1)
                    correct["variant"] += (variant_pred == labels["variant_label"]).sum().item()

                    valid = labels["condition_label"] >= 0
                    if valid.any():
                        cond_pred = outputs.condition_logits[valid].argmax(dim=1)
                        correct["condition"] += (cond_pred == labels["condition_label"][valid]).sum().item()
                        total_condition_samples += valid.sum().item()

            # Update progress bar
            pbar.set_postfix({
                "loss": f"{loss.item() * accumulation_steps:.4f}",
                "card_acc": f"{correct['card'] / max(total_samples, 1) * 100:.1f}%",
            })

        return TrainingMetrics(
            loss=total_loss / total_samples,
            card_loss=task_losses["card"] / total_samples,
            variant_loss=task_losses["variant"] / total_samples,
            condition_loss=task_losses["condition"] / max(total_condition_samples, 1),
            card_accuracy=correct["card"] / total_samples,
            variant_accuracy=correct["variant"] / total_samples,
            condition_accuracy=correct["condition"] / max(total_condition_samples, 1),
        )

    @torch.no_grad()
    def _validate(self) -> TrainingMetrics:
        """Run validation."""
        self.model.eval()

        total_loss = 0
        task_losses = {"card": 0, "variant": 0, "condition": 0}
        correct = {"card": 0, "variant": 0, "condition": 0}
        total_samples = 0
        total_condition_samples = 0

        for batch in tqdm(self.val_loader, desc="Validating", leave=False):
            images = batch["image"].to(self.device)
            labels = {
                "card_label": batch["card_label"].to(self.device),
                "variant_label": batch["variant_label"].to(self.device),
                "condition_label": batch["condition_label"].to(self.device),
            }

            with autocast(enabled=self.use_amp):
                outputs = self.model(images)
                outputs_dict = {
                    "card_logits": outputs.card_logits,
                    "variant_logits": outputs.variant_logits,
                    "condition_logits": outputs.condition_logits,
                }
                loss, losses = self.criterion(outputs_dict, labels)

            batch_size = images.size(0)
            total_loss += loss.item() * batch_size
            total_samples += batch_size

            for task in ["card", "variant", "condition"]:
                task_losses[task] += losses[task].item() * batch_size

            # Accuracy
            card_pred = outputs.card_logits.argmax(dim=1)
            correct["card"] += (card_pred == labels["card_label"]).sum().item()

            variant_pred = outputs.variant_logits.argmax(dim=1)
            correct["variant"] += (variant_pred == labels["variant_label"]).sum().item()

            valid = labels["condition_label"] >= 0
            if valid.any():
                cond_pred = outputs.condition_logits[valid].argmax(dim=1)
                correct["condition"] += (cond_pred == labels["condition_label"][valid]).sum().item()
                total_condition_samples += valid.sum().item()

        return TrainingMetrics(
            loss=total_loss / total_samples,
            card_loss=task_losses["card"] / total_samples,
            variant_loss=task_losses["variant"] / total_samples,
            condition_loss=task_losses["condition"] / max(total_condition_samples, 1),
            card_accuracy=correct["card"] / total_samples,
            variant_accuracy=correct["variant"] / total_samples,
            condition_accuracy=correct["condition"] / max(total_condition_samples, 1),
        )

    def _log_metrics(
        self,
        train_metrics: TrainingMetrics,
        val_metrics: TrainingMetrics,
        lr: float,
    ):
        """Log metrics to console and W&B."""
        print(f"\n  Epoch {self.current_epoch} (Phase {self.current_phase}):")
        print(f"    Train Loss: {train_metrics.loss:.4f} | Val Loss: {val_metrics.loss:.4f}")
        print(f"    Card Acc:   {train_metrics.card_accuracy*100:.1f}% | {val_metrics.card_accuracy*100:.1f}%")
        print(f"    Variant Acc: {train_metrics.variant_accuracy*100:.1f}% | {val_metrics.variant_accuracy*100:.1f}%")
        print(f"    Cond Acc:   {train_metrics.condition_accuracy*100:.1f}% | {val_metrics.condition_accuracy*100:.1f}%")

        if self.use_wandb:
            self.wandb.log({
                "epoch": self.current_epoch,
                "phase": self.current_phase,
                "lr": lr,
                "train/loss": train_metrics.loss,
                "train/card_loss": train_metrics.card_loss,
                "train/variant_loss": train_metrics.variant_loss,
                "train/condition_loss": train_metrics.condition_loss,
                "train/card_accuracy": train_metrics.card_accuracy,
                "train/variant_accuracy": train_metrics.variant_accuracy,
                "train/condition_accuracy": train_metrics.condition_accuracy,
                "val/loss": val_metrics.loss,
                "val/card_loss": val_metrics.card_loss,
                "val/variant_loss": val_metrics.variant_loss,
                "val/condition_loss": val_metrics.condition_loss,
                "val/card_accuracy": val_metrics.card_accuracy,
                "val/variant_accuracy": val_metrics.variant_accuracy,
                "val/condition_accuracy": val_metrics.condition_accuracy,
            })

    def load_checkpoint(self, path: str):
        """Load model from checkpoint."""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.current_epoch = checkpoint.get("epoch", 0)
        self.best_val_loss = checkpoint.get("best_val_loss", float("inf"))
        print(f"Loaded checkpoint from epoch {self.current_epoch}")
