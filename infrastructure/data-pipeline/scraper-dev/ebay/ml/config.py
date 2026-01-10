"""
Training Configuration for EfficientNet-B4 Card Recognition

Optimized settings based on research for:
- Small dataset (~1,100 images)
- Multi-task learning (card ID, variant, condition)
- Transfer learning from ImageNet
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional
from pathlib import Path


@dataclass
class ModelConfig:
    """Model architecture configuration."""
    backbone: str = "efficientnet_b4"
    input_size: int = 380
    dropout: float = 0.4
    drop_connect_rate: float = 0.3

    # Task-specific output dimensions
    num_card_classes: int = 515
    num_variant_classes: int = 6
    num_condition_classes: int = 5

    # Variant class names
    variant_classes: List[str] = field(default_factory=lambda: [
        "parallel", "sp", "manga", "tr", "boxtopper", "wantedposter"
    ])

    # Condition class names (ordered)
    condition_classes: List[str] = field(default_factory=lambda: [
        "NM", "LP", "MP", "HP", "DMG"
    ])


@dataclass
class TrainingConfig:
    """Training hyperparameters."""
    # Training phases
    phase1_epochs: int = 10  # Frozen backbone
    phase2_epochs: int = 15  # Partial fine-tuning
    phase3_epochs: int = 10  # Full fine-tuning

    # Learning rates per phase
    phase1_lr: float = 1e-3
    phase2_lr: float = 1e-4
    phase3_lr: float = 1e-5

    # Optimizer
    optimizer: str = "AdamW"
    weight_decay: float = 1e-4
    betas: tuple = (0.9, 0.999)

    # Batch size
    batch_size: int = 16
    accumulation_steps: int = 4  # Effective batch = 64
    num_workers: int = 4

    # Scheduler
    scheduler: str = "OneCycleLR"
    pct_start: float = 0.1  # 10% warmup

    # Regularization
    label_smoothing: float = 0.1
    cutmix_prob: float = 0.5
    cutmix_alpha: float = 1.0

    # Early stopping
    patience: int = 10
    min_delta: float = 1e-4

    # Mixed precision
    use_amp: bool = True


@dataclass
class DataConfig:
    """Data loading configuration."""
    # S3 paths
    s3_bucket: str = "tcg-training-data"
    s3_prefix: str = "onepiece-tcg/op01-prototype"

    # Local cache
    cache_dir: Path = field(default_factory=lambda: Path("./data/cache"))

    # Train/val/test split
    train_split: float = 0.8
    val_split: float = 0.1
    test_split: float = 0.1

    # Image settings
    image_resolution: int = 380  # EfficientNet-B4 optimal
    use_1600px: bool = True  # Use high-res images for condition

    # ImageNet normalization (required for pretrained weights)
    mean: List[float] = field(default_factory=lambda: [0.485, 0.456, 0.406])
    std: List[float] = field(default_factory=lambda: [0.229, 0.224, 0.225])


@dataclass
class LossConfig:
    """Loss function configuration."""
    # Loss weighting strategy
    weighting_strategy: str = "uncertainty"  # "static", "uncertainty", "dwa"

    # Static weights (if using static strategy)
    card_weight: float = 1.0
    variant_weight: float = 0.5
    condition_weight: float = 1.0

    # Use ordinal loss for condition
    use_ordinal_condition: bool = True


@dataclass
class LoggingConfig:
    """Logging and checkpointing configuration."""
    # Weights & Biases
    use_wandb: bool = True
    wandb_project: str = "optcg-card-recognition"
    wandb_entity: Optional[str] = None

    # Checkpoints
    checkpoint_dir: Path = field(default_factory=lambda: Path("./checkpoints"))
    save_every_n_epochs: int = 5
    save_best_only: bool = True

    # Logging frequency
    log_every_n_steps: int = 10


@dataclass
class Config:
    """Master configuration."""
    model: ModelConfig = field(default_factory=ModelConfig)
    training: TrainingConfig = field(default_factory=TrainingConfig)
    data: DataConfig = field(default_factory=DataConfig)
    loss: LossConfig = field(default_factory=LossConfig)
    logging: LoggingConfig = field(default_factory=LoggingConfig)

    # Experiment name
    experiment_name: str = "efficientnet_b4_optcg_v1"

    # Device
    device: str = "cuda"

    # Reproducibility
    seed: int = 42


def get_config() -> Config:
    """Get default configuration."""
    return Config()


def get_config_from_file(path: str) -> Config:
    """Load configuration from YAML file."""
    import yaml

    with open(path, "r") as f:
        data = yaml.safe_load(f)

    config = Config()

    # Override defaults with file values
    if "model" in data:
        for k, v in data["model"].items():
            setattr(config.model, k, v)

    if "training" in data:
        for k, v in data["training"].items():
            setattr(config.training, k, v)

    if "data" in data:
        for k, v in data["data"].items():
            if k in ["cache_dir"]:
                v = Path(v)
            setattr(config.data, k, v)

    if "loss" in data:
        for k, v in data["loss"].items():
            setattr(config.loss, k, v)

    if "logging" in data:
        for k, v in data["logging"].items():
            if k in ["checkpoint_dir"]:
                v = Path(v)
            setattr(config.logging, k, v)

    return config
