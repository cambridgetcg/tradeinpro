# AWS CardMarket Pipeline - Deployment Guide

> **Complete guide for deploying the CardMarket price scraper to AWS**
>
> **Date**: 2026-01-10
> **Status**: Production Ready

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Local Testing](#2-local-testing)
3. [AWS Account Setup](#3-aws-account-setup)
4. [Build & Push Docker Image](#4-build--push-docker-image)
5. [Deploy CDK Stack](#5-deploy-cdk-stack)
6. [Configure Secrets](#6-configure-secrets)
7. [Verify Deployment](#7-verify-deployment)
8. [Monitoring & Troubleshooting](#8-monitoring--troubleshooting)
9. [Cost Management](#9-cost-management)
10. [Maintenance](#10-maintenance)

---

## 1. Prerequisites

### Required Tools

```bash
# Node.js 20+
node --version  # v20.x.x

# AWS CLI v2
aws --version   # aws-cli/2.x.x

# Docker
docker --version  # Docker version 24.x.x

# AWS CDK
npm install -g aws-cdk
cdk --version   # 2.x.x
```

### Required Credentials

1. **AWS Account** with permissions for:
   - ECR (Elastic Container Registry)
   - ECS (Elastic Container Service)
   - EventBridge
   - Secrets Manager
   - CloudWatch
   - IAM
   - VPC
   - SNS

2. **Bright Data Account** with:
   - Web Unlocker zone enabled
   - API token (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

3. **Database Access**:
   - PostgreSQL connection string (existing RDS instance)

### Configure AWS CLI

```bash
aws configure
# AWS Access Key ID: [your-access-key]
# AWS Secret Access Key: [your-secret-key]
# Default region name: us-east-1
# Default output format: json
```

---

## 2. Local Testing

Before deploying to AWS, test the pipeline locally.

### 2.1 Install Dependencies

```bash
cd infrastructure/data-pipeline/scraper-dev/cardmarket
npm install
npx prisma generate
```

### 2.2 Set Environment Variables

```bash
export BRIGHTDATA_TOKEN="***REMOVED-ROTATE-ME***"
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
```

### 2.3 Run Dry Test

```bash
# Test with 5 cards, no database writes
npx tsx scripts/daily-cardmarket-production.ts --dry-run --sets=OP01 --max-cards=5
```

Expected output:
```
═══════════════════════════════════════════════════════════════
  CardMarket Daily Price Archive - PRODUCTION
═══════════════════════════════════════════════════════════════
  Environment: Local
  Mode: DRY RUN
  Date: 2026-01-10
═══════════════════════════════════════════════════════════════

🔐 Loading secrets...
📋 Sets to process: OP01
📦 Max cards per set: 5

────────────────────────────────────────────────────────────────
🗂️  SET: OP01
────────────────────────────────────────────────────────────────
   [DRY RUN] Would save: OP01-001-parallel
   ...
```

### 2.4 Run Production Test (Small Scale)

```bash
# Test with 10 cards, writes to database
npx tsx scripts/daily-cardmarket-production.ts --sets=OP01 --max-cards=10
```

---

## 3. AWS Account Setup

### 3.1 Bootstrap CDK (First Time Only)

```bash
cd infrastructure
npm install
cdk bootstrap aws://ACCOUNT_ID/us-east-1
```

### 3.2 Create VPC (If Needed)

If you don't have an existing VPC, the CDK stack will create one. If you have an existing VPC, note its ID for the deployment.

---

## 4. Build & Push Docker Image

### 4.1 Create ECR Repository (First Time)

```bash
aws ecr create-repository \
  --repository-name cardmarket-scraper \
  --image-scanning-configuration scanOnPush=true \
  --region us-east-1
```

### 4.2 Build Docker Image

```bash
cd infrastructure/data-pipeline/scraper-dev/cardmarket

# Build for x86_64 (ECS Fargate)
docker build --platform linux/amd64 -t cardmarket-scraper:latest .
```

### 4.3 Push to ECR

```bash
# Get ECR login
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Tag image
docker tag cardmarket-scraper:latest \
  ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/cardmarket-scraper:latest

# Push
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/cardmarket-scraper:latest
```

---

## 5. Deploy CDK Stack

### 5.1 Review Stack Configuration

Edit `infrastructure/cardmarket-pipeline-stack.ts` if needed:

```typescript
// Line 381-388
new CardMarketPipelineStack(app, 'CardMarketPipelineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  alertEmail: process.env.ALERT_EMAIL,  // Optional: your-email@example.com
  // vpcId: 'vpc-xxxxxxxx',  // Optional: use existing VPC
});
```

### 5.2 Preview Changes

```bash
cd infrastructure
cdk diff CardMarketPipelineStack
```

### 5.3 Deploy

```bash
# With alert email
ALERT_EMAIL=your-email@example.com cdk deploy CardMarketPipelineStack

# Without alerts
cdk deploy CardMarketPipelineStack
```

### 5.4 Note Outputs

After deployment, note the outputs:
```
Outputs:
CardMarketPipelineStack.RepositoryUri = ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/cardmarket-scraper
CardMarketPipelineStack.ClusterArn = arn:aws:ecs:us-east-1:ACCOUNT_ID:cluster/cardmarket-cluster
CardMarketPipelineStack.TaskDefinitionArn = arn:aws:ecs:us-east-1:ACCOUNT_ID:task-definition/cardmarket-scraper:1
CardMarketPipelineStack.LogGroupName = /ecs/cardmarket-scraper
CardMarketPipelineStack.DashboardUrl = https://us-east-1.console.aws.amazon.com/cloudwatch/...
```

---

## 6. Configure Secrets

### 6.1 Update Bright Data Secret

```bash
aws secretsmanager put-secret-value \
  --secret-id cardmarket-scraper/brightdata \
  --secret-string '{"API_TOKEN":"***REMOVED-ROTATE-ME***"}'
```

### 6.2 Update Database Secret

```bash
aws secretsmanager put-secret-value \
  --secret-id cardmarket-scraper/database \
  --secret-string '{"DATABASE_URL":"postgresql://user:password@cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com:5432/cardforum"}'
```

### 6.3 Verify Secrets

```bash
aws secretsmanager get-secret-value \
  --secret-id cardmarket-scraper/brightdata \
  --query SecretString --output text
```

---

## 7. Verify Deployment

### 7.1 Manual Test Run

```bash
# Get VPC configuration
SUBNETS=$(aws ec2 describe-subnets \
  --filters "Name=tag:Name,Values=*Private*" \
  --query "Subnets[0].SubnetId" --output text)

SECURITY_GROUP=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*ScraperSecurityGroup*" \
  --query "SecurityGroups[0].GroupId" --output text)

# Run task manually
aws ecs run-task \
  --cluster cardmarket-cluster \
  --task-definition cardmarket-scraper \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}"
```

### 7.2 Monitor Task

```bash
# List running tasks
aws ecs list-tasks --cluster cardmarket-cluster

# Describe task status
aws ecs describe-tasks \
  --cluster cardmarket-cluster \
  --tasks TASK_ARN
```

### 7.3 View Logs

```bash
# Real-time log streaming
aws logs tail /ecs/cardmarket-scraper --follow

# Last 100 lines
aws logs tail /ecs/cardmarket-scraper --since 1h
```

### 7.4 Check EventBridge Schedule

```bash
aws events list-rules --name-prefix cardmarket
```

---

## 8. Monitoring & Troubleshooting

### 8.1 CloudWatch Dashboard

Access the dashboard at:
```
https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=CardMarket-Scraper
```

Key metrics:
- **Cards Scraped (24h)**: Should be ~1,500 for full run
- **Errors (24h)**: Should be < 50
- **API Calls (24h)**: Should match cards scraped
- **Duration**: Should be ~5-6 hours

### 8.2 Alarms

| Alarm | Trigger | Action |
|-------|---------|--------|
| High Error Rate | > 50 errors/hour | SNS notification |
| Long Duration | > 7 hours | SNS notification |

### 8.3 Common Issues

#### Task Fails Immediately

```bash
# Check task stopped reason
aws ecs describe-tasks --cluster cardmarket-cluster --tasks TASK_ARN \
  --query "tasks[0].stoppedReason"
```

Common causes:
- **Secrets access denied**: Check IAM role has secretsmanager:GetSecretValue
- **ECR pull failed**: Verify image exists and execution role has ecr:GetDownloadUrlForLayer
- **OOM killed**: Increase memory in task definition

#### Bright Data Errors

```bash
# Check logs for Bright Data issues
aws logs filter-log-events \
  --log-group-name /ecs/cardmarket-scraper \
  --filter-pattern "Bright Data"
```

Common causes:
- **401 Unauthorized**: Token expired or invalid
- **429 Too Many Requests**: Rate limiting, increase delay
- **503 Service Unavailable**: Bright Data outage

#### Database Connection Errors

```bash
# Check logs for database issues
aws logs filter-log-events \
  --log-group-name /ecs/cardmarket-scraper \
  --filter-pattern "database"
```

Common causes:
- **Connection refused**: Check security group allows ECS to RDS
- **Authentication failed**: Verify DATABASE_URL in secrets

### 8.4 Force Stop Task

```bash
aws ecs stop-task \
  --cluster cardmarket-cluster \
  --task TASK_ARN \
  --reason "Manual stop"
```

---

## 9. Cost Management

### 9.1 Expected Monthly Costs

| Service | Usage | Cost |
|---------|-------|------|
| ECS Fargate | 5.4h × 30d × 0.5vCPU | ~$15 |
| NAT Gateway | ~100GB outbound | ~$10 |
| Secrets Manager | 2 secrets | ~$1 |
| CloudWatch Logs | ~1GB | ~$0.50 |
| ECR | ~500MB storage | ~$0.10 |
| **AWS Total** | | **~$27/month** |
| Bright Data | ~45,000 requests | **~$40-67/month** |
| **Grand Total** | | **~$67-94/month** |

### 9.2 Cost Optimization Tips

1. **Use NAT Instance instead of NAT Gateway**: Saves ~$30/month
2. **Schedule only weekdays**: Reduces Bright Data by ~30%
3. **Use Growth Plan**: Better rate than Pay-As-You-Go

### 9.3 Monitor Costs

```bash
# Get cost and usage
aws ce get-cost-and-usage \
  --time-period Start=2026-01-01,End=2026-01-31 \
  --granularity MONTHLY \
  --metrics "UnblendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE
```

---

## 10. Maintenance

### 10.1 Update Scraper Code

```bash
# 1. Build new image
docker build --platform linux/amd64 -t cardmarket-scraper:latest .

# 2. Push to ECR
docker tag cardmarket-scraper:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/cardmarket-scraper:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/cardmarket-scraper:latest

# 3. Force new deployment (optional - ECS will pull latest on next run)
aws ecs update-service \
  --cluster cardmarket-cluster \
  --service cardmarket-scraper \
  --force-new-deployment
```

### 10.2 Update Infrastructure

```bash
cd infrastructure
cdk diff CardMarketPipelineStack
cdk deploy CardMarketPipelineStack
```

### 10.3 Rotate Secrets

```bash
# Generate new Bright Data token in their dashboard, then:
aws secretsmanager put-secret-value \
  --secret-id cardmarket-scraper/brightdata \
  --secret-string '{"API_TOKEN":"NEW_TOKEN_HERE"}'
```

### 10.4 Clean Up Old Images

```bash
# ECR automatically keeps only 5 images (lifecycle policy)
# To manually clean:
aws ecr list-images \
  --repository-name cardmarket-scraper \
  --query 'imageIds[?imageTag!=`latest`]'
```

### 10.5 Destroy Stack

```bash
# WARNING: This deletes all resources
cdk destroy CardMarketPipelineStack
```

---

## Quick Reference

### Run Scraper Manually
```bash
aws ecs run-task \
  --cluster cardmarket-cluster \
  --task-definition cardmarket-scraper \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=DISABLED}"
```

### View Logs
```bash
aws logs tail /ecs/cardmarket-scraper --follow
```

### Check Schedule
```bash
aws events list-rules --name-prefix cardmarket
```

### Stop Running Task
```bash
aws ecs stop-task --cluster cardmarket-cluster --task TASK_ARN
```

### Update Secret
```bash
aws secretsmanager put-secret-value --secret-id cardmarket-scraper/brightdata --secret-string '{"API_TOKEN":"xxx"}'
```

---

*"Infrastructure as code: reproducible, auditable, reliable."*
