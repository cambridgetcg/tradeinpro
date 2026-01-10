"""
Data Augmentation for TCG Card Recognition

Implements card-safe augmentation strategies:
- Avoids horizontal flip (cards are asymmetric)
- Limited rotation (cards have fixed orientation)
- Color jittering for different lighting conditions
- CutMix for improved generalization
"""

import numpy as np
import torch
import albumentations as A
from albumentations.pytorch import ToTensorV2
from typing import Callable, Tuple


def get_train_transform(config) -> Callable:
    """
    Get training augmentation pipeline.

    Optimized for trading card images with:
    - Limited geometric transforms (cards have orientation)
    - Strong color augmentation (different lighting/cameras)
    - Noise injection for robustness
    """
    return A.Compose([
        # Spatial transforms (card-safe)
        A.RandomResizedCrop(
            height=config.data.image_resolution,
            width=config.data.image_resolution,
            scale=(0.85, 1.0),  # Don't crop too aggressively
            ratio=(0.95, 1.05),  # Cards are roughly square
            p=1.0,
        ),

        # Limited rotation - cards are always upright
        A.Rotate(limit=10, border_mode=0, p=0.5),

        # NO horizontal flip - cards are asymmetric!
        # A.HorizontalFlip(p=0.0),

        # Slight shift and scale
        A.ShiftScaleRotate(
            shift_limit=0.05,
            scale_limit=0.05,
            rotate_limit=5,
            border_mode=0,
            p=0.3,
        ),

        # Perspective transform (simulate different camera angles)
        A.Perspective(scale=(0.02, 0.05), p=0.2),

        # Color transforms (handle different lighting conditions)
        A.OneOf([
            A.ColorJitter(
                brightness=0.2,
                contrast=0.2,
                saturation=0.2,
                hue=0.05,  # Limit hue shift to preserve card colors
            ),
            A.RandomBrightnessContrast(
                brightness_limit=0.2,
                contrast_limit=0.2,
            ),
            A.HueSaturationValue(
                hue_shift_limit=5,  # Limited to preserve card colors
                sat_shift_limit=20,
                val_shift_limit=20,
            ),
        ], p=0.8),

        # Simulate different camera conditions
        A.OneOf([
            A.GaussianBlur(blur_limit=(3, 5)),
            A.MotionBlur(blur_limit=5),
            A.MedianBlur(blur_limit=3),
        ], p=0.15),

        # Simulate image compression artifacts
        A.ImageCompression(quality_lower=75, quality_upper=100, p=0.2),

        # Add slight noise
        A.OneOf([
            A.GaussNoise(var_limit=(5, 30)),
            A.ISONoise(color_shift=(0.01, 0.03), intensity=(0.1, 0.3)),
        ], p=0.2),

        # Random shadow (simulates lighting)
        A.RandomShadow(
            shadow_roi=(0, 0, 1, 1),
            num_shadows_lower=1,
            num_shadows_upper=2,
            shadow_dimension=5,
            p=0.1,
        ),

        # Normalize to ImageNet stats (required for pretrained weights)
        A.Normalize(
            mean=config.data.mean,
            std=config.data.std,
        ),

        ToTensorV2(),
    ])


def get_val_transform(config) -> Callable:
    """
    Get validation/test transform.

    Only resize and normalize - no augmentation.
    """
    return A.Compose([
        A.Resize(
            height=config.data.image_resolution,
            width=config.data.image_resolution,
        ),
        A.Normalize(
            mean=config.data.mean,
            std=config.data.std,
        ),
        ToTensorV2(),
    ])


def get_tta_transforms(config) -> list:
    """
    Get test-time augmentation transforms.

    Returns multiple transforms to average predictions over.
    """
    base_normalize = A.Compose([
        A.Normalize(mean=config.data.mean, std=config.data.std),
        ToTensorV2(),
    ])

    return [
        # Original
        A.Compose([
            A.Resize(config.data.image_resolution, config.data.image_resolution),
            base_normalize,
        ]),
        # Slight rotation variants
        A.Compose([
            A.Resize(config.data.image_resolution, config.data.image_resolution),
            A.Rotate(limit=(5, 5), p=1.0),
            base_normalize,
        ]),
        A.Compose([
            A.Resize(config.data.image_resolution, config.data.image_resolution),
            A.Rotate(limit=(-5, -5), p=1.0),
            base_normalize,
        ]),
        # Scale variants
        A.Compose([
            A.RandomResizedCrop(
                config.data.image_resolution,
                config.data.image_resolution,
                scale=(0.9, 0.9),
            ),
            base_normalize,
        ]),
        A.Compose([
            A.RandomResizedCrop(
                config.data.image_resolution,
                config.data.image_resolution,
                scale=(1.0, 1.0),
            ),
            base_normalize,
        ]),
    ]


# ============================================================================
# CutMix Implementation
# ============================================================================

