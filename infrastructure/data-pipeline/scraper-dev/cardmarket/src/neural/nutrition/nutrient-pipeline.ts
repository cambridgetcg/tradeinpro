/**
 * Neural Embryo Nutritional Pipeline
 *
 * Implements the nutritional framework for feeding the vision neural embryo.
 * Transforms raw data into high-quality nutrients for model training.
 *
 * Nutrient Categories:
 *   - Macronutrients: Images (carbs), Labels (protein), Context (fats)
 *   - Micronutrients: Augmentations (vitamins), Domain knowledge (minerals)
 *
 * @see docs/NEURAL_EMBRYO_NUTRIENTS.md for full nutritional specification
 */

// =============================================================================
// NUTRIENT TYPES
// =============================================================================

/**
 * Raw card image (Carbohydrate source)
 */
export interface RawCardImage {
  buffer: Buffer;
  format: 'jpeg' | 'png' | 'webp';
  source: 'official' | 'user_upload' | 'scrape';
  quality: 'high' | 'medium' | 'low';
  dimensions: { width: number; height: number };
}

/**
 * Label annotation (Protein source)
 */
export interface CardLabels {
  // Essential amino acids (must be provided)
  cardId?: string;           // Leucine - identity
  condition?: ConditionLabel; // Isoleucine - condition
  rarity?: RarityLabel;       // Valine - rarity
  variant?: VariantLabel;     // Lysine - variation
  language?: LanguageLabel;   // Methionine - language
  authentic?: boolean;        // Threonine - authenticity

  // Non-essential (can be derived)
  boundingBox?: BoundingBox;
  textRegions?: TextRegion[];
}

export interface ConditionLabel {
  grade: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
  score: number; // 0-100
  defects?: DefectAnnotation[];
}

export interface RarityLabel {
  rarity: 'C' | 'UC' | 'R' | 'SR' | 'SEC' | 'SP' | 'ALT' | 'PROMO';
  holoType?: 'none' | 'standard' | 'full' | 'special';
}

export interface VariantLabel {
  type: 'standard' | 'parallel' | 'sp' | 'manga' | 'boxtopper' | 'promo';
  artType: 'standard' | 'alternate' | 'extended' | 'full';
}

export interface LanguageLabel {
  language: 'EN' | 'JP' | 'KR' | 'CN' | 'DE' | 'FR' | 'ES' | 'IT';
  textDirection: 'ltr' | 'rtl' | 'vertical';
}

export interface DefectAnnotation {
  type: 'whitening' | 'scratch' | 'crease' | 'dent' | 'stain' | 'tear';
  region: 'corner_tl' | 'corner_tr' | 'corner_bl' | 'corner_br' | 'edge' | 'surface';
  severity: 'minor' | 'moderate' | 'severe';
  coordinates?: { x: number; y: number; width: number; height: number };
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface TextRegion {
  type: 'name' | 'text_box' | 'card_number' | 'set_symbol';
  box: BoundingBox;
  text?: string;
}

/**
 * Contextual information (Fat source)
 */
export interface CardContext {
  // Saturated fats (stable knowledge)
  setReleaseDate?: Date;
  cardNumberInSet?: number;
  totalCardsInSet?: number;
  printRun?: string;

  // Unsaturated fats (market context)
  currentPrice?: number;
  priceHistory?: PricePoint[];
  popularity?: number;
  tournamentRelevance?: number;

  // Omega-3 (error-correcting)
  knownCounterfeitPatterns?: string[];
  commonMisidentifications?: string[];
  gradingRubric?: GradingRubric;
}

export interface PricePoint {
  date: Date;
  price: number;
  currency: string;
}

export interface GradingRubric {
  cornerWeight: number;
  edgeWeight: number;
  surfaceWeight: number;
  centeringWeight: number;
}

// =============================================================================
// COMPLETE NUTRIENT (Training Example)
// =============================================================================

export interface TrainingNutrient {
  // Macronutrients
  image: RawCardImage;
  labels: CardLabels;
  context?: CardContext;

  // Metadata
  nutrientId: string;
  sourceDataset: string;
  proteinQuality: number; // 0-100 (label confidence)
  collectedAt: Date;
}

// =============================================================================
// VITAMIN AUGMENTATIONS
// =============================================================================

export interface VitaminConfig {
  // Vitamin A (Visual adaptation)
  vitaminA: {
    enabled: boolean;
    brightnessRange: [number, number]; // e.g., [-0.3, 0.3]
    contrastRange: [number, number];
    colorTempRange: [number, number]; // Kelvin
  };

