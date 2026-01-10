/**
 * Vision Model Types
 *
 * Types specific to the card image processing model.
 */

export type { VisionInput, VisionOutput, CardCondition, CardLanguage, VariantType } from "../types";

/**
 * Preprocessed image data ready for model input
 */
export interface PreprocessedImage {
  /** Normalized tensor data [H, W, C] */
  tensor: number[][][];
  /** Original dimensions */
  originalWidth: number;
  originalHeight: number;
  /** Preprocessing applied */
  preprocessing: {
    resized: boolean;
    normalized: boolean;
    cropped: boolean;
  };
}

/**
 * Card match candidate from the database
 */
export interface CardCandidate {
  cardId: string;
  name: string;
  setCode: string;
  cardNumber: string;
  variantType: string;
  imageUrl: string | null;
  embedding?: number[];
}

/**
 * Condition detail scores
 */
export interface ConditionDetails {
  corners: number; // 0-1, 1 = perfect
  edges: number;
  surface: number;
  centering: number;
}

/**
 * Authenticity check result
 */
export interface AuthenticityResult {
  isAuthentic: boolean;
  confidence: number;
  redFlags: string[];
  checksPassed: string[];
}

/**
 * Grading potential assessment
 */
export interface GradingPotential {
  psa10Probability: number;
  psa9Probability: number;
  expectedGrade: number;
  recommendSubmission: boolean;
  factors: {
    centering: string;
    corners: string;
    edges: string;
    surface: string;
  };
}

/**
 * Raw model output before post-processing
 */
export interface RawVisionOutput {
  cardIdLogits: number[];
  conditionLogits: number[];
  languageLogits: number[];
  variantLogits: number[];
  authenticityLogits: number[];
  gradePrediction: number;
  conditionDetails: ConditionDetails;
}

/**
 * Vision model configuration
 */
export interface VisionModelConfig {
  modelPath: string;
  cardDatabase: CardCandidate[];
  confidenceThresholds: {
    cardMatch: number;
    condition: number;
    language: number;
    authenticity: number;
  };
}
