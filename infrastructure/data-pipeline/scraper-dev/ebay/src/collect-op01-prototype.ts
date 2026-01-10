#!/usr/bin/env npx tsx
/**
 * OP01 Alt Art Prototype Collection
 *
 * Targeted collection of OP01 alt art cards for ML training prototype.
 * Based on CardPriceV2 trade-in inventory.
 *
 * Run with: npx tsx src/collect-op01-prototype.ts
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

// ============================================================================
// OP01 TARGET CARDS (from CardPriceV2)
// ============================================================================

interface TargetCard {
  cardId: string;
  name: string;
  variantType: string;
  priceGbp: number;
  priority: number;  // 1 = highest value, collect more images
}

// Top OP01 alt art cards for trade-in, ordered by value
const OP01_TARGET_CARDS: TargetCard[] = [
  // Ultra High Value (£200+) - Priority 1
  { cardId: 'OP01-120', name: 'Shanks', variantType: 'manga', priceGbp: 1024, priority: 1 },
  { cardId: 'OP01-078', name: 'Boa Hancock', variantType: 'sp', priceGbp: 496, priority: 1 },
  { cardId: 'OP01-016', name: 'Nami', variantType: 'sp', priceGbp: 282, priority: 1 },
  { cardId: 'OP01-016', name: 'Nami', variantType: 'parallel', priceGbp: 282, priority: 1 },
  { cardId: 'OP01-003', name: 'Monkey D. Luffy', variantType: 'parallel', priceGbp: 264, priority: 1 },
  { cardId: 'OP01-001', name: 'Roronoa Zoro', variantType: 'parallel', priceGbp: 201, priority: 1 },

  // High Value (£100-200) - Priority 2
  { cardId: 'OP01-121', name: 'Yamato', variantType: 'sp', priceGbp: 154, priority: 2 },
  { cardId: 'OP01-002', name: 'Trafalgar Law', variantType: 'parallel', priceGbp: 145, priority: 2 },
  { cardId: 'OP01-060', name: 'Donquixote Doflamingo', variantType: 'parallel', priceGbp: 121, priority: 2 },
  { cardId: 'OP01-047', name: 'Trafalgar Law', variantType: 'sp', priceGbp: 117, priority: 2 },
  { cardId: 'OP01-078', name: 'Boa Hancock', variantType: 'parallel', priceGbp: 116, priority: 2 },

  // Medium Value (£50-100) - Priority 3
  { cardId: 'OP01-024', name: 'Monkey D. Luffy', variantType: 'parallel', priceGbp: 99, priority: 3 },
  { cardId: 'OP01-025', name: 'Roronoa Zoro', variantType: 'parallel', priceGbp: 90, priority: 3 },
  { cardId: 'OP01-121', name: 'Yamato', variantType: 'parallel', priceGbp: 72, priority: 3 },
  { cardId: 'OP01-051', name: 'Eustass Kid', variantType: 'wantedposter', priceGbp: 68, priority: 3 },
  { cardId: 'OP01-073', name: 'Donquixote Doflamingo', variantType: 'sp', priceGbp: 63, priority: 3 },
  { cardId: 'OP01-120', name: 'Shanks', variantType: 'parallel', priceGbp: 62, priority: 3 },
  { cardId: 'OP01-094', name: 'Kaido', variantType: 'parallel', priceGbp: 57, priority: 3 },

  // Lower Value (£20-50) - Priority 4
  { cardId: 'OP01-013', name: 'Sanji', variantType: 'parallel', priceGbp: 48, priority: 4 },
  { cardId: 'OP01-062', name: 'Crocodile', variantType: 'parallel', priceGbp: 47, priority: 4 },
  { cardId: 'OP01-031', name: 'Kouzuki Oden', variantType: 'parallel', priceGbp: 40, priority: 4 },
  { cardId: 'OP01-061', name: 'Kaido', variantType: 'parallel', priceGbp: 38, priority: 4 },
  { cardId: 'OP01-070', name: 'Dracule Mihawk', variantType: 'parallel', priceGbp: 37, priority: 4 },
  { cardId: 'OP01-047', name: 'Trafalgar Law', variantType: 'parallel', priceGbp: 34, priority: 4 },
  { cardId: 'OP01-035', name: 'Okiku', variantType: 'sp', priceGbp: 31, priority: 4 },
  { cardId: 'OP01-091', name: 'King', variantType: 'parallel', priceGbp: 29, priority: 4 },
  { cardId: 'OP01-077', name: 'Perona', variantType: 'boxtopper', priceGbp: 28, priority: 4 },
];

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  serpApiKey: process.env.SERPAPI_API_KEY || '',
  s3Bucket: process.env.S3_BUCKET || 'tcg-training-data',
  s3Prefix: 'onepiece-tcg/op01-prototype',
  resolutions: [500, 1600],

  // Images per card based on priority
  imagesPerPriority: {
    1: 80,   // High value - more training data
    2: 60,
    3: 40,
    4: 30,
  } as Record<number, number>,

  // Rate limiting
  serpApiDelayMs: 1500,
  imageDelayMs: 50,
  concurrency: 5,
};

// ============================================================================
// TYPES
// ============================================================================

interface SerpApiResult {
  title: string;
  link: string;
  product_id: string;
  price?: { raw: string; extracted: number };
  condition?: string;
  thumbnail?: string;
  sold_date?: string;
}

interface CollectedImage {
  cardId: string;
  variantType: string;
  language: 'EN' | 'JP';
  ebayItemId: string;
  s3Key: string;
  priceUsd: number | null;
  resolution: number;
}

// ============================================================================
// COLLECTION FUNCTIONS
// ============================================================================

const s3 = new S3Client({ region: 'us-east-1' });

/**
 * Build search query for a specific card
 *
 * Strategy: Keep queries simple - card number + minimal terms
 * Over-specification kills results on eBay
 */
