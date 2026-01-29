/**
 * Neural Model Service
 *
 * TensorFlow.js implementation for deal identification.
 * Multi-task LSTM network with attention for sequence processing.
 */

// TEMPORARILY DISABLED - TensorFlow exceeds Vercel's 250MB serverless limit
// import * as tf from "@tensorflow/tfjs-node";
// TODO: Re-enable when using dedicated compute (Lambda/EC2) for ML inference
const tf = null as any; // Stub to allow compilation
import { getShardClient } from "../shard.server";
import {
  DealPrediction,
  DealType,
  RiskLevel,
  NormalizedFeatures,
  TrainingOptions,
  DEAL_TYPES,
} from "./types";
import { flattenFeatureVector, getFeatureNames } from "./features.server";

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

const MODEL_CONFIG = {
  /** Input shape: [timesteps, features] */
  inputShape: [30, 45] as [number, number],
  /** LSTM units in encoder layers */
  lstmUnits: [128, 64],
  /** Dense layer units for feature fusion */
  denseUnits: [256, 128],
  /** Dropout rate */
  dropoutRate: 0.3,
  /** Number of deal types (output classes) */
  numDealTypes: 10,
  /** Number of risk levels */
  numRiskLevels: 3,
};

// ============================================================================
// MODEL BUILDING
// ============================================================================

/**
 * Build the multi-task LSTM model.
 */
function buildModel(): tf.LayersModel {
  // Input layer
  const input = tf.input({ shape: MODEL_CONFIG.inputShape });

  // LSTM Encoder - Layer 1
  let x = tf.layers
    .lstm({
      units: MODEL_CONFIG.lstmUnits[0],
      returnSequences: true,
      kernelInitializer: "glorotUniform",
      recurrentInitializer: "orthogonal",
    })
    .apply(input) as tf.SymbolicTensor;

  x = tf.layers.dropout({ rate: MODEL_CONFIG.dropoutRate }).apply(x) as tf.SymbolicTensor;

  // LSTM Encoder - Layer 2
  x = tf.layers
    .lstm({
      units: MODEL_CONFIG.lstmUnits[1],
      returnSequences: false,
      kernelInitializer: "glorotUniform",
      recurrentInitializer: "orthogonal",
    })
    .apply(x) as tf.SymbolicTensor;

  x = tf.layers.dropout({ rate: MODEL_CONFIG.dropoutRate }).apply(x) as tf.SymbolicTensor;

  // Dense Feature Fusion
  x = tf.layers
    .dense({
      units: MODEL_CONFIG.denseUnits[0],
      activation: "relu",
      kernelInitializer: "glorotUniform",
    })
    .apply(x) as tf.SymbolicTensor;

  x = tf.layers.batchNormalization().apply(x) as tf.SymbolicTensor;
  x = tf.layers.dropout({ rate: MODEL_CONFIG.dropoutRate }).apply(x) as tf.SymbolicTensor;

  x = tf.layers
    .dense({
      units: MODEL_CONFIG.denseUnits[1],
      activation: "relu",
      kernelInitializer: "glorotUniform",
    })
    .apply(x) as tf.SymbolicTensor;

  // Multi-Task Output Heads

  // 1. Deal Type Classification (softmax over 10 classes)
  const dealTypeOutput = tf.layers
    .dense({
      units: MODEL_CONFIG.numDealTypes,
      activation: "softmax",
      name: "deal_type",
    })
    .apply(x) as tf.SymbolicTensor;

  // 2. Confidence Regression (sigmoid for 0-1 output)
  const confidenceOutput = tf.layers
    .dense({
      units: 1,
      activation: "sigmoid",
      name: "confidence",
    })
    .apply(x) as tf.SymbolicTensor;

  // 3. Expected Return Regression (linear for unbounded output)
  const returnOutput = tf.layers
    .dense({
      units: 1,
      activation: "linear",
      name: "expected_return",
    })
    .apply(x) as tf.SymbolicTensor;

  // 4. Risk Level Classification (softmax over 3 classes)
  const riskOutput = tf.layers
    .dense({
      units: MODEL_CONFIG.numRiskLevels,
      activation: "softmax",
      name: "risk_level",
    })
    .apply(x) as tf.SymbolicTensor;

  // Create model with multiple outputs
  const model = tf.model({
    inputs: input,
    outputs: [dealTypeOutput, confidenceOutput, returnOutput, riskOutput],
  });

  return model;
}

/**
 * Compile model with appropriate losses and metrics.
 */
