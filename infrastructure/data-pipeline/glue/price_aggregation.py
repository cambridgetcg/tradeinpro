"""
Price Aggregation Glue ETL Job

Aggregates raw price data from S3 Data Lake into daily/weekly/monthly
summaries for efficient querying and ML training.

Schedule: Daily at 2 AM UTC
Input: s3://bucket/raw/prices/
Output: s3://bucket/processed/price_aggregates/
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
from pyspark.sql.types import (
    StructType,
    StructField,
    StringType,
    DoubleType,
    IntegerType,
    TimestampType,
)
from datetime import datetime, timedelta

# Initialize Glue context
args = getResolvedOptions(
    sys.argv,
    [
        "JOB_NAME",
        "S3_INPUT_PATH",
        "S3_OUTPUT_PATH",
        "CATALOG_DATABASE",
        "PROCESSING_DATE",
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
DATABASE = args["CATALOG_DATABASE"]
PROCESSING_DATE = args.get("PROCESSING_DATE", datetime.now().strftime("%Y-%m-%d"))


def load_raw_prices(date_str: str):
    """Load raw price data for a specific date range."""
    # Parse the date
    target_date = datetime.strptime(date_str, "%Y-%m-%d")

    # Load data from the last 30 days for rolling calculations
    start_date = target_date - timedelta(days=30)

    # Read from partitioned S3 path
    df = spark.read.parquet(f"{INPUT_PATH}/prices/")

    # Filter to date range
    df = df.filter(
        (F.col("year") >= start_date.year)
        & (F.col("month") >= start_date.month)
        & (F.col("day") >= start_date.day)
    )

    return df


def calculate_daily_aggregates(df):
    """Calculate daily price aggregates per card/source/condition."""
    daily = df.groupBy("card_id", "source", "condition", "year", "month", "day").agg(
        F.min("price_usd").alias("min_price"),
        F.max("price_usd").alias("max_price"),
        F.avg("price_usd").alias("avg_price"),
        F.expr("percentile_approx(price_usd, 0.5)").alias("median_price"),
        F.stddev("price_usd").alias("std_price"),
        F.count("*").alias("sample_count"),
        F.sum("listings_count").alias("total_listings"),
        F.min("collected_at").alias("first_seen"),
        F.max("collected_at").alias("last_seen"),
    )

    # Add date column for easier querying
    daily = daily.withColumn(
        "date",
        F.to_date(F.concat_ws("-", F.col("year"), F.col("month"), F.col("day"))),
    )

    return daily


def calculate_rolling_stats(daily_df):
    """Calculate rolling statistics (7-day, 30-day windows)."""
    # Define windows
    window_7d = (
        Window.partitionBy("card_id", "source", "condition")
        .orderBy("date")
        .rowsBetween(-6, 0)
    )

    window_30d = (
        Window.partitionBy("card_id", "source", "condition")
        .orderBy("date")
        .rowsBetween(-29, 0)
    )

    # Calculate rolling averages
    with_rolling = daily_df.withColumn(
        "avg_7d", F.avg("avg_price").over(window_7d)
    ).withColumn("avg_30d", F.avg("avg_price").over(window_30d))

    # Calculate rolling standard deviations
    with_rolling = with_rolling.withColumn(
        "std_7d", F.stddev("avg_price").over(window_7d)
    ).withColumn("std_30d", F.stddev("avg_price").over(window_30d))

    # Calculate price momentum (rate of change)
    with_rolling = with_rolling.withColumn(
        "momentum_7d",
        (F.col("avg_price") - F.lag("avg_price", 7).over(window_7d))
        / F.lag("avg_price", 7).over(window_7d),
    ).withColumn(
        "momentum_30d",
        (F.col("avg_price") - F.lag("avg_price", 30).over(window_30d))
        / F.lag("avg_price", 30).over(window_30d),
    )

    # Calculate volatility (coefficient of variation)
    with_rolling = with_rolling.withColumn(
        "volatility_7d", F.col("std_7d") / F.col("avg_7d")
    ).withColumn("volatility_30d", F.col("std_30d") / F.col("avg_30d"))

    return with_rolling


def calculate_cross_market_spreads(daily_df):
    """Calculate price spreads across different markets."""
    # Pivot to get prices by source
    pivoted = daily_df.groupBy("card_id", "condition", "date").pivot("source").agg(
        F.first("avg_price")
    )

    # Calculate spreads between major markets
    spreads = pivoted

    # TCGplayer vs Cardmarket spread
    if "tcgplayer" in pivoted.columns and "cardmarket" in pivoted.columns:
        spreads = spreads.withColumn(
            "spread_tcg_cm",
            (F.col("tcgplayer") - F.col("cardmarket"))
            / F.greatest(F.col("tcgplayer"), F.col("cardmarket")),
        )

    # TCGplayer vs eBay spread
    if "tcgplayer" in pivoted.columns and "ebay_us" in pivoted.columns:
        spreads = spreads.withColumn(
            "spread_tcg_ebay",
            (F.col("tcgplayer") - F.col("ebay_us"))
            / F.greatest(F.col("tcgplayer"), F.col("ebay_us")),
        )

    # Japan vs US spread
    if "yahoo_jp" in pivoted.columns and "tcgplayer" in pivoted.columns:
        spreads = spreads.withColumn(
            "spread_jp_us",
            (F.col("yahoo_jp") - F.col("tcgplayer"))
            / F.greatest(F.col("yahoo_jp"), F.col("tcgplayer")),
        )

    return spreads


def calculate_market_summary(daily_df):
    """Calculate overall market summary statistics."""
    summary = daily_df.groupBy("date", "source").agg(
        F.countDistinct("card_id").alias("unique_cards"),
        F.sum("total_listings").alias("total_listings"),
        F.avg("avg_price").alias("market_avg_price"),
        F.expr("percentile_approx(avg_price, 0.5)").alias("market_median_price"),
        F.sum(F.col("avg_price") * F.col("total_listings")).alias("total_market_value"),
    )

    return summary


def identify_price_movers(daily_df):
    """Identify cards with significant price movements."""
    window = (
        Window.partitionBy("card_id", "source", "condition").orderBy("date").rowsBetween(-1, 0)
    )

    # Calculate daily change
    with_change = daily_df.withColumn(
        "prev_price", F.lag("avg_price", 1).over(window)
    ).withColumn(
        "daily_change",
        (F.col("avg_price") - F.col("prev_price")) / F.col("prev_price"),
    )

    # Filter to significant movers (>10% change)
    movers = with_change.filter(F.abs(F.col("daily_change")) > 0.10).select(
        "card_id",
        "source",
        "condition",
        "date",
        "avg_price",
        "prev_price",
        "daily_change",
        "total_listings",
    )

    return movers


def main():
    print(f"Processing date: {PROCESSING_DATE}")
    print(f"Input path: {INPUT_PATH}")
    print(f"Output path: {OUTPUT_PATH}")

    # Load raw data
    print("Loading raw price data...")
    raw_df = load_raw_prices(PROCESSING_DATE)
    raw_count = raw_df.count()
    print(f"Loaded {raw_count} raw records")

    # Calculate daily aggregates
    print("Calculating daily aggregates...")
    daily_df = calculate_daily_aggregates(raw_df)
    daily_df.cache()

    # Calculate rolling statistics
    print("Calculating rolling statistics...")
    rolling_df = calculate_rolling_stats(daily_df)

    # Calculate cross-market spreads
    print("Calculating cross-market spreads...")
    spreads_df = calculate_cross_market_spreads(daily_df)

    # Calculate market summary
    print("Calculating market summary...")
    summary_df = calculate_market_summary(daily_df)

    # Identify price movers
    print("Identifying price movers...")
    movers_df = identify_price_movers(daily_df)

    # Write outputs
    print("Writing outputs...")

    # Daily aggregates with rolling stats
    rolling_df.write.mode("overwrite").partitionBy("year", "month", "day").parquet(
        f"{OUTPUT_PATH}/daily_aggregates/"
    )

    # Cross-market spreads
    spreads_df.write.mode("overwrite").partitionBy("date").parquet(
        f"{OUTPUT_PATH}/cross_market_spreads/"
    )

    # Market summary
    summary_df.write.mode("overwrite").partitionBy("date").parquet(
        f"{OUTPUT_PATH}/market_summary/"
    )

    # Price movers
    movers_df.write.mode("overwrite").partitionBy("date").parquet(
        f"{OUTPUT_PATH}/price_movers/"
    )

    # Register in Glue Catalog
    print("Updating Glue Catalog...")

    rolling_dynamic = DynamicFrame.fromDF(rolling_df, glueContext, "rolling")
    glueContext.write_dynamic_frame.from_catalog(
        frame=rolling_dynamic,
        database=DATABASE,
        table_name="price_daily_aggregates",
        transformation_ctx="write_daily",
    )

    print("Price aggregation complete!")
    print(f"  Daily aggregates: {rolling_df.count()} records")
    print(f"  Price movers: {movers_df.count()} records")

    # Cleanup
    daily_df.unpersist()


if __name__ == "__main__":
    main()
    job.commit()
