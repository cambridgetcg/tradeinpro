/**
 * Unit tests for SQS Queue Integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock AWS SDK
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  SendMessageCommand: vi.fn().mockImplementation((params) => params),
  SendMessageBatchCommand: vi.fn().mockImplementation((params) => params),
  ReceiveMessageCommand: vi.fn().mockImplementation((params) => params),
  DeleteMessageCommand: vi.fn().mockImplementation((params) => params),
  DeleteMessageBatchCommand: vi.fn().mockImplementation((params) => params),
  GetQueueAttributesCommand: vi.fn().mockImplementation((params) => params),
}));

// Mock CloudWatch metrics
vi.mock('../../src/monitoring/cloudwatch.js', () => ({
  CloudWatchMetrics: vi.fn().mockImplementation(() => ({
    putMetric: vi.fn().mockResolvedValue(undefined),
  })),
}));

const { SQSQueue, createSQSQueue } = await import(
  '../../src/pipeline/sqs-queue.js'
);

describe('SQSQueue', () => {
  let queue: InstanceType<typeof SQSQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    queue = createSQSQueue({
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
      dlqUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/test-dlq',
      region: 'us-east-1',
      maxRetries: 3,
      visibilityTimeout: 900,
      batchSize: 10,
    });
  });

  describe('sendJob', () => {
    it('should send a job to the queue', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-123' });

      const jobId = await queue.sendJob({
        jobType: 'set',
        setCode: 'OP01',
      });

      expect(jobId).toMatch(/^job_\d+_[a-z0-9]+$/);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should set delay for low priority jobs', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-123' });

      await queue.sendJob({
        jobType: 'set',
        setCode: 'OP01',
        priority: 'low',
      });

      const sendParams = mockSend.mock.calls[0][0];
      expect(sendParams.DelaySeconds).toBe(60);
    });

    it('should include message attributes', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-123' });

      await queue.sendJob({
        jobType: 'card',
        cardUrl: 'https://cardmarket.com/card/OP01-001',
        priority: 'high',
      });

      const sendParams = mockSend.mock.calls[0][0];
      expect(sendParams.MessageAttributes.JobType.StringValue).toBe('card');
      expect(sendParams.MessageAttributes.Priority.StringValue).toBe('high');
    });
  });

  describe('sendJobBatch', () => {
    it('should send multiple jobs in batch', async () => {
      mockSend.mockResolvedValue({});

      const jobs = [
        { jobType: 'set' as const, setCode: 'OP01' },
        { jobType: 'set' as const, setCode: 'OP02' },
        { jobType: 'set' as const, setCode: 'OP03' },
      ];

      const jobIds = await queue.sendJobBatch(jobs);

      expect(jobIds.length).toBe(3);
      expect(mockSend).toHaveBeenCalledTimes(1); // Single batch call
    });

    it('should split into multiple batches when needed', async () => {
      mockSend.mockResolvedValue({});

      // Create 15 jobs (batch size is 10)
      const jobs = Array.from({ length: 15 }, (_, i) => ({
        jobType: 'set' as const,
        setCode: `OP${String(i + 1).padStart(2, '0')}`,
      }));

      const jobIds = await queue.sendJobBatch(jobs);

      expect(jobIds.length).toBe(15);
      expect(mockSend).toHaveBeenCalledTimes(2); // Two batch calls
    });
  });

  describe('receiveJobs', () => {
    it('should receive jobs from the queue', async () => {
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            Body: JSON.stringify({
              jobId: 'job_123',
              jobType: 'set',
              setCode: 'OP01',
              createdAt: new Date().toISOString(),
            }),
            ReceiptHandle: 'receipt-123',
          },
        ],
      });

      const jobs = await queue.receiveJobs(1);

      expect(jobs.length).toBe(1);
      expect(jobs[0].job.jobType).toBe('set');
      expect(jobs[0].job.setCode).toBe('OP01');
      expect(jobs[0].receiptHandle).toBe('receipt-123');
    });

    it('should return empty array when no messages', async () => {
      mockSend.mockResolvedValueOnce({ Messages: undefined });

      const jobs = await queue.receiveJobs(1);

      expect(jobs).toEqual([]);
    });

    it('should use long polling', async () => {
      mockSend.mockResolvedValueOnce({ Messages: [] });

      await queue.receiveJobs(1);

      const receiveParams = mockSend.mock.calls[0][0];
      expect(receiveParams.WaitTimeSeconds).toBe(20);
    });
  });

  describe('deleteJob', () => {
    it('should delete a processed job', async () => {
      mockSend.mockResolvedValueOnce({});

      await queue.deleteJob('receipt-123');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const deleteParams = mockSend.mock.calls[0][0];
      expect(deleteParams.ReceiptHandle).toBe('receipt-123');
    });
  });

  describe('sendToDLQ', () => {
    it('should send failed job to DLQ', async () => {
      mockSend.mockResolvedValueOnce({});

      const job = {
        jobId: 'job_123',
        jobType: 'set' as const,
        setCode: 'OP01',
        createdAt: new Date().toISOString(),
      };

      await queue.sendToDLQ(job, 'Processing failed');

      const sendParams = mockSend.mock.calls[0][0];
      expect(sendParams.QueueUrl).toContain('dlq');

      const body = JSON.parse(sendParams.MessageBody);
      expect(body.error).toBe('Processing failed');
      expect(body.failedAt).toBeDefined();
    });
  });

  describe('retry logic', () => {
    it('should determine if job can be retried', () => {
      const job1 = { jobId: 'job_1', jobType: 'set' as const, retryCount: 0, createdAt: '' };
      const job2 = { jobId: 'job_2', jobType: 'set' as const, retryCount: 2, createdAt: '' };
      const job3 = { jobId: 'job_3', jobType: 'set' as const, retryCount: 3, createdAt: '' };

      expect(queue.shouldRetry(job1)).toBe(true);
      expect(queue.shouldRetry(job2)).toBe(true);
      expect(queue.shouldRetry(job3)).toBe(false);
    });

    it('should requeue job with incremented retry count', async () => {
      mockSend.mockResolvedValueOnce({});

      const job = {
        jobId: 'job_123',
        jobType: 'set' as const,
        setCode: 'OP01',
        retryCount: 1,
        createdAt: new Date().toISOString(),
      };

      await queue.requeueForRetry(job);

      const sendParams = mockSend.mock.calls[0][0];
      const body = JSON.parse(sendParams.MessageBody);
      expect(body.retryCount).toBe(2);
      expect(sendParams.DelaySeconds).toBeGreaterThan(0);
    });

    it('should use exponential backoff for retries', async () => {
      mockSend.mockResolvedValue({});

      const baseJob = {
        jobId: 'job_123',
        jobType: 'set' as const,
        createdAt: new Date().toISOString(),
      };

      // Retry 1: 2^1 * 60 = 120s
      await queue.requeueForRetry({ ...baseJob, retryCount: 0 });
      const delay1 = mockSend.mock.calls[0][0].DelaySeconds;

      // Retry 2: 2^2 * 60 = 240s
      mockSend.mockClear();
      await queue.requeueForRetry({ ...baseJob, retryCount: 1 });
      const delay2 = mockSend.mock.calls[0][0].DelaySeconds;

      // Retry 3: 2^3 * 60 = 480s
      mockSend.mockClear();
      await queue.requeueForRetry({ ...baseJob, retryCount: 2 });
      const delay3 = mockSend.mock.calls[0][0].DelaySeconds;

      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      mockSend
        .mockResolvedValueOnce({
          Attributes: {
            ApproximateNumberOfMessages: '5',
            ApproximateNumberOfMessagesNotVisible: '2',
          },
        })
        .mockResolvedValueOnce({
          Attributes: {
            ApproximateNumberOfMessages: '1',
          },
        });

      const stats = await queue.getQueueStats();

      expect(stats.approximateMessageCount).toBe(5);
      expect(stats.approximateNotVisibleCount).toBe(2);
      expect(stats.dlqMessageCount).toBe(1);
    });
  });

  describe('queueAllSets', () => {
    it('should queue all One Piece sets', async () => {
      mockSend.mockResolvedValue({});

      const jobIds = await queue.queueAllSets();

      // Should include OP01-13, EB01-02, ST01-20
      expect(jobIds.length).toBeGreaterThan(30);
    });
  });
});
