/**
 * Pipeline Type Definitions
 */

// ============================================================================
// SerpApi Response Types
// ============================================================================

export interface SerpApiListing {
  title: string;
  link: string;
  product_id: string;
  condition?: string;
  price?: {
    raw: string;
    extracted: number;
  };
  shipping?: {
    raw: string;
    extracted: number;
  };
  thumbnail?: string;
  seller?: {
    username: string;
    reviews: number;
    positive_feedback_in_percentage: number;
  };
  sold_date?: string;
  location?: string;
}

export interface SerpApiResponse {
  search_metadata?: {
    status: string;
    total_time_taken: number;
  };
  search_information?: {
    total_results: number;
  };
  organic_results?: SerpApiListing[];
  error?: string;
}

// ============================================================================
// Parsed Listing Data
// ============================================================================

export interface ParsedListing {
  // eBay identifiers
  ebayItemId: string;
  ebayLink: string;

  // Card identification
  cardId: string | null;      // e.g., "OP01-120"
  setCode: string | null;     // e.g., "OP01"
  cardNumber: string | null;  // e.g., "120"

  // Classification
  variantType: VariantType | null;
  rarity: Rarity | null;
  language: Language;

  // Grading
  graded: boolean;
  gradeCompany: GradeCompany | null;
  gradeValue: number | null;

  // Pricing
  price: number | null;           // Extracted numeric value
  priceCurrency: string | null;   // USD, GBP, EUR, etc.
  priceRaw: string | null;        // Original string e.g. "$140.00"
  shipping: number | null;
  shippingCurrency: string | null;

  // Condition (for raw cards)
  condition: string | null;

  // Image
  thumbnailUrl: string | null;
  imageUrls: Record<number, string>;  // resolution -> URL

  // Metadata
  title: string;
  soldDate: string | null;
  sellerUsername: string | null;
  sellerFeedback: number | null;

  // Collection metadata
  collectedAt: string;
  queryName: string;
}

export type VariantType =
  | 'parallel'
  | 'sp'
  | 'manga'
  | 'tr'
  | 'sec'
  | 'sec_parallel'
  | 'sr_parallel'
  | 'wantedposter'
  | 'boxtopper'
  | 'promo'
  | 'standard';

export type Rarity =
  | 'C'      // Common
  | 'UC'    // Uncommon
  | 'R'     // Rare
  | 'SR'    // Super Rare
  | 'SEC'   // Secret Rare
  | 'L'     // Leader
  | 'SP'    // Special
  | 'TR';   // Treasure Rare

export type Language = 'EN' | 'JP' | 'UNKNOWN';

export type GradeCompany = 'PSA' | 'CGC' | 'BGS';

// ============================================================================
// Image Collection Types
// ============================================================================

export interface ImageDownloadResult {
  success: boolean;
  ebayItemId: string;
  cardId: string | null;
  resolution: number;
  localPath?: string;
  s3Key?: string;
  sizeBytes?: number;
  error?: string;
}

export interface ImageMetadata {
  ebayItemId: string;
  cardId: string | null;
  resolution: number;
  s3Key: string;
  sizeBytes: number;
  contentType: string;
  downloadedAt: string;

  // Labels for ML training
  labels: {
    cardId: string | null;
    variantType: VariantType | null;
    rarity: Rarity | null;
    language: Language;
    graded: boolean;
    gradeCompany: GradeCompany | null;
    gradeValue: number | null;
    condition: string | null;
    price: number | null;
    priceCurrency: string | null;
  };
}

// ============================================================================
// Collection Stats
// ============================================================================

export interface CollectionStats {
  totalListings: number;
  totalImages: number;
  totalSizeBytes: number;

  byQuery: Record<string, {
    listings: number;
    images: number;
  }>;

  byCardId: Record<string, {
    count: number;
    avgPrice: number;
  }>;

  byVariantType: Record<string, number>;
  byLanguage: Record<string, number>;
  byGraded: {
    graded: number;
    raw: number;
  };

  lastUpdated: string;
  dateRange: {
    earliest: string;
    latest: string;
  };
}

export interface DailyStats {
  date: string;
  queriesRun: number;
  listingsCollected: number;
  imagesDownloaded: number;
  bytesDownloaded: number;
  errors: number;
  duration: number;
}

// ============================================================================
// Training Labels
// ============================================================================

export interface CardIdentificationLabel {
  imageS3Key: string;
  cardId: string;
  setCode: string;
  cardNumber: string;
  confidence: number;  // Based on title parsing quality
}

export interface ConditionGradingLabel {
  imageS3Key: string;
  condition: string;       // NM, LP, MP, HP, DMG
  graded: boolean;
  gradeCompany?: string;
  gradeValue?: number;
  confidence: number;
}

export interface VariantDetectionLabel {
  imageS3Key: string;
  variantType: VariantType;
  rarity: Rarity | null;
  language: Language;
  confidence: number;
}

// ============================================================================
// Pipeline State
// ============================================================================

export interface PipelineState {
  lastRun: string | null;
  totalRuns: number;
  processedItemIds: Set<string>;  // For deduplication
  errors: Array<{
    timestamp: string;
    type: string;
    message: string;
    context?: unknown;
  }>;
}

export interface CollectionManifest {
  version: string;
  created: string;
  lastUpdated: string;

  stats: CollectionStats;

  // Index of all collected images
  images: Array<{
    s3Key: string;
    cardId: string | null;
    variantType: VariantType | null;
    resolution: number;
  }>;

  // Processed item IDs for deduplication
  processedItemIds: string[];
}
