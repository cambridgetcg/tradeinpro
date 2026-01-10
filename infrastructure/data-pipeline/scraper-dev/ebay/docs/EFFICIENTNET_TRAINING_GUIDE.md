# EfficientNet-B4 Training Guide for TCG Card Recognition

> Comprehensive research and implementation guide for training EfficientNet-B4 on One Piece TCG card images for identification, variant detection, and condition assessment.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Transfer Learning Strategy](#transfer-learning-strategy)
4. [Data Augmentation](#data-augmentation)
5. [Multi-Task Learning](#multi-task-learning)
6. [Condition Assessment](#condition-assessment)
7. [Training Hyperparameters](#training-hyperparameters)
8. [Production Deployment](#production-deployment)
9. [References](#references)

---

## Executive Summary

### Why EfficientNet-B4?

EfficientNet-B4 represents the optimal balance for our TCG card recognition use case:

| Model | Parameters | Top-1 Accuracy | Input Size | Inference Time |
|-------|------------|----------------|------------|----------------|
| ResNet-50 | 25.6M | 76.3% | 224×224 | ~15ms |
| **EfficientNet-B4** | **19.3M** | **82.6%** | **380×380** | **~25ms** |
| EfficientNet-B7 | 66M | 84.4% | 600×600 | ~80ms |
| ViT-B/16 | 86M | 84.0% | 384×384 | ~45ms |

**Key advantages:**
- **+6.3% accuracy** over ResNet-50 with similar computational cost
- **Compound scaling** optimizes depth, width, and resolution together
- **Transfer learning excels** on small datasets (~1,100 images)
- **Mobile-friendly** for potential app deployment

### Our Task Requirements

| Task | Difficulty | Classes | Key Challenge |
|------|------------|---------|---------------|
| Card Identification | Medium | ~515 | Similar card layouts, need to distinguish specific artwork |
| Variant Detection | Easy | 6 | Foil patterns are visually distinctive |
| Condition Assessment | Hard | 5 | Subtle defects (whitening, scratches, centering) |

---

## Architecture Overview

### EfficientNet Compound Scaling

EfficientNet uses a compound coefficient φ to uniformly scale network dimensions:

```
depth:      d = α^φ
width:      w = β^φ
resolution: r = γ^φ

where α · β² · γ² ≈ 2 (FLOPS constraint)
```

For EfficientNet-B4 (φ=4):
- **Depth**: 1.8× baseline
- **Width**: 1.4× baseline
- **Resolution**: 380×380 pixels
- **Dropout**: 0.4

### Network Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EfficientNet-B4                          │
├─────────────────────────────────────────────────────────────┤
│ Stage 1: Stem Conv (3×3, stride 2)                          │
│          48 channels, Swish activation                      │
├─────────────────────────────────────────────────────────────┤
│ Stage 2-8: MBConv Blocks                                    │
│   - Mobile Inverted Bottleneck (MBConv)                     │
│   - Squeeze-and-Excitation (SE) attention                   │
│   - Skip connections                                        │
│   - Swish activation (x · σ(x))                            │
├─────────────────────────────────────────────────────────────┤
│ Stage 9: Head                                               │
│   - Conv 1×1 (1792 channels)                               │
│   - Global Average Pooling                                  │
│   - Dropout (0.4)                                          │
│   - FC → 1000 classes (ImageNet)                           │
└─────────────────────────────────────────────────────────────┘
```

### Multi-Task Architecture for Card Recognition

```
                         Input Image (380×380×3)
                                  │
                    ┌─────────────▼─────────────┐
                    │     EfficientNet-B4       │
                    │   (Pretrained Backbone)   │
                    │      Freeze initially     │
                    └─────────────┬─────────────┘
                                  │
                         Feature Vector (1792)
                                  │
                    ┌─────────────▼─────────────┐
                    │      Shared FC Layer      │
                    │   Linear(1792, 512)       │
                    │   ReLU + Dropout(0.3)     │
                    └─────────────┬─────────────┘
                                  │
           ┌──────────────────────┼──────────────────────┐
           │                      │                      │
    ┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
    │  Card ID    │       │   Variant   │       │  Condition  │
    │    Head     │       │    Head     │       │    Head     │
    │ FC(512,515) │       │ FC(512,6)   │       │ FC(512,5)   │
    └─────────────┘       └─────────────┘       └─────────────┘
           │                      │                      │
           ▼                      ▼                      ▼
    CrossEntropy           CrossEntropy            Ordinal Loss
    (515 classes)          (6 classes)            (5 ordered)
```

---

## Transfer Learning Strategy

### Three-Phase Training Protocol

Based on research from [Keras](https://keras.io/examples/vision/image_classification_efficientnet_fine_tuning/) and [debuggercafe](https://debuggercafe.com/transfer-learning-using-efficientnet-pytorch/):

#### Phase 1: Feature Extraction (Freeze Backbone)

```python
# Freeze all backbone layers
for param in model.backbone.parameters():
    param.requires_grad = False

# Only train task heads
optimizer = AdamW(model.heads.parameters(), lr=1e-3)
```

**Settings:**
- Epochs: 5-10
- Learning Rate: 1e-3
- Purpose: Learn task-specific mappings on fixed features

#### Phase 2: Partial Fine-Tuning (Unfreeze Top Layers)

```python
# Unfreeze last 2 MBConv blocks (stages 7-8)
for name, param in model.backbone.named_parameters():
    if 'blocks.6' in name or 'blocks.7' in name:
        param.requires_grad = True

optimizer = AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=1e-4)
```

**Settings:**
- Epochs: 10-20
- Learning Rate: 1e-4 (10× lower)
- Purpose: Adapt high-level features to card domain

#### Phase 3: Full Fine-Tuning (Unfreeze All)

```python
# Unfreeze entire model
for param in model.parameters():
    param.requires_grad = True

optimizer = AdamW(model.parameters(), lr=1e-5)
```

**Settings:**
- Epochs: 5-10
- Learning Rate: 1e-5 (100× lower than Phase 1)
- Purpose: Final refinement

### Learning Rate Schedule

Research shows OneCycleLR outperforms cosine annealing for fine-tuning:

```python
scheduler = OneCycleLR(
    optimizer,
    max_lr=1e-3,
    epochs=num_epochs,
    steps_per_epoch=len(train_loader),
    pct_start=0.1,      # 10% warmup
    anneal_strategy='cos',
    div_factor=25,      # initial_lr = max_lr/25
    final_div_factor=1000,  # final_lr = max_lr/1000
)
```

### Regularization for Small Datasets

Our dataset (~1,100 images) requires strong regularization:

| Technique | Value | Purpose |
|-----------|-------|---------|
| Dropout | 0.4 | Prevent co-adaptation |
| Drop Connect | 0.3 | Stochastic depth |
| Weight Decay | 1e-4 | L2 regularization |
| Label Smoothing | 0.1 | Prevent overconfidence |
| Early Stopping | patience=10 | Avoid overfitting |

```python
criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
```

---

## Data Augmentation

### Why Augmentation is Critical

With only ~1,100 images for ~515 card classes, heavy augmentation is essential. Each card has approximately **2 images on average** - far below the recommended 50-100 per class.

### Recommended Augmentation Pipeline

Based on [Albumentations](https://albumentations.ai/) best practices:

```python
import albumentations as A
from albumentations.pytorch import ToTensorV2

train_transform = A.Compose([
    # Spatial transforms (card-safe)
    A.RandomResizedCrop(
        height=380, width=380,
        scale=(0.8, 1.0),  # Don't crop too aggressively
        ratio=(0.9, 1.1),  # Cards are roughly square
    ),
    A.Rotate(limit=15, p=0.5),  # Limited rotation - cards have orientation
    A.HorizontalFlip(p=0.0),    # DISABLED - cards are asymmetric!
    A.ShiftScaleRotate(
        shift_limit=0.1,
        scale_limit=0.1,
        rotate_limit=10,
        p=0.5
    ),

    # Color transforms (handle different lighting conditions)
    A.OneOf([
        A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.1),
        A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2),
        A.HueSaturationValue(hue_shift_limit=10, sat_shift_limit=20, val_shift_limit=20),
    ], p=0.8),

    # Simulate different camera conditions
    A.OneOf([
        A.GaussianBlur(blur_limit=(3, 5)),
        A.MotionBlur(blur_limit=5),
        A.MedianBlur(blur_limit=5),
    ], p=0.2),

    # Simulate worn/damaged cards (for condition training)
    A.OneOf([
        A.GaussNoise(var_limit=(10, 50)),
        A.ISONoise(),
        A.ImageCompression(quality_lower=70, quality_upper=100),
    ], p=0.3),

    # Normalize to ImageNet stats (required for pretrained weights)
    A.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225],
    ),
    ToTensorV2(),
])

val_transform = A.Compose([
    A.Resize(380, 380),
    A.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225],
    ),
    ToTensorV2(),
])
```

### Advanced Augmentation Techniques

#### 1. CutMix (Recommended)

Combines two images by cutting and pasting regions:

```python
def cutmix(batch, alpha=1.0):
    """CutMix augmentation for batch training."""
    lam = np.random.beta(alpha, alpha)
    rand_index = torch.randperm(batch.size(0))

    # Generate random bounding box
    bbx1, bby1, bbx2, bby2 = rand_bbox(batch.size(), lam)

    batch[:, :, bbx1:bbx2, bby1:bby2] = batch[rand_index, :, bbx1:bbx2, bby1:bby2]

    # Adjust lambda for actual area
    lam = 1 - ((bbx2 - bbx1) * (bby2 - bby1) / (batch.size(-1) * batch.size(-2)))

    return batch, lam, rand_index