function buildCardQuery(card: TargetCard, language: 'EN' | 'JP'): string {
  // Language filter - simple and effective
  const langFilter = language === 'EN'
    ? '-japanese'
    : 'japanese';

  // Minimal variant hint - don't over-specify
  let variantHint = '';
  switch (card.variantType) {
    case 'manga':
      variantHint = 'manga';
      break;
    case 'sp':
      variantHint = 'SP';
      break;
    case 'parallel':
      variantHint = 'parallel';
      break;
    case 'wantedposter':
      variantHint = 'wanted';
      break;
    case 'boxtopper':
      variantHint = 'promo';
      break;
    default:
      variantHint = 'alt';
  }

  // Simple query: card number + "one piece" + variant hint + language filter + noise reduction
  return `"${card.cardId}" "one piece" ${variantHint} ${langFilter} -lot -bundle -bulk`;
}

/**
 * Search eBay via SerpApi
 */
async function searchEbay(query: string, limit: number = 100): Promise<SerpApiResult[]> {
  const params = new URLSearchParams({
    engine: 'ebay',
    _nkw: query,
    show_only: 'Sold',
    _ipg: String(Math.min(limit, 200)),
    api_key: CONFIG.serpApiKey,
  });

  const response = await fetch(`https://serpapi.com/search?${params}`);
  const data = await response.json();

  if (data.error) {
    console.log(`   ⚠️ API error: ${data.error}`);
    return [];
  }

  return data.organic_results || [];
}

/**
 * Extract eBay item ID from URL
 */
function extractItemId(link: string): string {
  const match = link.match(/\/itm\/(\d+)/);
  return match ? match[1] : '';
}

/**
 * Download image from eBay CDN
 */
async function downloadImage(url: string, retries = 3): Promise<Buffer | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
    } catch {
      await delay(1000 * (i + 1));
    }
  }
  return null;
}

/**
 * Check if image exists in S3
 */
async function imageExists(s3Key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: CONFIG.s3Bucket,
      Key: s3Key,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload image to S3
 */
async function uploadImage(
  buffer: Buffer,
  s3Key: string,
  metadata: Record<string, string>
): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: CONFIG.s3Bucket,
    Key: s3Key,
    Body: buffer,
    ContentType: 'image/jpeg',
    Metadata: metadata,
  }));
}

/**
 * Collect images for a single card
 */
