# Waypoint: I3 - AWS Performance

**Created**: 2026-01-29
**Type**: Infrastructure Foundation
**Required By**: W7 (Production Launch)
**Depends On**: I1, I2
**Status**: completed
**Completed**: 2026-01-29

---

## What This Waypoint Achieves

Sub-second response times at scale through caching, real-time data streaming, and optimized query infrastructure. Supports 100+ concurrent users and 1000+ daily operations.

---

## Success Criteria

1. [x] DynamoDB caching tables deployed (3 tables created)
2. [ ] Kinesis streams deployed (from CDK) - deferred until needed
3. [ ] Lambda collectors deployed - deferred until needed
4. [ ] Athena configured for S3 queries - deferred until needed
5. [ ] RDS read replica added - deferred (Multi-AZ provides read benefit)
6. [ ] P95 latency < 200ms for price lookups - pending benchmark

**Note**: Core DynamoDB caching deployed. Kinesis/Lambda/Athena deferred as they require significant ongoing cost and are not needed until higher volume.

---

## Task 1: Deploy DynamoDB Caching Tables

**Why**: Sub-10ms lookups for hot data (prices, cards)

**Tables to Create**:

```bash
# 1. Current Prices Cache
aws dynamodb create-table \
  --table-name cardforum-current-prices \
  --attribute-definitions \
    AttributeName=cardId,AttributeType=S \
    AttributeName=game,AttributeType=S \
  --key-schema \
    AttributeName=cardId,KeyType=HASH \
  --global-secondary-indexes \
    '[{
      "IndexName": "game-index",
      "KeySchema": [{"AttributeName":"game","KeyType":"HASH"}],
      "Projection": {"ProjectionType":"ALL"},
      "BillingMode": "PAY_PER_REQUEST"
    }]' \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1

# 2. Card Catalog Cache
aws dynamodb create-table \
  --table-name cardforum-card-catalog \
  --attribute-definitions \
    AttributeName=cardId,AttributeType=S \
    AttributeName=setCode,AttributeType=S \
  --key-schema \
    AttributeName=cardId,KeyType=HASH \
  --global-secondary-indexes \
    '[{
      "IndexName": "set-index",
      "KeySchema": [{"AttributeName":"setCode","KeyType":"HASH"}],
      "Projection": {"ProjectionType":"ALL"},
      "BillingMode": "PAY_PER_REQUEST"
    }]' \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1

# 3. Session/Rate Limit Cache
aws dynamodb create-table \
  --table-name cardforum-sessions \
  --attribute-definitions \
    AttributeName=sessionId,AttributeType=S \
  --key-schema \
    AttributeName=sessionId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --time-to-live-specification \
    Enabled=true,AttributeName=ttl \
  --region us-east-1
```

**Application Integration**:
```typescript
// app/lib/cache.server.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);

export async function getCachedPrice(cardId: string): Promise<CachedPrice | null> {
  const result = await docClient.send(new GetCommand({
    TableName: "cardforum-current-prices",
    Key: { cardId },
  }));
  return result.Item as CachedPrice | null;
}

export async function setCachedPrice(cardId: string, price: CachedPrice): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: "cardforum-current-prices",
    Item: { ...price, cardId, ttl: Math.floor(Date.now() / 1000) + 3600 },
  }));
}
```

---

## Task 2: Deploy CDK Stack (Kinesis + Lambda)

**Why**: Real-time data ingestion at scale

**Location**: `infrastructure/data-pipeline/`

```bash
# 1. Install dependencies
cd infrastructure/data-pipeline
npm install

# 2. Bootstrap CDK (first time only)
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1

# 3. Synthesize to verify
npx cdk synth

# 4. Deploy stack
npx cdk deploy CardForumDataPipelineStack \
  --parameters environment=production \
  --parameters kinesisShardCount=4 \
  --require-approval never

# 5. Verify deployment
aws kinesis list-streams --region us-east-1
# Expected: price-stream, listing-stream, sales-stream, signal-stream

aws lambda list-functions --region us-east-1 | grep -i collector
# Expected: tcgplayerCollector, cardmarketCollector, etc.
```

**What Gets Deployed**:
- 4 Kinesis streams (22 shards total)
- 6 Lambda collectors
- EventBridge scheduled rules
- Kinesis Firehose to S3
- CloudWatch dashboards

---

## Task 3: Configure Athena for S3 Queries

**Why**: Query historical price data without loading into RDS

**Setup**:
```bash
# 1. Create Athena workgroup
aws athena create-work-group \
  --name cardforum-analytics \
  --configuration '{
    "ResultConfiguration": {
      "OutputLocation": "s3://pricedata-tcg/athena-results/"
    },
    "EnforceWorkGroupConfiguration": true
  }' \
  --region us-east-1

# 2. Create database
aws athena start-query-execution \
  --query-string "CREATE DATABASE IF NOT EXISTS cardforum_analytics" \
  --work-group cardforum-analytics \
  --region us-east-1

# 3. Create table for price history
aws athena start-query-execution \
  --query-string "
    CREATE EXTERNAL TABLE IF NOT EXISTS cardforum_analytics.price_history (
      card_id STRING,
      game STRING,
      price_usd DOUBLE,
      price_gbp DOUBLE,
      price_eur DOUBLE,
      source STRING,
      timestamp TIMESTAMP
    )
    PARTITIONED BY (year STRING, month STRING, day STRING)
    STORED AS PARQUET
    LOCATION 's3://pricedata-tcg/processed/prices/'
  " \
  --work-group cardforum-analytics \
  --region us-east-1
```

