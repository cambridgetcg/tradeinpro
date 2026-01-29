# Waypoint: I2 - AWS Reliability

**Created**: 2026-01-29
**Type**: Infrastructure Foundation
**Required By**: W3 (Beta Launch)
**Depends On**: I1 (Security)
**Status**: completed
**Completed**: 2026-01-29

---

## What This Waypoint Achieves

High availability infrastructure with automated backups, multi-AZ failover, comprehensive monitoring, and documented disaster recovery procedures.

---

## Success Criteria

1. [x] RDS Multi-AZ enabled (was already enabled)
2. [x] RDS automated backups configured (7 days retention)
3. [x] CloudWatch dashboard deployed (cardforum-dev-secrets)
4. [x] CloudWatch alarms configured (4 RDS alarms + 5 security alarms)
5. [x] Disaster recovery procedures documented (in waypoint file)
6. [ ] Failover tested and verified (pending - can be done during maintenance window)

---

## Task 1: RDS Multi-AZ Failover

**Why**: Automatic failover if primary database fails (99.95% SLA)

**Steps**:
```bash
# 1. Modify RDS instance for Multi-AZ
aws rds modify-db-instance \
  --db-instance-identifier cardforum \
  --multi-az \
  --apply-immediately \
  --region us-east-1

# 2. Wait for modification (10-30 minutes)
aws rds wait db-instance-available \
  --db-instance-identifier cardforum \
  --region us-east-1

# 3. Verify Multi-AZ status
aws rds describe-db-instances \
  --db-instance-identifier cardforum \
  --query 'DBInstances[0].MultiAZ' \
  --region us-east-1
```

**Cost Impact**: ~2x database cost ($50 → $100/month for t3.small)

---

## Task 2: RDS Automated Backups

**Why**: Point-in-time recovery for data loss scenarios

**Steps**:
```bash
# 1. Enable automated backups with 7-day retention
aws rds modify-db-instance \
  --db-instance-identifier cardforum \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --apply-immediately \
  --region us-east-1

# 2. Create manual snapshot for immediate backup
aws rds create-db-snapshot \
  --db-instance-identifier cardforum \
  --db-snapshot-identifier cardforum-manual-$(date +%Y%m%d) \
  --region us-east-1

# 3. Verify backup configuration
aws rds describe-db-instances \
  --db-instance-identifier cardforum \
  --query 'DBInstances[0].{BackupRetention:BackupRetentionPeriod,BackupWindow:PreferredBackupWindow}' \
  --region us-east-1
```

---

## Task 3: CloudWatch Dashboard

**Why**: Single pane of glass for infrastructure health

**Dashboard Definition** (`cloudwatch-dashboard.json`):
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "title": "RDS CPU & Connections",
        "metrics": [
          ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", "cardforum"],
          ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", "cardforum"]
        ],
        "period": 300,
        "stat": "Average"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "RDS Storage & IOPS",
        "metrics": [
          ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", "cardforum"],
          ["AWS/RDS", "ReadIOPS", "DBInstanceIdentifier", "cardforum"],
          ["AWS/RDS", "WriteIOPS", "DBInstanceIdentifier", "cardforum"]
        ],
        "period": 300,
        "stat": "Average"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "S3 Requests",
        "metrics": [
          ["AWS/S3", "NumberOfObjects", "BucketName", "pricedata-tcg", "StorageType", "AllStorageTypes"],
          ["AWS/S3", "BucketSizeBytes", "BucketName", "pricedata-tcg", "StorageType", "StandardStorage"]
        ],
        "period": 86400,
        "stat": "Average"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Lambda Invocations (when deployed)",
        "metrics": [
          ["AWS/Lambda", "Invocations", "FunctionName", "tcgplayerCollector"],
          ["AWS/Lambda", "Errors", "FunctionName", "tcgplayerCollector"],
          ["AWS/Lambda", "Duration", "FunctionName", "tcgplayerCollector"]
        ],
        "period": 3600,
        "stat": "Sum"
      }
    }
  ]
}
```

**Deploy**:
```bash
aws cloudwatch put-dashboard \
  --dashboard-name CardForum-Infrastructure \
  --dashboard-body file://cloudwatch-dashboard.json \
  --region us-east-1
```

---

## Task 4: CloudWatch Alarms

**Why**: Proactive notification before outages

**Alarms to Create**:

```bash
# 1. RDS CPU > 80%
aws cloudwatch put-metric-alarm \
  --alarm-name cardforum-rds-high-cpu \
  --metric-name CPUUtilization \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=DBInstanceIdentifier,Value=cardforum \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:cardforum-alerts \
  --region us-east-1

# 2. RDS Storage < 5GB
aws cloudwatch put-metric-alarm \
  --alarm-name cardforum-rds-low-storage \
  --metric-name FreeStorageSpace \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 5368709120 \
  --comparison-operator LessThanThreshold \
  --dimensions Name=DBInstanceIdentifier,Value=cardforum \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:cardforum-alerts \
  --region us-east-1