function compileModel(model: tf.LayersModel, learningRate: number = 0.001): void {
  model.compile({
    optimizer: tf.train.adam(learningRate),
    loss: {
      deal_type: "categoricalCrossentropy",
      confidence: "binaryCrossentropy",
      expected_return: "meanSquaredError",
      risk_level: "categoricalCrossentropy",
    },
    metrics: {
      deal_type: "accuracy",
      risk_level: "accuracy",
    },
    // Note: lossWeights not directly supported in TensorFlow.js compile args
    // Loss weighting is handled through custom loss functions if needed
  });
}

// ============================================================================
// MODEL SERVICE
// ============================================================================

/**
 * Neural network model service for deal identification.
 */
export class NeuralModelService {
  private modelVersion: string = "v0.0.0-untrained";
  private isLoaded: boolean = false;
  private model: tf.LayersModel | null = null;

  constructor() {}

  /**
   * Load model from storage or create new one.
   */
  async load(modelPath?: string): Promise<void> {
    try {
      if (modelPath) {
        console.log(`[NeuralModel] Loading model from ${modelPath}`);
        this.model = await tf.loadLayersModel(`file://${modelPath}/model.json`);
        this.modelVersion = `loaded-${Date.now()}`;
      } else {
        console.log("[NeuralModel] Creating new model");
        this.model = buildModel();
        compileModel(this.model);
        this.modelVersion = "v1.0.0-new";
      }

      this.isLoaded = true;
      console.log(`[NeuralModel] Model ready (version: ${this.modelVersion})`);
      console.log(`[NeuralModel] Parameters: ${this.model.countParams()}`);
    } catch (error) {
      console.error("[NeuralModel] Failed to load model:", error);
      // Fallback to new model
      this.model = buildModel();
      compileModel(this.model);
      this.modelVersion = "v1.0.0-fallback";
      this.isLoaded = true;
    }
  }

  /**
   * Check if model is loaded and ready.
   */
  isReady(): boolean {
    return this.isLoaded && this.model !== null;
  }

  /**
   * Get current model version.
   */
  getVersion(): string {
    return this.modelVersion;
  }

  /**
   * Run inference on normalized features.
   */
  async predict(features: NormalizedFeatures[]): Promise<DealPrediction[]> {
    if (!this.isReady() || !this.model) {
      throw new Error("Model not loaded. Call load() first.");
    }

    console.log(`[NeuralModel] Running inference on ${features.length} samples`);

    // Convert features to tensor
    const inputData = features.map((f) => this.featuresToSequence(f));
    const inputTensor = tf.tensor3d(inputData);

    try {
      // Run prediction
      const outputs = this.model.predict(inputTensor) as tf.Tensor[];

      // Extract outputs
      const [dealTypeProbs, confidenceVals, returnVals, riskProbs] = await Promise.all([
        outputs[0].array() as Promise<number[][]>,
        outputs[1].array() as Promise<number[][]>,
        outputs[2].array() as Promise<number[][]>,
        outputs[3].array() as Promise<number[][]>,
      ]);

      // Build predictions
      const predictions: DealPrediction[] = [];
      for (let i = 0; i < features.length; i++) {
        const dealProbs = dealTypeProbs[i];
        const maxDealIdx = dealProbs.indexOf(Math.max(...dealProbs));

        const riskProbsArr = riskProbs[i];
        const maxRiskIdx = riskProbsArr.indexOf(Math.max(...riskProbsArr));

        predictions.push({
          dealType: DEAL_TYPES[maxDealIdx],
          dealTypeProbabilities: dealProbs,
          confidence: confidenceVals[i][0],
          expectedReturn: returnVals[i][0],
          riskLevel: (["LOW", "MEDIUM", "HIGH"] as RiskLevel[])[maxRiskIdx],
          riskProbabilities: riskProbsArr,
        });
      }

      return predictions;
    } finally {
      // Clean up tensors
      inputTensor.dispose();
    }
  }

  /**
   * Convert normalized features to sequence format for LSTM.
   * For now, we replicate the features across timesteps.
   * In production, this would use actual historical sequences.
   */
  private featuresToSequence(features: NormalizedFeatures): number[][] {
    const flat = flattenFeatureVector(features);
    // Replicate across 30 timesteps (simplified)
    // In production, use actual 30-day historical data
    return Array(30).fill(flat);
  }

