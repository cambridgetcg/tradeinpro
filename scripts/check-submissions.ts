import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkSubmissions() {
  // Get recent submissions
  const submissions = await prisma.tradeInSubmission.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      customer: true,
      _count: { select: { items: true } }
    }
  });

  console.log('\n=== Recent Submissions ===');
  for (const sub of submissions) {
    const shopifyId = sub.customer.shopifyCustomerId || 'NULL';
    console.log(`  ${sub.submissionNumber}: status=${sub.status}, customerId=${sub.customerId}`);
    console.log(`    Customer: email=${sub.customer.email}, shopifyId=${shopifyId}`);
  }

  // Get all customers
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { _count: { select: { submissions: true } } }
  });

  console.log('\n=== Recent Customers ===');
  for (const c of customers) {
    const shopifyId = c.shopifyCustomerId || 'NULL';
    console.log(`  ${c.id}: email=${c.email}, shopifyId=${shopifyId}, submissions=${c._count.submissions}`);
  }

  // Look for orphaned customers (have shopifyId but no submissions)
  const orphaned = customers.filter(c => c.shopifyCustomerId && c._count.submissions === 0);
  if (orphaned.length > 0) {
    console.log('\n=== Potential Orphaned Customers (have Shopify ID, 0 submissions) ===');
    for (const c of orphaned) {
      console.log(`  ${c.id}: email=${c.email}, shopifyId=${c.shopifyCustomerId}`);
    }
  }

  // Look for duplicate emails
  const emailGroups = await prisma.customer.groupBy({
    by: ['email'],
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } }
  });

  if (emailGroups.length > 0) {
    console.log('\n=== Duplicate Emails (multiple customer records) ===');
    for (const g of emailGroups) {
      console.log(`  ${g.email}: ${g._count.id} records`);
    }
  }

  await prisma.$disconnect();
}

checkSubmissions().catch(console.error);
