"""
Loss Functions for Multi-Task Card Recognition

Implements:
- Uncertainty-weighted multi-task loss (Kendall et al., 2018)
- Dynamic Weight Average (DWA)
- Ordinal regression loss for condition assessment
- CutMix-aware loss computation
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Dict, List, Optional, Tuple


class LabelSmoothingCrossEntropy(nn.Module):
    """Cross entropy with label smoothing."""

    def __init__(self, smoothing: float = 0.1, reduction: str = "mean"):
        super().__init__()
        self.smoothing = smoothing
        self.reduction = reduction

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        n_classes = logits.size(-1)
        log_probs = F.log_softmax(logits, dim=-1)

        # Create smoothed targets
        with torch.no_grad():
            smooth_targets = torch.zeros_like(log_probs)
            smooth_targets.fill_(self.smoothing / (n_classes - 1))
            smooth_targets.scatter_(1, targets.unsqueeze(1), 1.0 - self.smoothing)

        loss = (-smooth_targets * log_probs).sum(dim=-1)

        if self.reduction == "mean":
            return loss.mean()
        elif self.reduction == "sum":
            return loss.sum()
        return loss


class OrdinalRegressionLoss(nn.Module):
    """
    Ordinal regression loss for ordered classes.

    Conditions are ordered: NM=0 < LP=1 < MP=2 < HP=3 < DMG=4
    Predicting LP when true is NM is less bad than predicting DMG.
    """

    def __init__(self, num_classes: int = 5):
        super().__init__()
        self.num_classes = num_classes

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        """
        Args:
            logits: (B, num_classes - 1) cumulative logits
            targets: (B,) class indices 0 to num_classes-1
        """
        # Convert logits to cumulative probabilities P(y > k)
        cumulative_probs = torch.sigmoid(logits)  # (B, num_classes - 1)

        # Create cumulative targets
        # P(y > k) = 1 if y > k, else 0
        targets_expanded = targets.unsqueeze(1)  # (B, 1)
        thresholds = torch.arange(self.num_classes - 1, device=targets.device)  # (num_classes - 1,)
        cumulative_targets = (targets_expanded > thresholds).float()  # (B, num_classes - 1)

        # Binary cross entropy for each threshold
        loss = F.binary_cross_entropy(cumulative_probs, cumulative_targets)

        return loss


class UncertaintyWeightedLoss(nn.Module):
    """
    Multi-task loss with learned uncertainty weighting.

    From Kendall et al., "Multi-Task Learning Using Uncertainty to Weigh Losses"

    Loss = Σ (1/σ_i²) * L_i + log(σ_i)

    where σ_i is learned per task.
    """

    def __init__(
        self,
        num_tasks: int = 3,
        label_smoothing: float = 0.1,
        use_ordinal_condition: bool = True,
    ):
        super().__init__()
        self.num_tasks = num_tasks
        self.use_ordinal_condition = use_ordinal_condition

        # Learnable log variance for each task (initialized to 0 = σ=1)
        self.log_vars = nn.Parameter(torch.zeros(num_tasks))

        # Task-specific loss functions
        self.card_criterion = LabelSmoothingCrossEntropy(smoothing=label_smoothing)
        self.variant_criterion = LabelSmoothingCrossEntropy(smoothing=label_smoothing)

        if use_ordinal_condition:
            self.condition_criterion = OrdinalRegressionLoss(num_classes=5)
        else:
            self.condition_criterion = LabelSmoothingCrossEntropy(smoothing=label_smoothing)

    def forward(
        self,
        outputs: Dict[str, torch.Tensor],
        labels: Dict[str, torch.Tensor],
        lam: float = 1.0,  # CutMix lambda
    ) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        """
        Compute weighted multi-task loss.

        Args:
            outputs: Dict with 'card_logits', 'variant_logits', 'condition_logits'
            labels: Dict with labels (may include _b variants for CutMix)
            lam: CutMix mixing coefficient

        Returns:
            total_loss: Weighted sum of task losses
            task_losses: Dict of individual task losses
        """
        task_losses = {}

        # Card ID loss
        if 'card_label_b' in labels:
            # CutMix: interpolate losses
            loss_a = self.card_criterion(outputs['card_logits'], labels['card_label'])
            loss_b = self.card_criterion(outputs['card_logits'], labels['card_label_b'])
            card_loss = lam * loss_a + (1 - lam) * loss_b
        else:
            card_loss = self.card_criterion(outputs['card_logits'], labels['card_label'])
        task_losses['card'] = card_loss

        # Variant loss
        if 'variant_label_b' in labels:
            loss_a = self.variant_criterion(outputs['variant_logits'], labels['variant_label'])
            loss_b = self.variant_criterion(outputs['variant_logits'], labels['variant_label_b'])
            variant_loss = lam * loss_a + (1 - lam) * loss_b
        else:
            variant_loss = self.variant_criterion(outputs['variant_logits'], labels['variant_label'])
        task_losses['variant'] = variant_loss

        # Condition loss (handle missing labels)
        valid_condition = labels['condition_label'] >= 0
        if valid_condition.any():
            if 'condition_label_b' in labels:
                valid_b = labels['condition_label_b'] >= 0
                valid_both = valid_condition & valid_b

                if valid_both.any():
                    loss_a = self.condition_criterion(
                        outputs['condition_logits'][valid_both],
                        labels['condition_label'][valid_both]
                    )
                    loss_b = self.condition_criterion(
                        outputs['condition_logits'][valid_both],
                        labels['condition_label_b'][valid_both]
                    )
                    condition_loss = lam * loss_a + (1 - lam) * loss_b
                else:
                    condition_loss = torch.tensor(0.0, device=outputs['card_logits'].device)
            else:
                condition_loss = self.condition_criterion(
                    outputs['condition_logits'][valid_condition],
                    labels['condition_label'][valid_condition]
                )
        else:
            condition_loss = torch.tensor(0.0, device=outputs['card_logits'].device)
        task_losses['condition'] = condition_loss

        # Apply uncertainty weighting
        total_loss = 0
        losses_list = [card_loss, variant_loss, condition_loss]

        for i, loss in enumerate(losses_list):
            precision = torch.exp(-self.log_vars[i])
            total_loss = total_loss + precision * loss + self.log_vars[i]

        # Store learned weights for logging
        task_losses['weight_card'] = torch.exp(-self.log_vars[0])
        task_losses['weight_variant'] = torch.exp(-self.log_vars[1])
        task_losses['weight_condition'] = torch.exp(-self.log_vars[2])

        return total_loss, task_losses


class DynamicWeightAverage:
    """
    Dynamic Weight Average (DWA) for multi-task learning.

    Adjusts weights based on loss descent rate.
    """

    def __init__(self, num_tasks: int = 3, temp: float = 2.0):
        self.num_tasks = num_tasks
        self.temp = temp
        self.prev_losses: Optional[List[float]] = None

    def get_weights(self, current_losses: List[float]) -> List[float]:
        """
        Compute task weights based on loss descent.

        Args:
            current_losses: List of current task losses

        Returns:
            List of task weights
        """
        if self.prev_losses is None:
            self.prev_losses = current_losses
            return [1.0] * self.num_tasks

        # Compute relative descent (higher = loss decreasing slower = harder task)
        ratios = []
        for curr, prev in zip(current_losses, self.prev_losses):
            if prev > 0:
                ratios.append(curr / prev)
            else:
                ratios.append(1.0)

        # Softmax with temperature
        ratios_tensor = torch.tensor(ratios)
        weights = F.softmax(ratios_tensor / self.temp, dim=0)

        # Scale to sum to num_tasks (so average weight = 1)
        weights = weights * self.num_tasks

        self.prev_losses = current_losses
        return weights.tolist()


class StaticWeightedLoss(nn.Module):
    """
    Simple static-weighted multi-task loss.

    Useful as a baseline before trying more complex weighting.
    """

    def __init__(
        self,
        card_weight: float = 1.0,
        variant_weight: float = 0.5,
        condition_weight: float = 1.0,
        label_smoothing: float = 0.1,
        use_ordinal_condition: bool = True,
    ):
        super().__init__()

        self.weights = {
            'card': card_weight,
            'variant': variant_weight,
            'condition': condition_weight,
        }

        self.card_criterion = LabelSmoothingCrossEntropy(smoothing=label_smoothing)
        self.variant_criterion = LabelSmoothingCrossEntropy(smoothing=label_smoothing)

        if use_ordinal_condition:
            self.condition_criterion = OrdinalRegressionLoss(num_classes=5)
        else:
            self.condition_criterion = LabelSmoothingCrossEntropy(smoothing=label_smoothing)

    def forward(
        self,
        outputs: Dict[str, torch.Tensor],
        labels: Dict[str, torch.Tensor],
        lam: float = 1.0,
    ) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        """Compute weighted multi-task loss."""
        task_losses = {}

        # Card loss
        card_loss = self.card_criterion(outputs['card_logits'], labels['card_label'])
        task_losses['card'] = card_loss

        # Variant loss
        variant_loss = self.variant_criterion(outputs['variant_logits'], labels['variant_label'])
        task_losses['variant'] = variant_loss

        # Condition loss
        valid = labels['condition_label'] >= 0
        if valid.any():
            condition_loss = self.condition_criterion(
                outputs['condition_logits'][valid],
                labels['condition_label'][valid]
            )
        else:
            condition_loss = torch.tensor(0.0, device=outputs['card_logits'].device)
        task_losses['condition'] = condition_loss

        # Weighted sum
        total_loss = (
            self.weights['card'] * card_loss +
            self.weights['variant'] * variant_loss +
            self.weights['condition'] * condition_loss
        )

        return total_loss, task_losses


def create_loss_function(config) -> nn.Module:
    """Create loss function from config."""
    if config.loss.weighting_strategy == "uncertainty":
        return UncertaintyWeightedLoss(
            num_tasks=3,
            label_smoothing=config.training.label_smoothing,
            use_ordinal_condition=config.loss.use_ordinal_condition,
        )
    else:
        return StaticWeightedLoss(
            card_weight=config.loss.card_weight,
            variant_weight=config.loss.variant_weight,
            condition_weight=config.loss.condition_weight,
            label_smoothing=config.training.label_smoothing,
            use_ordinal_condition=config.loss.use_ordinal_condition,
        )
