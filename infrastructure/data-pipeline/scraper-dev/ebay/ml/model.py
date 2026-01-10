"""
EfficientNet-B4 Multi-Task Model for TCG Card Recognition

Architecture:
- Pretrained EfficientNet-B4 backbone
- Shared feature layer
- Task-specific heads for card ID, variant, and condition
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision.models import efficientnet_b4, EfficientNet_B4_Weights
from typing import Dict, Optional, Tuple
from dataclasses import dataclass


@dataclass
class ModelOutput:
    """Model output container."""
    card_logits: torch.Tensor
    variant_logits: torch.Tensor
    condition_logits: torch.Tensor
    features: Optional[torch.Tensor] = None


class AttentionPooling(nn.Module):
    """Attention-based pooling for better feature aggregation."""

    def __init__(self, in_features: int, hidden_features: int = 256):
        super().__init__()
        self.attention = nn.Sequential(
            nn.Linear(in_features, hidden_features),
            nn.Tanh(),
            nn.Linear(hidden_features, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, C, H, W) -> (B, H*W, C)
        B, C, H, W = x.shape
        x_flat = x.view(B, C, -1).permute(0, 2, 1)  # (B, H*W, C)

        # Compute attention weights
        attn_weights = self.attention(x_flat)  # (B, H*W, 1)
        attn_weights = F.softmax(attn_weights, dim=1)

        # Weighted sum
        out = (x_flat * attn_weights).sum(dim=1)  # (B, C)
        return out


class CardRecognitionModel(nn.Module):
    """
    Multi-task EfficientNet-B4 model for card recognition.

    Tasks:
    - Card ID classification (515 classes)
    - Variant detection (6 classes)
    - Condition assessment (5 classes, ordinal)
    """

    def __init__(
        self,
        num_card_classes: int = 515,
        num_variant_classes: int = 6,
        num_condition_classes: int = 5,
        dropout: float = 0.4,
        pretrained: bool = True,
        use_attention_pooling: bool = False,
    ):
        super().__init__()

        self.num_card_classes = num_card_classes
        self.num_variant_classes = num_variant_classes
        self.num_condition_classes = num_condition_classes

        # Load pretrained EfficientNet-B4
        if pretrained:
            self.backbone = efficientnet_b4(weights=EfficientNet_B4_Weights.IMAGENET1K_V1)
        else:
            self.backbone = efficientnet_b4(weights=None)

        # Get backbone output dimension
        self.backbone_out_features = self.backbone.classifier[1].in_features  # 1792

        # Remove original classifier
        self.backbone.classifier = nn.Identity()

        # Optional attention pooling
        self.use_attention_pooling = use_attention_pooling
        if use_attention_pooling:
            self.attention_pool = AttentionPooling(self.backbone_out_features)

        # Shared feature layer
        self.shared_fc = nn.Sequential(
            nn.Linear(self.backbone_out_features, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
        )

        # Task-specific heads
        self.card_head = nn.Sequential(
            nn.Linear(512, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout * 0.5),
            nn.Linear(256, num_card_classes),
        )

        self.variant_head = nn.Sequential(
            nn.Linear(512, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout * 0.5),
            nn.Linear(128, num_variant_classes),
        )

        self.condition_head = nn.Sequential(
            nn.Linear(512, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout * 0.5),
            nn.Linear(128, num_condition_classes),
        )

        # Initialize heads
        self._init_heads()

    def _init_heads(self):
        """Initialize head layers with proper weights."""
        for module in [self.shared_fc, self.card_head, self.variant_head, self.condition_head]:
            for m in module.modules():
                if isinstance(m, nn.Linear):
                    nn.init.kaiming_normal_(m.weight, mode='fan_out', nonlinearity='relu')
                    if m.bias is not None:
                        nn.init.zeros_(m.bias)

    def freeze_backbone(self):
        """Freeze all backbone layers for Phase 1 training."""
        for param in self.backbone.parameters():
            param.requires_grad = False

    def unfreeze_top_layers(self, num_blocks: int = 2):
        """
        Unfreeze top N MBConv blocks for Phase 2 training.

        EfficientNet-B4 has blocks indexed 0-6 in self.backbone.features
        """
        # First, freeze everything
        self.freeze_backbone()

        # Unfreeze last N blocks
        total_blocks = len(self.backbone.features)
        for i in range(total_blocks - num_blocks, total_blocks):
            for param in self.backbone.features[i].parameters():
                param.requires_grad = True

        # Always unfreeze the final conv and batch norm
        for name, param in self.backbone.named_parameters():
            if 'features.8' in name:  # Final conv block
                param.requires_grad = True

    def unfreeze_all(self):
        """Unfreeze entire model for Phase 3 training."""
        for param in self.backbone.parameters():
            param.requires_grad = True

    def get_trainable_params(self) -> int:
        """Count trainable parameters."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)

    def forward(
        self,
        x: torch.Tensor,
        return_features: bool = False,
    ) -> ModelOutput:
        """
        Forward pass.

        Args:
            x: Input images (B, 3, 380, 380)
            return_features: Whether to return intermediate features

        Returns:
            ModelOutput with logits for each task
        """
        # Backbone feature extraction
        features = self.backbone.features(x)

        if self.use_attention_pooling:
            pooled = self.attention_pool(features)
        else:
            # Global average pooling
            pooled = self.backbone.avgpool(features)
            pooled = torch.flatten(pooled, 1)

        # Shared layer
        shared = self.shared_fc(pooled)

        # Task-specific outputs
        card_logits = self.card_head(shared)
        variant_logits = self.variant_head(shared)
        condition_logits = self.condition_head(shared)

        return ModelOutput(
            card_logits=card_logits,
            variant_logits=variant_logits,
            condition_logits=condition_logits,
            features=shared if return_features else None,
        )

    def get_embeddings(self, x: torch.Tensor) -> torch.Tensor:
        """Get feature embeddings for similarity search."""
        with torch.no_grad():
            features = self.backbone.features(x)
            pooled = self.backbone.avgpool(features)
            pooled = torch.flatten(pooled, 1)
            return self.shared_fc(pooled)


