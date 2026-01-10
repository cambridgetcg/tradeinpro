"""
Dataset and Data Loading for TCG Card Recognition

Handles:
- Loading images from S3 or local cache
- Label extraction from S3 metadata/file structure
- Train/val/test splitting
- Efficient data loading with caching
"""

import os
import json
import torch
import numpy as np
from pathlib import Path
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from typing import Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass
import boto3
from io import BytesIO
import hashlib


@dataclass
class CardSample:
    """Single card sample with all labels."""
    image_path: str
    card_id: str
    variant_type: str
    language: str
    condition: Optional[str] = None  # May not always be available
    ebay_item_id: str = ""
    price_usd: Optional[float] = None


class CardDataset(Dataset):
    """
    Dataset for TCG card images.

    Loads images from S3 or local cache with labels derived from
    the directory structure and S3 metadata.
    """

    def __init__(
        self,
        samples: List[CardSample],
        card_to_idx: Dict[str, int],
        variant_to_idx: Dict[str, int],
        condition_to_idx: Dict[str, int],
        transform: Optional[Callable] = None,
        cache_dir: Optional[Path] = None,
        use_s3: bool = False,
        s3_bucket: str = "tcg-training-data",
    ):
        self.samples = samples
        self.card_to_idx = card_to_idx
        self.variant_to_idx = variant_to_idx
        self.condition_to_idx = condition_to_idx
        self.transform = transform
        self.cache_dir = cache_dir
        self.use_s3 = use_s3
        self.s3_bucket = s3_bucket

        if use_s3:
            self.s3_client = boto3.client('s3')

        # Create cache directory
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        sample = self.samples[idx]

        # Load image
        image = self._load_image(sample.image_path)

        # Apply transforms
        if self.transform:
            transformed = self.transform(image=np.array(image))
            image = transformed["image"]
        else:
            image = torch.from_numpy(np.array(image)).permute(2, 0, 1).float() / 255.0

        # Get labels
        card_label = self.card_to_idx.get(sample.card_id, -1)
        variant_label = self.variant_to_idx.get(sample.variant_type, -1)

        # Condition might not be available for all samples
        if sample.condition and sample.condition in self.condition_to_idx:
            condition_label = self.condition_to_idx[sample.condition]
        else:
            condition_label = -1  # Unknown/not labeled

        return {
            "image": image,
            "card_label": torch.tensor(card_label, dtype=torch.long),
            "variant_label": torch.tensor(variant_label, dtype=torch.long),
            "condition_label": torch.tensor(condition_label, dtype=torch.long),
            "card_id": sample.card_id,
            "variant_type": sample.variant_type,
        }

    def _load_image(self, path: str) -> Image.Image:
        """Load image from S3 or local path."""
        if self.use_s3:
            return self._load_from_s3(path)
        else:
            return Image.open(path).convert("RGB")

    def _load_from_s3(self, s3_key: str) -> Image.Image:
        """Load image from S3 with local caching."""
        if self.cache_dir:
            # Create cache key from S3 path
            cache_key = hashlib.md5(s3_key.encode()).hexdigest()
            cache_path = self.cache_dir / f"{cache_key}.jpg"

            if cache_path.exists():
                return Image.open(cache_path).convert("RGB")

        # Download from S3
        response = self.s3_client.get_object(Bucket=self.s3_bucket, Key=s3_key)
        image_data = response['Body'].read()
        image = Image.open(BytesIO(image_data)).convert("RGB")

        # Cache locally
        if self.cache_dir:
            image.save(cache_path, "JPEG", quality=95)

        return image


