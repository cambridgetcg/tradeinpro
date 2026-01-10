# AWS CardMarket Price Pipeline Architecture

> **Production Architecture** - Daily price extraction using Bright Data on AWS
>
> **Date**: 2026-01-10
> **Status**: Planning

---

## Executive Summary

Design for automated daily CardMarket price archiving using:
- **Bright Data Web Unlocker** for Cloudflare bypass
- **AWS ECS Fargate** for long-running scraper execution
- **AWS EventBridge** for daily scheduling
- **AWS Secrets Manager** for credential management
- **AWS RDS PostgreSQL** for price storage (existing)
- **AWS CloudWatch** for monitoring and alerting

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AWS CARDMARKET PRICE PIPELINE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │  EventBridge │───▶│     ECS      │───▶│   Bright     │                   │
│  │  (Schedule)  │    │   Fargate    │    │    Data      │                   │
│  │  Daily 2 AM  │    │  (Scraper)   │    │    API       │                   │
│  └──────────────┘    └──────┬───────┘    └──────────────┘                   │
│                             │                    │                           │
│                             │                    ▼                           │
│                             │           ┌──────────────┐                    │
│                             │           │  CardMarket  │                    │
│                             │           │  (Target)    │                    │
│                             │           └──────────────┘                    │
│                             │                                                │
│         ┌───────────────────┼───────────────────┐                           │
│         │                   │                   │                           │
│         ▼                   ▼                   ▼                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   Secrets    │    │     RDS      │    │  CloudWatch  │                   │
│  │   Manager    │    │  PostgreSQL  │    │   Logs &     │                   │
│  │  (API Keys)  │    │  (Storage)   │    │   Alarms     │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│                             │                   │                           │
│                             ▼                   ▼                           │
│                      ┌──────────────┐    ┌──────────────┐                   │
│                      │   CardForum  │    │     SNS      │                   │
│                      │     App      │    │   (Alerts)   │                   │
│                      └──────────────┘    └──────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Details

### 2.1 ECS Fargate (Scraper Execution)

**Why Fargate over Lambda:**
| Factor | Lambda | Fargate |
|--------|--------|---------|
| Max runtime | 15 minutes | Unlimited |
| Our runtime | ~5.4 hours | ✅ Supported |
| Cost model | Per invocation | Per second |
| Cold start | ~1s | ~30s |
| Memory | Up to 10GB | Up to 30GB |

**Configuration:**
```yaml
Task Definition:
  CPU: 512 (0.5 vCPU)
  Memory: 1024 MB
  Container:
    Image: cardmarket-scraper:latest
    Environment:
      - DATABASE_URL: from Secrets Manager
      - BRIGHTDATA_TOKEN: from Secrets Manager
    Logging: CloudWatch Logs
```

**Estimated Runtime:**
```
Cards: ~1,500 (OP01-OP13 + extras)
Time per card: ~13 seconds (Bright Data)
Total: ~5.4 hours
Buffer: 7 hours max
```

### 2.2 EventBridge Scheduler

**Schedule:** Daily at 2:00 AM UTC (low traffic)

```yaml
Rule:
  Name: cardmarket-daily-archive
  ScheduleExpression: cron(0 2 * * ? *)
  Target: ECS RunTask
  Input:
    sets: "all"
    mode: "production"
```

**Why 2 AM UTC:**
- CardMarket traffic lowest
- Before European business hours
- Allows time for retries before morning

### 2.3 Secrets Manager

**Secrets to Store:**
```yaml
cardmarket-scraper/brightdata:
  API_TOKEN: "***REMOVED-ROTATE-ME***"

cardmarket-scraper/database:
  DATABASE_URL: "postgresql://..."
```

