/**
 * Pipeline Module Index
 *
 * Export data transformation pipeline components.
 */

// Validator
export * from './validator.js';

// Merger
export * from './merger.js';

// Transformer
export * from './transformer.js';

// Orchestrator
export * from './orchestrator.js';

// Hybrid Pipeline (JustTCG + Bright Data fallback)
export * from './hybrid-tcgplayer-pipeline.js';

// Re-export convenience functions
import { createValidator, validateCard, validateCards } from './validator.js';
import { createMerger, mergeTwoSources } from './merger.js';
import { createTransformer, transformCards, transformRawCards } from './transformer.js';
import { createPipeline, runPipeline, runForGame } from './orchestrator.js';
import { createHybridPipeline, HybridTCGPlayerPipeline } from './hybrid-tcgplayer-pipeline.js';

export {
  // Validator
  createValidator,
  validateCard,
  validateCards,
  // Merger
  createMerger,
  mergeTwoSources,
  // Transformer
  createTransformer,
  transformCards,
  transformRawCards,
  // Orchestrator
  createPipeline,
  runPipeline,
  runForGame,
  // Hybrid Pipeline
  createHybridPipeline,
  HybridTCGPlayerPipeline,
};
