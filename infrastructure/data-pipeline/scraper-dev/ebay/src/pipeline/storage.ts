/**
 * S3 Storage Manager
 *
 * Handles all S3 operations for the image collection pipeline.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, stat, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { Readable } from 'stream';

import type { PipelineConfig } from './config.js';
import { S3_PATHS } from './config.js';
import type {
  ParsedListing,
  ImageMetadata,
  CollectionManifest,
  CollectionStats,
  DailyStats,
} from './types.js';

export class StorageManager {
  private s3: S3Client;
  private config: PipelineConfig;
  private manifest: CollectionManifest | null = null;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.s3 = new S3Client({ region: config.s3Region });
  }

  // ============================================================================
  // Image Operations
  // ============================================================================

  /**
   * Upload an image to S3
   */
  async uploadImage(
    imageBuffer: Buffer,
    listing: ParsedListing,
    resolution: number
  ): Promise<ImageMetadata> {
    const cardIdPath = listing.cardId || 'unknown';
    const s3Key = S3_PATHS.images.raw(
      this.config.s3Prefix,
      resolution,
      cardIdPath,
      listing.ebayItemId
    );

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: s3Key,
        Body: imageBuffer,
        ContentType: 'image/jpeg',
        Metadata: {
          'ebay-item-id': listing.ebayItemId,
          'card-id': listing.cardId || '',
          'variant-type': listing.variantType || '',
          'language': listing.language,
          'graded': String(listing.graded),
          'price': String(listing.price || ''),
          'price-currency': listing.priceCurrency || '',
          'collected-at': listing.collectedAt,
        },
      })
    );

    return {
      ebayItemId: listing.ebayItemId,
      cardId: listing.cardId,
      resolution,
      s3Key,
      sizeBytes: imageBuffer.length,
      contentType: 'image/jpeg',
      downloadedAt: new Date().toISOString(),
      labels: {
        cardId: listing.cardId,
        variantType: listing.variantType,
        rarity: listing.rarity,
        language: listing.language,
        graded: listing.graded,
        gradeCompany: listing.gradeCompany,
        gradeValue: listing.gradeValue,
        condition: listing.condition,
        price: listing.price,
        priceCurrency: listing.priceCurrency,
      },
    };
  }

  /**
   * Check if an image already exists in S3
   */
  async imageExists(
    cardId: string | null,
    ebayItemId: string,
    resolution: number
  ): Promise<boolean> {
    const cardIdPath = cardId || 'unknown';
    const s3Key = S3_PATHS.images.raw(
      this.config.s3Prefix,
      resolution,
      cardIdPath,
      ebayItemId
    );

    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.config.s3Bucket,
          Key: s3Key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Metadata Operations
  // ============================================================================

  /**
   * Save listings metadata as JSONL
   */
  async saveListingsMetadata(
    listings: ParsedListing[],
    queryName: string
  ): Promise<string> {
    const date = new Date().toISOString().split('T')[0];
    const s3Key = S3_PATHS.metadata.listings(
      this.config.s3Prefix,
      date,
      queryName
    );

    const jsonl = listings.map((l) => JSON.stringify(l)).join('\n');

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: s3Key,
        Body: jsonl,
        ContentType: 'application/jsonl',
      })
    );

    return s3Key;
  }

  /**
   * Load or create manifest
   */
  async loadManifest(): Promise<CollectionManifest> {
    if (this.manifest) return this.manifest;

    const s3Key = S3_PATHS.metadata.manifest(this.config.s3Prefix);

    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.config.s3Bucket,
          Key: s3Key,
        })
      );

      const body = await streamToString(response.Body as Readable);
      this.manifest = JSON.parse(body);
      return this.manifest!;
    } catch {
      // Create new manifest
      this.manifest = {
        version: '1.0.0',
        created: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        stats: {
          totalListings: 0,
          totalImages: 0,
          totalSizeBytes: 0,
          byQuery: {},
          byCardId: {},
          byVariantType: {},
          byLanguage: {},
          byGraded: { graded: 0, raw: 0 },
          lastUpdated: new Date().toISOString(),
          dateRange: { earliest: '', latest: '' },
        },
        images: [],
        processedItemIds: [],
      };
      return this.manifest;
    }
  }

  /**
   * Save manifest
   */
  async saveManifest(): Promise<void> {
    if (!this.manifest) return;

    this.manifest.lastUpdated = new Date().toISOString();
    const s3Key = S3_PATHS.metadata.manifest(this.config.s3Prefix);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: s3Key,
        Body: JSON.stringify(this.manifest, null, 2),
        ContentType: 'application/json',
      })
    );
  }

  /**
   * Update manifest with new data
   */
  async updateManifest(
    listings: ParsedListing[],
    imageMetadata: ImageMetadata[],
    queryName: string
  ): Promise<void> {
    const manifest = await this.loadManifest();

    // Update stats
    manifest.stats.totalListings += listings.length;
    manifest.stats.totalImages += imageMetadata.length;
    manifest.stats.totalSizeBytes += imageMetadata.reduce(
      (sum, m) => sum + m.sizeBytes,
      0
    );

    // Update by query
    if (!manifest.stats.byQuery[queryName]) {
      manifest.stats.byQuery[queryName] = { listings: 0, images: 0 };
    }
    manifest.stats.byQuery[queryName].listings += listings.length;
    manifest.stats.byQuery[queryName].images += imageMetadata.length;

    // Update by card ID
    for (const listing of listings) {
      if (listing.cardId) {
        if (!manifest.stats.byCardId[listing.cardId]) {
          manifest.stats.byCardId[listing.cardId] = { count: 0, avgPrice: 0 };
        }
        const cardStats = manifest.stats.byCardId[listing.cardId];
        const oldTotal = cardStats.count * cardStats.avgPrice;
        cardStats.count += 1;
        if (listing.price) {
          cardStats.avgPrice = (oldTotal + listing.price) / cardStats.count;
        }
      }
    }

    // Update by variant type
    for (const listing of listings) {
      const vt = listing.variantType || 'unknown';
      manifest.stats.byVariantType[vt] =
        (manifest.stats.byVariantType[vt] || 0) + 1;
    }

    // Update by language
    for (const listing of listings) {
      manifest.stats.byLanguage[listing.language] =
        (manifest.stats.byLanguage[listing.language] || 0) + 1;
    }

    // Update graded stats
    for (const listing of listings) {
      if (listing.graded) {
        manifest.stats.byGraded.graded += 1;
      } else {
        manifest.stats.byGraded.raw += 1;
      }
    }

    // Update date range
    const dates = listings
      .map((l) => l.soldDate)
      .filter((d): d is string => !!d);
    if (dates.length > 0) {
      dates.sort();
      if (
        !manifest.stats.dateRange.earliest ||
        dates[0] < manifest.stats.dateRange.earliest
      ) {
        manifest.stats.dateRange.earliest = dates[0];
      }
      if (
        !manifest.stats.dateRange.latest ||
        dates[dates.length - 1] > manifest.stats.dateRange.latest
      ) {
        manifest.stats.dateRange.latest = dates[dates.length - 1];
      }
    }

    // Add images to index
    for (const meta of imageMetadata) {
      manifest.images.push({
        s3Key: meta.s3Key,
        cardId: meta.cardId,
        variantType: meta.labels.variantType,
        resolution: meta.resolution,
      });
    }

    // Add processed item IDs
    for (const listing of listings) {
      if (!manifest.processedItemIds.includes(listing.ebayItemId)) {
        manifest.processedItemIds.push(listing.ebayItemId);
      }
    }

    manifest.stats.lastUpdated = new Date().toISOString();
    await this.saveManifest();
  }

  /**
   * Check if item has been processed
   */
  async isProcessed(ebayItemId: string): Promise<boolean> {
    const manifest = await this.loadManifest();
    return manifest.processedItemIds.includes(ebayItemId);
  }

  /**
   * Get processed item IDs for deduplication
   */
  async getProcessedItemIds(): Promise<Set<string>> {
    const manifest = await this.loadManifest();
    return new Set(manifest.processedItemIds);
  }

  // ============================================================================
  // Stats Operations
  // ============================================================================

  /**
   * Save daily stats
   */
  async saveDailyStats(stats: DailyStats): Promise<void> {
    const s3Key = S3_PATHS.stats.daily(this.config.s3Prefix, stats.date);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: s3Key,
        Body: JSON.stringify(stats, null, 2),
        ContentType: 'application/json',
      })
    );
  }

  /**
   * Get collection stats
   */
  async getStats(): Promise<CollectionStats> {
    const manifest = await this.loadManifest();
    return manifest.stats;
  }

  // ============================================================================
  // Training Labels
  // ============================================================================

  /**
   * Generate and save training labels
   */
  async generateTrainingLabels(): Promise<void> {
    const manifest = await this.loadManifest();

    // Card identification labels
    const cardIdLabels = manifest.images
      .filter((img) => img.cardId)
      .map((img) => ({
        imageS3Key: img.s3Key,
        cardId: img.cardId!,
        setCode: img.cardId!.split('-')[0],
        cardNumber: img.cardId!.split('-')[1],
        confidence: 0.9, // High confidence since we have card ID
      }));

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: S3_PATHS.metadata.labels(this.config.s3Prefix, 'card_identification'),
        Body: JSON.stringify(cardIdLabels, null, 2),
        ContentType: 'application/json',
      })
    );

    // Variant detection labels
    const variantLabels = manifest.images
      .filter((img) => img.variantType)
      .map((img) => ({
        imageS3Key: img.s3Key,
        variantType: img.variantType!,
        confidence: 0.85,
      }));

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: S3_PATHS.metadata.labels(this.config.s3Prefix, 'variant_detection'),
        Body: JSON.stringify(variantLabels, null, 2),
        ContentType: 'application/json',
      })
    );
  }

  // ============================================================================
  // Local Cache
  // ============================================================================

  /**
   * Save image to local cache
   */
  async saveToLocalCache(
    imageBuffer: Buffer,
    listing: ParsedListing,
    resolution: number
  ): Promise<string> {
    const cardIdPath = listing.cardId || 'unknown';
    const localPath = join(
      this.config.localCachePath,
      'images',
      String(resolution),
      cardIdPath,
      `${listing.ebayItemId}.jpg`
    );

    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, imageBuffer);

    return localPath;
  }

  /**
   * Check if image exists in local cache
   */
  async existsInLocalCache(
    listing: ParsedListing,
    resolution: number
  ): Promise<boolean> {
    const cardIdPath = listing.cardId || 'unknown';
    const localPath = join(
      this.config.localCachePath,
      'images',
      String(resolution),
      cardIdPath,
      `${listing.ebayItemId}.jpg`
    );

    try {
      await stat(localPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Helper: Convert readable stream to string
 */
async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export default StorageManager;