class MultiCropConditionModel(nn.Module):
    """
    Enhanced condition assessment model using multiple image crops.

    Crops corners and edges to better detect wear and damage.
    """

    def __init__(
        self,
        backbone: nn.Module,
        num_conditions: int = 5,
        hidden_dim: int = 256,
    ):
        super().__init__()

        self.backbone = backbone
        self.backbone_out = 1792  # EfficientNet-B4 output

        # Feature projection for each crop
        self.crop_projector = nn.Sequential(
            nn.Linear(self.backbone_out, hidden_dim),
            nn.ReLU(inplace=True),
        )

        # Self-attention over crops
        self.attention = nn.MultiheadAttention(
            embed_dim=hidden_dim,
            num_heads=4,
            dropout=0.1,
            batch_first=True,
        )

        # Final classifier
        self.classifier = nn.Sequential(
            nn.Linear(hidden_dim * 5, 128),  # 5 crops
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(128, num_conditions),
        )

    def forward(
        self,
        full_image: torch.Tensor,
        corner_crops: torch.Tensor,
    ) -> torch.Tensor:
        """
        Args:
            full_image: (B, 3, 380, 380)
            corner_crops: (B, 4, 3, 112, 112) - TL, TR, BL, BR
        """
        B = full_image.size(0)

        # Process full image
        full_feat = self._extract_features(full_image)
        full_embed = self.crop_projector(full_feat)  # (B, hidden_dim)

        # Process corner crops
        corners_flat = corner_crops.view(B * 4, 3, 112, 112)
        # Resize corners to 380x380 for backbone
        corners_resized = F.interpolate(corners_flat, size=(380, 380), mode='bilinear')
        corner_feats = self._extract_features(corners_resized)  # (B*4, backbone_out)
        corner_embeds = self.crop_projector(corner_feats)  # (B*4, hidden_dim)
        corner_embeds = corner_embeds.view(B, 4, -1)  # (B, 4, hidden_dim)

        # Stack all embeddings
        all_embeds = torch.cat([
            full_embed.unsqueeze(1),  # (B, 1, hidden_dim)
            corner_embeds,  # (B, 4, hidden_dim)
        ], dim=1)  # (B, 5, hidden_dim)

        # Self-attention
        attended, _ = self.attention(all_embeds, all_embeds, all_embeds)

        # Flatten and classify
        flat = attended.view(B, -1)  # (B, 5 * hidden_dim)
        return self.classifier(flat)

    def _extract_features(self, x: torch.Tensor) -> torch.Tensor:
        """Extract backbone features."""
        features = self.backbone.features(x)
        pooled = self.backbone.avgpool(features)
        return torch.flatten(pooled, 1)


def create_model(config) -> CardRecognitionModel:
    """Create model from config."""
    return CardRecognitionModel(
        num_card_classes=config.model.num_card_classes,
        num_variant_classes=config.model.num_variant_classes,
        num_condition_classes=config.model.num_condition_classes,
        dropout=config.model.dropout,
        pretrained=True,
    )


def load_checkpoint(
    model: CardRecognitionModel,
    checkpoint_path: str,
    device: str = "cuda",
) -> Tuple[CardRecognitionModel, Dict]:
    """Load model from checkpoint."""
    checkpoint = torch.load(checkpoint_path, map_location=device)
    model.load_state_dict(checkpoint["model_state_dict"])

    return model, {
        "epoch": checkpoint.get("epoch", 0),
        "best_val_loss": checkpoint.get("best_val_loss", float("inf")),
        "config": checkpoint.get("config", None),
    }


def save_checkpoint(
    model: CardRecognitionModel,
    optimizer,
    epoch: int,
    val_loss: float,
    config,
    path: str,
):
    """Save model checkpoint."""
    torch.save({
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "epoch": epoch,
        "best_val_loss": val_loss,
        "config": config,
    }, path)