  // Vitamin B Complex (Geometric transforms)
  vitaminB: {
    enabled: boolean;
    rotationRange: [number, number]; // degrees
    scaleRange: [number, number];
    perspectiveStrength: number;
    horizontalFlip: boolean;
  };

  // Vitamin C (Noise resistance)
  vitaminC: {
    enabled: boolean;
    gaussianNoiseSigma: number;
    jpegQualityRange: [number, number];
    motionBlurChance: number;
  };

  // Vitamin D (Structural integrity)
  vitaminD: {
    enabled: boolean;
    cutoutChance: number;
    cutoutSize: [number, number]; // fraction of image
    mixupAlpha: number;
    cutmixChance: number;
  };

  // Vitamin E (Overfitting prevention)
  vitaminE: {
    enabled: boolean;
    dropoutRate: number;
    labelSmoothing: number;
    weightDecay: number;
  };

  // Vitamin K (Knowledge retention)
  vitaminK: {
    enabled: boolean;
    ewcLambda: number;
    replayBufferSize: number;
    distillationTemp: number;
  };
}

// =============================================================================
// MINERAL CONFIGURATIONS
// =============================================================================

export interface MineralConfig {
  // Calcium (Card anatomy)
  calcium: {
    artBoxRegion: BoundingBox;
    textBoxRegion: BoundingBox;
    cornerRegions: BoundingBox[];
    edgeRegions: BoundingBox[];
  };

  // Zinc (Counterfeit detection)
  zinc: {
    authenticPatterns: string[];
    counterfeitPatterns: string[];
    holoPatternDatabase: string;
  };

  // Potassium (Output calibration)
  potassium: {
    gradeDistribution: Record<string, number>;
    rarityPriors: Record<string, number>;
    calibrationCurve?: number[];
  };
}

// =============================================================================
// NUTRIENT PIPELINE
// =============================================================================

export class NutrientPipeline {
  private vitamins: VitaminConfig;
  private minerals: MineralConfig;
  private stage: 'ZYGOTE' | 'BLASTULA' | 'GASTRULA' | 'NEURULA' | 'ORGANISM';

  constructor(
    vitamins: Partial<VitaminConfig> = {},
    minerals: Partial<MineralConfig> = {},
    stage: 'ZYGOTE' | 'BLASTULA' | 'GASTRULA' | 'NEURULA' | 'ORGANISM' = 'ZYGOTE'
  ) {
    this.vitamins = this.getDefaultVitamins(vitamins);
    this.minerals = this.getDefaultMinerals(minerals);
    this.stage = stage;
  }

  // ===========================================================================
  // NUTRIENT PROCESSING
  // ===========================================================================