**Rotation:** Manual (Bright Data tokens don't auto-rotate)

### 2.4 RDS PostgreSQL (Existing)

**Instance:** `cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com`

**Tables Used:**
- `cardmarket_price_archive` - Daily aggregate prices
- `cardmarket_condition_snapshot` - Condition-level breakdown
- `cardmarket_listing_snapshot` - Individual seller listings

**Connection:** Via VPC private subnet

### 2.5 CloudWatch Monitoring

**Logs:**
```yaml
Log Group: /ecs/cardmarket-scraper
Retention: 30 days
```

**Metrics:**
- Cards scraped per run
- Error count
- Duration
- API calls to Bright Data

**Alarms:**
```yaml
- Name: ScraperFailed
  Metric: ECS Task Exit Code != 0
  Action: SNS notification

- Name: ScraperTimeout
  Metric: Task duration > 7 hours
  Action: SNS notification

- Name: HighErrorRate
  Metric: Error count > 50
  Action: SNS notification
```

---

## 3. Data Flow

### 3.1 Daily Archive Process

```
1. EventBridge triggers at 2:00 AM UTC
           │
           ▼
2. ECS Fargate task starts
   - Pulls secrets from Secrets Manager
   - Connects to RDS
           │
           ▼
3. For each set (OP01-OP13, EB01-EB02):
   a. Fetch expansion page via Bright Data
   b. Parse card URLs
   c. For each card:
      - Fetch card page via Bright Data
      - Parse prices, conditions, listings
      - Upsert to RDS
   d. Log progress to CloudWatch
           │
           ▼
4. Task completes
   - Success: Log summary, exit 0
   - Failure: Log error, exit 1, trigger alarm
           │
           ▼
5. CloudWatch metrics updated
   - Alarms evaluated
   - SNS notifications if needed
```

### 3.2 Data Volume Estimates

| Table | Records/Day | Growth/Month |
|-------|-------------|--------------|
| cardmarket_price_archive | ~1,500 | ~45,000 |
| cardmarket_condition_snapshot | ~5,000 | ~150,000 |
| cardmarket_listing_snapshot | ~75,000 | ~2.25M |

**Storage Growth:** ~500MB/month

---

## 4. Cost Analysis

### 4.1 AWS Costs (Monthly)

| Service | Usage | Cost |
|---------|-------|------|
| ECS Fargate | 5.4h × 30 days × 0.5vCPU | ~$15 |
| Secrets Manager | 2 secrets | ~$1 |
| CloudWatch Logs | 1GB | ~$0.50 |
| EventBridge | 30 invocations | ~$0 |
| Data Transfer | Minimal | ~$1 |
| **Total AWS** | | **~$18/month** |

### 4.2 Bright Data Costs (Monthly)

| Tier | Requests | Cost |
|------|----------|------|
| Free | 5,000 | $0 |
| Pay-As-You-Go | 45,000 | ~$67 |
| Growth Plan | 45,000 | ~$40 (better rate) |

### 4.3 Total Monthly Cost

| Scenario | Cost |
|----------|------|
| Free tier (testing) | ~$18 |
| Pay-As-You-Go | ~$85 |
| Growth Plan | ~$58 |

---

## 5. Security

### 5.1 Network Architecture

```
┌─────────────────────────────────────────┐
│              VPC (10.0.0.0/16)          │
├─────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────┐  │
│  │  Private Subnet │  │ Private Subnet│  │
│  │   (10.0.1.0/24) │  │ (10.0.2.0/24) │  │
│  │                 │  │               │  │
│  │   ┌─────────┐   │  │  ┌────────┐  │  │
│  │   │   ECS   │   │  │  │  RDS   │  │  │
│  │   │ Fargate │───┼──┼──│Primary │  │  │
│  │   └─────────┘   │  │  └────────┘  │  │
│  │        │        │  │               │  │
│  └────────┼────────┘  └──────────────┘  │
│           │                             │
│           ▼                             │
│  ┌─────────────────┐                    │
│  │   NAT Gateway   │                    │
│  │  (Outbound to   │                    │
│  │   Bright Data)  │                    │
│  └─────────────────┘                    │
└─────────────────────────────────────────┘
```

### 5.2 IAM Roles

**ECS Task Role:**
```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:cardmarket-scraper/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/ecs/cardmarket-scraper:*"
    }
  ]
}
```

**ECS Execution Role:**
```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 6. Resilience & Error Handling

### 6.1 Retry Strategy

```typescript
// Application-level retry
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

async function fetchWithRetry(url: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchWithBrightData(url);
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error;
      console.log(`Retry ${attempt}/${MAX_RETRIES} for ${url}`);
      await sleep(RETRY_DELAY * attempt);
    }
  }
}
```

### 6.2 Checkpoint & Resume

```typescript
// Save progress to allow resume on failure
interface ScrapeCheckpoint {
  date: string;
  lastSetCode: string;
  lastCardIndex: number;
  completedSets: string[];
}

// Store in DynamoDB or S3 for cross-run persistence
```

### 6.3 Dead Letter Handling

Failed cards are logged but don't stop the pipeline:
```typescript
const failedCards: string[] = [];

