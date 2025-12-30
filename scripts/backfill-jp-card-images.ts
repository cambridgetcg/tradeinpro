#!/usr/bin/env npx tsx
/**
 * Backfill JP Card Images Script
 *
 * This script updates all Japanese cards in CardPriceV2 to have full S3 URLs
 * for their images instead of relative paths.
 *
 * The existing relative paths (e.g., "Official/OP08/SP-ST02-007.png") are correct
 * and account for SP cards with different naming conventions. This script simply
 * prepends the S3 base URL to convert them to full URLs.
 *
 * Usage:
 *   npx tsx scripts/backfill-jp-card-images.ts [--dry-run] [--validate]
 *
 * Options:
 *   --dry-run   Preview changes without writing to database
 *   --validate  Check if S3 images exist (slower, requires AWS credentials)
 */

import prisma from "../app/db.server";

// S3 Configuration (must match jp-prices.server.ts)
const S3_REGION = process.env.AWS_REGION || "us-east-1";
const IMAGE_BUCKET = "jp-op-photos";

// S3 base URL
const S3_BASE_URL = `https://${IMAGE_BUCKET}.s3.${S3_REGION}.amazonaws.com`;

// Convert a relative path to full S3 URL
function toFullS3Url(relativePath: string): string {
  // Handle paths that may or may not start with "/"
  const cleanPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return `${S3_BASE_URL}${cleanPath}`;
}

// Construct the full S3 URL for a JP card image (for cards without existing paths)
function getJpCardImageUrl(setCode: string, cardNumber: string): string {
  const cardId = `${setCode}-${cardNumber}`;
  return `${S3_BASE_URL}/Official/${setCode}/${cardId}.png`;
}

// Check if a URL is already a full S3 URL
function isFullUrl(url: string | null): boolean {
  if (!url) return false;
  return url.startsWith("https://") || url.startsWith("http://");
}

// Validate that an S3 image exists (HEAD request)
async function validateImageExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

interface BackfillResult {
  totalJpCards: number;
  alreadyCorrect: number;
  needsUpdate: number;
  updated: number;
  skipped: number;
  errors: Array<{ cardId: string; error: string }>;
  validated?: number;
  invalidImages?: Array<{ cardId: string; url: string }>;
}

