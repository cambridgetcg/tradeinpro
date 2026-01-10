/**
 * S3 Uploader Neuron
 *
 * Motor neuron that uploads raw and processed data to S3 Data Lake.
 * Handles NDJSON formatting, gzip compression, and partitioning.
 *
 * Targets:
 *   - raw/prices/cardmarket/{date}/ - Raw scraped data
 *   - training/{date}/ - ML training datasets
 */

import { BaseNeuron } from '../base-neuron';
import {
  NeuralLayer,
  NeuralSignal,
  NeurotransmitterType,
  NormalizedPriceSignal,
} from '../types';

// =============================================================================
// INTERFACES
// =============================================================================

export interface S3UploaderConfig {
  bucket: string;
  region: string;
  rawPrefix: string;
  trainingPrefix: string;
  enableCompression: boolean;
  dryRun: boolean;
}

export interface UploadRequest {
  type: 'raw' | 'training';
  data: NormalizedPriceSignal[] | TrainingData;
  metadata?: Record<string, string>;
}

export interface TrainingData {
  examples: TrainingExample[];
  split: 'train' | 'validation' | 'test';
  metadata: TrainingMetadata;
}

export interface TrainingExample {
  cardId: string;
  sequence: number[][]; // [30 timesteps][45 features]
  labels: {
    dealType: number;    // One-hot encoded
    confidence: number;
    expectedReturn: number;
    riskLevel: number;
  };
}

export interface TrainingMetadata {
  sequenceLength: number;
  featureCount: number;
  exampleCount: number;
  generatedAt: Date;
  dateRange: { start: string; end: string };
}

export interface UploadResult {
  bucket: string;
  key: string;
  size: number;
  records: number;
  compressed: boolean;
  timestamp: Date;
}

export interface S3Client {
  send: (command: unknown) => Promise<unknown>;
}

// =============================================================================
// S3 UPLOADER NEURON
// =============================================================================

export class S3UploaderNeuron extends BaseNeuron<UploadRequest, UploadResult> {
  private config: S3UploaderConfig;
  private s3Client?: S3Client;

  // Statistics
  private stats: UploaderStats;

  constructor(
    s3Client?: S3Client,
    config: Partial<S3UploaderConfig> = {}
  ) {
    super('S3Uploader', NeuralLayer.MOTOR);

    this.s3Client = s3Client;

    this.config = {
      bucket: process.env.DATA_LAKE_BUCKET || 'tcg-data-lake',
      region: process.env.AWS_REGION || 'us-east-1',
      rawPrefix: 'raw/prices/cardmarket',
      trainingPrefix: 'training',
      enableCompression: true,
      dryRun: false,
      ...config,
    };

    this.stats = {
      uploadsCompleted: 0,
      bytesUploaded: 0,
      recordsUploaded: 0,
      errors: 0,
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected async onInitialize(): Promise<void> {
    console.log(`☁️ [${this.name}] S3 uploader initialized`);
    console.log(`   Bucket: ${this.config.bucket}`);
    console.log(`   Region: ${this.config.region}`);
    console.log(`   Compression: ${this.config.enableCompression ? 'Enabled' : 'Disabled'}`);
    console.log(`   Dry run: ${this.config.dryRun}`);
    console.log(`   S3 client: ${this.s3Client ? 'Connected' : 'Not connected'}`);
  }

  protected async onShutdown(): Promise<void> {
    this.logStats();
  }

  // ===========================================================================
  // SIGNAL PROCESSING
  // ===========================================================================

  async processSignal(signal: NeuralSignal<UploadRequest>): Promise<UploadResult> {
    const request = signal.payload;
    const startTime = Date.now();

    // Determine S3 key based on type
    const key = this.generateS3Key(request);

    // Prepare data
    const { content, recordCount } = this.prepareContent(request);

    // Compress if enabled
    const finalContent = this.config.enableCompression
      ? await this.compress(content)
      : content;

    const result: UploadResult = {
      bucket: this.config.bucket,
      key: this.config.enableCompression ? `${key}.gz` : key,
      size: finalContent.length,
      records: recordCount,
      compressed: this.config.enableCompression,
      timestamp: new Date(),
    };

    if (this.config.dryRun) {
      console.log(`📝 [${this.name}] Dry run - would upload to s3://${result.bucket}/${result.key}`);
      console.log(`   Size: ${this.formatBytes(result.size)}, Records: ${result.records}`);
      return result;
    }

    if (!this.s3Client) {
      console.warn(`⚠️ [${this.name}] No S3 client - data not uploaded`);
      return result;
    }

    try {
      // Upload to S3
      await this.uploadToS3(result.key, finalContent, request.metadata);

      const latency = Date.now() - startTime;
      console.log(
        `✅ [${this.name}] Uploaded s3://${result.bucket}/${result.key} ` +
        `(${this.formatBytes(result.size)}, ${result.records} records, ${latency}ms)`
      );

      // Update stats
      this.stats.uploadsCompleted++;
      this.stats.bytesUploaded += result.size;
      this.stats.recordsUploaded += result.records;
    } catch (error) {
      this.stats.errors++;
      console.error(`❌ [${this.name}] Upload failed:`, error);
      throw error;
    }

    return result;
  }

  // ===========================================================================
  // KEY GENERATION
  // ===========================================================================

  private generateS3Key(request: UploadRequest): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hour = String(now.getUTCHours()).padStart(2, '0');
    const timestamp = now.getTime();

    if (request.type === 'raw') {
      // Partitioned by date: raw/prices/cardmarket/year=2026/month=01/day=09/
      return `${this.config.rawPrefix}/year=${year}/month=${month}/day=${day}/prices_${hour}_${timestamp}.ndjson`;
    } else {
      // Training data: training/2026-01-09/train.json
      const dateStr = `${year}-${month}-${day}`;
      const trainData = request.data as TrainingData;
      return `${this.config.trainingPrefix}/${dateStr}/${trainData.split}.json`;
    }
  }

  // ===========================================================================
  // CONTENT PREPARATION
  // ===========================================================================

  private prepareContent(request: UploadRequest): {
    content: Buffer;
    recordCount: number;
  } {
    if (request.type === 'raw') {
      const prices = request.data as NormalizedPriceSignal[];
      const lines = prices.map((p) => JSON.stringify(this.toRawRecord(p)));
      return {
        content: Buffer.from(lines.join('\n') + '\n'),
        recordCount: prices.length,
      };
    } else {
      const training = request.data as TrainingData;
      const content = JSON.stringify(training, null, 2);
      return {
        content: Buffer.from(content),
        recordCount: training.examples.length,
      };
    }
  }

  private toRawRecord(price: NormalizedPriceSignal): Record<string, unknown> {
    return {
      card_id: price.cardId,
      name: price.name,
      // USD normalized prices (standardized for ML training)
      price_from_usd: price.priceFromUsd,
      price_trend_usd: price.priceTrendUsd,
      price_avg_usd: price.priceAvgUsd,
      best_price_usd: price.bestPriceUsd,
      tradein_price_usd: price.tradeinPriceUsd,
      // Original source data retained for reference
      source_marketplace: price.source.marketplace,
      source_currency: price.source.currency,
      source_price_from: price.source.priceFrom,
      source_price_trend: price.source.priceTrend,
      source_price_avg: price.source.priceAvg,
      // Analysis
      spread_percent: price.spreadPercent,
      spread_absolute: price.spreadAbsolute,
      fx_rate: price.fxRate,
      fx_source: price.fxSource,
      timestamp: price.timestamp.toISOString(),
      ingested_at: new Date().toISOString(),
    };
  }

  // ===========================================================================
  // COMPRESSION
  // ===========================================================================

  private async compress(data: Buffer): Promise<Buffer> {
    const { promisify } = await import('util');
    const zlib = await import('zlib');
    const gzip = promisify(zlib.gzip);
    return gzip(data);
  }

  // ===========================================================================
  // S3 UPLOAD
  // ===========================================================================

  private async uploadToS3(
    key: string,
    content: Buffer,
    metadata?: Record<string, string>
  ): Promise<void> {
    if (!this.s3Client) throw new Error('S3 client not available');

    // Dynamic import to avoid bundling issues
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: content,
      ContentType: key.endsWith('.gz')
        ? 'application/gzip'
        : key.endsWith('.json') || key.endsWith('.ndjson')
        ? 'application/json'
        : 'application/octet-stream',
      ContentEncoding: key.endsWith('.gz') ? 'gzip' : undefined,
      Metadata: {
        'uploaded-by': 'tcg-neural-pipeline',
        'neuron-id': this.id,
        ...metadata,
      },
    });

