/**
 * Temporal Fusion Transformer (TFT) for Multi-Horizon Price Prediction
 *
 * Architecture: TFT with Variable Selection, LSTM Encoder-Decoder, Multi-Head Attention
 * Purpose: State-of-the-art time series forecasting with interpretability
 *
 * Training Status: AWAITING TRAINING DATA
 * Data Requirements:
 *   - 500K+ card-date sequences
 *   - 90 days lookback, 30 days forecast
 *
 * @see docs/AI_MODELS_FOR_TCG_ARBITRAGE.md Section 4 - M7
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

export const TFT_CONFIG = {
  modelId: "temporal-fusion-transformer-tcg",
  version: "1.0.0-stub",

  // Architecture
  architecture: {
    encoderLayers: 2,
    decoderLayers: 2,
    lstmHiddenSize: 128,
    attentionHeads: 4,
    hiddenSize: 256,
    dropout: 0.1,
    variableSelectionHidden: 64,
  },

  // Sequence configuration
  sequence: {
    encoderLength: 90, // Days lookback
    decoderLength: 30, // Days forecast
    targetColumn: "price",
  },

  // Feature categories
  features: {
    // Static (card attributes, don't change)
    static: [
      "card_id_embedding",
      "rarity_embedding",
      "color_embedding",
      "card_type_embedding",
      "set_embedding",
    ],

    // Known future (can be calculated ahead)
    knownFuture: [
      "day_of_week",
      "month",
      "is_weekend",
      "is_holiday",
      "days_to_set_release",
      "days_to_tournament",
      "is_ban_list_period",
    ],

    // Observed (only available in past)
    observed: [
      "price",
      "price_change",
      "volume",
      "listings_count",
      "tcg100_index",
      "social_sentiment",
      "search_volume",
    ],
  },

  // Output configuration
  output: {
    quantiles: [0.1, 0.5, 0.9], // 10th, 50th, 90th percentile
    horizons: [1, 7, 14, 30], // Days ahead
  },

  // Training
  training: {
    requiredSequences: 500000,
    batchSize: 64,
    learningRate: 0.001,
    epochs: 100,
    earlyStoppingPatience: 10,
    validationSplit: 0.15,
    testSplit: 0.15,
  },
};

// =============================================================================
// TYPES
// =============================================================================

export interface TFTInput {
  cardId: string;

  // Static features (one per card)
  staticFeatures: {
    cardIdEncoded: number;
    rarityEncoded: number;
    colorEncoded: number;
    cardTypeEncoded: number;
    setEncoded: number;
  };

  // Time-varying observed (encoder only) - shape: [encoderLength, numFeatures]
  observedSequence: Array<{
    date: Date;
    price: number;
    priceChange: number;
    volume: number;
    listingsCount: number;
    tcg100Index: number;
    socialSentiment: number;
    searchVolume: number;
  }>;

  // Time-varying known (encoder + decoder) - shape: [totalLength, numFeatures]
  knownSequence: Array<{
    date: Date;
    dayOfWeek: number;
    month: number;
    isWeekend: boolean;
    isHoliday: boolean;
    daysToSetRelease: number;
    daysToTournament: number;
    isBanListPeriod: boolean;
  }>;
}

export interface TFTOutput {
  cardId: string;
  predictionTimestamp: Date;

  // Multi-horizon forecasts with uncertainty
  forecasts: Array<{
    horizon: number; // Days ahead
    date: Date;
    predicted: {
      p10: number; // 10th percentile
      p50: number; // Median
      p90: number; // 90th percentile
    };
  }>;

  // Attention weights (interpretability)
  attention: {
    // Which past timesteps were most important
    temporalAttention: Array<{
      date: Date;
      weight: number;
    }>;

    // Which features were most important
    featureImportance: Array<{
      feature: string;
      importance: number;
    }>;
  };

  // Model confidence
  confidence: number;
  modelVersion: string;
}

export interface TFTModelConfig {
  modelPath?: string;
  useGPU?: boolean;
  batchSize?: number;
}

// =============================================================================
// TFT MODEL SERVICE
// =============================================================================

export class TemporalFusionTransformerModel {
  readonly name = "Temporal Fusion Transformer";
  readonly version = TFT_CONFIG.version;

  private modelLoaded: boolean = false;
  private inferenceCount: number = 0;

  constructor(private config: TFTModelConfig = {}) {}

  /**
   * Load the TFT model
   */
  async load(): Promise<void> {
    console.log("[TFT] Loading Temporal Fusion Transformer model...");
    console.log("[TFT] Status: MODEL NOT YET TRAINED");
    console.log("[TFT] Required: 500K card-date sequences");

    await new Promise((resolve) => setTimeout(resolve, 100));

    this.modelLoaded = true;
    console.log("[TFT] Model loaded in STUB mode");
  }

  isLoaded(): boolean {
    return this.modelLoaded;
  }

  /**
   * Generate multi-horizon forecast
   */
  async predict(input: TFTInput): Promise<TFTOutput> {
    if (!this.modelLoaded) {
      throw new Error("TFT model not loaded. Call load() first.");
    }

    this.inferenceCount++;

    // Get last known price for stub predictions
    const lastPrice =
      input.observedSequence.length > 0
        ? input.observedSequence[input.observedSequence.length - 1].price
        : 100;

    const now = new Date();

    // Generate stub forecasts
    const forecasts = TFT_CONFIG.output.horizons.map((horizon) => {
      const forecastDate = new Date(now);
      forecastDate.setDate(forecastDate.getDate() + horizon);

      // Stub: Random walk around last price
      const drift = (Math.random() - 0.5) * 0.1 * horizon;
      const volatility = 0.05 * Math.sqrt(horizon);

      return {
        horizon,
        date: forecastDate,
        predicted: {
          p10: lastPrice * (1 + drift - volatility * 1.28),
          p50: lastPrice * (1 + drift),
          p90: lastPrice * (1 + drift + volatility * 1.28),
        },
      };
    });

    // Stub attention weights
    const temporalAttention = input.observedSequence.map((obs) => ({
      date: obs.date,
      weight: Math.random(),
    }));

    // Normalize attention weights
    const totalWeight = temporalAttention.reduce((sum, a) => sum + a.weight, 0);
    temporalAttention.forEach((a) => (a.weight /= totalWeight));

    // Stub feature importance
    const featureImportance = [
      { feature: "price", importance: 0.3 },
      { feature: "price_change", importance: 0.2 },
      { feature: "tcg100_index", importance: 0.15 },
      { feature: "volume", importance: 0.1 },
      { feature: "day_of_week", importance: 0.1 },
      { feature: "social_sentiment", importance: 0.08 },
      { feature: "days_to_set_release", importance: 0.07 },
    ];

    return {
      cardId: input.cardId,
      predictionTimestamp: now,
      forecasts,
      attention: {
        temporalAttention,
        featureImportance,
      },
      confidence: 0.5, // Low confidence = model not trained
      modelVersion: this.version,
    };
  }

  /**
   * Batch prediction
   */
  async predictBatch(inputs: TFTInput[]): Promise<TFTOutput[]> {
    return Promise.all(inputs.map((input) => this.predict(input)));
  }

  /**
   * Unload model
   */
  async unload(): Promise<void> {
    this.modelLoaded = false;
    console.log("[TFT] Model unloaded");
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let tftInstance: TemporalFusionTransformerModel | null = null;

export function getTemporalFusionTransformer(
  config?: TFTModelConfig
): TemporalFusionTransformerModel {
  if (!tftInstance) {
    tftInstance = new TemporalFusionTransformerModel(config);
  }
  return tftInstance;
}

export function resetTemporalFusionTransformer(): void {
  if (tftInstance) {
    tftInstance.unload();
  }
  tftInstance = null;
}

// =============================================================================
// TRAINING DATA SCHEMA
// =============================================================================

export interface TFTTrainingExample {
  cardId: string;

  // Static features
  staticFeatures: TFTInput["staticFeatures"];

  // Full sequence (encoder + decoder periods)
  // Length = encoderLength + decoderLength
  sequence: Array<{
    date: Date;

    // Target
    price: number;

    // Observed features
    priceChange: number;
    volume: number;
    listingsCount: number;
    tcg100Index: number;
    socialSentiment: number;
    searchVolume: number;

    // Known features
    dayOfWeek: number;
    month: number;
    isWeekend: boolean;
    isHoliday: boolean;
    daysToSetRelease: number;
    daysToTournament: number;
    isBanListPeriod: boolean;

    // Flag indicating if this is in encoder (true) or decoder (false) period
    isEncoderPeriod: boolean;
  }>;

  // Metadata
  splitType: "train" | "validation" | "test";
}

export interface TFTTrainingStats {
  totalSequences: number;
  uniqueCards: number;
  dateRange: { start: Date; end: Date };
  avgSequenceLength: number;
  missingDataRate: number;
  lastUpdated: Date;
}

export function calculateTFTTrainingReadiness(stats: TFTTrainingStats): {
  ready: boolean;
  completionPercentage: number;
  missingRequirements: string[];
} {
  const requirements = TFT_CONFIG.training;
  const missing: string[] = [];

  const sequenceCompletion = stats.totalSequences / requirements.requiredSequences;
  if (sequenceCompletion < 1) {
    missing.push(
      `Need ${requirements.requiredSequences - stats.totalSequences} more sequences (${Math.round(sequenceCompletion * 100)}% complete)`
    );
  }

  if (stats.missingDataRate > 0.05) {
    missing.push(`Missing data rate ${(stats.missingDataRate * 100).toFixed(1)}% exceeds 5% threshold`);
  }

  const requiredLength = TFT_CONFIG.sequence.encoderLength + TFT_CONFIG.sequence.decoderLength;
  if (stats.avgSequenceLength < requiredLength) {
    missing.push(`Average sequence length ${stats.avgSequenceLength} < required ${requiredLength}`);
  }

  return {
    ready: missing.length === 0,
    completionPercentage: Math.min(100, Math.round(sequenceCompletion * 100)),
    missingRequirements: missing,
  };
}
