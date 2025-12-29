const { PrismaClient } = require('@prisma/client');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const prisma = new PrismaClient();
const s3 = new S3Client({ region: 'us-east-1' });

const IMAGE_BUCKET = 'jp-op-photos';
const IMAGE_PREFIX = 'Official/';
const S3_BASE_URL = `https://${IMAGE_BUCKET}.s3.us-east-1.amazonaws.com/`;

async function getS3Images() {
  console.log('Fetching image list from S3...');

  const images = new Map(); // setCode-cardNumber -> image path

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

      // Parse: Official/OP01/OP01-001.png -> OP01-001
      const match = key.match(/Official\/([A-Z0-9]+)\/([A-Z0-9]+-\d+)\.png$/i);
      if (match) {
        const [, folder, cardId] = match;
        images.set(cardId.toUpperCase(), key);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  console.log(`Found ${images.size} images in S3`);
  return images;
}

/**
 * Extract setCode and cardNumber from SKU
 * Regular: OP-OP01-001-JP -> setCode=OP01, cardNumber=001
 * SP: OP-OP03-SP-OP01-051-JP -> setCode=OP01, cardNumber=051 (original card)
 */
function extractSetAndNumber(sku) {
  // SP card format: OP-OP03-SP-OP01-051-JP
  const spMatch = sku.match(/^OP-[A-Z0-9]+-SP-([A-Z0-9]+)-(\d+)-JP$/i);
  if (spMatch) {
    return { setCode: spMatch[1].toUpperCase(), cardNumber: spMatch[2] };
  }

  // Regular card format: OP-OP01-001-JP
  const regularMatch = sku.match(/^OP-([A-Z0-9]+)-(\d+)-JP$/i);
  if (regularMatch) {
    return { setCode: regularMatch[1].toUpperCase(), cardNumber: regularMatch[2] };
  }

  return { setCode: null, cardNumber: null };
}

async function fixSpCards() {
  // First, fix the SP cards in JapanesePriceSource and CardPriceV2
  console.log('Fixing SP cards with null setCode/cardNumber...');

  const spSource = await prisma.japanesePriceSource.findMany({
    where: { setCode: null }
  });

  console.log(`Found ${spSource.length} JapanesePriceSource records with null setCode`);

  for (const source of spSource) {
    const { setCode, cardNumber } = extractSetAndNumber(source.sku);
    if (setCode && cardNumber) {
      await prisma.japanesePriceSource.update({
        where: { id: source.id },
        data: { setCode, cardNumber }
      });
    }
  }

  // Now fix CardPriceV2
  const jpCards = await prisma.cardPriceV2.findMany({
    where: { language: 'JP', setCode: null }
  });

  console.log(`Found ${jpCards.length} CardPriceV2 JP cards with null setCode`);

  for (const card of jpCards) {
    // Extract SKU from cardId: JP-OP-OP03-SP-OP01-051-JP -> OP-OP03-SP-OP01-051-JP
    const sku = card.cardId.replace(/^JP-/, '');
    const { setCode, cardNumber } = extractSetAndNumber(sku);
    if (setCode && cardNumber) {
      await prisma.cardPriceV2.update({
        where: { cardId: card.cardId },
        data: { setCode, cardNumber }
      });
    }
  }

  console.log('Fixed SP cards!');
}

async function updateCardImages() {
  // Get all S3 images
  const s3Images = await getS3Images();

  // Get all JP cards
  console.log('\nFetching JP cards from database...');
  const jpCards = await prisma.cardPriceV2.findMany({
    where: { language: 'JP' },
    select: { cardId: true, setCode: true, cardNumber: true }
  });
  console.log(`Found ${jpCards.length} JP cards`);

  let updated = 0;
  let notFound = 0;
  const missing = [];

  for (const card of jpCards) {
    if (!card.setCode || !card.cardNumber) {
      notFound++;
      missing.push(card.cardId);
      continue;
    }

    // Construct the expected image key: {setCode}-{cardNumber}
    const imageKey = `${card.setCode}-${card.cardNumber}`.toUpperCase();
    const s3Path = s3Images.get(imageKey);

    if (s3Path) {
      await prisma.cardPriceV2.update({
        where: { cardId: card.cardId },
        data: { imageUrl: s3Path }
      });
      updated++;
    } else {
      notFound++;
      missing.push(`${card.cardId} (${imageKey})`);
    }
  }

  console.log(`\nResults:`);
  console.log(`  Updated: ${updated} cards with images`);
  console.log(`  Not found: ${notFound} cards without images`);

  if (missing.length > 0 && missing.length <= 20) {
    console.log('\nMissing images for:');
    missing.forEach(m => console.log(`  ${m}`));
  }

  // Show some samples including SP cards
  const samples = await prisma.cardPriceV2.findMany({
    where: { language: 'JP', imageUrl: { not: null }, cardId: { contains: 'SP' } },
    take: 3,
    select: { cardId: true, setCode: true, cardNumber: true, imageUrl: true }
  });
  console.log('\nSample SP cards with images:');
  samples.forEach(c => {
    console.log(`  ${c.cardId} (${c.setCode}-${c.cardNumber}): ${S3_BASE_URL}${c.imageUrl}`);
  });

  await prisma.$disconnect();
}

async function main() {
  await fixSpCards();
  await updateCardImages();
}

main().catch(console.error);