async function backfillJpCardImages(options: {
  dryRun: boolean;
  validate: boolean;
}): Promise<BackfillResult> {
  const { dryRun, validate } = options;

  console.log("=".repeat(60));
  console.log("JP Card Image Backfill Script");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE (will update database)"}`);
  console.log(`Validate S3: ${validate ? "Yes" : "No"}`);
  console.log(`S3 Bucket: ${IMAGE_BUCKET}`);
  console.log(`S3 Region: ${S3_REGION}`);
  console.log("=".repeat(60));
  console.log();

  const result: BackfillResult = {
    totalJpCards: 0,
    alreadyCorrect: 0,
    needsUpdate: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  if (validate) {
    result.validated = 0;
    result.invalidImages = [];
  }

  // Fetch all JP cards
  console.log("Fetching JP cards from database...");
  const jpCards = await prisma.cardPriceV2.findMany({
    where: { language: "JP" },
    select: {
      cardId: true,
      name: true,
      setCode: true,
      cardNumber: true,
      imageUrl: true,
    },
  });

  result.totalJpCards = jpCards.length;
  console.log(`Found ${jpCards.length} JP cards\n`);

  // Group cards by status
  const needsUpdate: typeof jpCards = [];
  const alreadyCorrect: typeof jpCards = [];
  const cannotUpdate: typeof jpCards = [];
  const noImageUrl: typeof jpCards = [];

  for (const card of jpCards) {
    if (isFullUrl(card.imageUrl)) {
      // Already has a full URL
      alreadyCorrect.push(card);
    } else if (card.imageUrl) {
      // Has a relative path - just needs S3 base URL prepended
      needsUpdate.push(card);
    } else if (card.setCode && card.cardNumber) {
      // No imageUrl but has setCode/cardNumber - can construct URL
      noImageUrl.push(card);
    } else {
      // Cannot update - no imageUrl and missing setCode/cardNumber
      cannotUpdate.push(card);
    }
  }

  result.alreadyCorrect = alreadyCorrect.length;
  result.needsUpdate = needsUpdate.length + noImageUrl.length;
  result.skipped = cannotUpdate.length;

  console.log("Card Status Summary:");
  console.log(`  - Already have full URL: ${alreadyCorrect.length}`);
  console.log(`  - Has relative path (need S3 base URL): ${needsUpdate.length}`);
  console.log(`  - No imageUrl (will construct from setCode/cardNumber): ${noImageUrl.length}`);
  console.log(`  - Cannot update (no data): ${cannotUpdate.length}`);
  console.log();

  if (cannotUpdate.length > 0) {
    console.log("Cards that cannot be updated (missing data):");
    for (const card of cannotUpdate.slice(0, 10)) {
      console.log(`  - ${card.cardId}: imageUrl=${card.imageUrl}, setCode=${card.setCode}, cardNumber=${card.cardNumber}`);
    }
    if (cannotUpdate.length > 10) {
      console.log(`  ... and ${cannotUpdate.length - 10} more`);
    }
    console.log();
  }

  // Combine both lists for processing
  const allToUpdate = [...needsUpdate, ...noImageUrl];

  if (allToUpdate.length === 0) {
    console.log("No cards need updating!");
    await prisma.$disconnect();
    return result;
  }

  // Helper to get the new URL for a card
  const getNewUrl = (card: (typeof allToUpdate)[0]): string => {
    if (card.imageUrl) {
      // Has relative path - prepend S3 base URL
      return toFullS3Url(card.imageUrl);
    } else {
      // No imageUrl - construct from setCode/cardNumber
      return getJpCardImageUrl(card.setCode!, card.cardNumber!);
    }
  };

  // Preview changes
  console.log("Sample of changes to be made:");
  for (const card of allToUpdate.slice(0, 5)) {
    const newUrl = getNewUrl(card);
    console.log(`  ${card.cardId}:`);
    console.log(`    Current: ${card.imageUrl || "(null)"}`);
    console.log(`    New:     ${newUrl}`);
  }
  if (allToUpdate.length > 5) {
    console.log(`  ... and ${allToUpdate.length - 5} more cards`);
  }
  console.log();

  // Validation pass (optional)
  if (validate) {
    console.log("Validating S3 images exist (this may take a while)...");
    let validatedCount = 0;

    for (const card of allToUpdate) {
      const newUrl = getNewUrl(card);
      const exists = await validateImageExists(newUrl);

      if (!exists) {
        result.invalidImages!.push({ cardId: card.cardId, url: newUrl });
      }

      validatedCount++;
      if (validatedCount % 50 === 0) {
        console.log(`  Validated ${validatedCount}/${allToUpdate.length}...`);
      }
    }

    result.validated = validatedCount;
    console.log(`Validation complete: ${result.invalidImages!.length} images not found in S3\n`);

    if (result.invalidImages!.length > 0) {
      console.log("Images not found in S3:");
      for (const img of result.invalidImages!.slice(0, 10)) {
        console.log(`  - ${img.cardId}: ${img.url}`);
      }
      if (result.invalidImages!.length > 10) {
        console.log(`  ... and ${result.invalidImages!.length - 10} more`);
      }
      console.log();
    }
  }

  // Perform updates
  if (dryRun) {
    console.log("DRY RUN - No changes made to database");
    result.updated = 0;
  } else {
    console.log("Updating database...");
    const BATCH_SIZE = 50;
    let updatedCount = 0;

    for (let i = 0; i < allToUpdate.length; i += BATCH_SIZE) {
      const batch = allToUpdate.slice(i, i + BATCH_SIZE);

      // Use a transaction for each batch
      await prisma.$transaction(
        batch.map((card) => {
          const newUrl = getNewUrl(card);
          return prisma.cardPriceV2.update({
            where: { cardId: card.cardId },
            data: { imageUrl: newUrl },
          });
        })
      );

      updatedCount += batch.length;
      console.log(`  Updated ${updatedCount}/${allToUpdate.length} cards...`);
    }

    result.updated = updatedCount;
    console.log(`\nSuccessfully updated ${updatedCount} cards!`);
  }

  await prisma.$disconnect();
  return result;
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const validate = args.includes("--validate");

// Run the script
backfillJpCardImages({ dryRun, validate })
  .then((result) => {
    console.log("\n" + "=".repeat(60));
    console.log("FINAL SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total JP cards: ${result.totalJpCards}`);
    console.log(`Already correct: ${result.alreadyCorrect}`);
    console.log(`Needed update: ${result.needsUpdate}`);
    console.log(`Updated: ${result.updated}`);
    console.log(`Skipped (missing data): ${result.skipped}`);
    console.log(`Errors: ${result.errors.length}`);
    if (result.validated !== undefined) {
      console.log(`Validated: ${result.validated}`);
      console.log(`Invalid images: ${result.invalidImages?.length || 0}`);
    }
    console.log("=".repeat(60));
    process.exit(result.errors.length > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