for (const cardUrl of cardUrls) {
  try {
    await scrapeCard(cardUrl);
  } catch (error) {
    failedCards.push(cardUrl);
    console.error(`Failed: ${cardUrl}`, error);
    // Continue with next card
  }
}

// Report failures at end
if (failedCards.length > 0) {
  console.warn(`Failed cards: ${failedCards.length}`);
  // Could trigger partial retry
}
```

---

## 7. Deployment Strategy

### 7.1 Infrastructure as Code

**Option A: AWS CDK (Recommended)**
```typescript
// infrastructure/cardmarket-pipeline-stack.ts
const cluster = new ecs.Cluster(this, 'CardMarketCluster', { vpc });

const taskDefinition = new ecs.FargateTaskDefinition(this, 'ScraperTask', {
  memoryLimitMiB: 1024,
  cpu: 512,
});

taskDefinition.addContainer('scraper', {
  image: ecs.ContainerImage.fromEcrRepository(repo),
  logging: new ecs.AwsLogDriver({ streamPrefix: 'scraper' }),
  secrets: {
    BRIGHTDATA_TOKEN: ecs.Secret.fromSecretsManager(brightdataSecret),
    DATABASE_URL: ecs.Secret.fromSecretsManager(dbSecret),
  },
});

new events.Rule(this, 'DailySchedule', {
  schedule: events.Schedule.cron({ hour: '2', minute: '0' }),
  targets: [new targets.EcsTask({ cluster, taskDefinition })],
});
```

**Option B: CloudFormation**
```yaml
# infrastructure/cardmarket-pipeline.yaml
Resources:
  ScraperTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      Family: cardmarket-scraper
      Cpu: 512
      Memory: 1024
      # ...
```

### 7.2 CI/CD Pipeline

```yaml
# .github/workflows/deploy-scraper.yml
name: Deploy CardMarket Scraper

on:
  push:
    branches: [main]
    paths:
      - 'infrastructure/data-pipeline/scraper-dev/cardmarket/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build Docker image
        run: docker build -t cardmarket-scraper .

      - name: Push to ECR
        run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REPO
          docker tag cardmarket-scraper:latest $ECR_REPO:latest
          docker push $ECR_REPO:latest

      - name: Update ECS service
        run: aws ecs update-service --cluster cardmarket --service scraper --force-new-deployment
```

---

## 8. Monitoring Dashboard

### CloudWatch Dashboard Widgets

```yaml
Dashboard: CardMarket-Scraper

Widgets:
  - Title: "Daily Scrape Status"
    Type: Number
    Metrics:
      - TaskSuccessCount
      - TaskFailureCount

  - Title: "Cards Scraped"
    Type: Graph
    Metrics:
      - CardsScrapedPerRun

  - Title: "Duration Trend"
    Type: Graph
    Metrics:
      - TaskDurationSeconds

  - Title: "Error Rate"
    Type: Graph
    Metrics:
      - ErrorCount / TotalRequests

  - Title: "Bright Data Usage"
    Type: Number
    Metrics:
      - APIRequestCount
```

---

## 9. Implementation Phases

### Phase 1: Local Production Ready (Current)
- [x] Bright Data scraper working
- [x] Database schema deployed
- [x] Daily archive script tested
- [ ] Add retry logic
- [ ] Add progress checkpointing

### Phase 2: AWS Infrastructure
- [ ] Create ECR repository
- [ ] Build Docker image
- [ ] Create Secrets Manager secrets
- [ ] Deploy ECS task definition
- [ ] Configure VPC/subnets

### Phase 3: Automation
- [ ] Create EventBridge rule
- [ ] Set up CloudWatch alarms
- [ ] Configure SNS notifications
- [ ] Create monitoring dashboard

### Phase 4: Production Hardening
- [ ] Load testing
- [ ] Failure recovery testing
- [ ] Cost optimization
- [ ] Documentation

---

## 10. Quick Reference

### Run Manually (AWS CLI)
```bash
aws ecs run-task \
  --cluster cardmarket-cluster \
  --task-definition cardmarket-scraper \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx]}"
```

### Check Status
```bash
aws ecs describe-tasks \
  --cluster cardmarket-cluster \
  --tasks <task-arn>
```

### View Logs
```bash
aws logs tail /ecs/cardmarket-scraper --follow
```

### Force Stop
```bash
aws ecs stop-task \
  --cluster cardmarket-cluster \
  --task <task-arn>
```

---

*"Automation is the bridge between manual success and scalable excellence."*
