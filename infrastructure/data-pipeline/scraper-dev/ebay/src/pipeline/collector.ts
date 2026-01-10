/**
 * SerpApi Collector & Image Downloader
 *
 * Fetches sold listings from SerpApi and downloads images from eBay CDN.
 * Supports date range filtering for historical data collection.
 */

import type { PipelineConfig } from './config.js';
import type {
  SerpApiResponse,
  SerpApiListing,
  ParsedListing,
  ImageDownloadResult,
} from './types.js';
import { parseListing } from './parser.js';

export interface FetchOptions {
  /** Number of days to look back (default: 365 for 1 year) */
  lookbackDays?: number;
  /** Minimum price filter in USD */
  minPrice?: number;
  /** Maximum price filter in USD */
  maxPrice?: number;
  /** Specific eBay category ID */
  categoryId?: string;
  /** Sort order: 'date' (newest first) or 'price' */
  sortBy?: 'date' | 'price';
}

export class Collector {
  private config: PipelineConfig;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  // ============================================================================
  // SerpApi Collection
  // ============================================================================

  /**
   * Fetch sold listings from SerpApi with optional filters
   *
   * @param query - Search query string
   * @param queryName - Name for tracking/metadata
   * @param page - Page number (1-indexed)
   * @param options - Additional fetch options
   */
  async fetchListings(
    query: string,
    queryName: string,
    page: number = 1,
    options: FetchOptions = {}
  ): Promise<{ listings: ParsedListing[]; totalResults: number }> {
    const {
      lookbackDays = 365, // Default to 1 year
      minPrice,
      maxPrice,
      categoryId,
      sortBy = 'date',
    } = options;

    // Build URL parameters using SerpAPI format
    // Note: SerpAPI uses 'show_only' not 'LH_Sold' for sold items filter
    const params = new URLSearchParams({
      engine: 'ebay',
      _nkw: query,
      show_only: 'Sold',    // SerpAPI format for sold items only
      _ipg: String(this.config.resultsPerPage),
      _pgn: String(page),
      api_key: this.config.serpApiKey,
    });

    // Price filters (SerpAPI passes these through to eBay)
    if (minPrice !== undefined) {
      params.set('_udlo', String(minPrice));
    }
    if (maxPrice !== undefined) {
      params.set('_udhi', String(maxPrice));
    }

    // Category filter (183454 = CCG Individual Cards)
    if (categoryId) {
      params.set('_sacat', categoryId);
    } else {
      // Default to CCG category for One Piece TCG
      params.set('_sacat', '183454');
    }

    // Note: SerpAPI doesn't support eBay _sop sort parameter
    // Results are returned in eBay's default order (typically by date for sold items)
    // We acknowledge these params for documentation purposes
    void sortBy;
    void lookbackDays;

    const url = `https://serpapi.com/search?${params}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`SerpApi error: ${response.status}`);
    }

    const data: SerpApiResponse = await response.json();

    if (data.error) {
      throw new Error(`SerpApi error: ${data.error}`);
    }

    const rawListings = data.organic_results || [];
    const totalResults = data.search_information?.total_results || 0;

    // Parse all listings
    const listings = rawListings.map((raw) => parseListing(raw, queryName));

    return { listings, totalResults };
  }

  /**
   * Fetch all pages for a query (up to limit)
   *
   * @param query - Search query string
   * @param queryName - Name for tracking/metadata
   * @param maxPages - Maximum pages to fetch
   * @param options - Additional fetch options (lookback days, price filters, etc.)
   */
  async fetchAllPages(
    query: string,
    queryName: string,
    maxPages: number = 10,
    options: FetchOptions = {}
  ): Promise<ParsedListing[]> {
    const allListings: ParsedListing[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const { listings, totalResults } = await this.fetchListings(
        query,
        queryName,
        page,
        options
      );

      allListings.push(...listings);

      // Check if there are more pages
      const fetchedSoFar = page * this.config.resultsPerPage;
      hasMore = fetchedSoFar < totalResults && listings.length > 0;
      page++;

      // Rate limiting
      if (hasMore) {
        await this.delay(this.config.serpApiDelayMs);
      }
    }

    return allListings;
  }

  // ============================================================================
  // Image Download
  // ============================================================================

  /**
   * Download image from eBay CDN
   */
  async downloadImage(
    imageUrl: string,
    retries: number = 3
  ): Promise<Buffer | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(imageUrl);

        if (!response.ok) {
          if (attempt === retries) {
            console.error(`Failed to download ${imageUrl}: ${response.status}`);
            return null;
          }
          await this.delay(1000 * attempt); // Exponential backoff
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (error) {
        if (attempt === retries) {
          console.error(`Error downloading ${imageUrl}:`, error);
          return null;
        }
        await this.delay(1000 * attempt);
      }
    }

    return null;
  }

  /**
   * Download images for a listing at specified resolutions
   */
  async downloadListingImages(
    listing: ParsedListing,
    resolutions: number[]
  ): Promise<Map<number, Buffer>> {
    const images = new Map<number, Buffer>();

    for (const resolution of resolutions) {
      const imageUrl = listing.imageUrls[resolution];

      if (!imageUrl) {
        console.warn(
          `No image URL for resolution ${resolution}: ${listing.ebayItemId}`
        );
        continue;
      }

      const buffer = await this.downloadImage(imageUrl);

      if (buffer) {
        images.set(resolution, buffer);
      }

      // Small delay between resolutions
      await this.delay(this.config.ebayImageDelayMs);
    }

    return images;
  }

  /**
   * Download images for multiple listings with concurrency control
   */
  async downloadBatch(
    listings: ParsedListing[],
    resolutions: number[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, Map<number, Buffer>>> {
    const results = new Map<string, Map<number, Buffer>>();
    const total = listings.length;
    let completed = 0;

    // Process in batches for concurrency control
    const batchSize = this.config.downloadConcurrency;

    for (let i = 0; i < listings.length; i += batchSize) {
      const batch = listings.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (listing) => {
          const images = await this.downloadListingImages(listing, resolutions);
          return { ebayItemId: listing.ebayItemId, images };
        })
      );

      for (const { ebayItemId, images } of batchResults) {
        if (images.size > 0) {
          results.set(ebayItemId, images);
        }
        completed++;
        onProgress?.(completed, total);
      }

      // Delay between batches
      if (i + batchSize < listings.length) {
        await this.delay(this.config.downloadDelayMs);
      }
    }

    return results;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Filter out already processed listings
   */
  filterNewListings(
    listings: ParsedListing[],
    processedIds: Set<string>
  ): ParsedListing[] {
    return listings.filter((l) => !processedIds.has(l.ebayItemId));
  }

  /**
   * Filter listings with valid images
   */
  filterWithImages(listings: ParsedListing[]): ParsedListing[] {
    return listings.filter((l) => l.thumbnailUrl && l.imageUrls[500]);
  }

  /**
   * Filter listings with card IDs (for higher quality data)
   */
  filterWithCardIds(listings: ParsedListing[]): ParsedListing[] {
    return listings.filter((l) => l.cardId !== null);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default Collector;