    await this.s3Client.send(command);
  }

  // ===========================================================================
  // NEUROTRANSMITTER SELECTION
  // ===========================================================================

  protected selectNeurotransmitter(output: UploadResult): NeurotransmitterType {
    // Large upload success
    if (output.records >= 100) {
      return NeurotransmitterType.SEROTONIN; // Confidence
    }

    // Training data upload
    if (output.key.includes('training')) {
      return NeurotransmitterType.ACETYLCHOLINE; // Learning signal
    }

    return NeurotransmitterType.GLUTAMATE;
  }

  protected calculateSignalStrength(output: UploadResult): number {
    // Strength based on data volume
    if (output.records >= 500) return 1.0;
    if (output.records >= 100) return 0.8;
    if (output.records >= 50) return 0.6;
    return 0.4;
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private logStats(): void {
    console.log(`\n📊 [${this.name}] Uploader Statistics:`);
    console.log(`   Uploads completed: ${this.stats.uploadsCompleted}`);
    console.log(`   Bytes uploaded: ${this.formatBytes(this.stats.bytesUploaded)}`);
    console.log(`   Records uploaded: ${this.stats.recordsUploaded}`);
    console.log(`   Errors: ${this.stats.errors}`);
  }

  getStats(): UploaderStats {
    return { ...this.stats };
  }

  /**
   * Set S3 client (for dependency injection)
   */
  setS3Client(client: S3Client): void {
    this.s3Client = client;
  }

  /**
   * Quick upload method for convenience
   */
  async uploadPrices(prices: NormalizedPriceSignal[]): Promise<UploadResult> {
    const signal: NeuralSignal<UploadRequest> = {
      id: `upload-${Date.now()}`,
      sourceNeuron: 'external',
      timestamp: new Date(),
      signalType: 'excitatory',
      strength: 1.0,
      payload: {
        type: 'raw',
        data: prices,
      },
      neurotransmitter: NeurotransmitterType.GLUTAMATE,
    };

    return this.processSignal(signal);
  }

  /**
   * Upload training data
   */
  async uploadTrainingData(data: TrainingData): Promise<UploadResult> {
    const signal: NeuralSignal<UploadRequest> = {
      id: `training-${Date.now()}`,
      sourceNeuron: 'external',
      timestamp: new Date(),
      signalType: 'excitatory',
      strength: 1.0,
      payload: {
        type: 'training',
        data,
      },
      neurotransmitter: NeurotransmitterType.ACETYLCHOLINE,
    };

    return this.processSignal(signal);
  }
}

// =============================================================================
// SUPPORTING TYPES
// =============================================================================

interface UploaderStats {
  uploadsCompleted: number;
  bytesUploaded: number;
  recordsUploaded: number;
  errors: number;
}
