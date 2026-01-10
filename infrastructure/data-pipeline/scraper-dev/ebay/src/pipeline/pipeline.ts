/**
 * Image Collection Pipeline
 *
 * Main orchestrator for collecting eBay listing images for ML training.
 */

import type { PipelineConfig } from './config.js';
import { DEFAULT_CONFIG, COLLECTION_QUERIES } from './config.js';
import type {
  ParsedListing,
  ImageMetadata,
  DailyStats,
  CollectionStats,
} from './types.js';
import { Collector } from './collector.js';
import { StorageManager } from './storage.js';

export interface PipelineOptions {
  // Which queries to run (by name or priority)
  queries?: string[];
  priority?: number;

  // Pagination
  maxPagesPerQuery?: number;

  // Image settings
  resolutions?: number[];

  // Filtering
  requireCardId?: boolean;
  skipProcessed?: boolean;

  // Dry run (no uploads)
  dryRun?: boolean;

  // Verbose logging
  verbose?: boolean;
}

export interface PipelineResult {
  success: boolean;
  stats: DailyStats;
  errors: Array<{ query: string; error: string }>;
}

export class ImageCollectionPipeline {
  private config: PipelineConfig;
  private collector: Collector;
  private storage: StorageManager;

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.collector = new Collector(this.config);
    this.storage = new StorageManager(this.config);
  }

  /**
   * Run the collection pipeline
   */
  async run(options: PipelineOptions = {}): Promise<PipelineResult> {
    const startTime = Date.now();
    const date = new Date().toISOString().split('T')[0];

    const stats: DailyStats = {
      date,
      queriesRun: 0,
      listingsCollected: 0,
      imagesDownloaded: 0,
      bytesDownloaded: 0,
      errors: 0,
      duration: 0,
    };

    const errors: Array<{ query: string; error: string }> = [];

    // Determine which queries to run
    const queriesToRun = this.selectQueries(options);

    if (options.verbose) {
      console.log(`\n📊 Running ${queriesToRun.length} queries`);
      console.log(`   Resolutions: ${options.resolutions || this.config.imageResolutions}`);
      console.log(`   Dry run: ${options.dryRun || false}`);
    }

    // Get processed IDs for deduplication
    const processedIds = options.skipProcessed !== false
      ? await this.storage.getProcessedItemIds()
      : new Set<string>();

    if (options.verbose) {
      console.log(`   Already processed: ${processedIds.size} items`);
    }

    // Process each query
    for (const queryConfig of queriesToRun) {
      if (options.verbose) {
        console.log(`\n🔍 Query: ${queryConfig.name}`);
        console.log(`   "${queryConfig.query}"`);
      }

      try {
        const result = await this.processQuery(
          queryConfig.name,
          queryConfig.query,
          processedIds,
          options
        );

        stats.queriesRun++;
        stats.listingsCollected += result.listingsCollected;
        stats.imagesDownloaded += result.imagesDownloaded;
        stats.bytesDownloaded += result.bytesDownloaded;

        // Update processed IDs
        for (const id of result.processedIds) {
          processedIds.add(id);
        }

        if (options.verbose) {
          console.log(`   ✅ Collected ${result.listingsCollected} listings, ${result.imagesDownloaded} images`);
        }
      } catch (error) {
        stats.errors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ query: queryConfig.name, error: errorMsg });

        if (options.verbose) {
          console.log(`   ❌ Error: ${errorMsg}`);
        }
      }

      // Delay between queries
      await this.delay(this.config.serpApiDelayMs);
    }

    stats.duration = Date.now() - startTime;

    // Save daily stats
    if (!options.dryRun) {
      await this.storage.saveDailyStats(stats);
    }

    if (options.verbose) {
      console.log(`\n${'═'.repeat(60)}`);
      console.log('PIPELINE COMPLETE');
      console.log(`${'═'.repeat(60)}`);
      console.log(`   Queries: ${stats.queriesRun}`);
      console.log(`   Listings: ${stats.listingsCollected}`);
      console.log(`   Images: ${stats.imagesDownloaded}`);
      console.log(`   Size: ${(stats.bytesDownloaded / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Errors: ${stats.errors}`);
      console.log(`   Duration: ${(stats.duration / 1000).toFixed(1)}s`);
    }

    return {
      success: stats.errors === 0,
      stats,
      errors,
    };
  }

  /**
   * Process a single query
   */
  private async processQuery(
    queryName: string,
    query: string,
    processedIds: Set<string>,
    options: PipelineOptions
  ): Promise<{
    listingsCollected: number;
    imagesDownloaded: number;
    bytesDownloaded: number;
    processedIds: string[];
  }> {
    const resolutions = options.resolutions || this.config.imageResolutions;
    const maxPages = options.maxPagesPerQuery || 5;

    // Fetch listings
    let listings = await this.collector.fetchAllPages(query, queryName, maxPages);

    // Filter
    listings = this.collector.filterWithImages(listings);

    if (options.requireCardId !== false) {
      listings = this.collector.filterWithCardIds(listings);
    }

    if (options.skipProcessed !== false) {
      listings = this.collector.filterNewListings(listings, processedIds);
    }

    if (listings.length === 0) {
      return {
        listingsCollected: 0,
        imagesDownloaded: 0,
        bytesDownloaded: 0,
        processedIds: [],
      };
    }

    // Download images
    const imageBuffers = await this.collector.downloadBatch(
      listings,
      resolutions,
      options.verbose
        ? (completed, total) => {
            process.stdout.write(`\r   Downloading: ${completed}/${total}`);
          }
        : undefined
    );

    if (options.verbose) {
      console.log(); // New line after progress
    }

    // Upload to S3
    let totalBytes = 0;
    let totalImages = 0;
    const allImageMetadata: ImageMetadata[] = [];

    if (!options.dryRun) {
      for (const listing of listings) {
        const images = imageBuffers.get(listing.ebayItemId);
        if (!images) continue;

        for (const [resolution, buffer] of images) {
          const metadata = await this.storage.uploadImage(
            buffer,
            listing,
            resolution
          );
          allImageMetadata.push(metadata);
          totalBytes += buffer.length;
          totalImages++;
        }
      }

      // Save metadata and update manifest
      await this.storage.saveListingsMetadata(listings, queryName);
      await this.storage.updateManifest(listings, allImageMetadata, queryName);
    } else {
      // Dry run - just count
      for (const [, images] of imageBuffers) {
        for (const [, buffer] of images) {
          totalBytes += buffer.length;
          totalImages++;
        }
      }
    }

    return {
      listingsCollected: listings.length,
      imagesDownloaded: totalImages,
      bytesDownloaded: totalBytes,
      processedIds: listings.map((l) => l.ebayItemId),
    };
  }

  /**
   * Select queries to run based on options
   */
  private selectQueries(
    options: PipelineOptions
  ): Array<{ name: string; query: string; priority: number }> {
    let queries = [...COLLECTION_QUERIES];

    // Filter by name
    if (options.queries && options.queries.length > 0) {
      queries = queries.filter((q) => options.queries!.includes(q.name));
    }

    // Filter by priority
    if (options.priority !== undefined) {
      queries = queries.filter((q) => q.priority <= options.priority!);
    }

    // Sort by priority
    queries.sort((a, b) => a.priority - b.priority);

    return queries;
  }

  /**
   * Get collection statistics
   */
  async getStats(): Promise<CollectionStats> {
    return this.storage.getStats();
  }

  /**
   * Generate training labels from collected data
   */
  async generateLabels(): Promise<void> {
    await this.storage.generateTrainingLabels();
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default ImageCollectionPipeline;