```

Research shows CutMix is more effective than Cutout for fine-grained recognition.

#### 2. Test-Time Augmentation (TTA)

Apply multiple augmentations at inference and average predictions:

```python
def predict_with_tta(model, image, n_augments=5):
    """Test-time augmentation for improved accuracy."""
    predictions = []

    # Original
    predictions.append(model(image))

    # Augmented versions
    for _ in range(n_augments - 1):
        aug_image = tta_transform(image)
        predictions.append(model(aug_image))

    # Average predictions
    return torch.stack(predictions).mean(dim=0)
```

### Augmentations to AVOID for Cards

| Augmentation | Reason to Avoid |
|--------------|-----------------|
| Horizontal Flip | Cards have asymmetric artwork |
| Vertical Flip | Unnatural orientation |
| Heavy Rotation (>20°) | Cards are always upright |
| Aggressive Cropping | May cut off card number/name |
| Color Inversion | Destroys color-based features |

---

## Multi-Task Learning

### Loss Weighting Strategies

Based on research from [Ruder](https://www.ruder.io/multi-task/) and [IEEE](https://ieeexplore.ieee.org/document/8848395/):

#### 1. Static Weighting (Baseline)

```python
total_loss = λ_card * loss_card + λ_variant * loss_variant + λ_condition * loss_condition
```

Initial weights based on task importance:
- Card ID: λ = 1.0 (primary task)
- Variant: λ = 0.5 (easier task)
- Condition: λ = 1.0 (critical for business)

#### 2. Uncertainty Weighting (Recommended)

From Kendall et al., learns task weights automatically:

```python
class UncertaintyWeightedLoss(nn.Module):
    def __init__(self, num_tasks=3):
        super().__init__()
        # Learnable log variance for each task
        self.log_vars = nn.Parameter(torch.zeros(num_tasks))

    def forward(self, losses):
        """
        losses: list of task losses [card_loss, variant_loss, condition_loss]
        """
        total_loss = 0
        for i, loss in enumerate(losses):
            precision = torch.exp(-self.log_vars[i])
            total_loss += precision * loss + self.log_vars[i]
        return total_loss