async function collectCardImages(
  card: TargetCard,
  language: 'EN' | 'JP',
  targetCount: number,
  collectedIds: Set<string>
): Promise<CollectedImage[]> {
  const query = buildCardQuery(card, language);
  console.log(`\n   🔍 Query: ${query.substring(0, 60)}...`);

  const results = await searchEbay(query, targetCount * 2);
  console.log(`   📦 Found: ${results.length} listings`);

  if (results.length === 0) return [];

  const collected: CollectedImage[] = [];
  let downloaded = 0;

  for (const result of results) {
    if (collected.length >= targetCount) break;

    const itemId = extractItemId(result.link) || result.product_id;
    if (!itemId || collectedIds.has(itemId)) continue;

    // Check if thumbnail exists
    if (!result.thumbnail) continue;

    // Download both resolutions
    for (const resolution of CONFIG.resolutions) {
      const imageUrl = result.thumbnail.replace(/s-l\d+/, `s-l${resolution}`);
      const s3Key = `${CONFIG.s3Prefix}/${card.cardId}/${card.variantType}/${language}/${resolution}/${itemId}.jpg`;

      // Skip if already exists
      if (await imageExists(s3Key)) {
        console.log(`   ⏭️ Exists: ${itemId} (${resolution}px)`);
        continue;
      }

      const buffer = await downloadImage(imageUrl);
      if (!buffer) continue;

      await uploadImage(buffer, s3Key, {
        'card-id': card.cardId,
        'card-name': card.name,
        'variant-type': card.variantType,
        'language': language,
        'price-usd': String(result.price?.extracted || ''),
        'ebay-item-id': itemId,
      });

      collected.push({
        cardId: card.cardId,
        variantType: card.variantType,
        language,
        ebayItemId: itemId,
        s3Key,
        priceUsd: result.price?.extracted || null,
        resolution,
      });

      downloaded++;
      await delay(CONFIG.imageDelayMs);
    }

    collectedIds.add(itemId);

    // Progress
    if (downloaded % 10 === 0) {
      process.stdout.write(`\r   📥 Downloaded: ${downloaded} images`);
    }
  }

  if (downloaded > 0) console.log();
  return collected;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═'.repeat(70));
  console.log('OP01 Alt Art Prototype Collection');
  console.log('═'.repeat(70));
  console.log(`Target Cards: ${OP01_TARGET_CARDS.length}`);
  console.log(`S3 Bucket: ${CONFIG.s3Bucket}`);
  console.log(`S3 Prefix: ${CONFIG.s3Prefix}`);
  console.log(`Resolutions: ${CONFIG.resolutions.join(', ')}px`);

  if (!CONFIG.serpApiKey) {
    console.error('❌ SERPAPI_API_KEY not set');
    process.exit(1);
  }

  const collectedIds = new Set<string>();
  const allCollected: CollectedImage[] = [];
  const stats = {
    totalCards: 0,
    totalImages: 0,
    byLanguage: { EN: 0, JP: 0 },
    byVariant: {} as Record<string, number>,
    byCard: {} as Record<string, number>,
  };

  // Process cards by priority
  for (const priority of [1, 2, 3, 4]) {
    const cards = OP01_TARGET_CARDS.filter(c => c.priority === priority);
    if (cards.length === 0) continue;

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📊 Priority ${priority} Cards (${cards.length} cards)`);
    console.log(`   Target: ~${CONFIG.imagesPerPriority[priority]} images per card per language`);

    for (const card of cards) {
      console.log(`\n🎴 ${card.name} (${card.cardId}) - ${card.variantType} [£${card.priceGbp}]`);
      stats.totalCards++;

      const targetCount = CONFIG.imagesPerPriority[priority];

      // Collect English
      const enImages = await collectCardImages(card, 'EN', targetCount, collectedIds);
      allCollected.push(...enImages);
      stats.byLanguage.EN += enImages.length;
      console.log(`   ✅ EN: ${enImages.length / 2} listings, ${enImages.length} images`);

      await delay(CONFIG.serpApiDelayMs);

      // Collect Japanese
      const jpImages = await collectCardImages(card, 'JP', Math.floor(targetCount / 2), collectedIds);
      allCollected.push(...jpImages);
      stats.byLanguage.JP += jpImages.length;
      console.log(`   ✅ JP: ${jpImages.length / 2} listings, ${jpImages.length} images`);

      // Update stats
      stats.totalImages += enImages.length + jpImages.length;
      stats.byVariant[card.variantType] = (stats.byVariant[card.variantType] || 0) + enImages.length + jpImages.length;
      stats.byCard[card.cardId] = (stats.byCard[card.cardId] || 0) + enImages.length + jpImages.length;

      await delay(CONFIG.serpApiDelayMs);
    }
  }

  // Save manifest
  const manifest = {
    created: new Date().toISOString(),
    targetCards: OP01_TARGET_CARDS,
    stats,
    images: allCollected,
  };

  await s3.send(new PutObjectCommand({
    Bucket: CONFIG.s3Bucket,
    Key: `${CONFIG.s3Prefix}/manifest.json`,
    Body: JSON.stringify(manifest, null, 2),
    ContentType: 'application/json',
  }));

  // Final summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log('COLLECTION COMPLETE');
  console.log('═'.repeat(70));
  console.log(`Total Cards Processed: ${stats.totalCards}`);
  console.log(`Total Images Collected: ${stats.totalImages}`);
  console.log(`\nBy Language:`);
  console.log(`   EN: ${stats.byLanguage.EN}`);
  console.log(`   JP: ${stats.byLanguage.JP}`);
  console.log(`\nBy Variant Type:`);
  for (const [variant, count] of Object.entries(stats.byVariant)) {
    console.log(`   ${variant}: ${count}`);
  }
  console.log(`\nTop Cards by Image Count:`);
  const topCards = Object.entries(stats.byCard)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [cardId, count] of topCards) {
    console.log(`   ${cardId}: ${count} images`);
  }

  console.log(`\n📁 Data Location: s3://${CONFIG.s3Bucket}/${CONFIG.s3Prefix}/`);
}

main().catch(console.error);
