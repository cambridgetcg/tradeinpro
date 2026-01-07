/**
 * Partition Manager for card_price_history
 *
 * This utility manages partitions for the card_price_history table.
 * Run monthly to create future partitions and optionally archive old ones.
 *
 * Usage:
 *   npx tsx scripts/migrations/partition-manager.ts create-future
 *   npx tsx scripts/migrations/partition-manager.ts check-status
 *   npx tsx scripts/migrations/partition-manager.ts archive --before 2025-01-01
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // How many months ahead to create partitions
  futureMonths: 3,

  // Minimum months to retain before archiving
  retentionMonths: 12,

  // Table names
  baseTable: "card_price_history",
  partitionPrefix: "card_price_history_",
};

// ============================================================================
// Utility Functions
// ============================================================================

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getPartitionName(year: number, month: number): string {
  const monthStr = month.toString().padStart(2, "0");
  return `${CONFIG.partitionPrefix}${year}_${monthStr}`;
}

function getNextMonth(date: Date): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
}

// ============================================================================
// Check if table is partitioned
// ============================================================================

async function isTablePartitioned(): Promise<boolean> {
  const result = await prisma.$queryRaw<[{ relkind: string }]>`
    SELECT relkind
    FROM pg_class
    WHERE relname = ${CONFIG.baseTable}
  `;

  // 'p' = partitioned table, 'r' = regular table
  return result[0]?.relkind === "p";
}

// ============================================================================
// Get existing partitions
// ============================================================================

interface PartitionInfo {
  name: string;
  size: string;
  rows: number;
  minDate: Date | null;
  maxDate: Date | null;
}

async function getExistingPartitions(): Promise<PartitionInfo[]> {
  const partitions = await prisma.$queryRaw<PartitionInfo[]>`
    SELECT
      c.relname as name,
      pg_size_pretty(pg_relation_size(c.oid)) as size,
      COALESCE(s.n_live_tup, 0)::int as rows,
      (SELECT MIN(snapshot_date) FROM card_price_history WHERE tableoid = c.oid) as "minDate",
      (SELECT MAX(snapshot_date) FROM card_price_history WHERE tableoid = c.oid) as "maxDate"
    FROM pg_class c
    JOIN pg_inherits i ON c.oid = i.inhrelid
    JOIN pg_class parent ON i.inhparent = parent.oid
    LEFT JOIN pg_stat_user_tables s ON c.relname = s.relname
    WHERE parent.relname = ${CONFIG.baseTable}
    ORDER BY c.relname
  `;

  return partitions;
}

// ============================================================================
// Create future partitions
// ============================================================================

async function createFuturePartitions(): Promise<string[]> {
  const isPartitioned = await isTablePartitioned();
  if (!isPartitioned) {
    console.log("Table is not partitioned. Run partition migration first.");
    return [];
  }

  const existingPartitions = await getExistingPartitions();
  const existingNames = new Set(existingPartitions.map((p) => p.name));

  const created: string[] = [];
  const now = new Date();

  for (let i = 0; i <= CONFIG.futureMonths; i++) {
    const targetDate = new Date(now);
    targetDate.setMonth(targetDate.getMonth() + i);

    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const partitionName = getPartitionName(year, month);

    if (!existingNames.has(partitionName)) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = getNextMonth(startDate);

      try {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE ${partitionName} PARTITION OF ${CONFIG.baseTable}
          FOR VALUES FROM ('${formatDate(startDate)}') TO ('${formatDate(endDate)}')
        `);
        console.log(`Created partition: ${partitionName}`);
        created.push(partitionName);
      } catch (error: any) {
        if (error.message.includes("already exists")) {
          console.log(`Partition already exists: ${partitionName}`);
        } else {
          throw error;
        }
      }
    } else {
      console.log(`Partition exists: ${partitionName}`);
    }
  }

  return created;
}

// ============================================================================
// Check partition status
// ============================================================================

async function checkStatus(): Promise<void> {
  const isPartitioned = await isTablePartitioned();

  console.log("═".repeat(70));
  console.log("  PARTITION STATUS REPORT");
  console.log("═".repeat(70));

  if (!isPartitioned) {
    console.log("\n⚠️  Table is NOT partitioned");
    console.log("   Run the partition migration when table exceeds 500 MB");

    // Show current table size
    const size = await prisma.$queryRaw<[{ size: string; rows: bigint }]>`
      SELECT
        pg_size_pretty(pg_total_relation_size('card_price_history')) as size,
        (SELECT count(*) FROM card_price_history) as rows
    `;
    console.log(`\n   Current size: ${size[0].size}`);
    console.log(`   Current rows: ${Number(size[0].rows).toLocaleString()}`);
    return;
  }

  console.log("\n✅ Table is partitioned\n");

  const partitions = await getExistingPartitions();

  console.log("┌─────────────────────────────────┬──────────┬──────────────┐");
  console.log("│ Partition                       │ Size     │ Rows         │");
  console.log("├─────────────────────────────────┼──────────┼──────────────┤");

  let totalRows = 0;
  for (const p of partitions) {
    totalRows += p.rows;
    console.log(
      `│ ${p.name.padEnd(31)} │ ${p.size.padStart(8)} │ ${p.rows.toLocaleString().padStart(12)} │`
    );
  }

  console.log("├─────────────────────────────────┼──────────┼──────────────┤");
  console.log(
    `│ TOTAL                           │          │ ${totalRows.toLocaleString().padStart(12)} │`
  );
  console.log("└─────────────────────────────────┴──────────┴──────────────┘");

  // Check for missing future partitions
  console.log("\nFuture Partition Check:");
  const now = new Date();
  for (let i = 0; i <= CONFIG.futureMonths; i++) {
    const targetDate = new Date(now);
    targetDate.setMonth(targetDate.getMonth() + i);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const partitionName = getPartitionName(year, month);

    const exists = partitions.some((p) => p.name === partitionName);
    const status = exists ? "✅" : "⚠️  MISSING";
    console.log(`  ${partitionName}: ${status}`);
  }
}

// ============================================================================
// Archive old partitions
// ============================================================================

async function archivePartitions(beforeDate: string): Promise<string[]> {
  const isPartitioned = await isTablePartitioned();
  if (!isPartitioned) {
    console.log("Table is not partitioned. Nothing to archive.");
    return [];
  }

  const cutoff = new Date(beforeDate);
  const partitions = await getExistingPartitions();
  const archived: string[] = [];

  console.log(`Archiving partitions with data before ${formatDate(cutoff)}...\n`);

  for (const partition of partitions) {
    if (partition.name === `${CONFIG.partitionPrefix}default`) {
      continue; // Never archive default partition
    }

    if (partition.maxDate && partition.maxDate < cutoff) {
      console.log(`Archiving: ${partition.name} (max date: ${formatDate(partition.maxDate)})`);

      // Option 1: Detach partition (keeps data, removes from table)
      // await prisma.$executeRawUnsafe(`
      //   ALTER TABLE ${CONFIG.baseTable} DETACH PARTITION ${partition.name}
      // `);

      // Option 2: Drop partition (deletes data)
      // await prisma.$executeRawUnsafe(`DROP TABLE ${partition.name}`);

      // For safety, just log what would be done
      console.log(`  → Would detach/drop: ${partition.name}`);
      archived.push(partition.name);
    }
  }

  if (archived.length === 0) {
    console.log("No partitions eligible for archiving.");
  } else {
    console.log(`\n${archived.length} partition(s) would be archived.`);
    console.log("Uncomment the DROP/DETACH statements in the script to actually archive.");
  }

  return archived;
}

// ============================================================================
// Main CLI
// ============================================================================

async function main() {
  const command = process.argv[2];

  try {
    switch (command) {
      case "create-future":
        console.log("Creating future partitions...\n");
        const created = await createFuturePartitions();
        console.log(`\nCreated ${created.length} new partition(s).`);
        break;

      case "check-status":
        await checkStatus();
        break;

      case "archive":
        const beforeIndex = process.argv.indexOf("--before");
        if (beforeIndex === -1 || !process.argv[beforeIndex + 1]) {
          console.log("Usage: partition-manager.ts archive --before YYYY-MM-DD");
          process.exit(1);
        }
        await archivePartitions(process.argv[beforeIndex + 1]);
        break;

      default:
        console.log("Partition Manager for card_price_history\n");
        console.log("Commands:");
        console.log("  create-future  Create partitions for upcoming months");
        console.log("  check-status   Show current partition status");
        console.log("  archive        Archive old partitions\n");
        console.log("Examples:");
        console.log("  npx tsx scripts/migrations/partition-manager.ts create-future");
        console.log("  npx tsx scripts/migrations/partition-manager.ts check-status");
        console.log("  npx tsx scripts/migrations/partition-manager.ts archive --before 2025-01-01");
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