```

#### 3. Dynamic Weight Average (DWA)

Adjusts weights based on loss descent rate:

```python
class DynamicWeightAverage:
    def __init__(self, num_tasks, temp=2.0):
        self.num_tasks = num_tasks
        self.temp = temp
        self.prev_losses = None

    def get_weights(self, current_losses):
        if self.prev_losses is None:
            self.prev_losses = current_losses
            return [1.0] * self.num_tasks

        # Compute relative descent
        ratios = [curr / prev for curr, prev in zip(current_losses, self.prev_losses)]

        # Softmax with temperature
        weights = F.softmax(torch.tensor(ratios) / self.temp, dim=0)

        self.prev_losses = current_losses
        return weights.tolist()
```

### Gradient Surgery (Advanced)

When task gradients conflict, project out conflicting components:

```python
def pcgrad_backward(losses, shared_params):
    """Projecting Conflicting Gradients (PCGrad)."""
    grads = []

    # Compute gradients for each task
    for loss in losses:
        grad = torch.autograd.grad(loss, shared_params, retain_graph=True)
        grads.append(torch.cat([g.view(-1) for g in grad]))

    # Project out conflicting components
    projected_grads = []
    for i, grad_i in enumerate(grads):
        proj_grad = grad_i.clone()
        for j, grad_j in enumerate(grads):
            if i != j:
                dot = torch.dot(proj_grad, grad_j)
                if dot < 0:  # Conflicting gradients
                    proj_grad -= dot / (grad_j.norm() ** 2 + 1e-8) * grad_j
        projected_grads.append(proj_grad)

    # Sum projected gradients
    return sum(projected_grads)
