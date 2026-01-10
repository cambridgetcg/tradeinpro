/**
 * S3 Storage Client
 *
 * Handles storage of raw API responses, transformed data,
 * and exports for ML training.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
  type PutObjectCommandInput,
  type GetObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import type { GameCode } from '../config/games.js';
import type { TransformedCard } from '../pipeline/transformer.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * S3 storage configuration
 */
export interface S3StorageConfig {
  bucket: string;
  region: string;
  prefix: string;
  compressionEnabled: boolean;
  partitionByDate: boolean;
  partitionByGame: boolean;
  expirationDays: number;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Storage paths
 */
export interface StoragePaths {
  raw: string;        // Raw API responses
  transformed: string; // Transformed data
  exports: string;    // ML training exports
  snapshots: string;  // Price snapshots
  logs: string;       // Pipeline logs
}

/**
 * Stored object metadata
 */
export interface StoredObjectMeta {
  key: string;
  size: number;
  lastModified: Date;
  contentType: string;
  compressed: boolean;
  game?: GameCode;
  source?: string;
}

const DEFAULT_CONFIG: S3StorageConfig = {
  bucket: process.env.S3_BUCKET || 'tcgplayer-price-data',
  region: process.env.AWS_REGION || 'us-east-1',
  prefix: 'tcgplayer',
  compressionEnabled: true,
  partitionByDate: true,
  partitionByGame: true,
  expirationDays: 90,
};

const DEFAULT_PATHS: StoragePaths = {
  raw: 'raw',
  transformed: 'transformed',
  exports: 'exports',
  snapshots: 'snapshots',
  logs: 'logs',
};

/**
 * S3 Storage Client
 */
export class S3Storage {
  private client: S3Client;
  private config: S3StorageConfig;
  private paths: StoragePaths;

