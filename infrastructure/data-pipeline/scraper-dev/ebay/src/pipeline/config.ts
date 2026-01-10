/**
 * Pipeline Configuration
 *
 * Centralized configuration for the image collection pipeline.
 */

export interface PipelineConfig {
  // SerpApi
  serpApiKey: string;
  searchesPerRun: number;
  resultsPerPage: number;

  // AWS S3
  s3Bucket: string;
  s3Region: string;
  s3Prefix: string;

  // Image settings
  imageResolutions: number[];  // e.g., [500, 1600]
  downloadConcurrency: number;
  downloadRetries: number;
  downloadDelayMs: number;

  // Rate limiting
  serpApiDelayMs: number;
  ebayImageDelayMs: number;

  // Storage paths
  localCachePath: string;
}

export const DEFAULT_CONFIG: PipelineConfig = {
  // SerpApi
  serpApiKey: process.env.SERPAPI_API_KEY || '',
  searchesPerRun: 100,
  resultsPerPage: 200, // SerpAPI returns up to 240 per search with _ipg=200

  // AWS S3
  s3Bucket: process.env.S3_BUCKET || 'tcg-training-data',
  s3Region: process.env.AWS_REGION || 'us-east-1',
  s3Prefix: 'onepiece-tcg',

  // Image settings
  imageResolutions: [500, 1600],  // 500px for card ID, 1600px for condition
  downloadConcurrency: 5,
  downloadRetries: 3,
  downloadDelayMs: 100,

  // Rate limiting
  serpApiDelayMs: 1500,  // Respect rate limits
  ebayImageDelayMs: 50,   // eBay CDN is fast

  // Local cache
  localCachePath: './cache',
};

/**
 * Configuration for 1-year comprehensive collection
 * Uses 1000 SerpAPI searches across alt art / rare cards
 */
export const ONE_YEAR_CONFIG: PipelineConfig = {
  ...DEFAULT_CONFIG,
  searchesPerRun: 1000,
  s3Prefix: 'onepiece-tcg-1year',
  serpApiDelayMs: 2000, // More conservative for long runs
  localCachePath: './cache/1year',
};

/**
 * S3 Bucket Structure
 *
 * s3://{bucket}/{prefix}/
 * ├── images/
 * │   ├── raw/                          # Original eBay images
 * │   │   ├── {resolution}/             # e.g., 500, 1600
 * │   │   │   ├── {card_id}/            # e.g., OP01-120
 * │   │   │   │   ├── {ebay_item_id}.jpg
 * │   ├── processed/                    # Normalized for training
 * │   │   ├── 224x224/                  # CNN input size
 * │   │   ├── 512x512/                  # Higher res models
 * ├── metadata/
 * │   ├── listings/                     # Raw listing data
 * │   │   ├── {date}/
 * │   │   │   ├── {query_name}.jsonl
 * │   ├── manifest.json                 # Master index
 * │   ├── labels/                       # Training labels
 * │   │   ├── card_identification.json
 * │   │   ├── condition_grading.json
 * │   │   ├── variant_detection.json
 * ├── stats/
 * │   ├── collection_stats.json
 * │   ├── daily/
 * │   │   ├── {date}.json
 */
export const S3_PATHS = {
  images: {
    raw: (prefix: string, resolution: number, cardId: string, itemId: string) =>
      `${prefix}/images/raw/${resolution}/${cardId}/${itemId}.jpg`,
    processed: (prefix: string, size: string, cardId: string, itemId: string) =>
      `${prefix}/images/processed/${size}/${cardId}/${itemId}.jpg`,
  },
  metadata: {
    listings: (prefix: string, date: string, queryName: string) =>
      `${prefix}/metadata/listings/${date}/${queryName}.jsonl`,
    manifest: (prefix: string) =>
      `${prefix}/metadata/manifest.json`,
    labels: (prefix: string, labelType: string) =>
      `${prefix}/metadata/labels/${labelType}.json`,
  },
  stats: {
    collection: (prefix: string) =>
      `${prefix}/stats/collection_stats.json`,
    daily: (prefix: string, date: string) =>
      `${prefix}/stats/daily/${date}.json`,
  },
};

/**
 * Optimized queries for image collection
 * (Based on query strategy research)
 */
export const COLLECTION_QUERIES = [
  // High-volume, high-precision queries
  {
    name: 'sec_parallel_en',
    query: '"one piece" SEC parallel english -lot -bundle -bulk -japanese',
    priority: 1,
    expectedVolume: 150,
  },
  {
    name: 'sec_en',
    query: 'one piece tcg SEC secret rare english -lot -bundle -japanese',
    priority: 1,
    expectedVolume: 1500,
  },
  {
    name: 'parallel_en',
    query: '"one piece" parallel english alt art -lot -bundle -japanese',
    priority: 1,
    expectedVolume: 900,
  },

  // Premium variants (high value, important for training)
  {
    name: 'manga_en',
    query: 'one piece tcg manga art english -lot -bundle -japanese',
    priority: 2,
    expectedVolume: 100,
  },
  {
    name: 'manga_jp',
    query: 'one piece tcg manga art japanese -lot -bundle',
    priority: 2,
    expectedVolume: 50,
  },
  {
    name: 'treasure_rare',
    query: 'one piece tcg TR treasure rare -lot -bundle',
    priority: 2,
    expectedVolume: 200,
  },
  {
    name: 'sp_special',
    query: 'one piece tcg SP special art -lot -bundle',
    priority: 2,
    expectedVolume: 200,
  },

  // Graded cards (separate category for condition training)
  {
    name: 'psa_10',
    query: 'one piece tcg PSA 10 -lot -bundle',
    priority: 3,
    expectedVolume: 300,
  },
  {
    name: 'psa_9',
    query: 'one piece tcg PSA 9 -lot -bundle',
    priority: 3,
    expectedVolume: 200,
  },
  {
    name: 'cgc_graded',
    query: 'one piece tcg CGC -lot -bundle',
    priority: 3,
    expectedVolume: 100,
  },

  // Japanese market (different image styles)
  {
    name: 'sec_jp',
    query: 'one piece tcg japanese SEC -english -lot -bundle',
    priority: 4,
    expectedVolume: 250,
  },
  {
    name: 'parallel_jp',
    query: '"one piece" parallel japanese -english -lot -bundle',
    priority: 4,
    expectedVolume: 350,
  },

  // Set-specific for coverage
  {
    name: 'op01_variants',
    query: '"OP01-" one piece parallel OR SEC english -lot -bundle',
    priority: 5,
    expectedVolume: 500,
  },
  {
    name: 'op05_variants',
    query: '"OP05-" one piece parallel OR SEC english -lot -bundle',
    priority: 5,
    expectedVolume: 400,
  },
];

export default DEFAULT_CONFIG;