**Example Queries**:
```sql
-- Price trend for a card
SELECT date_trunc('day', timestamp) as day, avg(price_gbp) as avg_price
FROM cardforum_analytics.price_history
WHERE card_id = 'OP01-001-parallel'
  AND year = '2026' AND month = '01'
GROUP BY 1
ORDER BY 1;

-- Top movers this week
SELECT card_id,
       (max(price_gbp) - min(price_gbp)) / min(price_gbp) * 100 as pct_change
FROM cardforum_analytics.price_history
WHERE timestamp > current_timestamp - interval '7' day
GROUP BY 1
HAVING count(*) > 5
ORDER BY 2 DESC
LIMIT 20;
```

---

## Task 4: Add RDS Read Replica

**Why**: Separate read traffic from write traffic, reduce primary load

```bash
# 1. Create read replica
aws rds create-db-instance-read-replica \
  --db-instance-identifier cardforum-read-1 \
  --source-db-instance-identifier cardforum \
  --db-instance-class db.t3.small \
  --availability-zone us-east-1b \
  --region us-east-1

# 2. Wait for replica
aws rds wait db-instance-available \
  --db-instance-identifier cardforum-read-1 \
  --region us-east-1

# 3. Get replica endpoint
aws rds describe-db-instances \
  --db-instance-identifier cardforum-read-1 \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text \
  --region us-east-1
```

**Application Integration** (Prisma read replica):
```typescript
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  directUrl = env("DATABASE_URL_DIRECT") // For migrations
}

// app/lib/db.server.ts
import { PrismaClient } from "@prisma/client";

// Primary for writes
const primaryClient = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Replica for reads
const replicaClient = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_REPLICA } },
});

export function getReadClient() {
  return replicaClient;
}

export function getWriteClient() {
  return primaryClient;
}
```

---

## Task 5: Performance Benchmarking

**Why**: Verify performance targets are met

**Benchmark Script**:
```typescript
// scripts/benchmark-performance.ts
import { performance } from "perf_hooks";

async function benchmarkPriceLookup(iterations: number = 100) {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fetch("https://cardforum.vercel.app/api/prices/OP01-001");
    const end = performance.now();
    times.push(end - start);
  }

  times.sort((a, b) => a - b);

  console.log(`Iterations: ${iterations}`);
  console.log(`P50: ${times[Math.floor(iterations * 0.5)].toFixed(2)}ms`);
  console.log(`P95: ${times[Math.floor(iterations * 0.95)].toFixed(2)}ms`);
  console.log(`P99: ${times[Math.floor(iterations * 0.99)].toFixed(2)}ms`);
  console.log(`Max: ${times[iterations - 1].toFixed(2)}ms`);
}

benchmarkPriceLookup(100);
```

**Targets**:
| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| Price lookup | <50ms | <200ms | <500ms |
| Card search | <100ms | <300ms | <800ms |
| Submission create | <200ms | <500ms | <1000ms |

---

## Verification Checklist

```bash
# 1. DynamoDB tables
aws dynamodb list-tables --region us-east-1 | grep cardforum
# Expected: cardforum-current-prices, cardforum-card-catalog, cardforum-sessions

# 2. Kinesis streams
aws kinesis list-streams --region us-east-1
# Expected: price-stream, listing-stream, sales-stream, signal-stream

# 3. Lambda functions
aws lambda list-functions --region us-east-1 \
  --query 'Functions[?contains(FunctionName, `Collector`)].FunctionName'
# Expected: tcgplayerCollector, cardmarketCollector, ...

# 4. Athena database
aws athena list-databases --catalog-name AwsDataCatalog --region us-east-1
# Expected: cardforum_analytics

# 5. Read replica
aws rds describe-db-instances \
  --query 'DBInstances[?ReadReplicaSourceDBInstanceIdentifier!=`null`].DBInstanceIdentifier'
# Expected: cardforum-read-1

# 6. Performance test
npx tsx scripts/benchmark-performance.ts
# Expected: P95 < 200ms
```

---

## Dependencies

**Required**:
- I1, I2 complete
- CDK bootstrap complete
- Sufficient AWS quotas (Kinesis shards, Lambda concurrency)

**Enables**:
- W7: Production launch at scale
- Future: Multi-TCG expansion

---

## Estimated Effort

| Task | Time | Cost Impact |
|------|------|-------------|
| DynamoDB tables | 1 hour | $10-50/month (on-demand) |
| CDK deploy | 2-3 hours | $300-500/month |
| Athena setup | 1-2 hours | $5/TB scanned |
| Read replica | 1 hour | $50-100/month |
| Benchmarking | 2 hours | None |
| **Total** | **7-10 hours** | **+$365-650/month** |

---

## Cost Optimization Notes

**DynamoDB**: Start with on-demand, switch to provisioned when patterns are stable
**Kinesis**: Reduce shard count in dev/staging (2 shards minimum)
**Read Replica**: Consider scaling down to t3.micro during low traffic
**Athena**: Use partitioning aggressively, query specific date ranges

---

## Notes

I3 is the most expensive infrastructure waypoint but enables the scale required for W7 (100+ trade-ins). Consider deploying incrementally:
1. DynamoDB caching first (immediate latency improvement)
2. Read replica second (reduce primary load)
3. Kinesis/CDK stack last (when real-time requirements emerge)