  /**
   * Process raw data into training-ready nutrients
   */
  async processNutrient(
    raw: TrainingNutrient
  ): Promise<ProcessedNutrient> {
    const startTime = Date.now();

    // 1. Validate protein quality (label verification)
    const proteinQuality = this.assessProteinQuality(raw.labels);

    // 2. Apply vitamin augmentations (if training)
    const augmentedImage = await this.applyVitamins(raw.image);

    // 3. Extract mineral-guided features
    const mineralFeatures = this.extractMineralFeatures(raw);

    // 4. Compute nutritional balance
    const balance = this.computeNutritionalBalance(raw);

    return {
      ...raw,
      augmentedImage,
      proteinQuality,
      mineralFeatures,
      nutritionalBalance: balance,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Assess protein (label) quality
   */
  private assessProteinQuality(labels: CardLabels): number {
    let score = 0;
    let maxScore = 0;

    // Essential amino acids
    const essentials = [
      { key: 'cardId', weight: 30, present: !!labels.cardId },
      { key: 'condition', weight: 20, present: !!labels.condition },
      { key: 'rarity', weight: 15, present: !!labels.rarity },
      { key: 'variant', weight: 15, present: !!labels.variant },
      { key: 'language', weight: 10, present: !!labels.language },
      { key: 'authentic', weight: 10, present: labels.authentic !== undefined },
    ];

    for (const aa of essentials) {
      maxScore += aa.weight;
      if (aa.present) {
        score += aa.weight;
      }
    }

    return (score / maxScore) * 100;
  }

  /**
   * Apply vitamin augmentations
   */
  private async applyVitamins(image: RawCardImage): Promise<AugmentedImage> {
    const augmentations: string[] = [];
    let processedBuffer = image.buffer;

    // Vitamin A: Visual adaptation
    if (this.vitamins.vitaminA.enabled && Math.random() < 0.5) {
      processedBuffer = await this.applyBrightnessContrast(
        processedBuffer,
        this.vitamins.vitaminA.brightnessRange,
        this.vitamins.vitaminA.contrastRange
      );
      augmentations.push('brightness_contrast');
    }

    // Vitamin B: Geometric transforms
    if (this.vitamins.vitaminB.enabled && Math.random() < 0.8) {
      processedBuffer = await this.applyGeometric(
        processedBuffer,
        this.vitamins.vitaminB
      );
      augmentations.push('geometric');
    }

    // Vitamin C: Noise resistance
    if (this.vitamins.vitaminC.enabled && Math.random() < 0.3) {
      processedBuffer = await this.applyNoise(
        processedBuffer,
        this.vitamins.vitaminC
      );
      augmentations.push('noise');
    }

    // Vitamin D: Structural (cutout/mixup) - handled at batch level
    // Vitamin E: Regularization - handled in training loop

    return {
      buffer: processedBuffer,
      appliedAugmentations: augmentations,
      originalDimensions: image.dimensions,
    };
  }

  /**
   * Extract mineral-guided features
   */
  private extractMineralFeatures(nutrient: TrainingNutrient): MineralFeatures {
    const features: MineralFeatures = {
      anatomyRegions: {},
      attentionPriors: [],
      calibrationFactors: {},
    };

    // Calcium: Card anatomy
    if (this.minerals.calcium) {
      features.anatomyRegions = {
        artBox: this.minerals.calcium.artBoxRegion,
        textBox: this.minerals.calcium.textBoxRegion,
        corners: this.minerals.calcium.cornerRegions,
        edges: this.minerals.calcium.edgeRegions,
      };
    }

    // Potassium: Calibration factors
    if (this.minerals.potassium && nutrient.labels.rarity) {
      const rarity = nutrient.labels.rarity.rarity;
      features.calibrationFactors.rarityPrior =
        this.minerals.potassium.rarityPriors[rarity] || 0.1;
    }

    // Sodium: Attention priors based on task
    features.attentionPriors = this.computeAttentionPriors(nutrient.labels);

    return features;
  }

  /**
   * Compute attention priors based on labels present
   */
  private computeAttentionPriors(labels: CardLabels): AttentionPrior[] {
    const priors: AttentionPrior[] = [];

    // Condition task → focus on corners and edges
    if (labels.condition) {
      priors.push({
        task: 'condition',
        regions: ['corner_tl', 'corner_tr', 'corner_bl', 'corner_br', 'edges'],
        weight: 1.5,
      });
    }

    // Rarity task → focus on frame and holo regions
    if (labels.rarity) {
      priors.push({
        task: 'rarity',
        regions: ['frame', 'holo_region'],
        weight: 1.3,
      });
    }

    // Language task → focus on text box
    if (labels.language) {
      priors.push({
        task: 'language',
        regions: ['text_box', 'name_region'],
        weight: 1.2,
      });
    }

    // Authenticity task → focus everywhere with micro-features
    if (labels.authentic !== undefined) {
      priors.push({
        task: 'authenticity',
        regions: ['full_card', 'micro_features'],
        weight: 1.0,
      });
    }

    return priors;
  }

  /**
   * Compute overall nutritional balance
   */
  private computeNutritionalBalance(nutrient: TrainingNutrient): NutritionalBalance {
    // Calculate macro ratios
    const carbScore = this.scoreImageQuality(nutrient.image);
    const proteinScore = this.assessProteinQuality(nutrient.labels);
    const fatScore = nutrient.context
      ? this.scoreContextRichness(nutrient.context)
      : 0;

    // Ideal ratio: 70% carbs, 20% protein, 10% fat
    const idealRatio = { carbs: 0.7, protein: 0.2, fat: 0.1 };
    const actualRatio = {
      carbs: carbScore / 100,
      protein: proteinScore / 100,
      fat: fatScore / 100,
    };

    // Calculate balance score
    const balanceScore =
      1 -
      (Math.abs(idealRatio.carbs - actualRatio.carbs) +
        Math.abs(idealRatio.protein - actualRatio.protein) +
        Math.abs(idealRatio.fat - actualRatio.fat)) /
        3;

    return {
      carbScore,
      proteinScore,
      fatScore,
      overallBalance: balanceScore * 100,
      deficiencies: this.identifyDeficiencies(actualRatio, idealRatio),
    };
  }

  private scoreImageQuality(image: RawCardImage): number {
    let score = 50; // Base

    // Resolution bonus
    const pixels = image.dimensions.width * image.dimensions.height;
    if (pixels >= 224 * 224) score += 10;
    if (pixels >= 512 * 512) score += 10;
    if (pixels >= 1024 * 1024) score += 10;

    // Quality bonus
    if (image.quality === 'high') score += 10;
    if (image.quality === 'medium') score += 5;

    // Source bonus
    if (image.source === 'official') score += 10;

    return Math.min(100, score);
  }

  private scoreContextRichness(context: CardContext): number {
    let score = 0;

    if (context.setReleaseDate) score += 15;
    if (context.currentPrice) score += 20;
    if (context.priceHistory && context.priceHistory.length > 0) score += 20;
    if (context.gradingRubric) score += 25;
    if (context.knownCounterfeitPatterns) score += 20;

    return Math.min(100, score);
  }

  private identifyDeficiencies(
    actual: Record<string, number>,
    ideal: Record<string, number>
  ): string[] {
    const deficiencies: string[] = [];

    if (actual.carbs < ideal.carbs * 0.7) deficiencies.push('low_image_quality');
    if (actual.protein < ideal.protein * 0.7) deficiencies.push('missing_labels');
    if (actual.fat < ideal.fat * 0.5) deficiencies.push('no_context');

    return deficiencies;
  }

  // ===========================================================================
  // DEFAULT CONFIGURATIONS
  // ===========================================================================

  private getDefaultVitamins(overrides: Partial<VitaminConfig>): VitaminConfig {
    return {
      vitaminA: {
        enabled: true,
        brightnessRange: [-0.3, 0.3],
        contrastRange: [-0.2, 0.2],
        colorTempRange: [4000, 7000],
        ...overrides.vitaminA,
      },
      vitaminB: {
        enabled: true,
        rotationRange: [-15, 15],
        scaleRange: [0.9, 1.1],
        perspectiveStrength: 0.1,
        horizontalFlip: false, // Cards shouldn't be flipped
        ...overrides.vitaminB,
      },
      vitaminC: {
        enabled: true,
        gaussianNoiseSigma: 0.02,
        jpegQualityRange: [70, 95],
        motionBlurChance: 0.1,
        ...overrides.vitaminC,
      },
      vitaminD: {
        enabled: true,
        cutoutChance: 0.2,
        cutoutSize: [0.1, 0.2],
        mixupAlpha: 0.2,
        cutmixChance: 0.1,
        ...overrides.vitaminD,
      },
      vitaminE: {
        enabled: true,
        dropoutRate: 0.2,
        labelSmoothing: 0.1,
        weightDecay: 0.0001,
        ...overrides.vitaminE,
      },
      vitaminK: {
        enabled: this.stage === 'ORGANISM',
        ewcLambda: 0.4,
        replayBufferSize: 10000,
        distillationTemp: 2.0,
        ...overrides.vitaminK,
      },
    };
  }

  private getDefaultMinerals(overrides: Partial<MineralConfig>): MineralConfig {
    return {
      calcium: {
        artBoxRegion: { x: 0.05, y: 0.05, width: 0.9, height: 0.45 },
        textBoxRegion: { x: 0.05, y: 0.55, width: 0.9, height: 0.35 },
        cornerRegions: [
          { x: 0, y: 0, width: 0.1, height: 0.1 },
          { x: 0.9, y: 0, width: 0.1, height: 0.1 },
          { x: 0, y: 0.9, width: 0.1, height: 0.1 },
          { x: 0.9, y: 0.9, width: 0.1, height: 0.1 },
        ],
        edgeRegions: [
          { x: 0, y: 0.1, width: 0.03, height: 0.8 },
          { x: 0.97, y: 0.1, width: 0.03, height: 0.8 },
          { x: 0.1, y: 0, width: 0.8, height: 0.03 },
          { x: 0.1, y: 0.97, width: 0.8, height: 0.03 },
        ],
        ...overrides.calcium,
      },
      zinc: {
        authenticPatterns: [],
        counterfeitPatterns: [],
        holoPatternDatabase: '',
        ...overrides.zinc,
      },
      potassium: {
        gradeDistribution: { NM: 0.15, LP: 0.30, MP: 0.30, HP: 0.15, DMG: 0.10 },
        rarityPriors: { C: 0.50, UC: 0.25, R: 0.15, SR: 0.07, SEC: 0.03 },
        ...overrides.potassium,
      },
    };
  }

  // ===========================================================================
  // AUGMENTATION IMPLEMENTATIONS (Stubs)
  // ===========================================================================

  private async applyBrightnessContrast(
    buffer: Buffer,
    _brightnessRange: [number, number],
    _contrastRange: [number, number]
  ): Promise<Buffer> {
    // Would use sharp or opencv in production
    return buffer;
  }

  private async applyGeometric(
    buffer: Buffer,
    _config: VitaminConfig['vitaminB']
  ): Promise<Buffer> {
    // Would apply rotation, scale, perspective in production
    return buffer;
  }

  private async applyNoise(
    buffer: Buffer,
    _config: VitaminConfig['vitaminC']
  ): Promise<Buffer> {
    // Would add Gaussian noise, JPEG artifacts in production
    return buffer;
  }

  // ===========================================================================
  // BATCH PROCESSING
  // ===========================================================================

  /**
   * Process a batch of nutrients with Vitamin D (mixup/cutmix)
   */
  async processBatch(
    nutrients: TrainingNutrient[]
  ): Promise<ProcessedNutrient[]> {
    const processed: ProcessedNutrient[] = [];

    for (const nutrient of nutrients) {
      const p = await this.processNutrient(nutrient);
      processed.push(p);
    }

    // Apply Vitamin D at batch level
    if (this.vitamins.vitaminD.enabled) {
      await this.applyBatchAugmentations(processed);
    }

    return processed;
  }

  private async applyBatchAugmentations(
    _batch: ProcessedNutrient[]
  ): Promise<void> {
    // Apply mixup, cutmix at batch level
    // Implementation would modify batch in-place
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Compute nutritional statistics for a dataset
   */
  computeDatasetNutrition(nutrients: TrainingNutrient[]): DatasetNutrition {
    const balances = nutrients.map((n) => this.computeNutritionalBalance(n));

    const avgCarbs =
      balances.reduce((s, b) => s + b.carbScore, 0) / balances.length;
    const avgProtein =
      balances.reduce((s, b) => s + b.proteinScore, 0) / balances.length;
    const avgFat =
      balances.reduce((s, b) => s + b.fatScore, 0) / balances.length;
    const avgBalance =
      balances.reduce((s, b) => s + b.overallBalance, 0) / balances.length;

    const deficiencyCounts: Record<string, number> = {};
    for (const balance of balances) {
      for (const def of balance.deficiencies) {
        deficiencyCounts[def] = (deficiencyCounts[def] || 0) + 1;
      }
    }

    return {
      sampleCount: nutrients.length,
      averageCarbs: avgCarbs,
      averageProtein: avgProtein,
      averageFat: avgFat,
      averageBalance: avgBalance,
      deficiencies: deficiencyCounts,
      recommendation: this.generateRecommendation(avgCarbs, avgProtein, avgFat),
    };
  }

  private generateRecommendation(
    carbs: number,
    protein: number,
    fat: number
  ): string {
    const issues: string[] = [];

    if (carbs < 60) issues.push('Need higher quality images');
    if (protein < 50) issues.push('Need more complete labels');
    if (fat < 30) issues.push('Add contextual information');

    return issues.length > 0 ? issues.join('; ') : 'Nutritional balance is good';
  }
}

// =============================================================================
// OUTPUT TYPES
// =============================================================================

export interface ProcessedNutrient extends TrainingNutrient {
  augmentedImage: AugmentedImage;
  mineralFeatures: MineralFeatures;
  nutritionalBalance: NutritionalBalance;
  processingTimeMs: number;
}

export interface AugmentedImage {
  buffer: Buffer;
  appliedAugmentations: string[];
  originalDimensions: { width: number; height: number };
}

export interface MineralFeatures {
  anatomyRegions: {
    artBox?: BoundingBox;
    textBox?: BoundingBox;
    corners?: BoundingBox[];
    edges?: BoundingBox[];
  };
  attentionPriors: AttentionPrior[];
  calibrationFactors: Record<string, number>;
}

export interface AttentionPrior {
  task: string;
  regions: string[];
  weight: number;
}

export interface NutritionalBalance {
  carbScore: number;
  proteinScore: number;
  fatScore: number;
  overallBalance: number;
  deficiencies: string[];
}

export interface DatasetNutrition {
  sampleCount: number;
  averageCarbs: number;
  averageProtein: number;
  averageFat: number;
  averageBalance: number;
  deficiencies: Record<string, number>;
  recommendation: string;
}