  constructor(config?: Partial<S3StorageConfig>, paths?: Partial<StoragePaths>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.paths = { ...DEFAULT_PATHS, ...paths };

    const clientConfig: {
      region: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = {
      region: this.config.region,
    };

    // Use explicit credentials if provided, otherwise use default credential chain
    if (this.config.accessKeyId && this.config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  /**
   * Build S3 key with partitioning
   */
  private buildKey(
    path: string,
    filename: string,
    options?: {
      game?: GameCode;
      date?: Date;
      source?: string;
    }
  ): string {
    const parts = [this.config.prefix, path];

    if (this.config.partitionByDate) {
      const date = options?.date || new Date();
      parts.push(
        `year=${date.getUTCFullYear()}`,
        `month=${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
        `day=${String(date.getUTCDate()).padStart(2, '0')}`
      );
    }

    if (this.config.partitionByGame && options?.game) {
      parts.push(`game=${options.game}`);
    }

    if (options?.source) {
      parts.push(`source=${options.source}`);
    }

    parts.push(filename);
    return parts.join('/');
  }

  /**
   * Store raw API response
   */
  async storeRawResponse(
    data: unknown,
    game: GameCode,
    source: string,
    options?: {
      setCode?: string;
      timestamp?: Date;
    }
  ): Promise<string> {
    const timestamp = options?.timestamp || new Date();
    const filename = options?.setCode
      ? `${source}-${options.setCode}-${timestamp.getTime()}.json`
      : `${source}-${timestamp.getTime()}.json`;

    const key = this.buildKey(this.paths.raw, filename, {
      game,
      date: timestamp,
      source,
    });

    await this.putJson(key, data);
    return key;
  }

  /**
   * Store transformed cards
   */
  async storeTransformedCards(
    cards: TransformedCard[],
    game: GameCode,
    options?: {
      timestamp?: Date;
      source?: string;
      format?: 'json' | 'jsonl' | 'csv';
    }
  ): Promise<string> {
    const timestamp = options?.timestamp || new Date();
    const format = options?.format || 'json';
    const filename = `cards-${timestamp.getTime()}.${format}`;

    const key = this.buildKey(this.paths.transformed, filename, {
      game,
      date: timestamp,
      source: options?.source,
    });

    switch (format) {
      case 'jsonl':
        const jsonl = cards.map((c) => JSON.stringify(c)).join('\n');
        await this.putText(key, jsonl, 'application/x-ndjson');
        break;
      case 'csv':
        const csv = this.cardsToCsv(cards);
        await this.putText(key, csv, 'text/csv');
        break;
      default:
        await this.putJson(key, cards);
    }

    return key;
  }

  /**
   * Store price snapshot for ML training
   */
  async storePriceSnapshot(
    cards: TransformedCard[],
    options?: {
      timestamp?: Date;
      format?: 'json' | 'parquet' | 'csv';
    }
  ): Promise<string> {
    const timestamp = options?.timestamp || new Date();
    const format = options?.format || 'json';

    // Extract just pricing data for snapshots
    const snapshot = cards.map((c) => ({
      cardId: c.cardId,
      game: c.game,
      name: c.name,
      setCode: c.setCode,
      priceUsd: c.priceUsd,
      priceGbp: c.priceGbp,
      tradeinPriceGbp: c.tradeinPriceGbp,
      timestamp: timestamp.toISOString(),
    }));

    const dateStr = timestamp.toISOString().split('T')[0];
    const filename = `snapshot-${dateStr}.${format}`;

    const key = this.buildKey(this.paths.snapshots, filename, {
      date: timestamp,
    });

    if (format === 'csv') {
      const csv = this.objectsToCsv(snapshot);
      await this.putText(key, csv, 'text/csv');
    } else {
      await this.putJson(key, snapshot);
    }

    return key;
  }

  /**
   * Store ML export
   */
  async storeMLExport(
    data: unknown[],
    name: string,
    options?: {
      format?: 'json' | 'jsonl' | 'csv';
      timestamp?: Date;
    }
  ): Promise<string> {
    const timestamp = options?.timestamp || new Date();
    const format = options?.format || 'jsonl';
    const filename = `${name}-${timestamp.getTime()}.${format}`;

    const key = this.buildKey(this.paths.exports, filename, {
      date: timestamp,
    });

    switch (format) {
      case 'jsonl':
        const jsonl = data.map((d) => JSON.stringify(d)).join('\n');
        await this.putText(key, jsonl, 'application/x-ndjson');
        break;
      case 'csv':
        const csv = this.objectsToCsv(data as Record<string, unknown>[]);
        await this.putText(key, csv, 'text/csv');
        break;
      default:
        await this.putJson(key, data);
    }

    return key;
  }

  /**
   * Store pipeline log
   */
  async storePipelineLog(
    log: unknown,
    pipelineId: string,
    options?: {
      timestamp?: Date;
    }
  ): Promise<string> {
    const timestamp = options?.timestamp || new Date();
    const filename = `pipeline-${pipelineId}-${timestamp.getTime()}.json`;

    const key = this.buildKey(this.paths.logs, filename, {
      date: timestamp,
    });

    await this.putJson(key, log);
    return key;
  }

  /**
   * Get raw response
   */
  async getRawResponse<T = unknown>(key: string): Promise<T | null> {
    return this.getJson<T>(key);
  }

  /**
   * Get transformed cards
   */
  async getTransformedCards(key: string): Promise<TransformedCard[] | null> {
    if (key.endsWith('.jsonl')) {
      const text = await this.getText(key);
      if (!text) return null;
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    }
    return this.getJson<TransformedCard[]>(key);
  }

  /**
   * List objects by prefix
   */
  async listObjects(
    path: string,
    options?: {
      game?: GameCode;
      date?: Date;
      maxKeys?: number;
    }
  ): Promise<StoredObjectMeta[]> {
    const prefix = this.buildKey(path, '', {
      game: options?.game,
      date: options?.date,
    });

    const command = new ListObjectsV2Command({
      Bucket: this.config.bucket,
      Prefix: prefix,
      MaxKeys: options?.maxKeys || 1000,
    });

    const response = await this.client.send(command);
    const objects: StoredObjectMeta[] = [];

    for (const obj of response.Contents || []) {
      if (obj.Key && obj.Size !== undefined && obj.LastModified) {
        objects.push({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified,
          contentType: this.guessContentType(obj.Key),
          compressed: obj.Key.endsWith('.gz'),
        });
      }
    }

    return objects;
  }

  /**
   * Get latest file from path
   */
  async getLatestFile(
    path: string,
    options?: {
      game?: GameCode;
    }
  ): Promise<StoredObjectMeta | null> {
    const objects = await this.listObjects(path, {
      game: options?.game,
    });

    if (objects.length === 0) return null;

    // Sort by last modified (newest first)
    objects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    return objects[0];
  }

  /**
   * Delete object
   */
  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  /**
   * Check if object exists
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get presigned URL for download
   */
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Put JSON data
   */
  private async putJson(key: string, data: unknown): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    let body: Buffer | string = json;
    let contentType = 'application/json';

    if (this.config.compressionEnabled) {
      body = await gzipAsync(json);
      key = `${key}.gz`;
      contentType = 'application/gzip';
    }

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await this.client.send(command);
  }

  /**
   * Put text data
   */
  private async putText(key: string, text: string, contentType: string): Promise<void> {
    let body: Buffer | string = text;

    if (this.config.compressionEnabled) {
      body = await gzipAsync(text);
      key = `${key}.gz`;
      contentType = 'application/gzip';
    }

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await this.client.send(command);
  }

  /**
   * Get JSON data
   */
  private async getJson<T = unknown>(key: string): Promise<T | null> {
    const text = await this.getText(key);
    if (!text) return null;
    return JSON.parse(text) as T;
  }

  /**
   * Get text data
   */
  private async getText(key: string): Promise<string | null> {
    try {
      // Try with .gz extension first if compression is enabled
      const actualKey = this.config.compressionEnabled && !key.endsWith('.gz')
        ? `${key}.gz`
        : key;

      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: actualKey,
      });

      const response = await this.client.send(command);
      const body = await response.Body?.transformToByteArray();

      if (!body) return null;

      // Decompress if needed
      if (actualKey.endsWith('.gz')) {
        const decompressed = await gunzipAsync(Buffer.from(body));
        return decompressed.toString('utf-8');
      }

      return Buffer.from(body).toString('utf-8');
    } catch (error: unknown) {
      const awsError = error as { name?: string };
      if (awsError?.name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Convert cards to CSV
   */
  private cardsToCsv(cards: TransformedCard[]): string {
    const headers = [
      'cardId', 'game', 'name', 'releaseSet', 'fullCardNumber',
      'setCode', 'cardNumber', 'variantType', 'isVariant',
      'priceUsd', 'lowPriceUsd', 'midPriceUsd', 'highPriceUsd',
      'priceGbp', 'tradeinPriceGbp', 'rarity', 'imageUrl',
      'qualityScore', 'priceConfidence', 'primarySource', 'lastUpdated',
    ];

    const rows = cards.map((card) =>
      headers.map((h) => {
        const value = card[h as keyof TransformedCard];
        if (value === null || value === undefined) return '';
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return String(value);
      }).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Convert objects to CSV
   */
  private objectsToCsv(objects: Record<string, unknown>[]): string {
    if (objects.length === 0) return '';

    const headers = Object.keys(objects[0]);
    const rows = objects.map((obj) =>
      headers.map((h) => {
        const value = obj[h];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return String(value);
      }).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Guess content type from key
   */
  private guessContentType(key: string): string {
    if (key.endsWith('.gz')) return 'application/gzip';
    if (key.endsWith('.json')) return 'application/json';
    if (key.endsWith('.jsonl')) return 'application/x-ndjson';
    if (key.endsWith('.csv')) return 'text/csv';
    if (key.endsWith('.parquet')) return 'application/octet-stream';
    return 'application/octet-stream';
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    paths: Record<string, { count: number; totalSize: number }>;
  }> {
    const stats: Record<string, { count: number; totalSize: number }> = {};

    for (const [name, path] of Object.entries(this.paths)) {
      const objects = await this.listObjects(path);
      stats[name] = {
        count: objects.length,
        totalSize: objects.reduce((sum, o) => sum + o.size, 0),
      };
    }

    return { paths: stats };
  }
}

/**
 * Create S3 storage instance
 */
export function createS3Storage(
  config?: Partial<S3StorageConfig>,
  paths?: Partial<StoragePaths>
): S3Storage {
  return new S3Storage(config, paths);
}