```

---

## Condition Assessment

### Challenge: Fine-Grained Defect Detection

Condition assessment requires detecting subtle defects:

| Condition | Visual Indicators |
|-----------|-------------------|
| NM (Near Mint) | No visible wear, sharp corners |
| LP (Lightly Played) | Minor edge wear, light scratches |
| MP (Moderately Played) | Noticeable wear, corner whitening |
| HP (Heavily Played) | Significant damage, creases |
| DMG (Damaged) | Major defects, bent, water damage |

### Multi-Crop Attention Strategy

Based on research in [fine-grained visual recognition](https://pmc.ncbi.nlm.nih.gov/articles/PMC9492346/):

```
┌─────────────────────────────────────────┐
│              Original Card              │
│  ┌───┐                         ┌───┐    │
│  │TL │                         │TR │    │  ← Corner crops (112×112)
│  └───┘                         └───┘    │
│                                         │
│            ┌───────────┐               │
│            │  Center   │               │  ← Center crop (224×224)
│            └───────────┘               │
│                                         │
│  ┌───┐                         ┌───┐    │
│  │BL │                         │BR │    │
│  └───┘                         └───┘    │
└─────────────────────────────────────────┘
```

```python
class MultiCropConditionModel(nn.Module):
    """
    Uses multiple crops to assess card condition.
    Corners and edges are most important for grading.
    """
    def __init__(self, backbone):
        super().__init__()
        self.backbone = backbone

        # Separate encoders for different regions
        self.corner_encoder = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(1792, 256),
        )

        # Attention over crops
        self.attention = nn.MultiheadAttention(
            embed_dim=256,
            num_heads=4,
            batch_first=True,
        )

        # Final condition head
        self.condition_head = nn.Sequential(
            nn.Linear(256 * 5, 128),  # 5 crops
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, 5),  # 5 conditions
        )

    def forward(self, full_image, corners):
        """
        full_image: (B, 3, 380, 380)
        corners: (B, 4, 3, 112, 112) - TL, TR, BL, BR
        """
        # Encode full image
        full_feat = self.backbone(full_image)  # (B, 1792)
        full_embed = self.corner_encoder(full_feat.unsqueeze(-1).unsqueeze(-1))

        # Encode corners
        B = corners.size(0)
        corners_flat = corners.view(B * 4, 3, 112, 112)
        corners_flat = F.interpolate(corners_flat, size=(380, 380))
        corner_feats = self.backbone(corners_flat)  # (B*4, 1792)
        corner_embeds = self.corner_encoder(corner_feats.unsqueeze(-1).unsqueeze(-1))
        corner_embeds = corner_embeds.view(B, 4, 256)

        # Stack all embeddings
        all_embeds = torch.cat([
            full_embed.unsqueeze(1),
            corner_embeds,
        ], dim=1)  # (B, 5, 256)

        # Self-attention
        attended, _ = self.attention(all_embeds, all_embeds, all_embeds)

        # Flatten and classify
        flat = attended.view(B, -1)  # (B, 1280)
        return self.condition_head(flat)
```

### Ordinal Regression for Conditions

Conditions are ordered (NM > LP > MP > HP > DMG), so use ordinal loss:

```python
class OrdinalRegressionLoss(nn.Module):
    """
    Conditions are ordered: NM=0 < LP=1 < MP=2 < HP=3 < DMG=4
    Predicting LP when true is NM is less bad than predicting DMG.
    """
    def __init__(self, num_classes=5):
        super().__init__()
        self.num_classes = num_classes

    def forward(self, logits, targets):
        # Convert to cumulative probabilities
        # P(y > k) for k in [0, 1, 2, 3]
        cumulative = torch.sigmoid(logits)

        # Create cumulative targets
        targets_expanded = targets.unsqueeze(1)
        thresholds = torch.arange(self.num_classes - 1).to(targets.device)
        cumulative_targets = (targets_expanded > thresholds).float()

        # Binary cross entropy for each threshold
        loss = F.binary_cross_entropy(cumulative, cumulative_targets)
        return loss