class CardDataModule:
    """
    Data module for managing train/val/test datasets.

    Handles:
    - Loading manifest from S3
    - Splitting data
    - Creating dataloaders
    - Managing label mappings
    """

    def __init__(
        self,
        s3_bucket: str = "tcg-training-data",
        s3_prefix: str = "onepiece-tcg/op01-prototype",
        cache_dir: Path = Path("./data/cache"),
        train_split: float = 0.8,
        val_split: float = 0.1,
        batch_size: int = 16,
        num_workers: int = 4,
        train_transform: Optional[Callable] = None,
        val_transform: Optional[Callable] = None,
        seed: int = 42,
    ):
        self.s3_bucket = s3_bucket
        self.s3_prefix = s3_prefix
        self.cache_dir = cache_dir
        self.train_split = train_split
        self.val_split = val_split
        self.batch_size = batch_size
        self.num_workers = num_workers
        self.train_transform = train_transform
        self.val_transform = val_transform
        self.seed = seed

        self.s3_client = boto3.client('s3')

        # Initialize mappings
        self.card_to_idx: Dict[str, int] = {}
        self.variant_to_idx: Dict[str, int] = {}
        self.condition_to_idx: Dict[str, int] = {}

        # Datasets
        self.train_dataset: Optional[CardDataset] = None
        self.val_dataset: Optional[CardDataset] = None
        self.test_dataset: Optional[CardDataset] = None

    def setup(self):
        """Load data and create datasets."""
        # Load manifest from S3
        samples = self._load_manifest()

        # Build label mappings
        self._build_mappings(samples)

        # Split data
        train_samples, val_samples, test_samples = self._split_data(samples)

        # Create datasets
        self.train_dataset = CardDataset(
            samples=train_samples,
            card_to_idx=self.card_to_idx,
            variant_to_idx=self.variant_to_idx,
            condition_to_idx=self.condition_to_idx,
            transform=self.train_transform,
            cache_dir=self.cache_dir / "train",
            use_s3=True,
            s3_bucket=self.s3_bucket,
        )

        self.val_dataset = CardDataset(
            samples=val_samples,
            card_to_idx=self.card_to_idx,
            variant_to_idx=self.variant_to_idx,
            condition_to_idx=self.condition_to_idx,
            transform=self.val_transform,
            cache_dir=self.cache_dir / "val",
            use_s3=True,
            s3_bucket=self.s3_bucket,
        )

        self.test_dataset = CardDataset(
            samples=test_samples,
            card_to_idx=self.card_to_idx,
            variant_to_idx=self.variant_to_idx,
            condition_to_idx=self.condition_to_idx,
            transform=self.val_transform,
            cache_dir=self.cache_dir / "test",
            use_s3=True,
            s3_bucket=self.s3_bucket,
        )

        print(f"Dataset loaded:")
        print(f"  Train: {len(self.train_dataset)} samples")
        print(f"  Val: {len(self.val_dataset)} samples")
        print(f"  Test: {len(self.test_dataset)} samples")
        print(f"  Card classes: {len(self.card_to_idx)}")
        print(f"  Variant classes: {len(self.variant_to_idx)}")

    def _load_manifest(self) -> List[CardSample]:
        """Load manifest from S3 and parse into samples."""
        manifest_key = f"{self.s3_prefix}/manifest.json"

        try:
            response = self.s3_client.get_object(
                Bucket=self.s3_bucket,
                Key=manifest_key
            )
            manifest = json.loads(response['Body'].read().decode('utf-8'))
        except Exception as e:
            print(f"Error loading manifest: {e}")
            # Try to build from S3 listing
            return self._build_samples_from_listing()

        samples = []
        for img_data in manifest.get("images", []):
            sample = CardSample(
                image_path=img_data["s3Key"],
                card_id=img_data["cardId"],
                variant_type=img_data["variantType"],
                language=img_data["language"],
                ebay_item_id=img_data.get("ebayItemId", ""),
                price_usd=img_data.get("priceUsd"),
            )
            samples.append(sample)

        return samples

    def _build_samples_from_listing(self) -> List[CardSample]:
        """Build samples by listing S3 bucket."""
        samples = []

        paginator = self.s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(
            Bucket=self.s3_bucket,
            Prefix=self.s3_prefix
        )

        for page in pages:
            for obj in page.get('Contents', []):
                key = obj['Key']
                if not key.endswith('.jpg'):
                    continue

                # Parse path: prefix/card_id/variant_type/language/resolution/item_id.jpg
                parts = key.split('/')
                if len(parts) >= 6:
                    sample = CardSample(
                        image_path=key,
                        card_id=parts[-5],
                        variant_type=parts[-4],
                        language=parts[-3],
                        ebay_item_id=parts[-1].replace('.jpg', ''),
                    )
                    samples.append(sample)

        return samples

    def _build_mappings(self, samples: List[CardSample]):
        """Build label index mappings."""
        # Card IDs
        card_ids = sorted(set(s.card_id for s in samples))
        self.card_to_idx = {card: idx for idx, card in enumerate(card_ids)}
        self.idx_to_card = {idx: card for card, idx in self.card_to_idx.items()}

        # Variants
        variants = sorted(set(s.variant_type for s in samples))
        self.variant_to_idx = {var: idx for idx, var in enumerate(variants)}
        self.idx_to_variant = {idx: var for var, idx in self.variant_to_idx.items()}

        # Conditions (fixed order for ordinal regression)
        conditions = ["NM", "LP", "MP", "HP", "DMG"]
        self.condition_to_idx = {cond: idx for idx, cond in enumerate(conditions)}
        self.idx_to_condition = {idx: cond for cond, idx in self.condition_to_idx.items()}

    def _split_data(
        self,
        samples: List[CardSample],
    ) -> Tuple[List[CardSample], List[CardSample], List[CardSample]]:
        """Split samples into train/val/test."""
        np.random.seed(self.seed)

        # Group samples by card_id to ensure same card doesn't appear in train and val
        card_samples: Dict[str, List[CardSample]] = {}
        for sample in samples:
            if sample.card_id not in card_samples:
                card_samples[sample.card_id] = []
            card_samples[sample.card_id].append(sample)

        # Shuffle card IDs
        card_ids = list(card_samples.keys())
        np.random.shuffle(card_ids)

        # Split by samples (not cards) for small dataset
        # This ensures each split has balanced card distribution
        all_samples = []
        for card_id in card_ids:
            all_samples.extend(card_samples[card_id])

        np.random.shuffle(all_samples)

        n_train = int(len(all_samples) * self.train_split)
        n_val = int(len(all_samples) * self.val_split)

        train_samples = all_samples[:n_train]
        val_samples = all_samples[n_train:n_train + n_val]
        test_samples = all_samples[n_train + n_val:]

        return train_samples, val_samples, test_samples

    def train_dataloader(self) -> DataLoader:
        """Get training dataloader."""
        return DataLoader(
            self.train_dataset,
            batch_size=self.batch_size,
            shuffle=True,
            num_workers=self.num_workers,
            pin_memory=True,
            drop_last=True,
        )

    def val_dataloader(self) -> DataLoader:
        """Get validation dataloader."""
        return DataLoader(
            self.val_dataset,
            batch_size=self.batch_size,
            shuffle=False,
            num_workers=self.num_workers,
            pin_memory=True,
        )

    def test_dataloader(self) -> DataLoader:
        """Get test dataloader."""
        return DataLoader(
            self.test_dataset,
            batch_size=self.batch_size,
            shuffle=False,
            num_workers=self.num_workers,
            pin_memory=True,
        )

    def get_class_weights(self) -> Dict[str, torch.Tensor]:
        """Compute class weights for imbalanced data."""
        if not self.train_dataset:
            raise RuntimeError("Call setup() first")

        # Count samples per class
        card_counts = {}
        variant_counts = {}

        for sample in self.train_dataset.samples:
            card_counts[sample.card_id] = card_counts.get(sample.card_id, 0) + 1
            variant_counts[sample.variant_type] = variant_counts.get(sample.variant_type, 0) + 1

        # Compute inverse frequency weights
        total_cards = sum(card_counts.values())
        card_weights = torch.zeros(len(self.card_to_idx))
        for card_id, idx in self.card_to_idx.items():
            count = card_counts.get(card_id, 1)
            card_weights[idx] = total_cards / (len(self.card_to_idx) * count)

        total_variants = sum(variant_counts.values())
        variant_weights = torch.zeros(len(self.variant_to_idx))
        for variant, idx in self.variant_to_idx.items():
            count = variant_counts.get(variant, 1)
            variant_weights[idx] = total_variants / (len(self.variant_to_idx) * count)

        return {
            "card_weights": card_weights,
            "variant_weights": variant_weights,
        }


def create_data_module(config) -> CardDataModule:
    """Create data module from config."""
    from augmentation import get_train_transform, get_val_transform

    return CardDataModule(
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
