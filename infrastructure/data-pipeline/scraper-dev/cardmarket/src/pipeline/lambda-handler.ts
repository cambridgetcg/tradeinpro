/**
 * AWS Lambda Handler Module
 *
 * Entry points for serverless execution:
 * - SQS trigger handler (process queued jobs)
 * - Step Functions handler (orchestrated pipeline)
 * - EventBridge handler (scheduled runs)
 * - API Gateway handler (manual triggers)
 */

import { PrismaClient } from '@prisma/client';
import type { SQSEvent, SQSRecord, Context } from 'aws-lambda';
import { PipelineOrchestrator, createPipelineOrchestrator } from './orchestrator.js';
import { SQSQueue, createSQSQueue, type ScrapeJob } from './sqs-queue.js';
import { CloudWatchMetrics } from '../monitoring/cloudwatch.js';

// Initialize outside handler for connection reuse
let prisma: PrismaClient | null = null;
let orchestrator: PipelineOrchestrator | null = null;
let sqsQueue: SQSQueue | null = null;
let metrics: CloudWatchMetrics | null = null;

/**
 * Initialize shared resources
 */
function initialize(): void {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  if (!metrics) {
    metrics = new CloudWatchMetrics({ namespace: 'CardmarketPipeline' });
  }
  if (!orchestrator) {
    orchestrator = createPipelineOrchestrator(prisma, metrics);
  }
  if (!sqsQueue) {
    sqsQueue = createSQSQueue(undefined, metrics);
  }
}

/**
 * Step Functions input
 */
export interface StepFunctionsInput {
  sets?: string[];
  options?: {
    maxCardsPerSet?: number;
    maxPagesPerSet?: number;
    includeArticles?: boolean;
    storeRawToS3?: boolean;
    loadToDatabase?: boolean;
    generateTrainingExport?: boolean;
  };
  taskToken?: string;
}

/**
 * Step Functions output
 */
export interface StepFunctionsOutput {
  success: boolean;
  runId: string;
  status: string;
  stats: {
    setsProcessed: number;
    cardsScraped: number;
    cardsLoaded: number;
    errors: number;
    duration: number;
  };
}

/**
 * Handler for AWS Step Functions (orchestrated pipeline)
 */
export async function stepFunctionsHandler(
  event: StepFunctionsInput,
  context: Context
): Promise<StepFunctionsOutput> {
  console.log('Step Functions handler invoked', { event, requestId: context.awsRequestId });
  initialize();

  const sets = event.sets || [
    'OP01', 'OP02', 'OP03', 'OP04', 'OP05', 'OP06', 'OP07', 'OP08',
    'OP09', 'OP10', 'OP11', 'OP12', 'OP13', 'EB01', 'EB02',
  ];

  try {
    const result = await orchestrator!.run({
      sets,
      maxCardsPerSet: event.options?.maxCardsPerSet || 500,
      maxPagesPerSet: event.options?.maxPagesPerSet || 50,
      includeArticles: event.options?.includeArticles || false,
      storeRawToS3: event.options?.storeRawToS3 ?? true,
      loadToDatabase: event.options?.loadToDatabase ?? true,
      generateTrainingExport: event.options?.generateTrainingExport || false,
      continueOnError: true,
      maxErrors: 20,
      dryRun: false,
    });

    return {
      success: result.success,
      runId: result.runId,
      status: result.status,
      stats: {
        setsProcessed: result.setsProcessed,
        cardsScraped: result.totalCardsScraped,
        cardsLoaded: result.totalCardsLoaded,
        errors: result.totalErrors,
        duration: result.duration,
      },
    };
  } catch (error) {
    console.error('Pipeline execution failed:', error);
    await metrics!.putMetric('PipelineFailures', 1, 'Count');

    return {
      success: false,
      runId: `failed_${Date.now()}`,
      status: 'failed',
      stats: {
        setsProcessed: 0,
        cardsScraped: 0,
        cardsLoaded: 0,
        errors: 1,
        duration: 0,
      },
    };
  }
}

/**
 * Handler for SQS events (process queued jobs)
 */
export async function sqsHandler(
  event: SQSEvent,
  context: Context
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  console.log('SQS handler invoked', {
    messageCount: event.Records.length,
    requestId: context.awsRequestId,
  });
  initialize();

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      await processJob(record);
    } catch (error) {
      console.error('Job processing failed:', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Report partial batch failure
      batchItemFailures.push({ itemIdentifier: record.messageId });

      // Try to send to DLQ if it's a permanent failure
      try {
        const job = JSON.parse(record.body) as ScrapeJob;
        if (!sqsQueue!.shouldRetry(job)) {
          await sqsQueue!.sendToDLQ(job, error instanceof Error ? error.message : 'Unknown error');
        }
      } catch (dlqError) {
        console.error('Failed to send to DLQ:', dlqError);
      }
    }
  }

  return { batchItemFailures };
}

/**
 * Process a single job from SQS
 */
