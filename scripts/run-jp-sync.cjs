const { PrismaClient } = require('@prisma/client');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const XLSX = require('xlsx');

const prisma = new PrismaClient();

// Condition multiplier for NM
const NM_MULTIPLIER = 0.70;

function poundsToPence(pounds) {
  return Math.round(pounds * 100);
}

function extractCardNumberFromSku(sku) {
  const match = sku.match(/^[A-Z]+-([A-Z0-9]+-\d+)/i);
  return match ? match[1].toUpperCase() : undefined;
}

function extractSetCodeFromSku(sku) {
  const cardNum = extractCardNumberFromSku(sku);
  if (cardNum) {
    const parts = cardNum.split('-');
    return parts[0];
  }
  return undefined;
}

function extractCardNumFromSku(sku) {
  const cardNum = extractCardNumberFromSku(sku);
  if (cardNum) {
    const parts = cardNum.split('-');
    return parts.length > 1 ? parts[1] : undefined;
  }
  return undefined;
}

async function runSync() {
  console.log('Starting S3 sync...');

  // Download from S3
  const s3 = new S3Client({ region: 'us-east-1' });
  const command = new GetObjectCommand({
    Bucket: 'pricedata-tcg',
    Key: 'pricefeed/onepiece_pricefeed.xlsx'
  });

  const response = await s3.send(command);
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  console.log('Downloaded', buffer.length, 'bytes from S3');

  // Parse Excel
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log('Parsed', data.length, 'rows');

  // Find date column
  const columns = Object.keys(data[0] || {});
  const dateColumns = columns.filter(col => /^\d{4}-\d{2}-\d{2}/.test(col));
  const latestDateCol = dateColumns.sort().pop();
  console.log('Using JPY price column:', latestDateCol);

  let created = 0, updated = 0, skipped = 0;

  for (const row of data) {
    const sku = String(row['sku'] || '').trim();
    if (!sku) continue;

    const jpyPrice = latestDateCol ? Number(row[latestDateCol]) : undefined;
    const gbpPrice = row['selling_price'] ? Number(row['selling_price']) : undefined;

    if (!jpyPrice && !gbpPrice) {
      skipped++;
      continue;
    }

    const priceGbpPence = gbpPrice ? poundsToPence(gbpPrice) : (jpyPrice ? Math.round(jpyPrice * 0.0053 * 100) : 0);
    const tradeinPriceGbp = Math.floor(priceGbpPence * NM_MULTIPLIER);

    const cardNumber = extractCardNumberFromSku(sku);
    const setCode = extractSetCodeFromSku(sku);
    const cardNum = extractCardNumFromSku(sku);

    // Upsert to JapanesePriceSource
    const existing = await prisma.japanesePriceSource.findUnique({ where: { sku } });

    if (existing) {
      await prisma.japanesePriceSource.update({
        where: { sku },
        data: {
          name: cardNumber || sku,
          setCode,
          cardNumber: cardNum,
          priceJpy: jpyPrice ? Math.round(jpyPrice) : null,
          priceGbp: priceGbpPence,
          tradeinPriceGbp,
          source: 's3_import',
          syncedToCardPrice: false,
          updatedAt: new Date()
        }
      });
      updated++;
    } else {
      await prisma.japanesePriceSource.create({
        data: {
          sku,
          name: cardNumber || sku,
          setCode,
          cardNumber: cardNum,
          priceJpy: jpyPrice ? Math.round(jpyPrice) : null,
          priceGbp: priceGbpPence,
          tradeinPriceGbp,
          source: 's3_import',
          syncedToCardPrice: false
        }
      });
      created++;
    }
  }

  console.log('Import complete:', { created, updated, skipped });

  // Now sync to CardPriceV2
  console.log('Syncing to CardPriceV2...');

  const jpPrices = await prisma.japanesePriceSource.findMany({
    where: { priceGbp: { not: null } }
  });

  let syncCreated = 0, syncUpdated = 0;

  for (const jpPrice of jpPrices) {
    const cardId = 'JP-' + jpPrice.sku.toUpperCase();
    const tradeinPriceGbp = Math.floor(jpPrice.priceGbp * NM_MULTIPLIER);

    const existingCard = await prisma.cardPriceV2.findUnique({ where: { cardId } });

    const cardData = {
      name: jpPrice.name,
      game: 'onepiece',
      language: 'JP',
      releaseSet: jpPrice.setCode,
      setCode: jpPrice.setCode,
      cardNumber: jpPrice.cardNumber,
      bestPriceGbp: jpPrice.priceGbp / 100,
      tradeinPriceGbp: tradeinPriceGbp / 100,
      lastUpdated: new Date()
    };

    if (existingCard) {
      await prisma.cardPriceV2.update({
        where: { cardId },
        data: cardData
      });
      syncUpdated++;
    } else {
      await prisma.cardPriceV2.create({
        data: { cardId, ...cardData }
      });
      syncCreated++;
    }

    await prisma.japanesePriceSource.update({
      where: { id: jpPrice.id },
      data: { syncedToCardPrice: true, cardPriceV2Id: cardId }
    });
  }

  console.log('Sync complete:', { syncCreated, syncUpdated });

  // Final count
  const finalCount = await prisma.cardPriceV2.count({ where: { language: 'JP' } });
  console.log('Total JP cards in trade-in database:', finalCount);

  // Show some samples
  const samples = await prisma.cardPriceV2.findMany({
    where: { language: 'JP' },
    take: 3,
    orderBy: { tradeinPriceGbp: 'desc' }
  });
  console.log('\nTop 3 JP cards by trade-in value:');
  samples.forEach(card => {
    console.log(`  ${card.cardId}: £${card.tradeinPriceGbp?.toFixed(2)} trade-in (market £${card.bestPriceGbp?.toFixed(2)})`);
  });

  await prisma.$disconnect();
}

runSync().catch(console.error);
