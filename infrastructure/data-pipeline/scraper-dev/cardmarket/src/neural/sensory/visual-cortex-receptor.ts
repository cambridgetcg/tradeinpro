/**
 * Visual Cortex Receptor Neuron (EMBRYONIC)
 *
 * Sensory neuron for image-based card analysis.
 * Currently in embryonic stage - core structure defined,
 * awaiting model integration.
 *
 * Development Stage: ZYGOTE → BLASTULA
 *
 * Future Capabilities:
 *   - Card identification from images
 *   - Condition grading (NM/LP/MP/HP/DMG)
 *   - Authenticity verification
 *   - Variant detection (parallel, SP, manga)
 *
 * @see docs/NEURAL_EMBRYO_VISION.md for full specification
 */

import { BaseNeuron } from '../base-neuron';
import {
  NeuralLayer,
  NeuralSignal,
  NeurotransmitterType,
  MyelinSheath,
} from '../types';

// =============================================================================
// INTERFACES (Embryonic - Will Evolve)
// =============================================================================

/**
 * Input image data
 */
export interface ImageInput {
  /** Raw image data (base64 or buffer) */
  data: Buffer | string;

  /** Image format */
  format: 'jpeg' | 'png' | 'webp';

  /** Source of the image */
  source: 'camera' | 'upload' | 'screenshot' | 'url';

  /** Original dimensions */
  dimensions?: { width: number; height: number };

  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Defect location for condition grading
 */
export interface DefectLocation {
  type: 'scratch' | 'dent' | 'whitening' | 'crease' | 'stain' | 'other';
  region: 'corner_tl' | 'corner_tr' | 'corner_bl' | 'corner_br' | 'edge' | 'surface' | 'center';
  severity: 'minor' | 'moderate' | 'severe';
  confidence: number;
}

/**
 * Complete visual analysis output
 */
export interface VisualCardSignal {
  /** Identified card ID (e.g., OP01-051-SP) */
  cardId: string | null;

  /** Identification confidence */
  confidence: number;

  /** Condition assessment */
  condition: {
    grade: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null;
    score: number; // 0-100
    defects: DefectLocation[];
  };

  /** Authenticity check */
  authentic: {
    real: boolean | null;
    confidence: number;
    suspiciousFeatures: string[];
  };

  /** Feature embedding for similarity search */
  embedding: number[] | null; // 2048-dim when model loaded

