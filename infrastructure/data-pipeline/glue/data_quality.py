"""
Data Quality Validation Glue ETL Job

Validates incoming data quality, detects anomalies, and maintains
data lineage for ML training data integrity.

Schedule: Hourly
Input: s3://bucket/raw/
Output: s3://bucket/validated/, s3://bucket/quarantine/
"""

import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
from pyspark.sql import functions as F
from pyspark.sql.window import Window
from pyspark.sql.types import StructType, StructField, StringType, DoubleType, BooleanType
from datetime import datetime, timedelta
import json

# Initialize Glue context
args = getResolvedOptions(
    sys.argv,
    [
        "JOB_NAME",
        "S3_INPUT_PATH",
        "S3_OUTPUT_PATH",
        "S3_QUARANTINE_PATH",
        "S3_METRICS_PATH",
        "ALERT_SNS_TOPIC",
    ],
)

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

# Configuration
INPUT_PATH = args["S3_INPUT_PATH"]
OUTPUT_PATH = args["S3_OUTPUT_PATH"]
QUARANTINE_PATH = args["S3_QUARANTINE_PATH"]
METRICS_PATH = args["S3_METRICS_PATH"]
ALERT_TOPIC = args.get("ALERT_SNS_TOPIC")


# =============================================================================
# VALIDATION RULES
# =============================================================================


class DataQualityRules:
    """Define data quality validation rules."""

    @staticmethod
    def validate_price_event(df):
        """Validate price event records."""
        validations = []

        # Rule 1: Price must be positive
        validations.append(
            (F.col("price_usd") > 0, "price_positive", "Price must be positive")
        )

        # Rule 2: Price must be within reasonable range ($0.01 - $10,000)
        validations.append(
            (
                (F.col("price_usd") >= 0.01) & (F.col("price_usd") <= 10000),
                "price_range",
                "Price must be between $0.01 and $10,000",
            )
        )

        # Rule 3: Card ID must be properly formatted
        validations.append(
            (
                F.col("card_id").rlike("^[A-Z]{2,3}\\d{2}-\\d{3}(-[a-z]+)?$"),
                "card_id_format",
                "Card ID must match format XX00-000 or XX00-000-variant",
            )
        )

        # Rule 4: Source must be known
        known_sources = [
            "tcgplayer",
            "cardmarket",
            "ebay_us",
            "ebay_gb",
            "ebay_de",
            "yahoo_jp",
            "mercari_jp",
        ]
        validations.append(
            (
                F.col("source").isin(known_sources),
                "known_source",
                f"Source must be one of: {known_sources}",
            )
        )

        # Rule 5: Condition must be standard
        valid_conditions = ["NM", "LP", "MP", "HP", "DMG"]
        validations.append(
            (
                F.col("condition").isin(valid_conditions),
                "valid_condition",
                f"Condition must be one of: {valid_conditions}",
            )
        )

        # Rule 6: Timestamp must be recent (within last 24 hours)
        validations.append(
            (
                F.col("collected_at") >= F.date_sub(F.current_timestamp(), 1),
                "recent_timestamp",
                "Record must be collected within last 24 hours",
            )
        )

        # Rule 7: Currency must be valid
        valid_currencies = ["USD", "EUR", "GBP", "JPY"]
        validations.append(
            (
                F.col("currency").isin(valid_currencies),
                "valid_currency",
                f"Currency must be one of: {valid_currencies}",
            )
        )

        return validations

    @staticmethod
    def validate_signal_event(df):
        """Validate social signal records."""
        validations = []

        # Rule 1: Sentiment must be normalized
        validations.append(
            (
                (F.col("sentiment") >= -1) & (F.col("sentiment") <= 1),
                "sentiment_range",
                "Sentiment must be between -1 and 1",
            )
        )

        # Rule 2: Engagement must be non-negative
        validations.append(
            (F.col("engagement") >= 0, "engagement_positive", "Engagement must be non-negative")
        )

        # Rule 3: Source must be known
        known_sources = ["twitter", "reddit", "youtube"]
        validations.append(
            (
                F.col("source").isin(known_sources),
                "known_source",
                f"Source must be one of: {known_sources}",
            )
        )

        return validations


# =============================================================================
# ANOMALY DETECTION
# =============================================================================


