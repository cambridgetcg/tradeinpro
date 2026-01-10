/**
 * Neural Nutrition Module
 *
 * Provides the nutritional infrastructure for feeding the vision neural embryo.
 * Implements the biological metaphor of nutrients for training data.
 *
 * @see docs/NEURAL_EMBRYO_NUTRIENTS.md
 */

export {
  // Nutrient types
  RawCardImage,
  CardLabels,
  ConditionLabel,
  RarityLabel,
  VariantLabel,
  LanguageLabel,
  DefectAnnotation,
  BoundingBox,
  TextRegion,
  CardContext,
  PricePoint,
  GradingRubric,
  TrainingNutrient,

  // Vitamin configuration
  VitaminConfig,

  // Mineral configuration
  MineralConfig,

  // Pipeline
  NutrientPipeline,

  // Output types
  ProcessedNutrient,
  AugmentedImage,
  MineralFeatures,
  AttentionPrior,
  NutritionalBalance,
  DatasetNutrition,
} from './nutrient-pipeline';
