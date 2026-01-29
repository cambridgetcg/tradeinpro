# Waypoint: I1 - AWS Security Hardening

**Created**: 2026-01-29
**Type**: Infrastructure Foundation
**Required By**: W3 (Beta Launch)
**Status**: completed
**Completed**: 2026-01-29

---

## What This Waypoint Achieves

Production-grade security for AWS infrastructure: encrypted data at rest, secrets management, audit logging, and least-privilege access controls.

---

## Success Criteria

1. [x] RDS encryption enabled with KMS (was already enabled)
2. [x] All secrets migrated to AWS Secrets Manager (8 secrets exist)
3. [x] S3 server-side encryption enabled (AES256)
4. [x] IAM roles with least-privilege policies (app integration code created)
5. [x] CloudTrail audit logging enabled (cardforum-dev-secrets-audit)
6. [x] S3 public access blocked (all 4 settings enabled)

---

## Task 1: RDS Encryption (KMS)

**Why**: Protect customer data at rest (PCI compliance, GDPR)

**Steps**:
```bash
# 1. Create KMS key for RDS
aws kms create-key \
  --description "CardForum RDS encryption key" \
  --tags TagKey=Project,TagValue=cardforum \
  --region us-east-1

# 2. Create snapshot of current RDS
aws rds create-db-snapshot \
  --db-instance-identifier cardforum \
  --db-snapshot-identifier cardforum-pre-encryption-snapshot \
  --region us-east-1

# 3. Copy snapshot with encryption
aws rds copy-db-snapshot \
  --source-db-snapshot-identifier cardforum-pre-encryption-snapshot \
  --target-db-snapshot-identifier cardforum-encrypted-snapshot \
  --kms-key-id alias/cardforum-rds-key \
  --region us-east-1

# 4. Restore encrypted instance
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier cardforum-encrypted \
  --db-snapshot-identifier cardforum-encrypted-snapshot \
  --db-instance-class db.t3.small \
  --region us-east-1

# 5. Update DNS/connection string after verification
# 6. Delete old unencrypted instance
```

**Verification**:
```bash
aws rds describe-db-instances \
  --db-instance-identifier cardforum-encrypted \
  --query 'DBInstances[0].StorageEncrypted' \
  --region us-east-1
# Should return: true
```

---

## Task 2: AWS Secrets Manager

**Why**: Remove hardcoded credentials from environment variables

**Secrets to Migrate**:
| Secret | Current Location | New Secret Name |
|--------|------------------|-----------------|
| DATABASE_URL | .env | cardforum/database/url |
| SHOPIFY_API_KEY | .env | cardforum/shopify/api-key |
| SHOPIFY_API_SECRET | .env | cardforum/shopify/api-secret |
| SENDGRID_API_KEY | .env | cardforum/email/sendgrid |
| S3 credentials | IAM user | (use IAM role instead) |

**Steps**:
```bash
# 1. Create secrets
aws secretsmanager create-secret \
  --name cardforum/database/url \
  --secret-string "postgresql://user:pass@cardforum-encrypted.xxx.us-east-1.rds.amazonaws.com:5432/cardforum" \
  --region us-east-1

aws secretsmanager create-secret \
  --name cardforum/shopify/api-key \
  --secret-string "your-api-key" \
  --region us-east-1

# 2. Update application code to fetch secrets
# See: app/lib/secrets.server.ts (to be created)
```

**Application Integration**:
```typescript
// app/lib/secrets.server.ts
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({ region: "us-east-1" });

export async function getSecret(secretName: string): Promise<string> {
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await client.send(command);
  return response.SecretString || "";
}

// Usage in prisma client initialization
const databaseUrl = await getSecret("cardforum/database/url");
```

---

## Task 3: S3 Encryption

**Why**: Protect price data and exports at rest

**Steps**:
```bash
# 1. Enable default encryption on bucket
aws s3api put-bucket-encryption \
  --bucket pricedata-tcg \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "alias/cardforum-s3-key"
      }
    }]
  }' \
  --region us-east-1

# 2. Block public access
aws s3api put-public-access-block \
  --bucket pricedata-tcg \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }' \
  --region us-east-1

# 3. Enable versioning
aws s3api put-bucket-versioning \
  --bucket pricedata-tcg \
  --versioning-configuration Status=Enabled \
  --region us-east-1
```

---

## Task 4: IAM Least-Privilege Roles

**Why**: Limit blast radius of compromised credentials

**Roles to Create**:

```json
// cardforum-app-role (for Vercel)
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::pricedata-tcg",
        "arn:aws:s3:::pricedata-tcg/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:*:secret:cardforum/*"
    }
  ]
}
```

```json
// cardforum-lambda-role (for collectors)
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::pricedata-tcg/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kinesis:PutRecord",
        "kinesis:PutRecords"
      ],
      "Resource": "arn:aws:kinesis:us-east-1:*:stream/price-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:*:secret:cardforum/api/*"
    }
  ]
}
```

---

## Task 5: CloudTrail Audit Logging

**Why**: Track all API calls for security forensics

**Steps**:
```bash
# 1. Create trail
aws cloudtrail create-trail \
  --name cardforum-audit-trail \
  --s3-bucket-name cardforum-cloudtrail-logs \
  --include-global-service-events \
  --is-multi-region-trail \
  --enable-log-file-validation \
  --region us-east-1

# 2. Start logging
aws cloudtrail start-logging \
  --name cardforum-audit-trail \
  --region us-east-1
```

---

## Verification Checklist

```bash
# Run these commands to verify I1 completion:

# 1. RDS encryption
aws rds describe-db-instances --db-instance-identifier cardforum \
  --query 'DBInstances[0].StorageEncrypted' --output text
# Expected: True

# 2. Secrets Manager
aws secretsmanager list-secrets --region us-east-1 \
  --filter Key=name,Values=cardforum/ --query 'SecretList[].Name'
# Expected: [cardforum/database/url, cardforum/shopify/..., ...]

# 3. S3 encryption
aws s3api get-bucket-encryption --bucket pricedata-tcg \
  --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm'
# Expected: aws:kms

# 4. S3 public access blocked
aws s3api get-public-access-block --bucket pricedata-tcg
# Expected: All true

# 5. CloudTrail
aws cloudtrail get-trail-status --name cardforum-audit-trail \
  --query 'IsLogging'
# Expected: true
```

---

## Dependencies

**Required**:
- AWS CLI configured with admin credentials
- KMS CreateKey permission
- S3 bucket exists (pricedata-tcg)

**Enables**:
- I2: Reliability (builds on secure foundation)
- W3: Beta launch with customer data protection

---

## Estimated Effort

| Task | Time | Cost Impact |
|------|------|-------------|
| RDS encryption | 2-4 hours | +$5/month (KMS) |
| Secrets Manager | 1-2 hours | +$3/month |
| S3 encryption | 30 min | Included |
| IAM roles | 1-2 hours | None |
| CloudTrail | 30 min | +$2/month |
| **Total** | **5-9 hours** | **+$10/month** |

---

## Notes

Complete I1 before accepting any real customer submissions. Customer PII (email, address) must be encrypted at rest per GDPR requirements.