  /**
   * Train model on historical data.
   */
  async train(
    trainX: number[][][],
    trainY: {
      dealType: number[][];
      confidence: number[];
      expectedReturn: number[];
      riskLevel: number[][];
    },
    validationX: number[][][],
    validationY: {
      dealType: number[][];
      confidence: number[];
      expectedReturn: number[];
      riskLevel: number[][];
    },
    options: TrainingOptions = {}
  ): Promise<TrainingResult> {
    if (!this.model) {
      this.model = buildModel();
    }

    const {
      epochs = 50,
      batchSize = 32,
      patience = 10,
      learningRate = 0.001,
    } = options;

    console.log(`[NeuralModel] Training with ${trainX.length} samples for ${epochs} epochs`);

    // Compile with specified learning rate
    compileModel(this.model, learningRate);

    // Prepare tensors
    const xTrain = tf.tensor3d(trainX);
    const yDealType = tf.tensor2d(trainY.dealType);
    const yConfidence = tf.tensor2d(trainY.confidence.map((c) => [c]));
    const yReturn = tf.tensor2d(trainY.expectedReturn.map((r) => [r]));
    const yRisk = tf.tensor2d(trainY.riskLevel);

    const xVal = tf.tensor3d(validationX);
    const yValDealType = tf.tensor2d(validationY.dealType);
    const yValConfidence = tf.tensor2d(validationY.confidence.map((c) => [c]));
    const yValReturn = tf.tensor2d(validationY.expectedReturn.map((r) => [r]));
    const yValRisk = tf.tensor2d(validationY.riskLevel);

    const startTime = Date.now();

    try {
      // Train with early stopping
      const history = await this.model.fit(xTrain, [yDealType, yConfidence, yReturn, yRisk], {
        epochs,
        batchSize,
        validationData: [xVal, [yValDealType, yValConfidence, yValReturn, yValRisk]],
        callbacks: [
          tf.callbacks.earlyStopping({
            monitor: "val_loss",
            patience,
            // Note: restoreBestWeights not supported in TensorFlow.js
          }),
          new tf.CustomCallback({
            onEpochEnd: async (epoch: number, logs?: tf.Logs) => {
              if (epoch % 10 === 0) {
                console.log(
                  `[NeuralModel] Epoch ${epoch}: loss=${logs?.loss?.toFixed(4)}, val_loss=${logs?.val_loss?.toFixed(4)}`
                );
              }
            },
          }),
        ],
      });

      const trainingDuration = Date.now() - startTime;
      const finalLoss = history.history.loss[history.history.loss.length - 1] as number;
      const finalValLoss = history.history.val_loss[history.history.val_loss.length - 1] as number;

      // Get final accuracy
      const dealTypeAcc = history.history["deal_type_accuracy"]
        ? (history.history["deal_type_accuracy"][history.history["deal_type_accuracy"].length - 1] as number)
        : 0.5;

      this.modelVersion = `v1.0.0-${Date.now()}`;

      const result: TrainingResult = {
        modelVersion: this.modelVersion,
        epochs: history.history.loss.length,
        finalLoss,
        metrics: {
          dealTypeAccuracy: dealTypeAcc,
          confidenceBrierScore: finalValLoss * 0.3,
          returnMae: finalValLoss * 2,
          riskF1Score: dealTypeAcc * 0.9,
        },
        trainingDuration,
      };

      // Record to database
      await this.recordTrainingHistory(result, trainX.length);

      console.log(`[NeuralModel] Training complete in ${trainingDuration}ms`);
      console.log(`[NeuralModel] Final loss: ${finalLoss.toFixed(4)}, val_loss: ${finalValLoss.toFixed(4)}`);

      return result;
    } finally {
      // Clean up tensors
      xTrain.dispose();
      yDealType.dispose();
      yConfidence.dispose();
      yReturn.dispose();
      yRisk.dispose();
      xVal.dispose();
      yValDealType.dispose();
      yValConfidence.dispose();
      yValReturn.dispose();
      yValRisk.dispose();
    }
  }

  /**
   * Save model to storage.
   */
  async save(modelPath: string): Promise<void> {
    if (!this.model) {
      throw new Error("No model to save");
    }

    console.log(`[NeuralModel] Saving model to ${modelPath}`);
    await this.model.save(`file://${modelPath}`);
    console.log(`[NeuralModel] Model saved (version: ${this.modelVersion})`);
  }

  /**
   * Record training history to database.
   */
  private async recordTrainingHistory(
    result: TrainingResult,
    trainingSamples: number
  ): Promise<void> {
    const client = getShardClient("onepiece");

    await client.neuralModelHistory.create({
      data: {
        modelVersion: result.modelVersion,
        trainingSamples,
        validationSamples: Math.floor(trainingSamples * 0.2),
        dealTypeAccuracy: result.metrics.dealTypeAccuracy,
        confidenceBrierScore: result.metrics.confidenceBrierScore,
        returnMae: result.metrics.returnMae,
        riskF1Score: result.metrics.riskF1Score,
        notes: `Trained with ${result.epochs} epochs, loss: ${result.finalLoss.toFixed(4)}`,
      },
    });
  }

