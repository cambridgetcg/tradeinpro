"""
TCG Card Recognition ML Module

Multi-task EfficientNet-B4 model for:
- Card identification (515+ classes)
- Variant detection (parallel, SP, manga, etc.)
- Condition assessment (NM, LP, MP, HP, DMG)
"""

from .config import Config, get_config
from .model import CardRecognitionModel, create_model
from .dataset import CardDataset, CardDataModule
from .losses import UncertaintyWeightedLoss, OrdinalRegressionLoss
from .trainer import Trainer
from .evaluate import Evaluator, InferenceEngine

__version__ = "1.0.0"

__all__ = [
    "Config",
    "get_config",
    "CardRecognitionModel",
    "create_model",
    "CardDataset",
    "CardDataModule",
    "UncertaintyWeightedLoss",
    "OrdinalRegressionLoss",
    "Trainer",
    "Evaluator",
    "InferenceEngine",
]
