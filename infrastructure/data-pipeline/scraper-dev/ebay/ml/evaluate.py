"""
Evaluation and Metrics for Card Recognition

Implements:
- Per-class accuracy and confusion matrices
- Top-K accuracy for card identification
- Ordinal accuracy for condition (within-N classes)
- Inference utilities
"""

import torch
import torch.nn.functional as F
import numpy as np
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    confusion_matrix,
    classification_report,
)
from tqdm import tqdm


class Evaluator:
    """
    Comprehensive evaluation for card recognition model.
    """

    def __init__(
        self,
        model,
        dataloader,
        device: str = "cuda",
        idx_to_card: Optional[Dict[int, str]] = None,
        idx_to_variant: Optional[Dict[int, str]] = None,
        idx_to_condition: Optional[Dict[int, str]] = None,
    ):
        self.model = model
        self.dataloader = dataloader
        self.device = device

        self.idx_to_card = idx_to_card or {}
        self.idx_to_variant = idx_to_variant or {}
        self.idx_to_condition = idx_to_condition or {
            0: "NM", 1: "LP", 2: "MP", 3: "HP", 4: "DMG"
        }

    @torch.no_grad()
    def evaluate(self) -> Dict:
        """
        Run full evaluation.

        Returns dict with metrics for each task.
        """
        self.model.eval()

        # Collect predictions and labels
        all_card_preds = []
        all_card_labels = []
        all_card_probs = []

        all_variant_preds = []
        all_variant_labels = []

        all_condition_preds = []
        all_condition_labels = []

        for batch in tqdm(self.dataloader, desc="Evaluating"):
            images = batch["image"].to(self.device)

            outputs = self.model(images)

            # Card predictions
            card_probs = F.softmax(outputs.card_logits, dim=1)
            card_preds = card_probs.argmax(dim=1)
            all_card_preds.extend(card_preds.cpu().numpy())
            all_card_labels.extend(batch["card_label"].numpy())
            all_card_probs.extend(card_probs.cpu().numpy())

            # Variant predictions
            variant_preds = outputs.variant_logits.argmax(dim=1)
            all_variant_preds.extend(variant_preds.cpu().numpy())
            all_variant_labels.extend(batch["variant_label"].numpy())

            # Condition predictions (only valid labels)
            condition_labels = batch["condition_label"].numpy()
            valid_mask = condition_labels >= 0
            if valid_mask.any():
                condition_preds = outputs.condition_logits[valid_mask].argmax(dim=1)
                all_condition_preds.extend(condition_preds.cpu().numpy())
                all_condition_labels.extend(condition_labels[valid_mask])

        # Convert to numpy
        all_card_preds = np.array(all_card_preds)
        all_card_labels = np.array(all_card_labels)
        all_card_probs = np.array(all_card_probs)

        all_variant_preds = np.array(all_variant_preds)
        all_variant_labels = np.array(all_variant_labels)

        all_condition_preds = np.array(all_condition_preds)
        all_condition_labels = np.array(all_condition_labels)

        # Compute metrics
        results = {
            "card": self._compute_card_metrics(
                all_card_preds, all_card_labels, all_card_probs
            ),
            "variant": self._compute_classification_metrics(
                all_variant_preds, all_variant_labels,
                class_names=[self.idx_to_variant.get(i, str(i)) for i in range(max(all_variant_labels) + 1)]
            ),
            "condition": self._compute_ordinal_metrics(
                all_condition_preds, all_condition_labels
            ) if len(all_condition_labels) > 0 else {"accuracy": 0.0},
        }

        return results

    def _compute_card_metrics(
        self,
        preds: np.ndarray,
        labels: np.ndarray,
        probs: np.ndarray,
    ) -> Dict:
        """Compute card identification metrics."""
        # Top-1 accuracy
        top1_acc = accuracy_score(labels, preds)

        # Top-5 accuracy
        top5_acc = self._top_k_accuracy(probs, labels, k=5)

        # Top-10 accuracy
        top10_acc = self._top_k_accuracy(probs, labels, k=10)

        # Per-class metrics
        precision, recall, f1, support = precision_recall_fscore_support(
            labels, preds, average='weighted', zero_division=0
        )

        # Confusion analysis - most confused pairs
        cm = confusion_matrix(labels, preds)
        confused_pairs = self._find_confused_pairs(cm, labels, n=10)

        return {
            "accuracy": top1_acc,
            "top5_accuracy": top5_acc,
            "top10_accuracy": top10_acc,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "confused_pairs": confused_pairs,
        }

    def _compute_classification_metrics(
        self,
        preds: np.ndarray,
        labels: np.ndarray,
        class_names: List[str],
    ) -> Dict:
        """Compute standard classification metrics."""
        accuracy = accuracy_score(labels, preds)

        precision, recall, f1, _ = precision_recall_fscore_support(
            labels, preds, average='weighted', zero_division=0
        )

        # Per-class report
        report = classification_report(
            labels, preds,
            target_names=class_names,
            output_dict=True,
            zero_division=0,
        )

        return {
            "accuracy": accuracy,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "per_class": report,
        }

    def _compute_ordinal_metrics(
        self,
        preds: np.ndarray,
        labels: np.ndarray,
    ) -> Dict:
        """Compute ordinal metrics for condition assessment."""
        if len(labels) == 0:
            return {"accuracy": 0.0}

        # Exact accuracy
        accuracy = accuracy_score(labels, preds)

        # Within-1 accuracy (off by at most 1 grade)
        within_1 = np.mean(np.abs(preds - labels) <= 1)

        # Within-2 accuracy
        within_2 = np.mean(np.abs(preds - labels) <= 2)

        # Mean absolute error (lower is better)
        mae = np.mean(np.abs(preds - labels))

        # Confusion matrix
        cm = confusion_matrix(labels, preds, labels=list(range(5)))
        cm_normalized = cm.astype('float') / cm.sum(axis=1, keepdims=True)

        return {
            "accuracy": accuracy,
            "within_1_accuracy": within_1,
            "within_2_accuracy": within_2,
            "mae": mae,
            "confusion_matrix": cm.tolist(),
            "confusion_matrix_normalized": cm_normalized.tolist(),
        }

    def _top_k_accuracy(
        self,
        probs: np.ndarray,
        labels: np.ndarray,
        k: int,
    ) -> float:
        """Compute top-K accuracy."""
        top_k_preds = np.argsort(probs, axis=1)[:, -k:]
        correct = np.array([label in preds for label, preds in zip(labels, top_k_preds)])
        return correct.mean()

    def _find_confused_pairs(
        self,
        cm: np.ndarray,
        labels: np.ndarray,
        n: int = 10,
    ) -> List[Tuple[str, str, int]]:
        """Find most confused class pairs."""
        unique_labels = np.unique(labels)

        # Zero out diagonal (correct predictions)
        cm_off_diag = cm.copy()
        np.fill_diagonal(cm_off_diag, 0)

        # Find top confused pairs
        confused = []
        flat_indices = np.argsort(cm_off_diag.flatten())[::-1][:n]

        for idx in flat_indices:
            i, j = np.unravel_index(idx, cm.shape)
            count = cm_off_diag[i, j]
            if count > 0:
                true_class = self.idx_to_card.get(unique_labels[i], str(i)) if i < len(unique_labels) else str(i)
                pred_class = self.idx_to_card.get(unique_labels[j], str(j)) if j < len(unique_labels) else str(j)
                confused.append((true_class, pred_class, int(count)))

        return confused


