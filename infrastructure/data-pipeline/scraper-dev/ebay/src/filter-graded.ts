#!/usr/bin/env npx tsx
/**
 * Filter out graded/slabbed cards from the training dataset
 *
 * Graded cards (PSA, BGS, CGC) are problematic for training because:
 * 1. The slab obscures card details
 * 2. Labels can become shortcut features
 * 3. Our use case is raw card identification
 *
 * This script analyzes listing titles to identify graded cards
 * and can optionally move them to a separate S3 prefix.
 */

import { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const s3 = new S3Client({ region: "us-east-1" });

// Patterns that indicate graded/slabbed cards
const GRADED_PATTERNS = [
  /\bpsa\b/i,
  /\bbgs\b/i,
  /\bcgc\b/i,
  /\bsgc\b/i,
  /\bgraded\b/i,
  /\bslab\b/i,
  /\bgem\s*mint/i,
  /\b10\s*gem/i,
  /\bpristine/i,
  /\bperfect\s*10/i,
];

// Patterns that indicate raw cards (to keep)
const RAW_PATTERNS = [
  /\braw\b/i,
  /\bungraded\b/i,
  /\bnm\b/i,
  /\bnear\s*mint/i,
  /\bmint\b/i,
  /\blp\b/i,
  /\bmp\b/i,
  /\bhp\b/i,
  /\bplayed\b/i,
];

interface ListingMetadata {
  itemId: string;
  title: string;
  s3Key: string;
  isGraded: boolean;
  gradedReason?: string;
}

async function loadMetadataIndex(): Promise<Map<string, any>> {
  const bucket = "tcg-training-data";
  const indexKey = "onepiece-tcg/op01-prototype/metadata-index.json";

  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: indexKey,
    }));

    const content = await response.Body?.transformToString();
    if (content) {
      const data = JSON.parse(content);
      return new Map(Object.entries(data));
    }
  } catch (error) {
    console.log("No metadata index found, will analyze titles from S3 keys");
  }

  return new Map();
}

function isGradedListing(title: string): { isGraded: boolean; reason?: string } {
  // Check for graded patterns
  for (const pattern of GRADED_PATTERNS) {
    if (pattern.test(title)) {
      return { isGraded: true, reason: `Matches pattern: ${pattern}` };
    }
  }

  // Check for PSA/BGS scores like "PSA 10", "BGS 9.5"
  if (/\b(psa|bgs|cgc|sgc)\s*\d+(\.\d+)?/i.test(title)) {
    return { isGraded: true, reason: "Contains grading score" };
  }

  return { isGraded: false };
}

async function analyzeDataset(dryRun: boolean = true) {
  const bucket = "tcg-training-data";
  const prefix = "onepiece-tcg/op01-prototype/";

  // Load metadata
  const metadata = await loadMetadataIndex();

  // Collect all images
  const listings: ListingMetadata[] = [];
  let continuationToken: string | undefined;

  console.log("Scanning S3 for images...\n");

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
      if (parts.length < 6) continue;

      const resolution = parts[5];
      if (resolution !== "500") continue; // Only analyze 500px versions

      const filename = parts[6] || "";
      const itemId = filename.replace(".jpg", "");

      // Get title from metadata or construct from path
      let title = "";
      const meta = metadata.get(itemId);
      if (meta?.title) {
        title = meta.title;
      } else {
        // If no metadata, we can't determine if graded from path alone
        // Mark as unknown
        title = `${parts[2]} ${parts[3]}`;
      }

      const gradedCheck = isGradedListing(title);

      listings.push({
        itemId,
        title,
        s3Key: key,
        isGraded: gradedCheck.isGraded,
        gradedReason: gradedCheck.reason,
      });
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  // Analyze results
  const graded = listings.filter(l => l.isGraded);
  const raw = listings.filter(l => !l.isGraded);

  console.log("═".repeat(70));
  console.log("GRADED CARD ANALYSIS");
  console.log("═".repeat(70));
  console.log(`Total listings analyzed: ${listings.length}`);
  console.log(`Graded/Slabbed: ${graded.length} (${(graded.length / listings.length * 100).toFixed(1)}%)`);
  console.log(`Raw/Ungraded: ${raw.length} (${(raw.length / listings.length * 100).toFixed(1)}%)`);

  // Show sample graded listings
  console.log("\n─".repeat(70));
  console.log("SAMPLE GRADED LISTINGS (first 10):");
  console.log("─".repeat(70));
  for (const listing of graded.slice(0, 10)) {
    console.log(`  ${listing.itemId}: ${listing.title.slice(0, 60)}...`);
    console.log(`    Reason: ${listing.gradedReason}`);
  }

  // Show sample raw listings
  console.log("\n─".repeat(70));
  console.log("SAMPLE RAW LISTINGS (first 10):");
  console.log("─".repeat(70));
  for (const listing of raw.slice(0, 10)) {
    console.log(`  ${listing.itemId}: ${listing.title.slice(0, 60)}...`);
  }

  // Save analysis report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: listings.length,
      graded: graded.length,
      raw: raw.length,
      gradedPercent: (graded.length / listings.length * 100).toFixed(1),
    },
    gradedListings: graded.map(l => ({
      itemId: l.itemId,
      title: l.title,
      reason: l.gradedReason,
    })),
    rawListings: raw.map(l => ({
      itemId: l.itemId,
      title: l.title,
    })),
  };

  const reportPath = resolve(__dirname, "../graded-analysis-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved to: ${reportPath}`);

  if (!dryRun) {
    console.log("\n🚀 Moving graded images to separate prefix...");
    await moveGradedImages(graded, bucket);
  } else {
    console.log("\n💡 Run with --execute to move graded images to separate prefix");
  }

  return { graded, raw };
}

async function moveGradedImages(graded: ListingMetadata[], bucket: string) {
  let moved = 0;

  for (const listing of graded) {
    // Move both 500px and 1000px versions
    for (const res of ["500", "1000"]) {
      const oldKey = listing.s3Key.replace("/500/", `/${res}/`);
      const newKey = oldKey.replace("/op01-prototype/", "/op01-prototype-graded/");

      try {
        // Copy to new location
        await s3.send(new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${oldKey}`,
          Key: newKey,
        }));

        // Delete from original location
        await s3.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: oldKey,
        }));

        moved++;
      } catch (error) {
        console.log(`  ⚠️ Failed to move ${oldKey}`);
      }
    }
  }

  console.log(`✅ Moved ${moved} files to graded prefix`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--execute");

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No files will be moved\n");
  }

  await analyzeDataset(dryRun);
}

main().catch(console.error);