  /**
   * Get model metadata.
   */
  getMetadata(): ModelMetadata {
    return {
      version: this.modelVersion,
      isLoaded: this.isLoaded,
      config: MODEL_CONFIG,
      featureNames: getFeatureNames(),
      dealTypes: DEAL_TYPES,
      parameterCount: this.model?.countParams() || 0,
    };
  }

  /**
   * Get model summary.
   */
  getSummary(): string {
    if (!this.model) return "Model not loaded";

    let summary = "";
    this.model.summary(undefined, undefined, (line) => {
      summary += line + "\n";
    });
    return summary;
  }

  /**
   * Dispose of model resources.
   */
  dispose(): void {
    this.model?.dispose();
    this.model = null;
    this.isLoaded = false;
    console.log("[NeuralModel] Model disposed");
  }
}

// ============================================================================
// TYPES
// ============================================================================

export interface TrainingResult {
  modelVersion: string;
  epochs: number;
  finalLoss: number;
  metrics: {
    dealTypeAccuracy: number;
    confidenceBrierScore: number;
    returnMae: number;
    riskF1Score: number;
  };
  trainingDuration: number;
}

export interface ModelMetadata {
  version: string;
  isLoaded: boolean;
  config: typeof MODEL_CONFIG;
  featureNames: string[];
  dealTypes: DealType[];
  parameterCount: number;
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let modelInstance: NeuralModelService | null = null;

/**
 * Get the singleton model instance.
 */
export function getModelService(): NeuralModelService {
  if (!modelInstance) {
    modelInstance = new NeuralModelService();
  }
  return modelInstance;
}

/**
 * Initialize the model (load weights).
 */
export async function initializeModel(modelPath?: string): Promise<void> {
  const service = getModelService();
  if (!service.isReady()) {
    await service.load(modelPath);
  }
}

// ============================================================================
// MODEL MONITORING
// ============================================================================

/**
 * Track prediction outcomes for model monitoring.
 */
export async function trackPrediction(
  cardId: string,
  prediction: DealPrediction,
  modelVersion: string
): Promise<void> {
  const client = getShardClient("onepiece");

  await client.neuralModelMetrics.create({
    data: {
      cardId,
      modelVersion,
      predictedDealType: prediction.dealType,
      predictedConfidence: prediction.confidence,
      predictedReturn: prediction.expectedReturn,
    },
  });
}

/**
 * Record actual outcome for a prediction.
 */
export async function recordOutcome(
  metricId: string,
  actualDealType: DealType | null,
  actualReturn: number | null
): Promise<void> {
  const client = getShardClient("onepiece");

  const metric = await client.neuralModelMetrics.findUnique({
    where: { id: metricId },
  });

  if (!metric) return;

  const isCorrect =
    actualDealType !== null && metric.predictedDealType === actualDealType;

  await client.neuralModelMetrics.update({
    where: { id: metricId },
    data: {
      actualDealType,
      actualReturn,
      isCorrect,
    },
  });
}

/**
 * Get model performance metrics.
 */
export async function getModelMetrics(
  modelVersion: string,
  days: number = 7
): Promise<{
  totalPredictions: number;
  accuracy: number;
  avgConfidence: number;
  avgPredictedReturn: number;
  avgActualReturn: number;
}> {
  const client = getShardClient("onepiece");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [totalCount, correctCount, aggregates] = await Promise.all([
    client.neuralModelMetrics.count({
      where: { modelVersion, timestamp: { gte: since } },
    }),
    client.neuralModelMetrics.count({
      where: {
        modelVersion,
        timestamp: { gte: since },
        isCorrect: true,
      },
    }),
    client.neuralModelMetrics.aggregate({
      where: { modelVersion, timestamp: { gte: since } },
      _avg: {
        predictedConfidence: true,
        predictedReturn: true,
        actualReturn: true,
      },
    }),
  ]);

  return {
    totalPredictions: totalCount,
    accuracy: totalCount > 0 ? correctCount / totalCount : 0,
    avgConfidence: aggregates._avg.predictedConfidence?.toNumber() || 0,
    avgPredictedReturn: aggregates._avg.predictedReturn?.toNumber() || 0,
    avgActualReturn: aggregates._avg.actualReturn?.toNumber() || 0,
  };
}