def print_evaluation_results(results: Dict):
    """Pretty print evaluation results."""
    print("\n" + "=" * 60)
    print("EVALUATION RESULTS")
    print("=" * 60)

    # Card identification
    print("\n📇 Card Identification:")
    print(f"  Top-1 Accuracy: {results['card']['accuracy']*100:.2f}%")
    print(f"  Top-5 Accuracy: {results['card']['top5_accuracy']*100:.2f}%")
    print(f"  Top-10 Accuracy: {results['card']['top10_accuracy']*100:.2f}%")
    print(f"  F1 Score: {results['card']['f1']:.4f}")

    if results['card']['confused_pairs']:
        print("\n  Most Confused Pairs:")
        for true_cls, pred_cls, count in results['card']['confused_pairs'][:5]:
            print(f"    {true_cls} → {pred_cls}: {count} times")

    # Variant detection
    print("\n🎨 Variant Detection:")
    print(f"  Accuracy: {results['variant']['accuracy']*100:.2f}%")
    print(f"  F1 Score: {results['variant']['f1']:.4f}")

    if 'per_class' in results['variant']:
        print("\n  Per-Class Performance:")
        for cls, metrics in results['variant']['per_class'].items():
            if cls not in ['accuracy', 'macro avg', 'weighted avg']:
                print(f"    {cls}: P={metrics['precision']:.2f} R={metrics['recall']:.2f} F1={metrics['f1-score']:.2f}")

    # Condition assessment
    print("\n⭐ Condition Assessment:")
    print(f"  Exact Accuracy: {results['condition']['accuracy']*100:.2f}%")
    if 'within_1_accuracy' in results['condition']:
        print(f"  Within-1 Accuracy: {results['condition']['within_1_accuracy']*100:.2f}%")
        print(f"  Within-2 Accuracy: {results['condition']['within_2_accuracy']*100:.2f}%")
        print(f"  MAE: {results['condition']['mae']:.3f}")

    print("\n" + "=" * 60)


