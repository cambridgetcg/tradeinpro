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

      // Regular card: Official/OP01/OP01-001.png
      // SP card: Official/OP08/SP-ST02-007.png

      // Parse regular: Official/{FOLDER}/{SET}-{NUM}.png
      const regularMatch = key.match(/Official\/([A-Z0-9]+)\/([A-Z0-9]+-\d+)\.png$/i);
      if (regularMatch && !key.includes('/SP-')) {
        const [, folder, cardId] = regularMatch;
        // Key: folder + cardId (e.g., "OP01:OP01-001")
        images.set(`${folder}:${cardId}`.toUpperCase(), key);
      }

      // Parse SP: Official/{RELEASE_SET}/SP-{ORIGINAL_SET}-{NUM}.png
      const spMatch = key.match(/Official\/([A-Z0-9]+)\/SP-([A-Z0-9]+-\d+)\.png$/i);
      if (spMatch) {
        const [, releaseSet, originalCard] = spMatch;
        // Key: releaseSet + SP + originalCard (e.g., "OP08:SP:ST02-007")
        images.set(`${releaseSet}:SP:${originalCard}`.toUpperCase(), key);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  console.log(`Found ${images.size} images in S3`);
  return images;
}

/**
 * Parse SKU to get release set, original set, card number, and if it's SP
 * Regular: OP-OP01-001-JP -> releaseSet=OP01, originalSet=OP01, cardNum=001, isSP=false
 * SP: OP-OP08-SP-ST02-007-JP -> releaseSet=OP08, originalSet=ST02, cardNum=007, isSP=true
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
    // Extract SKU from cardId: JP-OP-OP08-SP-ST02-007-JP -> OP-OP08-SP-ST02-007-JP
    const sku = card.cardId.replace(/^JP-/, '');
    const parsed = parseSku(sku);

    if (!parsed) {
      notFound++;
      missing.push(`${card.cardId} (unparseable)`);
      continue;
    }

    let imageKey;
    if (parsed.isSP) {
      // SP card: look for Official/{releaseSet}/SP-{originalSet}-{cardNum}.png
      imageKey = `${parsed.releaseSet}:SP:${parsed.originalSet}-${parsed.cardNum}`;
    } else {
      // Regular card: look for Official/{releaseSet}/{releaseSet}-{cardNum}.png
      imageKey = `${parsed.releaseSet}:${parsed.releaseSet}-${parsed.cardNum}`;
    }

    const s3Path = s3Images.get(imageKey.toUpperCase());

    if (s3Path) {
      await prisma.cardPriceV2.update({
        where: { cardId: card.cardId },
        data: { imageUrl: s3Path }
      });
      updated++;
    } else {
      notFound++;
      missing.push(`${card.cardId} (key: ${imageKey})`);
    }
  }

  console.log(`\nResults:`);
  console.log(`  Updated: ${updated} cards with images`);
  console.log(`  Not found: ${notFound} cards without images`);

  if (missing.length > 0 && missing.length <= 30) {
    console.log('\nMissing images for:');
    missing.forEach(m => console.log(`  ${m}`));
  }

  // Show some SP card samples
  const spSamples = await prisma.cardPriceV2.findMany({
    where: { language: 'JP', cardId: { contains: 'SP' }, imageUrl: { not: null } },
    take: 5,
    select: { cardId: true, imageUrl: true }
  });
  console.log('\nSample SP cards with images:');
  spSamples.forEach(c => {
    console.log(`  ${c.cardId}`);
    console.log(`    -> ${S3_BASE_URL}${c.imageUrl}`);
  });

  await prisma.$disconnect();
}

updateCardImages().catch(console.error);