def rand_bbox(size: Tuple[int, ...], lam: float) -> Tuple[int, int, int, int]:
    """Generate random bounding box for CutMix."""
    W = size[-1]
    H = size[-2]

    cut_rat = np.sqrt(1.0 - lam)
    cut_w = int(W * cut_rat)
    cut_h = int(H * cut_rat)

    # Uniform center
    cx = np.random.randint(W)
    cy = np.random.randint(H)

    bbx1 = np.clip(cx - cut_w // 2, 0, W)
    bby1 = np.clip(cy - cut_h // 2, 0, H)
    bbx2 = np.clip(cx + cut_w // 2, 0, W)
    bby2 = np.clip(cy + cut_h // 2, 0, H)

    return bbx1, bby1, bbx2, bby2


def cutmix_data(
    images: torch.Tensor,
    labels: dict,
    alpha: float = 1.0,
) -> Tuple[torch.Tensor, dict, float]:
    """
    Apply CutMix augmentation to a batch.

    Args:
        images: (B, C, H, W) tensor
        labels: dict with 'card_label', 'variant_label', 'condition_label'
        alpha: Beta distribution parameter

    Returns:
        mixed_images: Augmented images
        mixed_labels: Dict with mixed labels and original indices
        lam: Mixing coefficient
    """
    if alpha <= 0:
        return images, labels, 1.0

    lam = np.random.beta(alpha, alpha)
    batch_size = images.size(0)
    rand_index = torch.randperm(batch_size).to(images.device)

    # Generate random bounding box
    bbx1, bby1, bbx2, bby2 = rand_bbox(images.size(), lam)

    # Mix images
    mixed_images = images.clone()
    mixed_images[:, :, bby1:bby2, bbx1:bbx2] = images[rand_index, :, bby1:bby2, bbx1:bbx2]

    # Adjust lambda for actual area
    lam = 1 - ((bbx2 - bbx1) * (bby2 - bby1) / (images.size(-1) * images.size(-2)))

    # Store both label sets for mixed loss computation
    mixed_labels = {
        'card_label': labels['card_label'],
        'card_label_b': labels['card_label'][rand_index],
        'variant_label': labels['variant_label'],
        'variant_label_b': labels['variant_label'][rand_index],
        'condition_label': labels['condition_label'],
        'condition_label_b': labels['condition_label'][rand_index],
        'rand_index': rand_index,
    }

    return mixed_images, mixed_labels, lam


def mixup_data(
    images: torch.Tensor,
    labels: dict,
    alpha: float = 1.0,
) -> Tuple[torch.Tensor, dict, float]:
    """
    Apply MixUp augmentation to a batch.

    Simpler than CutMix - just linear interpolation of images.
    """
    if alpha <= 0:
        return images, labels, 1.0

    lam = np.random.beta(alpha, alpha)
    batch_size = images.size(0)
    rand_index = torch.randperm(batch_size).to(images.device)

    # Mix images
    mixed_images = lam * images + (1 - lam) * images[rand_index]

    # Store both label sets
    mixed_labels = {
        'card_label': labels['card_label'],
        'card_label_b': labels['card_label'][rand_index],
        'variant_label': labels['variant_label'],
        'variant_label_b': labels['variant_label'][rand_index],
        'condition_label': labels['condition_label'],
        'condition_label_b': labels['condition_label'][rand_index],
        'rand_index': rand_index,
    }

    return mixed_images, mixed_labels, lam


# ============================================================================
# Corner Crop Extraction for Condition Assessment
# ============================================================================

def extract_corner_crops(
    images: torch.Tensor,
    crop_size: int = 112,
) -> torch.Tensor:
    """
    Extract corner crops from images for condition assessment.

    Args:
        images: (B, C, H, W) tensor
        crop_size: Size of corner crops

    Returns:
        corners: (B, 4, C, crop_size, crop_size) tensor
    """
    B, C, H, W = images.shape

    # Extract corners: TL, TR, BL, BR
    tl = images[:, :, :crop_size, :crop_size]
    tr = images[:, :, :crop_size, W-crop_size:]
    bl = images[:, :, H-crop_size:, :crop_size]
    br = images[:, :, H-crop_size:, W-crop_size:]

    # Stack corners
    corners = torch.stack([tl, tr, bl, br], dim=1)  # (B, 4, C, H, W)

    return corners


def extract_edge_strips(
    images: torch.Tensor,
    strip_width: int = 20,
) -> torch.Tensor:
    """
    Extract edge strips from images for detecting edge wear.

    Args:
        images: (B, C, H, W) tensor
        strip_width: Width of edge strips

    Returns:
        edges: (B, 4, C, strip_width, max_dim) tensor
    """
    B, C, H, W = images.shape

    # Extract edges: Top, Bottom, Left, Right
    top = images[:, :, :strip_width, :]
    bottom = images[:, :, H-strip_width:, :]
    left = images[:, :, :, :strip_width].permute(0, 1, 3, 2)  # Rotate for consistency
    right = images[:, :, :, W-strip_width:].permute(0, 1, 3, 2)

    return {
        'top': top,
        'bottom': bottom,
        'left': left,
        'right': right,
    }
