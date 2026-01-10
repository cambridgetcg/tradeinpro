/**
 * Lambda Handlers Module Index
 *
 * Export AWS Lambda handlers for the pipeline.
 */

// Individual handlers
export { handler as fetchHandler, type FetchEvent, type FetchResult, type FetchResponse } from './fetch-handler.js';
export { handler as transformHandler, type TransformEvent, type TransformResponse } from './transform-handler.js';
export { handler as loadHandler, type LoadEvent, type LoadResponse } from './load-handler.js';
export { handler as orchestratorHandler, type OrchestratorEvent, type OrchestratorResponse } from './orchestrator-handler.js';

// Re-export handlers with descriptive names
import { handler as fetchHandler } from './fetch-handler.js';
import { handler as transformHandler } from './transform-handler.js';
import { handler as loadHandler } from './load-handler.js';
import { handler as orchestratorHandler } from './orchestrator-handler.js';

export const handlers = {
  fetch: fetchHandler,
  transform: transformHandler,
  load: loadHandler,
  orchestrator: orchestratorHandler,
};

export default handlers;
