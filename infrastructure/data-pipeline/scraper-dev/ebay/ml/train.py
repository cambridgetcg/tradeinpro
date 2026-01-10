#!/usr/bin/env python3
"""
Main Training Script for TCG Card Recognition

Usage:
    # Basic training
    python train.py

    # With custom config
    python train.py --config config.yaml

    # Resume from checkpoint
    python train.py --resume checkpoints/best_model.pt

    # Evaluate only
    python train.py --evaluate --checkpoint checkpoints/best_model.pt
"""

import argparse
import torch
import random
import numpy as np
from pathlib import Path

from config import get_config, get_config_from_file
from model import create_model, CardRecognitionModel, load_checkpoint
from dataset import CardDataModule
from augmentation import get_train_transform, get_val_transform
from trainer import Trainer
from evaluate import Evaluator, print_evaluation_results


def set_seed(seed: int):
    """Set random seeds for reproducibility."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False


def main():
    parser = argparse.ArgumentParser(description="Train card recognition model")
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to config YAML file",
    )
    parser.add_argument(
        "--resume",
        type=str,
        default=None,
        help="Path to checkpoint to resume from",
    )
    parser.add_argument(
        "--evaluate",
        action="store_true",
        help="Run evaluation only (requires --checkpoint)",
    )
    parser.add_argument(
        "--checkpoint",
        type=str,
        default=None,
        help="Path to model checkpoint for evaluation",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cuda" if torch.cuda.is_available() else "cpu",
        help="Device to use (cuda/cpu)",
    )
    parser.add_argument(
        "--no-wandb",
        action="store_true",
        help="Disable W&B logging",
    )
    args = parser.parse_args()

    # Load config
    if args.config:
        config = get_config_from_file(args.config)
    else:
        config = get_config()

    # Override config with CLI args
    config.device = args.device
    if args.no_wandb:
        config.logging.use_wandb = False

    # Set seed
    set_seed(config.seed)

    print("=" * 60)
    print("TCG Card Recognition Training")
    print("=" * 60)
    print(f"Device: {config.device}")
    print(f"Model: {config.model.backbone}")
    print(f"Input size: {config.model.input_size}x{config.model.input_size}")
    print(f"Batch size: {config.training.batch_size} x {config.training.accumulation_steps} = {config.training.batch_size * config.training.accumulation_steps}")

    # Create data module
    print("\n📁 Loading data...")
    data_module = CardDataModule(
        s3_bucket=config.data.s3_bucket,
        s3_prefix=config.data.s3_prefix,
        cache_dir=config.data.cache_dir,
        train_split=config.data.train_split,
        val_split=config.data.val_split,
        batch_size=config.training.batch_size,
        num_workers=config.training.num_workers,
        train_transform=get_train_transform(config),
        val_transform=get_val_transform(config),
        seed=config.seed,
    )
    data_module.setup()

    # Update config with actual class counts
    config.model.num_card_classes = len(data_module.card_to_idx)
    config.model.num_variant_classes = len(data_module.variant_to_idx)

    print(f"\n📊 Dataset statistics:")
    print(f"  Card classes: {config.model.num_card_classes}")
    print(f"  Variant classes: {config.model.num_variant_classes}")
    print(f"  Condition classes: {config.model.num_condition_classes}")

    # Create model
    print("\n🏗️ Creating model...")
    model = create_model(config)

    if args.resume or args.checkpoint:
        checkpoint_path = args.resume or args.checkpoint
        print(f"  Loading checkpoint from {checkpoint_path}")
        model, ckpt_info = load_checkpoint(model, checkpoint_path, config.device)
        print(f"  Loaded from epoch {ckpt_info['epoch']}")

    # Count parameters
    total_params = sum(p.numel() for p in model.parameters())
    print(f"  Total parameters: {total_params:,}")

    if args.evaluate:
        # Evaluation only
        print("\n🔍 Running evaluation...")
        model = model.to(config.device)

        evaluator = Evaluator(
            model=model,
            dataloader=data_module.test_dataloader(),
            device=config.device,
            idx_to_card=data_module.idx_to_card,
            idx_to_variant=data_module.idx_to_variant,
        )

        results = evaluator.evaluate()
        print_evaluation_results(results)

    else:
        # Training
        print("\n🚀 Starting training...")

        trainer = Trainer(
            model=model,
            config=config,
            train_loader=data_module.train_dataloader(),
            val_loader=data_module.val_dataloader(),
            device=config.device,
        )

        if args.resume:
            trainer.load_checkpoint(args.resume)

        trainer.train()

        # Final evaluation on test set
        print("\n🔍 Running final evaluation on test set...")
        best_model_path = config.logging.checkpoint_dir / "best_model.pt"
        if best_model_path.exists():
            model, _ = load_checkpoint(model, str(best_model_path), config.device)

        evaluator = Evaluator(
            model=model,
            dataloader=data_module.test_dataloader(),
            device=config.device,
            idx_to_card=data_module.idx_to_card,
            idx_to_variant=data_module.idx_to_variant,
        )

        results = evaluator.evaluate()
        print_evaluation_results(results)

        # Save final results
        import json
        results_path = config.logging.checkpoint_dir / "evaluation_results.json"

        # Convert numpy types for JSON serialization
        def convert_numpy(obj):
            if isinstance(obj, np.ndarray):
                return obj.tolist()
            elif isinstance(obj, (np.float32, np.float64)):
                return float(obj)
            elif isinstance(obj, (np.int32, np.int64)):
                return int(obj)
            elif isinstance(obj, dict):
                return {k: convert_numpy(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_numpy(v) for v in obj]
            return obj

        with open(results_path, "w") as f:
            json.dump(convert_numpy(results), f, indent=2)
        print(f"\n📄 Results saved to {results_path}")


if __name__ == "__main__":
    main()