async function processJob(record: SQSRecord): Promise<void> {
  const job = JSON.parse(record.body) as ScrapeJob;
  console.log('Processing job:', { jobId: job.jobId, type: job.jobType });

  switch (job.jobType) {
    case 'set':
      if (!job.setCode) {
        throw new Error('Set code is required for set job type');
      }
      await orchestrator!.run({
        sets: [job.setCode],
        maxCardsPerSet: job.options?.maxCardsPerSet || 500,
        maxPagesPerSet: job.options?.maxPagesPerSet || 50,
        includeArticles: job.options?.includeArticles || false,
        storeRawToS3: true,
        loadToDatabase: true,
        continueOnError: false,
        maxErrors: 5,
        dryRun: false,
      });
      break;

    case 'card':
      if (!job.cardUrl) {
        throw new Error('Card URL is required for card job type');
      }
      await orchestrator!.runSingleCard(job.cardUrl, { loadToDatabase: true });
      break;

    case 'full':
      const sets = job.sets || [
        'OP01', 'OP02', 'OP03', 'OP04', 'OP05', 'OP06', 'OP07', 'OP08',
        'OP09', 'OP10', 'OP11', 'OP12', 'OP13', 'EB01', 'EB02',
      ];
      await orchestrator!.run({
        sets,
        maxCardsPerSet: job.options?.maxCardsPerSet || 500,
        storeRawToS3: true,
        loadToDatabase: true,
        generateTrainingExport: true,
        continueOnError: true,
        maxErrors: 20,
        dryRun: false,
      });
      break;

    default:
      throw new Error(`Unknown job type: ${job.jobType}`);
  }

  await metrics!.putMetric('JobsProcessed', 1, 'Count');
}

/**
 * EventBridge scheduled event input
 */
export interface EventBridgeInput {
  'detail-type': string;
  source: string;
  detail: {
    schedule?: 'morning' | 'evening' | 'full';
    sets?: string[];
    options?: Record<string, unknown>;
  };
}

/**
 * Handler for EventBridge scheduled events
 */
export async function eventBridgeHandler(
  event: EventBridgeInput,
  context: Context
): Promise<StepFunctionsOutput> {
  console.log('EventBridge handler invoked', {
    source: event.source,
    detailType: event['detail-type'],
    requestId: context.awsRequestId,
  });

  // Map schedule type to sets
  const scheduleSetMap: Record<string, string[]> = {
    morning: ['OP01', 'OP02', 'OP03', 'OP04', 'OP05', 'OP06', 'OP07'],
    evening: ['OP08', 'OP09', 'OP10', 'OP11', 'OP12', 'OP13', 'EB01', 'EB02'],
    full: [
      'OP01', 'OP02', 'OP03', 'OP04', 'OP05', 'OP06', 'OP07', 'OP08',
      'OP09', 'OP10', 'OP11', 'OP12', 'OP13', 'EB01', 'EB02',
    ],
  };

  const schedule = event.detail?.schedule || 'full';
  const sets = event.detail?.sets || scheduleSetMap[schedule];

  return stepFunctionsHandler({ sets, options: event.detail?.options as any }, context);
}

/**
 * API Gateway input
 */
export interface APIGatewayInput {
  httpMethod: string;
  path: string;
  queryStringParameters?: {
    sets?: string;
    dryRun?: string;
  };
  body?: string;
}

/**
 * API Gateway output
 */
export interface APIGatewayOutput {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Handler for API Gateway (manual triggers)
 */
export async function apiGatewayHandler(
  event: APIGatewayInput,
  context: Context
): Promise<APIGatewayOutput> {
  console.log('API Gateway handler invoked', {
    method: event.httpMethod,
    path: event.path,
    requestId: context.awsRequestId,
  });
  initialize();

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    // Handle different endpoints
    if (event.path === '/status') {
      const stats = await sqsQueue!.getQueueStats();
      const dbStats = await orchestrator!['loader'].getPriceStats();

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          queue: stats,
          database: dbStats,
          timestamp: new Date().toISOString(),
        }),
      };
    }

    if (event.path === '/trigger' && event.httpMethod === 'POST') {
      const setsParam = event.queryStringParameters?.sets;
      const sets = setsParam ? setsParam.split(',') : undefined;
      const dryRun = event.queryStringParameters?.dryRun === 'true';

      // Queue the job instead of running directly
      const jobId = await sqsQueue!.sendJob({
        jobType: 'full',
        sets,
        options: { maxCardsPerSet: 500 },
        priority: 'normal',
      });

      return {
        statusCode: 202,
        headers: corsHeaders,
        body: JSON.stringify({
          message: 'Pipeline job queued',
          jobId,
          sets,
          dryRun,
        }),
      };
    }

    if (event.path === '/scrape-card' && event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      const url = body.url;

      if (!url) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'URL is required' }),
        };
      }

      const result = await orchestrator!.runSingleCard(url, {
        loadToDatabase: body.loadToDatabase ?? false,
        dryRun: body.dryRun ?? true,
      });

      return {
        statusCode: result.success ? 200 : 500,
        headers: corsHeaders,
        body: JSON.stringify(result),
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error) {
    console.error('API handler error:', error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
    };
  }
}

/**
 * Combined handler that routes based on event type
 */
export async function handler(
  event: StepFunctionsInput | SQSEvent | EventBridgeInput | APIGatewayInput,
  context: Context
): Promise<unknown> {
  // Detect event type and route accordingly
  if ('Records' in event && Array.isArray(event.Records)) {
    return sqsHandler(event as SQSEvent, context);
  }

  if ('detail-type' in event) {
    return eventBridgeHandler(event as EventBridgeInput, context);
  }

  if ('httpMethod' in event) {
    return apiGatewayHandler(event as APIGatewayInput, context);
  }

  // Default: Step Functions
  return stepFunctionsHandler(event as StepFunctionsInput, context);
}

// Export all handlers
export {
  handler as main,
  stepFunctionsHandler as stepFunctions,
  sqsHandler as sqs,
  eventBridgeHandler as eventBridge,
  apiGatewayHandler as api,
};