def detect_price_anomalies(df, z_threshold=3.0):
    """Detect anomalous prices using statistical methods."""
    # Calculate rolling statistics per card
    window = Window.partitionBy("card_id", "source", "condition").orderBy("collected_at")

    # Rolling mean and std (last 30 records)
    rolling_window = window.rowsBetween(-30, -1)

    with_stats = df.withColumn("rolling_mean", F.avg("price_usd").over(rolling_window)).withColumn(
        "rolling_std", F.stddev("price_usd").over(rolling_window)
    )

    # Calculate z-score
    with_stats = with_stats.withColumn(
        "z_score",
        F.when(
            F.col("rolling_std") > 0,
            (F.col("price_usd") - F.col("rolling_mean")) / F.col("rolling_std"),
        ).otherwise(0),
    )

    # Flag anomalies
    with_stats = with_stats.withColumn(
        "is_anomaly", F.abs(F.col("z_score")) > z_threshold
    ).withColumn(
        "anomaly_type",
        F.when(F.col("z_score") > z_threshold, "price_spike")
        .when(F.col("z_score") < -z_threshold, "price_drop")
        .otherwise(None),
    )

    return with_stats


def detect_duplicates(df):
    """Detect duplicate records."""
    # Define duplicate key
    window = Window.partitionBy("card_id", "source", "condition", "price_usd", "currency").orderBy(
        "collected_at"
    )

    with_dups = df.withColumn("dup_rank", F.row_number().over(window)).withColumn(
        "is_duplicate", F.col("dup_rank") > 1
    )

    return with_dups


def detect_missing_data(df, required_cols):
    """Detect records with missing required fields."""
    missing_conditions = [F.col(col).isNull() for col in required_cols]

    with_missing = df.withColumn(
        "has_missing", F.when(F.greatest(*missing_conditions), True).otherwise(False)
    ).withColumn(
        "missing_fields",
        F.array(
            *[
                F.when(F.col(col).isNull(), F.lit(col)).otherwise(F.lit(None))
                for col in required_cols
            ]
        ),
    )

    # Filter nulls from array
    with_missing = with_missing.withColumn(
        "missing_fields", F.expr("filter(missing_fields, x -> x is not null)")
    )

    return with_missing


# =============================================================================
# QUALITY METRICS
# =============================================================================


def calculate_quality_metrics(df, validated_df, quarantined_df):
    """Calculate data quality metrics."""
    total_count = df.count()
    valid_count = validated_df.count()
    quarantined_count = quarantined_df.count()

    metrics = {
        "timestamp": datetime.now().isoformat(),
        "total_records": total_count,
        "valid_records": valid_count,
        "quarantined_records": quarantined_count,
        "validity_rate": valid_count / total_count if total_count > 0 else 0,
        "quarantine_rate": quarantined_count / total_count if total_count > 0 else 0,
    }

    # Calculate metrics by validation rule
    if "validation_failures" in validated_df.columns:
        rule_failures = (
            validated_df.select(F.explode("validation_failures").alias("rule"))
            .groupBy("rule")
            .count()
            .collect()
        )
        metrics["failures_by_rule"] = {row["rule"]: row["count"] for row in rule_failures}

    # Calculate metrics by source
    source_metrics = (
        df.groupBy("source")
        .agg(
            F.count("*").alias("total"),
            F.avg("price_usd").alias("avg_price"),
        )
        .collect()
    )
    metrics["by_source"] = {
        row["source"]: {"count": row["total"], "avg_price": row["avg_price"]}
        for row in source_metrics
    }

    return metrics


def write_metrics(metrics, path):
    """Write quality metrics to S3."""
    metrics_df = spark.createDataFrame(
        [
            (
                metrics["timestamp"],
                metrics["total_records"],
                metrics["valid_records"],
                metrics["quarantined_records"],
                metrics["validity_rate"],
                json.dumps(metrics.get("failures_by_rule", {})),
                json.dumps(metrics.get("by_source", {})),
            )
        ],
        [
            "timestamp",
            "total_records",
            "valid_records",
            "quarantined_records",
            "validity_rate",
            "failures_by_rule",
            "by_source",
        ],
    )

    metrics_df.write.mode("append").parquet(f"{path}/quality_metrics/")


# =============================================================================
# VALIDATION PIPELINE
# =============================================================================


def apply_validations(df, validations):
    """Apply validation rules and flag failures."""
    # Add validation result columns
    for condition, rule_name, _ in validations:
        df = df.withColumn(f"valid_{rule_name}", condition)

    # Collect all validation columns
    valid_cols = [c for c in df.columns if c.startswith("valid_")]

    # Overall validity
    df = df.withColumn("is_valid", F.greatest(*[F.col(c) for c in valid_cols]))

    # Collect failed rules
    df = df.withColumn(
        "validation_failures",
        F.array(
            *[
                F.when(~F.col(f"valid_{rule_name}"), F.lit(rule_name)).otherwise(F.lit(None))
                for _, rule_name, _ in validations
            ]
        ),
    )

    # Filter nulls
    df = df.withColumn(
        "validation_failures", F.expr("filter(validation_failures, x -> x is not null)")
    )

    return df


