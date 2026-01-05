import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  // Get the most recent submission
  const latest = await prisma.tradeInSubmission.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { customer: true, items: { take: 3 } }
  });

  if (!latest) {
    console.log('No submissions found');
    return;
  }

  console.log('=== Most Recent Submission ===');
  console.log('Number:', latest.submissionNumber);
  console.log('Status:', latest.status);
  console.log('Created:', latest.createdAt.toISOString());
  console.log('Customer ID:', latest.customerId);
  console.log('Customer Email:', latest.customer.email);
  console.log('Customer Shopify ID:', latest.customer.shopifyCustomerId || 'NULL');
  console.log('Items:', latest.items.length);
  latest.items.forEach((item, i) => {
    console.log(`  ${i+1}. ${item.cardName}`);
  });

  await prisma.$disconnect();
}

check().catch(console.error);
