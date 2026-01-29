# Waypoint: W6 - JP Price AI

**Created**: 2026-01-29
**Predecessor**: W5 (PRISM 3D)
**Successor**: W7 (Production Launch)
**Status**: completed
**Completed**: 2026-01-29

---

## What This Waypoint Achieves

A sophisticated neural network for Japanese market price prediction using TensorFlow.js. The model predicts deal types, confidence levels, expected returns, and risk assessments.

---

## Success Criteria

1. [x] TensorFlow.js neural model implemented
2. [x] Multi-task LSTM architecture with 4 output heads
3. [x] Training pipeline with data export, balancing, augmentation
4. [x] Model persistence (save/load)
5. [x] Prediction tracking and outcome recording
6. [x] Model monitoring and metrics collection

---

## Implementation Details

### Neural Model Architecture

**Location:** `app/lib/neural/model.server.ts`

**Model Configuration:**
```typescript
const MODEL_CONFIG = {
  inputShape: [30, 45],        // [timesteps, features]
  lstmUnits: [128, 64],        // Two-layer LSTM encoder
  denseUnits: [256, 128],      // Feature fusion layers
  dropoutRate: 0.3,
  numDealTypes: 10,
  numRiskLevels: 3,
};
```

**Multi-Task Outputs:**
1. **Deal Type Classification** - Softmax over 10 classes
2. **Confidence Regression** - Sigmoid for 0-1 output
3. **Expected Return Regression** - Linear for unbounded output
4. **Risk Level Classification** - Softmax over 3 classes (LOW/MEDIUM/HIGH)

### Training Infrastructure

**Location:** `scripts/train-neural-model.ts`

**Features:**
- Configurable epochs, batch size, learning rate
- Class balancing and data augmentation
- Early stopping with patience
- Model saving and verification
- Verbose progress logging

**Usage:**
```bash
npx tsx scripts/train-neural-model.ts --epochs 100 --batch-size 32 --output ./models/neural
```

### Model Service API

```typescript
// Get singleton instance
const modelService = getModelService();

// Load or create model
await modelService.load(modelPath);

// Run inference
const predictions = await modelService.predict(normalizedFeatures);
// Returns: { dealType, confidence, expectedReturn, riskLevel }

// Train model
const result = await modelService.train(trainX, trainY, valX, valY, options);

// Save model
await modelService.save(outputPath);
```

### Monitoring & Metrics

**Prediction Tracking:**
```typescript
await trackPrediction(cardId, prediction, modelVersion);
await recordOutcome(metricId, actualDealType, actualReturn);
const metrics = await getModelMetrics(modelVersion, days);
```

**Database Tables:**
- `NeuralModelHistory` - Training run history
- `NeuralModelMetrics` - Prediction/outcome tracking

---

## Files Created/Verified

| File | Purpose | Status |
|------|---------|--------|
| `app/lib/neural/model.server.ts` | Multi-task LSTM model service | ✓ Complete |
| `app/lib/neural/features.server.ts` | Feature extraction and normalization | ✓ Complete |
| `app/lib/neural/training.server.ts` | Training data preparation | ✓ Complete |
| `app/lib/neural/types.ts` | TypeScript types for neural system | ✓ Complete |
| `scripts/train-neural-model.ts` | Training CLI script | ✓ Complete |

---

## Operational Requirements (for production)

1. **Data requirement**: Minimum 14 days of price history per card
2. **Training**: Run `npx tsx scripts/train-neural-model.ts` with production data
3. **Model deployment**: Save to `./models/neural` and configure path
4. **Monitoring**: Check `NeuralModelMetrics` for prediction accuracy

---

## Dependencies

**Required** (all met):
- TensorFlow.js in package.json: `@tensorflow/tfjs-node: ^4.22.0`
- Price history data in database
- Feature extraction pipeline

**Enables**:
- W7: Production launch with AI-powered pricing
- Future: JP market arbitrage detection

---

## Notes

The neural network infrastructure is **code-complete**. To reach full production capability:
1. Accumulate sufficient training data (30+ days recommended)
2. Train model with production data
3. Validate model accuracy meets >75% deal type prediction
4. Deploy trained model to production environment