```

---

## Training Hyperparameters

### Optimal Configuration

Based on research from [wandb](https://wandb.ai/sayakpaul/efficientnet-tl/reports/Transfer-Learning-With-the-EfficientNet-Family-of-Models--Vmlldzo4OTg1Nw) and [EfficientNetV2](https://github.com/hankyul2/EfficientNetV2-pytorch):

```python
CONFIG = {
    # Architecture
    'model': 'efficientnet_b4',
    'input_size': 380,
    'num_classes': {
        'card_id': 515,
        'variant': 6,
        'condition': 5,
    },

    # Training phases
    'phase1_epochs': 10,
    'phase2_epochs': 15,
    'phase3_epochs': 10,

    # Optimizer
    'optimizer': 'AdamW',
    'weight_decay': 1e-4,
    'betas': (0.9, 0.999),

    # Learning rates
    'phase1_lr': 1e-3,
    'phase2_lr': 1e-4,
    'phase3_lr': 1e-5,

    # Scheduler
    'scheduler': 'OneCycleLR',
    'pct_start': 0.1,

    # Regularization
    'dropout': 0.4,
    'drop_connect': 0.3,
    'label_smoothing': 0.1,

    # Batch size
    'batch_size': 16,  # Limited by GPU memory at 380×380
    'accumulation_steps': 4,  # Effective batch size = 64

    # Data
    'train_split': 0.8,
    'val_split': 0.1,
    'test_split': 0.1,

    # Augmentation
    'cutmix_prob': 0.5,
    'cutmix_alpha': 1.0,

    # Early stopping
    'patience': 10,
    'min_delta': 1e-4,
}
```

### Hyperparameter Priority

Research indicates importance ranking:

1. **Learning Rate** - Most critical, use OneCycleLR
2. **Weight Decay** - 1e-4 to 1e-5 works well
3. **Batch Size** - Larger is better, use gradient accumulation
4. **CutMix Probability** - 0.3-0.5 optimal
5. **Dropout** - 0.3-0.5 for small datasets

### Mixed Precision Training

Essential for faster training and larger batch sizes:

```python
from torch.cuda.amp import autocast, GradScaler

scaler = GradScaler()

for batch in train_loader:
    optimizer.zero_grad()

    with autocast():
        outputs = model(images)
        loss = criterion(outputs, labels)

    scaler.scale(loss).backward()
    scaler.step(optimizer)
    scaler.update()
```

---

## Production Deployment

### Model Export

#### ONNX Export

```python
import torch.onnx

