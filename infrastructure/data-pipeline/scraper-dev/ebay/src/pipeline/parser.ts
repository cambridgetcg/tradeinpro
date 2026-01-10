/**
 * Listing Parser
 *
 * Extracts structured data from eBay listing titles and metadata.
 */

import type {
  SerpApiListing,
  ParsedListing,
  VariantType,
  Rarity,
  Language,
  GradeCompany,
} from './types.js';

/**
 * Parse a SerpApi listing into structured data
 */
export function parseListing(
  listing: SerpApiListing,
  queryName: string
): ParsedListing {
  const title = listing.title || '';

  // Extract eBay item ID from link
  const ebayItemId = extractEbayItemId(listing.link) || listing.product_id;

  // Parse card identification
  const cardInfo = extractCardId(title);

  // Parse variant and rarity
  const variantType = detectVariantType(title);
  const rarity = detectRarity(title);

  // Parse language
  const language = detectLanguage(title);

  // Parse grading
  const grading = extractGrading(title);

  // Generate image URLs for different resolutions
  const imageUrls = generateImageUrls(listing.thumbnail);

  return {
    ebayItemId,
    ebayLink: listing.link,

    cardId: cardInfo.cardId,
    setCode: cardInfo.setCode,
    cardNumber: cardInfo.cardNumber,

    variantType,
    rarity,
    language,

    graded: grading.graded,
    gradeCompany: grading.company,
    gradeValue: grading.grade,

    price: listing.price?.extracted || null,
    priceCurrency: extractCurrency(listing.price?.raw),
    priceRaw: listing.price?.raw || null,
    shipping: listing.shipping?.extracted || null,
    shippingCurrency: extractCurrency(listing.shipping?.raw),

    condition: listing.condition || null,

    thumbnailUrl: listing.thumbnail || null,
    imageUrls,

    title,
    soldDate: listing.sold_date || null,
    sellerUsername: listing.seller?.username || null,
    sellerFeedback: listing.seller?.positive_feedback_in_percentage || null,

    collectedAt: new Date().toISOString(),
    queryName,
  };
}

/**
 * Extract currency from price string
 * e.g., "$140.00" -> "USD", "£50.00" -> "GBP", "€30.00" -> "EUR"
 */
function extractCurrency(priceStr: string | undefined): string | null {
  if (!priceStr) return null;

  // Check for currency symbols
  if (priceStr.includes('$')) return 'USD';
  if (priceStr.includes('£')) return 'GBP';
  if (priceStr.includes('€')) return 'EUR';
  if (priceStr.includes('¥')) return 'JPY';
  if (priceStr.includes('A$') || priceStr.includes('AU$')) return 'AUD';
  if (priceStr.includes('C$') || priceStr.includes('CA$')) return 'CAD';

  // Check for currency codes
  if (/\bUSD\b/i.test(priceStr)) return 'USD';
  if (/\bGBP\b/i.test(priceStr)) return 'GBP';
  if (/\bEUR\b/i.test(priceStr)) return 'EUR';
  if (/\bJPY\b/i.test(priceStr)) return 'JPY';
  if (/\bAUD\b/i.test(priceStr)) return 'AUD';
  if (/\bCAD\b/i.test(priceStr)) return 'CAD';

  return null;
}

/**
 * Extract eBay item ID from URL
 */