def quarantine_records(df, quarantine_path, reason_col="quarantine_reason"):
    """Move invalid/anomalous records to quarantine."""
    # Add quarantine metadata
    quarantined = df.withColumn("quarantined_at", F.current_timestamp()).withColumn(
        "quarantine_date", F.current_date()
    )

    # Write to quarantine with date partitioning
    quarantined.write.mode("append").partitionBy("quarantine_date", "source").parquet(
        quarantine_path
    )

    return quarantined


# =============================================================================
# MAIN
# =============================================================================


def main():
    print(f"Input path: {INPUT_PATH}")
    print(f"Output path: {OUTPUT_PATH}")
    print(f"Quarantine path: {QUARANTINE_PATH}")

    # Get list of event types to process
    event_types = ["prices", "listings", "sales", "signals"]

    all_metrics = {}

    for event_type in event_types:
        input_path = f"{INPUT_PATH}/{event_type}/"

        try:
            # Load raw data
            print(f"\nProcessing {event_type}...")
            df = spark.read.parquet(input_path)
            total_count = df.count()
            print(f"  Loaded {total_count} records")

            if total_count == 0:
                print(f"  No records found for {event_type}, skipping")
                continue

            # Get validation rules based on event type
            if event_type in ["prices", "listings", "sales"]:
                validations = DataQualityRules.validate_price_event(df)
                required_cols = ["card_id", "source", "price_usd", "condition"]
            elif event_type == "signals":
                validations = DataQualityRules.validate_signal_event(df)
                required_cols = ["source", "sentiment", "engagement"]
            else:
                validations = []
                required_cols = []

            # Apply validations
            print("  Applying validation rules...")
            validated_df = apply_validations(df, validations)

            # Detect anomalies (for price data)
            if event_type == "prices":
                print("  Detecting anomalies...")
                validated_df = detect_price_anomalies(validated_df)

            # Detect duplicates
            print("  Detecting duplicates...")
            validated_df = detect_duplicates(validated_df)

            # Detect missing data
            print("  Detecting missing data...")
            validated_df = detect_missing_data(validated_df, required_cols)

            # Combine all quality flags
            validated_df = validated_df.withColumn(
                "quarantine_reason",
                F.when(~F.col("is_valid"), "validation_failed")
                .when(F.col("is_duplicate"), "duplicate")
                .when(F.col("has_missing"), "missing_required_fields")
                .when(F.col("is_anomaly") == True, "anomaly_detected")
                .otherwise(None),
            )

            validated_df = validated_df.withColumn(
                "should_quarantine", F.col("quarantine_reason").isNotNull()
            )

            # Split valid and quarantine records
            valid_records = validated_df.filter(~F.col("should_quarantine"))
            quarantine_records_df = validated_df.filter(F.col("should_quarantine"))

            valid_count = valid_records.count()
            quarantine_count = quarantine_records_df.count()

            print(f"  Valid records: {valid_count}")
            print(f"  Quarantined records: {quarantine_count}")

            # Write valid records
            print("  Writing valid records...")
            valid_records.write.mode("overwrite").partitionBy("year", "month", "day").parquet(
                f"{OUTPUT_PATH}/{event_type}/"
            )

            # Write quarantine records
            if quarantine_count > 0:
                print("  Writing quarantine records...")
                quarantine_records(
                    quarantine_records_df, f"{QUARANTINE_PATH}/{event_type}/"
                )

            # Calculate metrics
            metrics = calculate_quality_metrics(df, valid_records, quarantine_records_df)
            metrics["event_type"] = event_type
            all_metrics[event_type] = metrics

        except Exception as e:
            print(f"  Error processing {event_type}: {e}")
            all_metrics[event_type] = {"error": str(e)}

    # Write overall metrics
    print("\nWriting quality metrics...")
    summary = {
        "timestamp": datetime.now().isoformat(),
        "event_types": all_metrics,
    }

    # Create summary DataFrame
    summary_rows = []
    for event_type, metrics in all_metrics.items():
        if "error" not in metrics:
            summary_rows.append(
                (
                    summary["timestamp"],
                    event_type,
                    metrics.get("total_records", 0),
                    metrics.get("valid_records", 0),
                    metrics.get("quarantined_records", 0),
                    metrics.get("validity_rate", 0),
                )
            )

    if summary_rows:
        summary_df = spark.createDataFrame(
            summary_rows,
            [
                "timestamp",
                "event_type",
                "total_records",
                "valid_records",
                "quarantined_records",
                "validity_rate",
            ],
        )
        summary_df.write.mode("append").parquet(f"{METRICS_PATH}/quality_summary/")

    print("\nData quality validation complete!")
    for event_type, metrics in all_metrics.items():
        if "error" in metrics:
            print(f"  {event_type}: ERROR - {metrics['error']}")
        else:
            print(
                f"  {event_type}: {metrics.get('valid_records', 0)}/{metrics.get('total_records', 0)} valid ({metrics.get('validity_rate', 0):.1%})"
            )


if __name__ == "__main__":
    main()
    job.commit()
