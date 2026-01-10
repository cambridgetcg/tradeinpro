/**
 * AWS S3 Storage Integration
 *
 * Stores scraped data in S3 with:
 * - Partitioned storage by date/set
 * - Compression support
 * - Atomic writes with versioning
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { ScrapedCard, ScrapedArticle } from '../scrapers/cardmarket-scraper.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface S3StorageConfig {
  bucket: string;
  region: string;
  prefix: string;
  compression: boolean;
  partitionByDate: boolean;
  partitionBySet: boolean;
}

export interface StoredDataset {
  metadata: {
    scrapeId: string;
    scrapedAt: string;
    setCode: string;
    cardCount: number;
    articleCount: number;
    version: string;
  };
  cards: ScrapedCard[];
  articles: ScrapedArticle[];
}

const DEFAULT_CONFIG: S3StorageConfig = {
  bucket: process.env.S3_BUCKET || 'cardmarket-scraper-data',
  region: process.env.AWS_REGION || 'us-east-1',
  prefix: 'scrapes',
  compression: true,
  partitionByDate: true,
  partitionBySet: true,
};

/**
 * S3 storage manager
 */
export class S3Storage {
  private client: S3Client;
  private config: S3StorageConfig;

  constructor(config?: Partial<S3StorageConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = new S3Client({ region: this.config.region });
  }

  /**
   * Generate S3 key for a dataset
   */
  private generateKey(setCode: string, scrapeId: string): string {
    const parts = [this.config.prefix];

    if (this.config.partitionByDate) {
      const date = new Date();
      parts.push(
        `year=${date.getUTCFullYear()}`,
        `month=${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
        `day=${String(date.getUTCDate()).padStart(2, '0')}`
      );
    }

    if (this.config.partitionBySet) {
      parts.push(`set=${setCode}`);
    }

    const extension = this.config.compression ? 'json.gz' : 'json';
    parts.push(`${scrapeId}.${extension}`);

    return parts.join('/');
  }

  /**
   * Store a scraped dataset
   */
  async store(
    setCode: string,
    cards: ScrapedCard[],
    articles: ScrapedArticle[],
    scrapeId?: string
  ): Promise<{ key: string; size: number }> {
    const id = scrapeId || `scrape_${Date.now()}`;

    const dataset: StoredDataset = {
      metadata: {
        scrapeId: id,
        scrapedAt: new Date().toISOString(),
        setCode,
        cardCount: cards.length,
        articleCount: articles.length,
        version: '1.0',
      },
      cards,
      articles,
    };

    const jsonData = JSON.stringify(dataset, null, 2);
    let body: Buffer | string = jsonData;
    let contentType = 'application/json';
    let contentEncoding: string | undefined;

    if (this.config.compression) {
      body = await gzipAsync(jsonData);
      contentEncoding = 'gzip';
    }

    const key = this.generateKey(setCode, id);

    const params: PutObjectCommandInput = {
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentEncoding: contentEncoding,
      Metadata: {
        'scrape-id': id,
        'set-code': setCode,
        'card-count': String(cards.length),
        'article-count': String(articles.length),
      },
    };

    await this.client.send(new PutObjectCommand(params));

    const size = typeof body === 'string' ? Buffer.byteLength(body) : body.length;

    return { key, size };
  }

  /**
   * Retrieve a stored dataset
   */
  async retrieve(key: string): Promise<StoredDataset | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        })
      );

      if (!response.Body) {
        return null;
      }

      let data = await response.Body.transformToByteArray();

      // Decompress if needed
      if (response.ContentEncoding === 'gzip' || key.endsWith('.gz')) {
        data = await gunzipAsync(Buffer.from(data));
      }

      const jsonStr = Buffer.from(data).toString('utf-8');
      return JSON.parse(jsonStr) as StoredDataset;
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all stored datasets for a set
   */
  async listBySet(
    setCode: string,
    options?: { maxResults?: number; startDate?: Date; endDate?: Date }
  ): Promise<Array<{ key: string; lastModified: Date; size: number }>> {
    const prefix = this.config.partitionBySet
      ? `${this.config.prefix}/set=${setCode}/`
      : `${this.config.prefix}/`;

    const results: Array<{ key: string; lastModified: Date; size: number }> = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          MaxKeys: options?.maxResults || 1000,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of response.Contents || []) {
        if (!obj.Key || !obj.LastModified || !obj.Size) continue;

        // Filter by date if specified
        if (options?.startDate && obj.LastModified < options.startDate) continue;
        if (options?.endDate && obj.LastModified > options.endDate) continue;

        results.push({
          key: obj.Key,
          lastModified: obj.LastModified,
          size: obj.Size,
        });
      }

      continuationToken = response.NextContinuationToken;

      if (options?.maxResults && results.length >= options.maxResults) {
        break;
      }
    } while (continuationToken);

    return results;
  }

  /**
   * Get the latest stored dataset for a set
   */
  async getLatest(setCode: string): Promise<StoredDataset | null> {
    const list = await this.listBySet(setCode, { maxResults: 1 });

    if (list.length === 0) {
      return null;
    }

    // Sort by date descending
    list.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    return this.retrieve(list[0].key);
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Store raw HTML for debugging
   */
  async storeRawHtml(
    url: string,
    html: string,
    scrapeId: string
  ): Promise<string> {
    const urlHash = Buffer.from(url).toString('base64url').slice(0, 20);
    const key = `${this.config.prefix}/raw/${scrapeId}/${urlHash}.html`;

    let body: Buffer | string = html;
    let contentEncoding: string | undefined;

    if (this.config.compression) {
      body = await gzipAsync(html);
      contentEncoding = 'gzip';
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: 'text/html',
        ContentEncoding: contentEncoding,
        Metadata: {
          'source-url': url,
          'scrape-id': scrapeId,
        },
      })
    );

    return key;
  }
}

/**
 * Create S3 storage instance
 */
export function createS3Storage(config?: Partial<S3StorageConfig>): S3Storage {
  return new S3Storage(config);
}