function extractEbayItemId(link: string): string | null {
  // Pattern: /itm/{item_id}
  const match = link.match(/\/itm\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract card ID from title
 * Returns: { cardId: "OP01-120", setCode: "OP01", cardNumber: "120" }
 */
function extractCardId(title: string): {
  cardId: string | null;
  setCode: string | null;
  cardNumber: string | null;
} {
  // Match patterns like OP01-120, ST01-001, EB01-050, PRB01-001
  const match = title.match(
    /\b(OP\d{2}|ST\d{2}|EB\d{2}|PRB\d{2})-(\d{3})\b/i
  );

  if (match) {
    const setCode = match[1].toUpperCase();
    const cardNumber = match[2];
    return {
      cardId: `${setCode}-${cardNumber}`,
      setCode,
      cardNumber,
    };
  }

  return { cardId: null, setCode: null, cardNumber: null };
}

/**
 * Detect variant type from title
 */
function detectVariantType(title: string): VariantType | null {
  const titleLower = title.toLowerCase();

  // Order matters - check more specific patterns first

  // Manga variants (highest value)
  if (/manga/i.test(title)) {
    return 'manga';
  }

  // Wanted poster (SP variant)
  if (/wanted\s*poster/i.test(title)) {
    return 'wantedposter';
  }

  // Box topper
  if (/box\s*topper/i.test(title)) {
    return 'boxtopper';
  }

  // SP Special Art (check before generic parallel)
  if (/\bSP\b/.test(title) || /special\s*(art|rare)/i.test(title)) {
    return 'sp';
  }

  // Treasure Rare
  if (/\bTR\b/i.test(title) || /treasure\s*rare/i.test(title)) {
    return 'tr';
  }

  // SEC Parallel (alt art SEC)
  if (
    (/\bSEC\b/i.test(title) || /secret\s*rare/i.test(title)) &&
    (/parallel/i.test(title) || /alt\s*art/i.test(title) || /alternate/i.test(title))
  ) {
    return 'sec_parallel';
  }

  // SR Parallel
  if (
    /\bSR\b/.test(title) &&
    (/parallel/i.test(title) || /alt\s*art/i.test(title))
  ) {
    return 'sr_parallel';
  }

  // Base SEC
  if (/\bSEC\b/i.test(title) || /secret\s*rare/i.test(title)) {
    return 'sec';
  }

  // Generic parallel/alt art
  if (/parallel/i.test(title) || /alt\s*art/i.test(title) || /alternate\s*art/i.test(title)) {
    return 'parallel';
  }

  // Promo
  if (/\bpromo\b/i.test(title)) {
    return 'promo';
  }

  return 'standard';
}

/**
 * Detect rarity from title
 */
function detectRarity(title: string): Rarity | null {
  // Check in order of specificity
  if (/\bSEC\b/i.test(title) || /secret\s*rare/i.test(title)) return 'SEC';
  if (/\bTR\b/i.test(title) || /treasure\s*rare/i.test(title)) return 'TR';
  if (/\bSP\b/.test(title) || /special\s*rare/i.test(title)) return 'SP';
  if (/\bSR\b/.test(title) || /super\s*rare/i.test(title)) return 'SR';
  if (/\bR\b/.test(title) && /rare/i.test(title)) return 'R';
  if (/\bUC\b/i.test(title) || /uncommon/i.test(title)) return 'UC';
  if (/\bC\b/.test(title) && /common/i.test(title)) return 'C';
  if (/\bL\b/.test(title) || /leader/i.test(title)) return 'L';

  return null;
}

/**
 * Detect language from title
 */
function detectLanguage(title: string): Language {
  // English indicators
  if (/\benglish\b/i.test(title) || /\bEN\b/.test(title)) {
    return 'EN';
  }

  // Japanese indicators
  if (
    /\bjapanese\b/i.test(title) ||
    /\bJP\b/i.test(title) ||
    /\bJPN\b/i.test(title) ||
    /日本語/.test(title)
  ) {
    return 'JP';
  }

  return 'UNKNOWN';
}

/**
 * Extract grading information from title
 */
function extractGrading(title: string): {
  graded: boolean;
  company: GradeCompany | null;
  grade: number | null;
} {
  // Match patterns like "PSA 10", "CGC 9.5", "BGS 10"
  const match = title.match(/\b(PSA|CGC|BGS)\s*(\d+\.?\d?)\b/i);

  if (match) {
    return {
      graded: true,
      company: match[1].toUpperCase() as GradeCompany,
      grade: parseFloat(match[2]),
    };
  }

  // Check for graded without specific grade
  if (/\b(PSA|CGC|BGS|graded|slab)\b/i.test(title)) {
    const companyMatch = title.match(/\b(PSA|CGC|BGS)\b/i);
    return {
      graded: true,
      company: companyMatch ? (companyMatch[1].toUpperCase() as GradeCompany) : null,
      grade: null,
    };
  }

  return { graded: false, company: null, grade: null };
}

/**
 * Generate image URLs for different resolutions
 */
function generateImageUrls(thumbnailUrl: string | undefined): Record<number, string> {
  const urls: Record<number, string> = {};

  if (!thumbnailUrl) return urls;

  // eBay image URL pattern: https://i.ebayimg.com/images/g/{id}/s-l{size}.jpg
  // We can replace the size to get different resolutions

  const resolutions = [140, 300, 500, 1600];

  for (const res of resolutions) {
    // Replace any existing size pattern with the desired resolution
    const resizedUrl = thumbnailUrl.replace(/s-l\d+/, `s-l${res}`);
    urls[res] = resizedUrl;
  }

  return urls;
}

/**
 * Calculate confidence score for card ID extraction
 */
export function calculateCardIdConfidence(listing: ParsedListing): number {
  let confidence = 0;

  // Has card ID
  if (listing.cardId) confidence += 40;

  // Has variant type
  if (listing.variantType && listing.variantType !== 'standard') confidence += 20;

  // Has rarity
  if (listing.rarity) confidence += 15;

  // Has language
  if (listing.language !== 'UNKNOWN') confidence += 10;

  // Has price
  if (listing.price) confidence += 10;

  // Title contains "one piece" or "tcg"
  const titleLower = listing.title.toLowerCase();
  if (titleLower.includes('one piece') || titleLower.includes('tcg')) {
    confidence += 5;
  }

  return Math.min(confidence, 100);
}

/**
 * Normalize condition string
 */
export function normalizeCondition(condition: string | null): string | null {
  if (!condition) return null;

  const condLower = condition.toLowerCase();

  if (condLower.includes('near mint') || condLower.includes('nm')) return 'NM';
  if (condLower.includes('lightly played') || condLower.includes('lp')) return 'LP';
  if (condLower.includes('moderately played') || condLower.includes('mp')) return 'MP';
  if (condLower.includes('heavily played') || condLower.includes('hp')) return 'HP';
  if (condLower.includes('damaged') || condLower.includes('dmg')) return 'DMG';
  if (condLower.includes('mint')) return 'M';
  if (condLower.includes('new')) return 'NM';
  if (condLower.includes('pre-owned')) return 'LP';  // Conservative estimate

  return condition;
}

export default { parseListing, calculateCardIdConfidence, normalizeCondition };
