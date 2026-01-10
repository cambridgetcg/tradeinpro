# CardMarket Pipeline - Production Deployment Guide

> **Version**: 1.0.0
> **Last Updated**: 2026-01-09

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development Setup](#local-development-setup)
3. [AWS Infrastructure Deployment](#aws-infrastructure-deployment)
4. [Configuration](#configuration)
5. [Deployment Steps](#deployment-steps)
6. [Verification](#verification)
7. [Operations](#operations)
8. [Troubleshooting](#troubleshooting)
9. [Cost Monitoring](#cost-monitoring)

---

## Prerequisites

### Required Tools

```bash
# Node.js 20.x or higher
node --version  # Should be >= 20.0.0

# AWS CLI v2
aws --version   # Should be >= 2.0.0

# AWS SAM CLI
sam --version   # Should be >= 1.100.0

# Docker (for building Lambda layers)
docker --version

# Playwright browsers (for local testing)
npx playwright install chromium
```

### AWS Account Requirements

- AWS Account with admin access
- VPC with private subnets (for Lambda/RDS)
- RDS PostgreSQL instance (existing or new)
- Secrets Manager secret for database credentials

### Proxy Service Account

Choose one residential proxy provider:
- **Bright Data**: Create account at https://brightdata.com
- **SmartProxy**: Create account at https://smartproxy.com
- **Oxylabs**: Create account at https://oxylabs.io

---

## Local Development Setup

### 1. Clone and Install

```bash
cd /path/to/cardforum/infrastructure/data-pipeline/scraper-dev/cardmarket

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate
```

### 2. Environment Configuration

Create `.env` file:

```bash
# Core
NODE_ENV=development
AWS_REGION=us-east-1

# Database (use local or remote)
DATABASE_URL=postgresql://user:password@localhost:5432/cardmarket_dev

# Proxy Configuration (choose one)
BRIGHT_DATA_CUSTOMER=your_customer_id
BRIGHT_DATA_PASSWORD=your_password

# OR
SMARTPROXY_USER=your_username
SMARTPROXY_PASSWORD=your_password

# S3 (optional for local)
S3_BUCKET=cardmarket-scraper-dev
USE_LOCAL_STORAGE=true
LOCAL_STORAGE_PATH=./data

# Request Settings
REQUEST_DELAY_MS=3000
REQUEST_TIMEOUT_MS=30000
MAX_CONCURRENCY=1

# Optional
DEBUG=cardmarket:*
```

### 3. Test Local Scraping

```bash
# Run test scrape (single set, limited cards)
npm run scrape:test

# Or with custom options
npx tsx src/cli/runner.ts OP01 --max-cards 10 --max-pages 1 --verbose --dry-run
```

### 4. Run Tests

```bash
# All tests
npm test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

---

## AWS Infrastructure Deployment

### 1. Create Database Secret

```bash
# Create Secrets Manager secret for database credentials
aws secretsmanager create-secret \
  --name cardmarket-scraper/database \
  --description "CardMarket scraper database credentials" \
  --secret-string '{
    "host": "your-rds-host.rds.amazonaws.com",
    "port": 5432,
    "username": "cardmarket",
    "password": "your-secure-password",
    "database": "cardmarket"
  }'
```

Note the ARN returned - you'll need it for deployment.

### 2. Build Playwright Lambda Layer

```bash
# Create layer directory
mkdir -p layers/playwright-chromium

# Build layer using Docker
docker run --rm -v $(pwd)/layers:/layers \
  public.ecr.aws/lambda/nodejs:20 \
  bash -c "
    npm install playwright-core@1.40.0 --prefix /layers/playwright-chromium/nodejs
    npx playwright install chromium --with-deps
  "

# Package layer
cd layers/playwright-chromium
zip -r ../playwright-chromium.zip .
cd ../..

# Upload to S3 (create bucket first if needed)
aws s3 cp layers/playwright-chromium.zip \
  s3://cardmarket-scraper-production-${AWS_ACCOUNT_ID}/layers/playwright-chromium.zip
```

### 3. Deploy CloudFormation Stack

```bash
# Set environment variables
export AWS_REGION=us-east-1
export ENVIRONMENT=production
export DATABASE_SECRET_ARN=arn:aws:secretsmanager:us-east-1:123456789:secret:cardmarket-scraper/database

# Get VPC details (replace with your VPC)
export VPC_ID=vpc-xxxxxxxx
export SUBNET_IDS=subnet-xxxxxxxx,subnet-yyyyyyyy
export SECURITY_GROUP_ID=sg-xxxxxxxx

# Build TypeScript
npm run build

# Deploy with SAM
sam build --template-file infrastructure/cloudformation.yaml

sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name cardmarket-scraper-${ENVIRONMENT} \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    Environment=${ENVIRONMENT} \
    DatabaseSecretArn=${DATABASE_SECRET_ARN} \
    VpcId=${VPC_ID} \
    SubnetIds=${SUBNET_IDS} \
    SecurityGroupId=${SECURITY_GROUP_ID} \
  --resolve-s3 \
  --no-fail-on-empty-changeset
```

### 4. Verify Deployment

```bash
# Get stack outputs
aws cloudformation describe-stacks \
  --stack-name cardmarket-scraper-${ENVIRONMENT} \
  --query 'Stacks[0].Outputs' \
  --output table

# Expected outputs:
# - ScraperFunctionArn
# - StateMachineArn
# - S3BucketName
# - SQSQueueUrl
# - AlertTopicArn
# - DashboardUrl
```

---

## Configuration

### Environment Variables (Lambda)

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (production/staging/development) | production |
| `DATABASE_SECRET_ARN` | ARN of database credentials secret | Required |
| `S3_BUCKET` | S3 bucket for scraper data | Auto-created |
| `SQS_QUEUE_URL` | SQS queue URL | Auto-created |
| `SQS_DLQ_URL` | Dead letter queue URL | Auto-created |
| `BRIGHT_DATA_CUSTOMER` | Bright Data customer ID | Optional |
| `BRIGHT_DATA_PASSWORD` | Bright Data password | Optional |
| `REQUEST_DELAY_MS` | Delay between requests | 3000 |
| `MAX_CONCURRENCY` | Max concurrent requests | 1 |

### Proxy Configuration

Update Lambda environment variables via console or CLI:

```bash
aws lambda update-function-configuration \
  --function-name cardmarket-scraper-production \
  --environment "Variables={
    NODE_ENV=production,
    BRIGHT_DATA_CUSTOMER=xxx,
    BRIGHT_DATA_PASSWORD=xxx,
    REQUEST_DELAY_MS=3000
  }"
```

---

## Deployment Steps

### Initial Deployment Checklist

```
[ ] Prerequisites installed (Node.js 20+, AWS CLI, SAM CLI)
[ ] AWS credentials configured
[ ] VPC with private subnets identified
[ ] RDS PostgreSQL instance available
[ ] Database secret created in Secrets Manager
[ ] Proxy provider account created
[ ] Playwright Lambda layer built and uploaded
[ ] CloudFormation stack deployed
[ ] Lambda environment variables configured
[ ] Initial test run completed
[ ] Monitoring alerts configured
[ ] SNS topic subscribed to (email/Slack)
```

### Update Deployment

```bash
# Rebuild and deploy
npm run build
sam build
sam deploy --no-confirm-changeset
```

### Rollback

```bash
# Rollback to previous version
aws cloudformation rollback-stack \
  --stack-name cardmarket-scraper-production
```

---

## Verification

### 1. Test Lambda Function

```bash
# Invoke scraper function directly
aws lambda invoke \
  --function-name cardmarket-scraper-production \
  --payload '{"sets": ["OP01"], "options": {"maxCardsPerSet": 5, "dryRun": true}}' \
  --cli-binary-format raw-in-base64-out \
  response.json

cat response.json
```

### 2. Test Step Functions Execution

```bash
# Start pipeline execution
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:123456789:stateMachine:CardmarketPipeline-production \
  --input '{
    "sets": ["OP01"],
    "options": {
      "maxCardsPerSet": 10,
      "dryRun": true
    }
  }'

# Monitor execution
aws stepfunctions describe-execution \
  --execution-arn <execution-arn-from-above>
```

### 3. Check CloudWatch Logs

```bash
# Get recent logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/cardmarket-scraper-production \
  --start-time $(date -d '1 hour ago' +%s000) \
  --filter-pattern "ERROR"
```

### 4. Verify S3 Data

```bash
# List recent scrapes
aws s3 ls s3://cardmarket-scraper-production-${AWS_ACCOUNT_ID}/scrapes/ --recursive | tail -20
```

### 5. Check Database

```sql
-- Connect to RDS and verify data
SELECT
  COUNT(*) as total_cards,
  MAX(last_updated) as last_update
FROM card_prices_v2
WHERE source = 'cardmarket';
```

---

## Operations

### Manual Pipeline Trigger

```bash
# Via Step Functions
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:123456789:stateMachine:CardmarketPipeline-production \
  --input '{"sets": ["OP01", "OP02", "OP03"]}'

# Via SQS (for single set)
aws sqs send-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789/cardmarket-scraper-queue-production \
  --message-body '{
    "jobType": "set",
    "setCode": "OP01",
    "options": {"maxCardsPerSet": 500}
  }'
```

### View Queue Statistics

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789/cardmarket-scraper-queue-production \
  --attribute-names All
```

### Check DLQ for Failed Jobs

```bash
# Receive failed messages
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789/cardmarket-scraper-dlq-production \
  --max-number-of-messages 10
```

### Disable Scheduled Scraping

```bash
# Disable morning schedule
aws scheduler update-schedule \
  --name cardmarket-morning-scrape-production \
  --state DISABLED \
  --flexible-time-window '{"Mode":"OFF"}' \
  --schedule-expression "cron(0 8 * * ? *)" \
  --target '{"Arn":"...","RoleArn":"..."}'
```

---

## Troubleshooting

### Common Issues

#### 1. Lambda Timeout

**Symptom**: Scraper Lambda times out after 15 minutes

**Solution**:
- Reduce `maxCardsPerSet` to 200
- Reduce `maxPagesPerSet` to 20
- Process fewer sets per execution

#### 2. Rate Limiting / Blocking

**Symptom**: 403/429 errors, CAPTCHA triggers

**Solution**:
- Increase `REQUEST_DELAY_MS` to 5000
- Verify proxy credentials are correct
- Check proxy IP reputation
- Wait 24 hours before retrying (IP cooldown)

#### 3. Circuit Breaker Open

**Symptom**: "Circuit breaker is OPEN" errors

**Solution**:
- Check CloudWatch metrics for recent failures
- Verify CardMarket is accessible
- Reset circuit breaker by waiting 30 seconds

#### 4. Database Connection Errors

**Symptom**: "Connection refused" or timeout errors

**Solution**:
- Verify Lambda is in correct VPC/subnets
- Check security group allows outbound to RDS
- Verify database credentials in Secrets Manager

### Log Analysis

```bash
# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/cardmarket-scraper-production \
  --filter-pattern "ERROR" \
  --start-time $(date -d '24 hours ago' +%s000)

# Search for rate limiting
aws logs filter-log-events \
  --log-group-name /aws/lambda/cardmarket-scraper-production \
  --filter-pattern "?429 ?blocked ?captcha" \
  --start-time $(date -d '24 hours ago' +%s000)
```

---

## Cost Monitoring

### Estimated Monthly Costs

| Service | Usage | Est. Cost |
|---------|-------|-----------|
| Lambda | 4 runs/day × 5 min × 2GB = 40 GB-min/day | ~$0.60 |
| S3 | 100 MB storage | ~$0.01 |
| SQS | 1,000 messages/month | ~$0.01 |
| CloudWatch | Logs + metrics | ~$0.30 |
| Secrets Manager | 1 secret | ~$0.40 |
| Step Functions | 120 executions/month | ~$0.01 |
| **Proxy (Bright Data)** | 1.5 GB/month | ~$13.00 |
| **Total** | | **~$14-16/month** |

### Cost Alerts

Set up billing alerts:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "CardmarketScraperCostAlert" \
  --alarm-description "Alert when daily cost exceeds $1" \
  --namespace "AWS/Billing" \
  --metric-name "EstimatedCharges" \
  --dimensions Name=ServiceName,Value=Lambda \
  --statistic Sum \
  --period 86400 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:123456789:cardmarket-alerts-production
```

---

## Security Checklist

```
[ ] Database credentials stored in Secrets Manager (not env vars)
[ ] Lambda functions run in private VPC subnets
[ ] S3 bucket has public access blocked
[ ] IAM roles follow least privilege principle
[ ] Proxy credentials stored securely
[ ] CloudWatch logs encrypted
[ ] SNS topic for alerts configured
```

---

## Support

### Resources

- **Architecture Documentation**: `docs/CARDMARKET_PIPELINE_ARCHITECTURE.md`
- **API Reference**: `src/` source files with JSDoc comments
- **CloudWatch Dashboard**: See deployment outputs

### Contacts

- **Pipeline Issues**: Check CloudWatch logs and DLQ
- **Infrastructure Issues**: Review CloudFormation events
- **Proxy Issues**: Contact proxy provider support

---

*Document version: 1.0.0*
*Last updated: 2026-01-09*