# Export to ONNX
dummy_input = torch.randn(1, 3, 380, 380)
torch.onnx.export(
    model,
    dummy_input,
    "card_recognition.onnx",
    input_names=['image'],
    output_names=['card_id', 'variant', 'condition'],
    dynamic_axes={
        'image': {0: 'batch_size'},
        'card_id': {0: 'batch_size'},
        'variant': {0: 'batch_size'},
        'condition': {0: 'batch_size'},
    },
    opset_version=13,
)
```

#### TorchScript Export

```python
# Trace model
traced = torch.jit.trace(model, dummy_input)
traced.save("card_recognition.pt")
```

### Inference Optimization

| Optimization | Speedup | Implementation |
|--------------|---------|----------------|
| Mixed Precision | 1.5-2× | `torch.cuda.amp.autocast()` |
| TensorRT | 2-4× | NVIDIA TensorRT conversion |
| Batching | N× | Process multiple cards together |
| Quantization | 2-4× | INT8 quantization |

### API Response Format

```json
{
  "predictions": {
    "card_id": {
      "top1": "OP01-120",
      "confidence": 0.95,
      "top5": [
        {"id": "OP01-120", "confidence": 0.95},
        {"id": "OP01-121", "confidence": 0.02},
        ...
      ]
    },
    "variant": {
      "type": "manga",
      "confidence": 0.98
    },
    "condition": {
      "grade": "LP",
      "confidence": 0.72,
      "distribution": {
        "NM": 0.15,
        "LP": 0.72,
        "MP": 0.10,
        "HP": 0.02,
        "DMG": 0.01
      }
    }
  },
  "inference_ms": 28,
  "model_version": "1.0.0"
}
```

---

## Training Pipeline Overview

```
┌────────────────────────────────────────────────────────────────┐
│                    Training Pipeline                            │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐    │
│  │  S3 Data    │───▶│   Dataset   │───▶│   DataLoader    │    │
│  │  Download   │    │   + Cache   │    │   + Augment     │    │
│  └─────────────┘    └─────────────┘    └────────┬────────┘    │
│                                                  │              │
│                                                  ▼              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    Training Loop                         │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                 │  │
│  │  │ Phase 1 │─▶│ Phase 2 │─▶│ Phase 3 │                 │  │
│  │  │ Frozen  │  │ Partial │  │  Full   │                 │  │
│  │  └─────────┘  └─────────┘  └─────────┘                 │  │
│  │                      │                                   │  │
│  │              ┌───────▼───────┐                          │  │
│  │              │   Validation  │                          │  │
│  │              │   + Metrics   │                          │  │
│  │              └───────┬───────┘                          │  │
│  │                      │                                   │  │
│  │              ┌───────▼───────┐                          │  │
│  │              │    W&B Log    │                          │  │
│  │              │  + Checkpoint │                          │  │
│  │              └───────────────┘                          │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐    │
│  │    Test     │───▶│   Export    │───▶│   Deploy to     │    │
│  │  Evaluation │    │ ONNX/Script │    │   Production    │    │
│  └─────────────┘    └─────────────┘    └─────────────────┘    │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## Expected Results

### Baseline Expectations

Based on similar projects ([Ximilar](https://www.ximilar.com/services/visual-ai-for-collectibles/), [CardGrader.AI](https://cardgrader.ai/)):

| Task | Expected Accuracy | Notes |
|------|-------------------|-------|
| Card Identification | 90-95% | May need more data for rare cards |
| Variant Detection | 95-98% | Foil patterns are distinctive |
| Condition Assessment | 70-80% | Most challenging, needs refinement |

### Improvement Strategies

If baseline performance is insufficient:

1. **Collect more data** - Target 50+ images per card
2. **Active learning** - Focus on misclassified examples
3. **Ensemble models** - Combine multiple architectures
4. **Synthetic data** - Use GANs to generate variations
5. **External data** - Scrape additional sources

---

## References

### Research Papers

1. Tan & Le (2019). "EfficientNet: Rethinking Model Scaling for CNNs" - [arXiv:1905.11946](https://arxiv.org/abs/1905.11946)
2. Kendall et al. (2018). "Multi-Task Learning Using Uncertainty to Weigh Losses" - [arXiv:1705.07115](https://arxiv.org/abs/1705.07115)
3. Yu et al. (2020). "Gradient Surgery for Multi-Task Learning" - [arXiv:2001.06782](https://arxiv.org/abs/2001.06782)

### Implementation Guides

- [Keras EfficientNet Fine-Tuning](https://keras.io/examples/vision/image_classification_efficientnet_fine_tuning/)
- [PyTorch Transfer Learning with EfficientNet](https://debuggercafe.com/transfer-learning-using-efficientnet-pytorch/)
- [W&B EfficientNet Report](https://wandb.ai/sayakpaul/efficientnet-tl/reports/Transfer-Learning-With-the-EfficientNet-Family-of-Models--Vmlldzo4OTg1Nw)

### Commercial Card Recognition

- [Ximilar Collectibles AI](https://www.ximilar.com/services/visual-ai-for-collectibles/)
- [CardGrader.AI](https://cardgrader.ai/blog/ultimate-guide-online-card-grading-identification-tools)
- [Collectors Image Search](https://blog.collectors.com/image-search/)

### Fine-Grained Recognition

- [Awesome Fine-Grained Visual Classification](https://github.com/haoweiz23/Awesome-Fine-grained-Visual-Classification)
- [Attention Mechanisms in CNNs](https://pmc.ncbi.nlm.nih.gov/articles/PMC9492346/)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-08 | Initial research and documentation |