class InferenceEngine:
    """
    Optimized inference for production use.
    """

    def __init__(
        self,
        model,
        device: str = "cuda",
        idx_to_card: Optional[Dict[int, str]] = None,
        idx_to_variant: Optional[Dict[int, str]] = None,
    ):
        self.model = model.to(device).eval()
        self.device = device
        self.idx_to_card = idx_to_card or {}
        self.idx_to_variant = idx_to_variant or {}

    @torch.no_grad()
    def predict(
        self,
        image: torch.Tensor,
        top_k: int = 5,
    ) -> Dict:
        """
        Run inference on a single image.

        Args:
            image: (3, 380, 380) tensor, normalized
            top_k: Number of top predictions to return

        Returns:
            Dict with predictions for each task
        """
        # Add batch dimension
        if image.dim() == 3:
            image = image.unsqueeze(0)

        image = image.to(self.device)

        outputs = self.model(image)

        # Card predictions
        card_probs = F.softmax(outputs.card_logits[0], dim=0)
        top_k_probs, top_k_indices = torch.topk(card_probs, k=min(top_k, len(card_probs)))

        card_predictions = [
            {
                "id": self.idx_to_card.get(idx.item(), str(idx.item())),
                "confidence": prob.item(),
            }
            for idx, prob in zip(top_k_indices, top_k_probs)
        ]

        # Variant prediction
        variant_probs = F.softmax(outputs.variant_logits[0], dim=0)
        variant_idx = variant_probs.argmax().item()
        variant_type = self.idx_to_variant.get(variant_idx, str(variant_idx))

        # Condition prediction
        condition_probs = F.softmax(outputs.condition_logits[0], dim=0)
        condition_idx = condition_probs.argmax().item()
        conditions = ["NM", "LP", "MP", "HP", "DMG"]

        return {
            "card": {
                "top1": card_predictions[0] if card_predictions else None,
                "top_k": card_predictions,
            },
            "variant": {
                "type": variant_type,
                "confidence": variant_probs[variant_idx].item(),
            },
            "condition": {
                "grade": conditions[condition_idx],
                "confidence": condition_probs[condition_idx].item(),
                "distribution": {
                    cond: condition_probs[i].item()
                    for i, cond in enumerate(conditions)
                },
            },
        }

    @torch.no_grad()
    def predict_batch(
        self,
        images: torch.Tensor,
        top_k: int = 5,
    ) -> List[Dict]:
        """
        Run inference on a batch of images.

        Args:
            images: (B, 3, 380, 380) tensor
            top_k: Number of top predictions per image

        Returns:
            List of prediction dicts
        """
        images = images.to(self.device)
        outputs = self.model(images)

        results = []
        for i in range(images.size(0)):
            # Process each image in batch
            card_probs = F.softmax(outputs.card_logits[i], dim=0)
            top_k_probs, top_k_indices = torch.topk(card_probs, k=min(top_k, len(card_probs)))

            card_predictions = [
                {
                    "id": self.idx_to_card.get(idx.item(), str(idx.item())),
                    "confidence": prob.item(),
                }
                for idx, prob in zip(top_k_indices, top_k_probs)
            ]

            variant_probs = F.softmax(outputs.variant_logits[i], dim=0)
            variant_idx = variant_probs.argmax().item()

            condition_probs = F.softmax(outputs.condition_logits[i], dim=0)
            condition_idx = condition_probs.argmax().item()
            conditions = ["NM", "LP", "MP", "HP", "DMG"]

            results.append({
                "card": {
                    "top1": card_predictions[0] if card_predictions else None,
                    "top_k": card_predictions,
                },
                "variant": {
                    "type": self.idx_to_variant.get(variant_idx, str(variant_idx)),
                    "confidence": variant_probs[variant_idx].item(),
                },
                "condition": {
                    "grade": conditions[condition_idx],
                    "confidence": condition_probs[condition_idx].item(),
                },
            })

        return results
