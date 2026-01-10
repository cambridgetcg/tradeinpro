/**
 * SQS Queue Integration Module
 *
 * Provides async processing capabilities:
 * - Job queue for scraping tasks
 * - Dead letter queue for failed tasks
 * - Message batching and retry logic
 */

import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  GetQueueAttributesCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { CloudWatchMetrics } from '../monitoring/cloudwatch.js';

/**
 * Scrape job message
 */
export interface ScrapeJob {
  jobId: string;
  jobType: 'set' | 'card' | 'full';
  setCode?: string;
  cardUrl?: string;
  sets?: string[];
  options?: {
    maxCardsPerSet?: number;
    maxPagesPerSet?: number;
    includeArticles?: boolean;
  };
  priority?: 'high' | 'normal' | 'low';
  retryCount?: number;
  createdAt: string;
}

/**
 * Queue configuration
 */
export interface QueueConfig {
  queueUrl: string;
  dlqUrl: string;
  region: string;
  maxRetries: number;
  visibilityTimeout: number;
  batchSize: number;
}

const DEFAULT_CONFIG: QueueConfig = {
  queueUrl: process.env.SQS_QUEUE_URL || '',
  dlqUrl: process.env.SQS_DLQ_URL || '',
  region: process.env.AWS_REGION || 'us-east-1',
  maxRetries: 3,
  visibilityTimeout: 900, // 15 minutes
  batchSize: 10,
};

/**
 * SQS queue manager
 */
export class SQSQueue {
  private client: SQSClient;
  private config: QueueConfig;
  private metrics: CloudWatchMetrics;

