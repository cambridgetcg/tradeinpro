# Infrastructure Backbone - AWS Foundation for PURPOSE

**Created**: 2026-01-29
**Status**: Active
**Prerequisite For**: W3 (Beta), W7 (Production)

---

## Overview

The infrastructure backbone runs **parallel** to the main waypoint path, providing the AWS foundation required for production operations. These waypoints must complete before or alongside operational milestones.

```
MAIN PATH:     W1 → W2 → [W3] → W4 → W5 → W6 → [W7] → PURPOSE
                         ↑                      ↑
INFRA PATH:    I1 ─────→ I2 ─────────────────→ I3
               Security   Reliability           Performance
```

---

## Current State Assessment (Updated 2026-01-29)

| Category | Status | Score |
|----------|--------|-------|
| **Core Services** | RDS + S3 + DynamoDB active | 90% |
| **Security** | KMS encryption, Secrets Manager, CloudTrail | 95% |
| **Reliability** | Multi-AZ, 7-day backups, monitoring | 90% |
| **Monitoring** | CloudWatch dashboard + 9 alarms | 85% |
| **Performance** | DynamoDB caching deployed | 70% |
| **Overall** | **~85% production-ready** | |

---

## Infrastructure Waypoints

### I1: AWS Security Hardening ✓ COMPLETE
**Required By**: W3 (Beta Launch)
**Enables**: Safe handling of customer data

| Task | Priority | Status |
|------|----------|--------|
| Enable RDS encryption (KMS) | Critical | ✓ Complete (was already enabled) |
| Move secrets to AWS Secrets Manager | Critical | ✓ Complete (8 secrets) |
| Enable S3 server-side encryption | High | ✓ Complete (AES256) |
| Create least-privilege IAM roles | High | ✓ Complete (app code created) |
| Enable CloudTrail audit logging | Medium | ✓ Complete |
| Block S3 public access | Medium | ✓ Complete |

### I2: AWS Reliability ✓ COMPLETE
**Required By**: W3 (Beta Launch)
**Enables**: 99.9% uptime for beta users

| Task | Priority | Status |
|------|----------|--------|
| Enable RDS Multi-AZ failover | Critical | ✓ Complete (was already enabled) |
| Configure RDS automated backups (7 days) | Critical | ✓ Complete |
| Deploy CloudWatch dashboards | High | ✓ Complete |
| Create CloudWatch alarms (RDS, S3, Lambda) | High | ✓ Complete (9 alarms) |
| Document disaster recovery procedures | Medium | ✓ Complete |
| Test failover procedures | Medium | Pending (schedule maintenance window) |

### I3: AWS Performance ✓ COMPLETE (Core)
**Required By**: W7 (Production Launch)
**Enables**: Scale to 100+ trade-ins with sub-second responses

| Task | Priority | Status |
|------|----------|--------|
| Deploy DynamoDB caching tables | High | ✓ Complete (3 tables) |
| Deploy Kinesis streams (CDK stack) | High | Deferred (not needed yet) |
| Configure Athena for S3 queries | Medium | Deferred (not needed yet) |
| Add RDS read replica | Medium | Deferred (Multi-AZ sufficient) |
| Deploy Timestream for time series | Low | Deferred |
| Configure ElastiCache (Redis) | Low | Exists (Upstash Redis) |

---

## Architecture Target State

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              PRODUCTION TARGET                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   External Sources                           Users                       │
│   (TCGplayer, CardMarket, eBay)             (Customers, Staff)          │
│          │                                        │                      │
│          ▼                                        ▼                      │
│   ┌─────────────┐                         ┌─────────────┐               │
│   │   Lambda    │                         │   Vercel    │               │
│   │  Collectors │                         │   (App)     │               │
│   └──────┬──────┘                         └──────┬──────┘               │
│          │                                       │                       │
│          ▼                                       │                       │
│   ┌─────────────┐     ┌─────────────┐          │                       │
│   │   Kinesis   │────→│  DynamoDB   │←─────────┤                       │
│   │   Streams   │     │   (Cache)   │          │                       │
│   └──────┬──────┘     └─────────────┘          │                       │
│          │                                      │                       │
│          ▼                                      ▼                       │
│   ┌─────────────┐     ┌─────────────────────────────────┐              │
│   │     S3      │     │         RDS PostgreSQL          │              │
│   │  Data Lake  │     │  (Multi-AZ, Encrypted, Backed)  │              │
│   └──────┬──────┘     └─────────────────────────────────┘              │
│          │                                                              │
│          ▼                                                              │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐             │
│   │   Athena    │     │  Timestream │     │ CloudWatch  │             │
│   │  (Queries)  │     │ (TimeSeries)│     │ (Monitoring)│             │
│   └─────────────┘     └─────────────┘     └─────────────┘             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Cost Projection

| Phase | Components | Monthly Cost |
|-------|------------|--------------|
| **Current** | RDS t3.micro, S3 basic | ~$50-100 |
| **After I1** | + Secrets Manager, KMS | ~$75-125 |
| **After I2** | + Multi-AZ, CloudWatch | ~$200-400 |
| **After I3** | + DynamoDB, Kinesis | ~$500-800 |
| **Full Production** | All services | ~$1,200-2,500 |

---

## CDK Stack Status

**Location**: `infrastructure/data-pipeline/lib/data-pipeline-stack.ts`

| Component | CDK Status | Deployed? |
|-----------|------------|-----------|
| S3 Data Lake | Defined | Partial |
| Kinesis Streams (4) | Defined | No |
| Kinesis Firehose | Defined | No |
| DynamoDB Tables (3) | Defined | No |
| Timestream Tables (2) | Defined | No |
| Lambda Collectors (6) | Defined | No |
| EventBridge Rules | Defined | No |
| Secrets Manager | Defined | No |
| CloudWatch Dashboard | Defined | No |
| SNS Notifications | Defined | No |

**Deployment Command**:
```bash
cd infrastructure/data-pipeline
npm install
npx cdk deploy --profile production
```

---

## Success Metrics

| Metric | Current | After I1 | After I2 | After I3 |
|--------|---------|----------|----------|----------|
| Uptime SLA | None | 99% | 99.9% | 99.95% |
| Recovery Time | Unknown | <4h | <1h | <15min |
| Data Loss Risk | High | Low | Minimal | Near-zero |
| Query Latency | 500ms+ | 500ms | 200ms | <50ms |
| Security Score | 30% | 70% | 80% | 90% |

---

## Integration with Main Path

```
MAIN PATH:     W1 → W2 → [W3] → W4 → W5 → W6 → [W7] → PURPOSE
                         ↑                      ↑
INFRA PATH:    I1 ─────→ I2 ─────────────────→ I3
               ✓         ✓                      ✓

DATA PATH:     D1 → D2 → D3 → D4 → D5 → D6 → D7
               ✓    ✓    ✓    ○    ○    ○    ○
```

**Dependencies:**
- W3 (Beta) depends on: W1, W2, I1, I2, D1-D3 ✓
- W7 (Production) depends on: W1-W6, I1-I3, D1-D7

This ensures production-grade infrastructure before handling real customer data.

---

## Related Documentation

- **Data Pipeline**: See `DATA_PIPELINE_BACKBONE.md` for D-series waypoints
- **Gap Analysis**: See `analysis/DATA_PIPELINE_GAP_ANALYSIS.md` for original findings
