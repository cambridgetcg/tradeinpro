const { PrismaClient } = require('@prisma/client');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const prisma = new PrismaClient();
const s3 = new S3Client({ region: 'us-east-1' });

const IMAGE_BUCKET = 'jp-op-photos';
const IMAGE_PREFIX = 'Official/';
const S3_BASE_URL = `https://${IMAGE_BUCKET}.s3.us-east-1.amazonaws.com/`;

async function getS3Images() {
  console.log('Fetching image list from S3...');

  const images = new Map(); // key -> image path

  let continuationToken;
  do {
    const command = new ListObjectsV2Command({
      Bucket: IMAGE_BUCKET,
      Prefix: IMAGE_PREFIX,
      ContinuationToken: continuationToken
    });

    const response = await s3.send(command);

    for (const obj of response.Contents || []) {
      const key = obj.Key;
      if (!key.endsWith('.png')) continue;

      // Extract folder and filename
      const match = key.match(/Official\/([A-Z0-9]+)\/(.+)\.png$/i);
      if (match) {
        const [, folder, filename] = match;
        // Store by folder:filename for flexible lookup
        images.set(`${folder}:${filename}`.toUpperCase(), key);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  console.log(`Found ${images.size} images in S3`);
  return images;
}

/**
 * Parse SKU to get release set, original set, card number, and if it's SP
 */
function parseSku(sku) {
  // SP card format: OP-OP08-SP-ST02-007-JP
  const spMatch = sku.match(/^OP-([A-Z0-9]+)-SP-([A-Z0-9]+)-(\d+)-JP$/i);
  if (spMatch) {
    return {
      releaseSet: spMatch[1].toUpperCase(),
      originalSet: spMatch[2].toUpperCase(),
      cardNum: spMatch[3],
      isSP: true
    };
  }

  // Regular card format: OP-OP01-001-JP
  const regularMatch = sku.match(/^OP-([A-Z0-9]+)-(\d+)-JP$/i);
  if (regularMatch) {
    return {
      releaseSet: regularMatch[1].toUpperCase(),
      originalSet: regularMatch[1].toUpperCase(),
      cardNum: regularMatch[2],
      isSP: false
    };
  }

  return null;
}

async function updateCardImages() {
  const s3Images = await getS3Images();

  // Get all JP cards
  console.log('\nFetching JP cards from database...');
  const jpCards = await prisma.cardPriceV2.findMany({
    where: { language: 'JP' },
    select: { cardId: true }
  });
  console.log(`Found ${jpCards.length} JP cards`);

  let updated = 0;
  let notFound = 0;
  const missing = [];

  for (const card of jpCards) {
    const sku = card.cardId.replace(/^JP-/, '');
    const parsed = parseSku(sku);

    if (!parsed) {
      notFound++;
      missing.push(`${card.cardId} (unparseable)`);
      continue;
    }

    let s3Path = null;

    if (parsed.isSP) {
      // Try multiple patterns for SP cards:
      // 1. Official/{releaseSet}/SP-{originalSet}-{cardNum}.png (standard SP naming)
      // 2. Official/{releaseSet}/{originalSet}-{cardNum}.png (alt naming like EB02/EB01-001.png)
      const spKey = `${parsed.releaseSet}:SP-${parsed.originalSet}-${parsed.cardNum}`;
      const altKey = `${parsed.releaseSet}:${parsed.originalSet}-${parsed.cardNum}`;

      s3Path = s3Images.get(spKey.toUpperCase()) || s3Images.get(altKey.toUpperCase());
    } else {
      // Regular card: Official/{releaseSet}/{releaseSet}-{cardNum}.png
      const key = `${parsed.releaseSet}:${parsed.releaseSet}-${parsed.cardNum}`;
      s3Path = s3Images.get(key.toUpperCase());
    }

    if (s3Path) {
      await prisma.cardPriceV2.update({
        where: { cardId: card.cardId },
        data: { imageUrl: s3Path }
      });
      updated++;
    } else {
      notFound++;
      missing.push(`${card.cardId} (release: ${parsed.releaseSet}, original: ${parsed.originalSet}-${parsed.cardNum})`);
    }
  }

  console.log(`\nResults:`);
  console.log(`  Updated: ${updated} cards with images`);
  console.log(`  Not found: ${notFound} cards without images`);

  if (missing.length > 0) {
    console.log(`\nMissing images (${missing.length}):`);
    missing.forEach(m => console.log(`  ${m}`));
  }

  // Verify SP cards
  const spCards = await prisma.cardPriceV2.findMany({
    where: { language: 'JP', cardId: { contains: 'SP' } },
    select: { cardId: true, imageUrl: true }
  });

  const spWithImages = spCards.filter(c => c.imageUrl);
  const spWithoutImages = spCards.filter(c => !c.imageUrl);

  console.log(`\nSP Cards Summary:`);
  console.log(`  Total SP cards: ${spCards.length}`);
  console.log(`  With images: ${spWithImages.length}`);
  console.log(`  Missing images: ${spWithoutImages.length}`);

  if (spWithImages.length > 0) {
    console.log('\nSample SP cards with correct images:');
    spWithImages.slice(0, 5).forEach(c => {
      console.log(`  ${c.cardId}`);
      console.log(`    -> ${c.imageUrl}`);
    });
  }

  await prisma.$disconnect();
}

updateCardImages().catch(console.error);