  /** Processing metadata */
  metadata: {
    inferenceTimeMs: number;
    resolution: [number, number];
    inputSource: ImageInput['source'];
    modelVersion: string;
    embryonicStage: EmbryonicStage;
  };
}

/**
 * Embryonic development stage
 */
export type EmbryonicStage =
  | 'ZYGOTE'        // Core model only
  | 'BLASTULA'      // Feature extraction
  | 'GASTRULA'      // Specialized heads
  | 'NEURULA'       // Integrated with network
  | 'ORGANISM';     // Full capability

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface VisualCortexConfig {
  /** Current development stage */
  stage: EmbryonicStage;

  /** Model path (when available) */
  modelPath?: string;

  /** Target image size for preprocessing */
  targetSize: [number, number];

  /** Enable GPU acceleration */
  useGPU: boolean;

  /** Confidence thresholds */
  thresholds: {
    identification: number;
    condition: number;
    authenticity: number;
  };

  /** Enable mock mode for testing */
  useMockInference: boolean;
}

const DEFAULT_CONFIG: VisualCortexConfig = {
  stage: 'ZYGOTE',
  targetSize: [224, 224],
  useGPU: false,
  thresholds: {
    identification: 0.85,
    condition: 0.80,
    authenticity: 0.95,
  },
  useMockInference: true,
};

// =============================================================================
// VISUAL CORTEX RECEPTOR NEURON
// =============================================================================

export class VisualCortexReceptorNeuron extends BaseNeuron<
  ImageInput,
  VisualCardSignal
> {
  private config: VisualCortexConfig;

  // Model state (will be populated as embryo develops)
  private modelLoaded: boolean = false;

  // Statistics
  private stats: VisionStats;

  // Germ layer heads (embryonic - placeholders)
  private identityHead: IdentityHead | null = null;
  private conditionHead: ConditionHead | null = null;
  private authenticityHead: AuthenticityHead | null = null;

  constructor(config: Partial<VisualCortexConfig> = {}) {
    super('VisualCortexReceptor', NeuralLayer.SENSORY);

    this.config = { ...DEFAULT_CONFIG, ...config };

    this.stats = {
      imagesProcessed: 0,
      identifications: 0,
      conditionGrades: 0,
      authenticityChecks: 0,
      avgInferenceMs: 0,
      embryonicProgress: 0,
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected async onInitialize(): Promise<void> {
    console.log(`👁️ [${this.name}] Visual Cortex initializing...`);
    console.log(`   Embryonic Stage: ${this.config.stage}`);
    console.log(`   Target Size: ${this.config.targetSize.join('×')}`);
    console.log(`   Mock Inference: ${this.config.useMockInference}`);

    // Add myelin sheaths for optimization
    this.addVisionMyelinSheaths();

    // Initialize based on stage
    await this.initializeForStage();

    console.log(`✅ [${this.name}] Visual Cortex ready (${this.config.stage})`);
  }

  protected async onShutdown(): Promise<void> {
    this.logStats();
  }

  // ===========================================================================
  // STAGE-BASED INITIALIZATION
  // ===========================================================================

  private async initializeForStage(): Promise<void> {
    switch (this.config.stage) {
      case 'ZYGOTE':
        // Core structure only - no model loaded
        this.stats.embryonicProgress = 10;
        console.log(`   🧬 Zygote: Core structure initialized`);
        break;

      case 'BLASTULA':
        // Feature extraction ready
        // Would load backbone here: await this.loadBackbone();
        this.stats.embryonicProgress = 30;
        console.log(`   🔬 Blastula: Feature extraction ready`);
        break;

      case 'GASTRULA':
        // Specialized heads ready
        this.identityHead = new IdentityHead();
        this.conditionHead = new ConditionHead();
        this.authenticityHead = new AuthenticityHead();
        this.stats.embryonicProgress = 60;
        console.log(`   🧫 Gastrula: Specialized heads initialized`);
        break;

      case 'NEURULA':
        // Integrated with network
        this.stats.embryonicProgress = 80;
        console.log(`   🧠 Neurula: Network integration ready`);
        break;

      case 'ORGANISM':
        // Fully operational
        this.modelLoaded = true;
        this.stats.embryonicProgress = 100;
        console.log(`   🦋 Organism: Full visual capability active`);
        break;
    }
  }

  // ===========================================================================
  // MYELIN SHEATHS
  // ===========================================================================

  private addVisionMyelinSheaths(): void {
    // Feature cache sheath
    const featureCacheSheath: MyelinSheath = {
      id: 'vision-feature-cache',
      name: 'Vision Feature Cache',
      location: 'Backbone → Task Heads',
      effect: 'Cache extracted features for same image',
      speedupFactor: 3.0,
      source: 'Multi-task learning optimization',
      ttlMs: 60000, // 1 minute
      cache: new Map(),
    };
    this.addMyelinSheath(featureCacheSheath);

    // Embedding index sheath
    const embeddingIndexSheath: MyelinSheath = {
      id: 'embedding-index',
      name: 'Reference Embedding Index',
      location: 'Identity Head → Card Matching',
      effect: 'Pre-computed embeddings for known cards',
      speedupFactor: 100.0,
      source: 'Similarity search best practices',
      ttlMs: 86400000, // 24 hours
      cache: new Map(),
    };
    this.addMyelinSheath(embeddingIndexSheath);

    console.log(`   ⚡ Vision myelin sheaths: 2`);
  }

  // ===========================================================================
  // SIGNAL PROCESSING
  // ===========================================================================

  async processSignal(
    signal: NeuralSignal<ImageInput>
  ): Promise<VisualCardSignal> {
    const input = signal.payload;
    const startTime = Date.now();

    this.stats.imagesProcessed++;

    // Check feature cache (myelin optimization)
    const cacheKey = this.computeImageHash(input);
    const cached = this.checkMyelinCache<VisualCardSignal>(
      'vision-feature-cache',
      cacheKey
    );
    if (cached) {
      console.log(`⚡ [${this.name}] Cache hit for image`);
      return cached;
    }

    // Process based on stage
    let result: VisualCardSignal;

    if (this.config.useMockInference) {
      result = await this.mockInference(input);
    } else {
      result = await this.realInference(input);
    }

    // Update inference time
    const inferenceTime = Date.now() - startTime;
    result.metadata.inferenceTimeMs = inferenceTime;

    // Update stats
    this.stats.avgInferenceMs =
      (this.stats.avgInferenceMs * (this.stats.imagesProcessed - 1) +
        inferenceTime) /
      this.stats.imagesProcessed;

    if (result.cardId) this.stats.identifications++;
    if (result.condition.grade) this.stats.conditionGrades++;
    if (result.authentic.real !== null) this.stats.authenticityChecks++;

    // Cache result
    this.setMyelinCache('vision-feature-cache', cacheKey, result);

    console.log(
      `👁️ [${this.name}] Processed image: ` +
      `card=${result.cardId || 'unknown'}, ` +
      `grade=${result.condition.grade || 'N/A'}, ` +
      `authentic=${result.authentic.real ?? 'N/A'} ` +
      `(${inferenceTime}ms)`
    );

    return result;
  }

  // ===========================================================================
  // INFERENCE (Mock for Embryonic Stage)
  // ===========================================================================

  private async mockInference(input: ImageInput): Promise<VisualCardSignal> {
    // Simulate processing delay
    await this.simulateDelay(50);

    // Generate mock results based on stage
    const result: VisualCardSignal = {
      cardId: null,
      confidence: 0,
      condition: {
        grade: null,
        score: 0,
        defects: [],
      },
      authentic: {
        real: null,
        confidence: 0,
        suspiciousFeatures: [],
      },
      embedding: null,
      metadata: {
        inferenceTimeMs: 0,
        resolution: this.config.targetSize,
        inputSource: input.source,
        modelVersion: 'embryonic-mock-v0.1',
        embryonicStage: this.config.stage,
      },
    };

    // Populate based on development stage
    if (this.config.stage === 'ZYGOTE') {
      // Zygote can only extract basic features
      result.embedding = this.mockEmbedding();
      result.confidence = 0.1;
    }

    if (
      this.config.stage === 'BLASTULA' ||
      this.config.stage === 'GASTRULA' ||
      this.config.stage === 'NEURULA' ||
      this.config.stage === 'ORGANISM'
    ) {
      // Can identify cards
      result.cardId = this.mockCardId();
      result.confidence = 0.85 + Math.random() * 0.1;
      result.embedding = this.mockEmbedding();
    }

    if (
      this.config.stage === 'GASTRULA' ||
      this.config.stage === 'NEURULA' ||
      this.config.stage === 'ORGANISM'
    ) {
      // Can grade condition
      result.condition = this.mockCondition();
      result.authentic = this.mockAuthenticity();
    }

    if (this.config.stage === 'ORGANISM') {
      // Full confidence
      result.confidence = 0.95 + Math.random() * 0.04;
    }

    return result;
  }

  private async realInference(_input: ImageInput): Promise<VisualCardSignal> {
    // Placeholder for actual model inference
    // Will be implemented as embryo develops
    throw new Error(
      `Real inference not yet implemented (Stage: ${this.config.stage})`
    );
  }

  // ===========================================================================
  // MOCK HELPERS
  // ===========================================================================

  private mockCardId(): string {
    const sets = ['OP01', 'OP02', 'OP03', 'OP04', 'OP05'];
    const set = sets[Math.floor(Math.random() * sets.length)];
    const num = String(Math.floor(Math.random() * 120) + 1).padStart(3, '0');
    const variants = ['', '-parallel', '-sp', '-manga'];
    const variant = variants[Math.floor(Math.random() * variants.length)];
    return `${set}-${num}${variant}`;
  }

  private mockCondition(): VisualCardSignal['condition'] {
    const grades: Array<'NM' | 'LP' | 'MP' | 'HP' | 'DMG'> = [
      'NM', 'NM', 'NM', 'LP', 'LP', 'MP', 'HP', 'DMG'
    ];
    const grade = grades[Math.floor(Math.random() * grades.length)];

    const gradeScores = { NM: 95, LP: 85, MP: 70, HP: 50, DMG: 25 };
    const score = gradeScores[grade] + Math.floor(Math.random() * 10) - 5;

    const defects: DefectLocation[] = [];
    if (grade !== 'NM') {
      defects.push({
        type: 'whitening',
        region: 'corner_tl',
        severity: grade === 'LP' ? 'minor' : 'moderate',
        confidence: 0.8,
      });
    }

    return { grade, score: Math.max(0, Math.min(100, score)), defects };
  }

  private mockAuthenticity(): VisualCardSignal['authentic'] {
    const isReal = Math.random() > 0.05; // 95% authentic
    return {
      real: isReal,
      confidence: isReal ? 0.98 : 0.85,
      suspiciousFeatures: isReal ? [] : ['print_quality', 'holo_pattern'],
    };
  }

  private mockEmbedding(): number[] {
    // 2048-dimensional random embedding
    return Array.from({ length: 2048 }, () => Math.random() * 2 - 1);
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private computeImageHash(input: ImageInput): string {
    // Simple hash for caching (would use proper hash in production)
    const data = typeof input.data === 'string' ? input.data : input.data.toString('base64').slice(0, 100);
    return `img-${data.slice(0, 32)}-${input.source}`;
  }

  // ===========================================================================
  // NEUROTRANSMITTER SELECTION
  // ===========================================================================

  protected selectNeurotransmitter(output: VisualCardSignal): NeurotransmitterType {
    // Counterfeit detected - GABA (inhibition)
    if (output.authentic.real === false) {
      return NeurotransmitterType.GABA;
    }

    // Unknown card or low confidence - attention needed
    if (!output.cardId || output.confidence < this.config.thresholds.identification) {
      return NeurotransmitterType.NOREPINEPHRINE;
    }

    // High confidence identification - dopamine for potential opportunity
    if (
      output.confidence > 0.95 &&
      (output.cardId?.includes('-sp') || output.cardId?.includes('-parallel'))
    ) {
      return NeurotransmitterType.DOPAMINE;
    }

    // Good condition with high confidence - serotonin
    if (
      output.condition.grade === 'NM' &&
      output.authentic.confidence > this.config.thresholds.authenticity
    ) {
      return NeurotransmitterType.SEROTONIN;
    }

    // Standard processing
    return NeurotransmitterType.GLUTAMATE;
  }

  protected calculateSignalStrength(output: VisualCardSignal): number {
    // Combine confidences
    const identityStrength = output.cardId ? output.confidence : 0;
    const conditionStrength = output.condition.grade ? 0.2 : 0;
    const authenticityStrength = output.authentic.real !== null ? 0.2 : 0;

    return Math.min(1.0, identityStrength + conditionStrength + authenticityStrength);
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  private logStats(): void {
    console.log(`\n📊 [${this.name}] Vision Statistics:`);
    console.log(`   Images processed: ${this.stats.imagesProcessed}`);
    console.log(`   Identifications: ${this.stats.identifications}`);
    console.log(`   Condition grades: ${this.stats.conditionGrades}`);
    console.log(`   Authenticity checks: ${this.stats.authenticityChecks}`);
    console.log(`   Avg inference: ${this.stats.avgInferenceMs.toFixed(0)}ms`);
    console.log(`   Embryonic progress: ${this.stats.embryonicProgress}%`);
  }

  getStats(): VisionStats {
    return { ...this.stats };
  }

  /**
   * Get current embryonic development stage
   */
  getStage(): EmbryonicStage {
    return this.config.stage;
  }

  /**
   * Advance to next development stage
   */
  async advanceStage(): Promise<void> {
    const stages: EmbryonicStage[] = [
      'ZYGOTE', 'BLASTULA', 'GASTRULA', 'NEURULA', 'ORGANISM'
    ];
    const currentIndex = stages.indexOf(this.config.stage);

    if (currentIndex < stages.length - 1) {
      this.config.stage = stages[currentIndex + 1];
      await this.initializeForStage();
      console.log(`🦋 [${this.name}] Advanced to stage: ${this.config.stage}`);
    } else {
      console.log(`🦋 [${this.name}] Already at final stage: ORGANISM`);
    }
  }
}

// =============================================================================
// GERM LAYER HEAD PLACEHOLDERS
// =============================================================================

class IdentityHead {
  async predict(_features: number[]): Promise<{ cardId: string; confidence: number }> {
    // Placeholder - will integrate with actual model
    return { cardId: 'unknown', confidence: 0 };
  }
}

class ConditionHead {
  async predict(_features: number[]): Promise<{ grade: string; score: number }> {
    // Placeholder - will integrate with actual model
    return { grade: 'unknown', score: 0 };
  }
}

class AuthenticityHead {
  async predict(_features: number[]): Promise<{ real: boolean; confidence: number }> {
    // Placeholder - will integrate with actual model
    return { real: true, confidence: 0 };
  }
}

// =============================================================================
// SUPPORTING TYPES
// =============================================================================

interface VisionStats {
  imagesProcessed: number;
  identifications: number;
  conditionGrades: number;
  authenticityChecks: number;
  avgInferenceMs: number;
  embryonicProgress: number;
}
