/**
 * Jobs Module
 *
 * Collection job scheduling and handlers:
 * - Cron-based scheduling
 * - Job handlers for each collector type
 * - Progress and error tracking
 */

// Scheduler
export {
  CollectionScheduler,
  createDefaultScheduler,
  DEFAULT_JOBS,
  type JobConfig,
  type JobType,
  type JobStatus,
  type JobResult,
  type JobContext,
  type JobHandler,
} from './collection-scheduler.js';

// Job handlers
export {
  createAllHandlers,
  createListingsHandler,
  createYouTubeHandler,
  createRedditHandler,
  createTournamentHandler,
  createCardmarketHandler,
  createFeatureRefreshHandler,
  type JobHandlerDependencies,
} from './job-handlers.js';
