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

async function updateCardImages() {
  // Get all S3 images
  const s3Images = await getS3Images();

  // Get all JP cards
  console.log('Fetching JP cards from database...');
  const jpCards = await prisma.cardPriceV2.findMany({
    where: { language: 'JP' },
    select: { cardId: true, setCode: true, cardNumber: true }
  });
  console.log(`Found ${jpCards.length} JP cards`);

  let updated = 0;
  let notFound = 0;

  for (const card of jpCards) {
    // Construct the expected image key: {setCode}-{cardNumber}
    const imageKey = `${card.setCode}-${card.cardNumber}`.toUpperCase();
    const s3Path = s3Images.get(imageKey);

    if (s3Path) {
      const imageUrl = s3Path; // Store relative path like "Official/OP01/OP01-001.png"

      await prisma.cardPriceV2.update({
        where: { cardId: card.cardId },
        data: { imageUrl }
      });
      updated++;
    } else {
      notFound++;
      if (notFound <= 10) {
        console.log(`  No image for: ${card.cardId} (looking for ${imageKey})`);
      }
    }
  }

  console.log(`\nResults:`);
  console.log(`  Updated: ${updated} cards with images`);
  console.log(`  Not found: ${notFound} cards without images`);

  // Show some samples
  const samples = await prisma.cardPriceV2.findMany({
    where: { language: 'JP', imageUrl: { not: null } },
    take: 5,
    select: { cardId: true, imageUrl: true }
  });
  console.log('\nSample cards with images:');
  samples.forEach(c => {
    console.log(`  ${c.cardId}: ${S3_BASE_URL}${c.imageUrl}`);
  });

  await prisma.$disconnect();
}

updateCardImages().catch(console.error);
