#!/usr/bin/env npx tsx
/**
 * Analyze image counts per card/variant in S3
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const s3 = new S3Client({ region: "us-east-1" });

interface CardVariantStats {
  cardId: string;
  variant: string;
  total: number;
  en: number;
  jp: number;
  sampleImages: string[];
}

async function analyzeImages() {
  const bucket = "tcg-training-data";
  // Analyze the v2 collection (graded cards filtered out)
  const prefix = "onepiece-tcg/op01-v2/";

  // Count images by card/variant/language/resolution
  const counts: Record<string, number> = {};
  const cardVariantCounts: Record<string, number> = {};
  const sampleImages: Record<string, string[]> = {};

  let continuationToken: string | undefined;
  let totalImages = 0;

  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    for (const obj of response.Contents || []) {
      const key = obj.Key;
      if (!key || !key.endsWith(".jpg")) continue;

      // Parse path: prefix/card_id/variant_type/language/resolution/item_id.jpg
      const parts = key.split("/");
      if (parts.length >= 6) {
        const cardId = parts[2];
        const variant = parts[3];
        const language = parts[4];
        const resolution = parts[5];

        // Count by card+variant (unique images, not resolutions)
        if (resolution === "500") {
          const cvKey = `${cardId}|${variant}`;
          cardVariantCounts[cvKey] = (cardVariantCounts[cvKey] || 0) + 1;

          const langKey = `${cardId}|${variant}|${language}`;
          counts[langKey] = (counts[langKey] || 0) + 1;

          // Store sample images (first 3 per card/variant)
          if (!sampleImages[cvKey]) {
            sampleImages[cvKey] = [];
          }
          if (sampleImages[cvKey].length < 3) {
            sampleImages[cvKey].push(key);
          }
        }
        totalImages++;
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  console.log("═".repeat(70));
  console.log("IMAGE COUNTS BY CARD/VARIANT");
  console.log("═".repeat(70));
  console.log(`Total images (both resolutions): ${totalImages}`);
  console.log(`Unique listings: ${totalImages / 2}`);
  console.log();

  // Sort by count descending
  const sorted: CardVariantStats[] = Object.entries(cardVariantCounts)
    .map(([key, count]) => {
      const [cardId, variant] = key.split("|");
      const enKey = `${cardId}|${variant}|EN`;
      const jpKey = `${cardId}|${variant}|JP`;
      return {
        cardId,
        variant,
        total: count,
        en: counts[enKey] || 0,
        jp: counts[jpKey] || 0,
        sampleImages: sampleImages[key] || [],
      };
    })
    .sort((a, b) => b.total - a.total);

  console.log("Card ID         Variant      Total   EN    JP");
  console.log("─".repeat(50));
  for (const item of sorted) {
    console.log(
      `${item.cardId.padEnd(15)} ${item.variant.padEnd(12)} ${String(item.total).padStart(5)}  ${String(item.en).padStart(4)}  ${String(item.jp).padStart(4)}`
    );
  }

  // Summary stats
  const totals = sorted.reduce((acc, item) => acc + item.total, 0);
  const avgPerCard = totals / sorted.length;
  const minCount = Math.min(...sorted.map(s => s.total));
  const maxCount = Math.max(...sorted.map(s => s.total));

  console.log("─".repeat(50));
  console.log(`Total unique card/variants: ${sorted.length}`);
  console.log(`Average images per card/variant: ${avgPerCard.toFixed(1)}`);
  console.log(`Min: ${minCount}, Max: ${maxCount}`);

  // Return sample images for downloading
  return sorted;
}

async function downloadSampleImages(stats: CardVariantStats[]) {
  const bucket = "tcg-training-data";
  const outputDir = resolve(__dirname, "../samples-v2");

  // Create samples directory
  const { mkdirSync, existsSync } = await import("fs");
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log("\n" + "═".repeat(70));
  console.log("DOWNLOADING SAMPLE IMAGES");
  console.log("═".repeat(70));

  // Download 2 samples from each of the top 5 cards
  const topCards = stats.slice(0, 8);
  const downloadedPaths: string[] = [];

  for (const card of topCards) {
    console.log(`\n📦 ${card.cardId} (${card.variant}):`);

    for (let i = 0; i < Math.min(2, card.sampleImages.length); i++) {
      const s3Key = card.sampleImages[i];
      const filename = `${card.cardId}_${card.variant}_${i + 1}.jpg`;
      const outputPath = resolve(outputDir, filename);

      try {
        const response = await s3.send(new GetObjectCommand({
          Bucket: bucket,
          Key: s3Key,
        }));

        const bodyContents = await response.Body?.transformToByteArray();
        if (bodyContents) {
          writeFileSync(outputPath, Buffer.from(bodyContents));
          console.log(`   ✅ ${filename}`);
          downloadedPaths.push(outputPath);
        }
      } catch (error) {
        console.log(`   ❌ Failed to download: ${s3Key}`);
      }
    }
  }

  console.log(`\n📁 Samples saved to: ${outputDir}`);
  return downloadedPaths;
}

async function main() {
  const stats = await analyzeImages();
  const samplePaths = await downloadSampleImages(stats);

  console.log("\n" + "═".repeat(70));
  console.log("SAMPLE IMAGE PATHS (for viewing)");
  console.log("═".repeat(70));
  for (const path of samplePaths) {
    console.log(path);
  }
}

main().catch(console.error);