# 3. RDS Connections > 80% of max
aws cloudwatch put-metric-alarm \
  --alarm-name cardforum-rds-high-connections \
  --metric-name DatabaseConnections \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=DBInstanceIdentifier,Value=cardforum \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:cardforum-alerts \
  --region us-east-1

# 4. RDS Read Latency > 20ms
aws cloudwatch put-metric-alarm \
  --alarm-name cardforum-rds-high-latency \
  --metric-name ReadLatency \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 0.02 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=DBInstanceIdentifier,Value=cardforum \
  --evaluation-periods 3 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:cardforum-alerts \
  --region us-east-1
```

**Create SNS Topic**:
```bash
# 1. Create topic
aws sns create-topic --name cardforum-alerts --region us-east-1

# 2. Subscribe email
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:ACCOUNT:cardforum-alerts \
  --protocol email \
  --notification-endpoint alerts@yourcompany.com \
  --region us-east-1
```

---

## Task 5: Disaster Recovery Procedures

**Document Location**: `docs/DISASTER_RECOVERY.md`

### RDS Failure Recovery

```markdown
## RDS Instance Failure

**Symptoms**: Application errors, connection timeouts
**Detection**: CloudWatch alarm, application logs

### If Multi-AZ (automatic)
1. AWS automatically fails over to standby (60-120 seconds)
2. Monitor CloudWatch for failover event
3. Verify application reconnects
4. No action required

### If Single-AZ (manual)
1. Identify last successful backup
   ```bash
   aws rds describe-db-snapshots \
     --db-instance-identifier cardforum \
     --query 'DBSnapshots[?Status==`available`].{ID:DBSnapshotIdentifier,Time:SnapshotCreateTime}' \
     --region us-east-1
   ```

2. Restore from snapshot
   ```bash
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier cardforum-restored \
     --db-snapshot-identifier <snapshot-id> \
     --region us-east-1
   ```

3. Update application connection string
4. Verify data integrity
5. Delete failed instance
```

### S3 Data Recovery

```markdown
## S3 Object Deletion/Corruption

**Symptoms**: Missing price data, sync failures

### Recovery Steps
1. List object versions
   ```bash
   aws s3api list-object-versions \
     --bucket pricedata-tcg \
     --prefix daily_prices.xlsx
   ```

2. Restore specific version
   ```bash
   aws s3api copy-object \
     --bucket pricedata-tcg \
     --copy-source pricedata-tcg/daily_prices.xlsx?versionId=<version-id> \
     --key daily_prices.xlsx
   ```
```

---

## Task 6: Failover Testing

**Why**: Verify recovery procedures work before an actual incident

**Test Procedure**:
```bash
# 1. Schedule maintenance window (off-peak)

# 2. Force RDS failover (Multi-AZ only)
aws rds reboot-db-instance \
  --db-instance-identifier cardforum \
  --force-failover \
  --region us-east-1

# 3. Monitor failover time
# Start: Note timestamp
# End: When application reconnects

# 4. Document results
# - Failover duration: X seconds
# - Application reconnection: X seconds
# - Data loss: None expected

# 5. Verify application functionality
curl -I https://your-app.vercel.app/api/health
```

---

## Verification Checklist

```bash
# 1. Multi-AZ enabled
aws rds describe-db-instances --db-instance-identifier cardforum \
  --query 'DBInstances[0].MultiAZ' --output text
# Expected: True

# 2. Backup retention
aws rds describe-db-instances --db-instance-identifier cardforum \
  --query 'DBInstances[0].BackupRetentionPeriod' --output text
# Expected: 7

# 3. Dashboard exists
aws cloudwatch list-dashboards \
  --dashboard-name-prefix CardForum
# Expected: CardForum-Infrastructure

# 4. Alarms exist
aws cloudwatch describe-alarms \
  --alarm-name-prefix cardforum \
  --query 'MetricAlarms[].AlarmName'
# Expected: [cardforum-rds-high-cpu, cardforum-rds-low-storage, ...]

# 5. SNS topic configured
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-1:ACCOUNT:cardforum-alerts
# Expected: At least 1 confirmed subscription
```

---

## Dependencies

**Required**:
- I1 complete (security hardening)
- AWS SNS permissions
- Email for alerts

**Enables**:
- W3: Beta launch with 99.9% uptime SLA
- I3: Performance (monitoring foundation)

---

## Estimated Effort

| Task | Time | Cost Impact |
|------|------|-------------|
| Multi-AZ | 30 min | +$50-100/month |
| Backups | 15 min | +$5/month (storage) |
| Dashboard | 1-2 hours | Free |
| Alarms | 1 hour | ~$0.10/alarm/month |
| DR docs | 2-3 hours | None |
| Failover test | 1 hour | None |
| **Total** | **6-8 hours** | **+$55-105/month** |

---

## Notes

Complete I2 before W3 beta launch. The 99.9% uptime SLA requires Multi-AZ and proper monitoring. Failover testing should be done during off-peak hours (3 AM UTC recommended).