  constructor(config?: Partial<QueueConfig>, metrics?: CloudWatchMetrics) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = new SQSClient({ region: this.config.region });
    this.metrics = metrics || new CloudWatchMetrics({ namespace: 'CardmarketPipeline' });
  }

  /**
   * Send a scrape job to the queue
   */
  async sendJob(job: Omit<ScrapeJob, 'jobId' | 'createdAt'>): Promise<string> {
    const fullJob: ScrapeJob = {
      ...job,
      jobId: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };

    // Calculate delay based on priority
    let delaySeconds = 0;
    if (job.priority === 'low') {
      delaySeconds = 60;
    }

    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.config.queueUrl,
        MessageBody: JSON.stringify(fullJob),
        DelaySeconds: delaySeconds,
        MessageAttributes: {
          JobType: {
            DataType: 'String',
            StringValue: job.jobType,
          },
          Priority: {
            DataType: 'String',
            StringValue: job.priority || 'normal',
          },
        },
      })
    );

    await this.metrics.putMetric('JobsQueued', 1, 'Count');

    return fullJob.jobId;
  }

  /**
   * Send multiple jobs in batch
   */
  async sendJobBatch(
    jobs: Array<Omit<ScrapeJob, 'jobId' | 'createdAt'>>
  ): Promise<string[]> {
    const jobIds: string[] = [];
    const batches = this.chunk(jobs, this.config.batchSize);

    for (const batch of batches) {
      const entries = batch.map((job, index) => {
        const fullJob: ScrapeJob = {
          ...job,
          jobId: `job_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          retryCount: 0,
        };
        jobIds.push(fullJob.jobId);

        return {
          Id: String(index),
          MessageBody: JSON.stringify(fullJob),
          MessageAttributes: {
            JobType: {
              DataType: 'String',
              StringValue: job.jobType,
            },
          },
        };
      });

      await this.client.send(
        new SendMessageBatchCommand({
          QueueUrl: this.config.queueUrl,
          Entries: entries,
        })
      );
    }

    await this.metrics.putMetric('JobsQueued', jobs.length, 'Count');

    return jobIds;
  }

  /**
   * Receive jobs from the queue
   */
  async receiveJobs(maxJobs: number = 1): Promise<Array<{ job: ScrapeJob; receiptHandle: string }>> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.config.queueUrl,
        MaxNumberOfMessages: Math.min(maxJobs, 10),
        VisibilityTimeout: this.config.visibilityTimeout,
        WaitTimeSeconds: 20, // Long polling
        MessageAttributeNames: ['All'],
      })
    );

    if (!response.Messages) {
      return [];
    }

    return response.Messages.map((msg) => ({
      job: JSON.parse(msg.Body || '{}') as ScrapeJob,
      receiptHandle: msg.ReceiptHandle || '',
    }));
  }

  /**
   * Delete a processed job
   */
  async deleteJob(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.config.queueUrl,
        ReceiptHandle: receiptHandle,
      })
    );

    await this.metrics.putMetric('JobsCompleted', 1, 'Count');
  }

  /**
   * Delete multiple processed jobs
   */
  async deleteJobBatch(receiptHandles: string[]): Promise<void> {
    const batches = this.chunk(receiptHandles, this.config.batchSize);

    for (const batch of batches) {
      const entries = batch.map((handle, index) => ({
        Id: String(index),
        ReceiptHandle: handle,
      }));

      await this.client.send(
        new DeleteMessageBatchCommand({
          QueueUrl: this.config.queueUrl,
          Entries: entries,
        })
      );
    }

    await this.metrics.putMetric('JobsCompleted', receiptHandles.length, 'Count');
  }

  /**
   * Send a job to the dead letter queue
   */
  async sendToDLQ(job: ScrapeJob, error: string): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.config.dlqUrl,
        MessageBody: JSON.stringify({
          ...job,
          error,
          failedAt: new Date().toISOString(),
        }),
        MessageAttributes: {
          JobType: {
            DataType: 'String',
            StringValue: job.jobType,
          },
          ErrorType: {
            DataType: 'String',
            StringValue: 'processing_failed',
          },
        },
      })
    );

    await this.metrics.putMetric('DLQMessages', 1, 'Count');
  }

  /**
   * Check if a job should be retried
   */
  shouldRetry(job: ScrapeJob): boolean {
    return (job.retryCount || 0) < this.config.maxRetries;
  }

  /**
   * Requeue a job for retry
   */
  async requeueForRetry(job: ScrapeJob): Promise<string> {
    const retryJob = {
      ...job,
      retryCount: (job.retryCount || 0) + 1,
    };

    // Exponential backoff delay
    const delaySeconds = Math.min(
      Math.pow(2, retryJob.retryCount) * 60,
      900 // Max 15 minutes
    );

    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.config.queueUrl,
        MessageBody: JSON.stringify(retryJob),
        DelaySeconds: delaySeconds,
        MessageAttributes: {
          JobType: {
            DataType: 'String',
            StringValue: job.jobType,
          },
          RetryCount: {
            DataType: 'Number',
            StringValue: String(retryJob.retryCount),
          },
        },
      })
    );

    await this.metrics.putMetric('JobsRetried', 1, 'Count');

    return job.jobId;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    approximateMessageCount: number;
    approximateNotVisibleCount: number;
    dlqMessageCount: number;
  }> {
    const [mainAttrs, dlqAttrs] = await Promise.all([
      this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.config.queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
        })
      ),
      this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.config.dlqUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        })
      ),
    ]);

    return {
      approximateMessageCount: parseInt(
        mainAttrs.Attributes?.ApproximateNumberOfMessages || '0',
        10
      ),
      approximateNotVisibleCount: parseInt(
        mainAttrs.Attributes?.ApproximateNumberOfMessagesNotVisible || '0',
        10
      ),
      dlqMessageCount: parseInt(dlqAttrs.Attributes?.ApproximateNumberOfMessages || '0', 10),
    };
  }

  /**
   * Queue all One Piece sets for scraping
   */
  async queueAllSets(): Promise<string[]> {
    const sets = [
      'OP01', 'OP02', 'OP03', 'OP04', 'OP05', 'OP06', 'OP07', 'OP08',
      'OP09', 'OP10', 'OP11', 'OP12', 'OP13',
      'EB01', 'EB02',
      'ST01', 'ST02', 'ST03', 'ST04', 'ST05', 'ST06', 'ST07', 'ST08',
      'ST09', 'ST10', 'ST11', 'ST12', 'ST13', 'ST14', 'ST15', 'ST16',
      'ST17', 'ST18', 'ST19', 'ST20',
    ];

    const jobs = sets.map((setCode) => ({
      jobType: 'set' as const,
      setCode,
      options: {
        maxCardsPerSet: 500,
        includeArticles: false,
      },
      priority: 'normal' as const,
    }));

    return this.sendJobBatch(jobs);
  }

  /**
   * Chunk array into batches
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

/**
 * Create SQS queue instance
 */
export function createSQSQueue(
  config?: Partial<QueueConfig>,
  metrics?: CloudWatchMetrics
): SQSQueue {
  return new SQSQueue(config, metrics);
}
