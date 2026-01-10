"""
Feature Engineering Glue ETL Job

Creates ML-ready features from aggregated price data, social signals,
and market metadata for model training.

Schedule: Daily at 4 AM UTC (after price aggregation)
Input: s3://bucket/processed/
Output: s3://bucket/features/
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
from pyspark.sql.types import ArrayType, DoubleType
from pyspark.ml.feature import VectorAssembler, StandardScaler, StringIndexer
from pyspark.ml.linalg import Vectors
from datetime import datetime, timedelta
import numpy as np

# Initialize Glue context
args = getResolvedOptions(
    sys.argv,
    [
        "JOB_NAME",
        "S3_PROCESSED_PATH",
        "S3_FEATURES_PATH",
        "CATALOG_DATABASE",
        "TRAINING_WINDOW_DAYS",
    ],
)

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

# Configuration
PROCESSED_PATH = args["S3_PROCESSED_PATH"]
FEATURES_PATH = args["S3_FEATURES_PATH"]
DATABASE = args["CATALOG_DATABASE"]
TRAINING_WINDOW = int(args.get("TRAINING_WINDOW_DAYS", "90"))


# =============================================================================
# FEATURE EXTRACTION FUNCTIONS
# =============================================================================


def load_data():
    """Load all required data sources."""
    # Load price aggregates
    prices = spark.read.parquet(f"{PROCESSED_PATH}/daily_aggregates/")

    # Load cross-market spreads
    spreads = spark.read.parquet(f"{PROCESSED_PATH}/cross_market_spreads/")

    # Load social signals
    try:
        signals = spark.read.parquet(f"{PROCESSED_PATH}/signals/")
    except:
        signals = None
        print("No social signals data found")

    # Load card catalog
    try:
        catalog = spark.read.parquet(f"{PROCESSED_PATH}/card_catalog/")
    except:
        catalog = None
        print("No card catalog found")

    return prices, spreads, signals, catalog


def create_price_features(prices_df):
    """Create price-based features."""

    # Base price features
    price_features = prices_df.select(
        "card_id",
        "source",
        "condition",
        "date",
        # Current price stats
        F.col("avg_price").alias("price_current"),
        F.col("min_price").alias("price_min"),
        F.col("max_price").alias("price_max"),
        F.col("median_price").alias("price_median"),
        F.col("std_price").alias("price_std"),
        # Rolling averages
        F.col("avg_7d").alias("price_ma7"),
        F.col("avg_30d").alias("price_ma30"),
        # Volatility
        F.col("volatility_7d").alias("volatility_7d"),
        F.col("volatility_30d").alias("volatility_30d"),
        # Momentum
        F.col("momentum_7d").alias("momentum_7d"),
        F.col("momentum_30d").alias("momentum_30d"),
        # Volume proxy
        F.col("total_listings").alias("listings_count"),
        F.col("sample_count").alias("price_samples"),
    )

    # Add derived features
    price_features = price_features.withColumn(
        # Price position relative to moving averages
        "price_vs_ma7",
        (F.col("price_current") - F.col("price_ma7")) / F.col("price_ma7"),
    ).withColumn(
        "price_vs_ma30",
        (F.col("price_current") - F.col("price_ma30")) / F.col("price_ma30"),
    )

    # Add price range features
    price_features = price_features.withColumn(
        "price_range", (F.col("price_max") - F.col("price_min")) / F.col("price_median")
    ).withColumn(
        "price_skew",
        (F.col("price_current") - F.col("price_median")) / F.col("price_std"),
    )

    # Trend classification
    price_features = price_features.withColumn(
        "trend",
        F.when(F.col("momentum_7d") > 0.05, "bullish")
        .when(F.col("momentum_7d") < -0.05, "bearish")
        .otherwise("neutral"),
    )

    return price_features


def create_temporal_features(df):
    """Create time-based features."""
    temporal = df.withColumn("day_of_week", F.dayofweek("date")).withColumn(
        "day_of_month", F.dayofmonth("date")
    ).withColumn("month", F.month("date")).withColumn("week_of_year", F.weekofyear("date"))

    # Weekend flag
    temporal = temporal.withColumn(
        "is_weekend", F.when(F.col("day_of_week").isin([1, 7]), 1).otherwise(0)
    )

    # Month end flag (last 5 days)
    temporal = temporal.withColumn(
        "is_month_end", F.when(F.col("day_of_month") >= 26, 1).otherwise(0)
    )

    # Cyclical encoding for time features
    temporal = temporal.withColumn(
        "day_sin", F.sin(2 * np.pi * F.col("day_of_week") / 7)
    ).withColumn("day_cos", F.cos(2 * np.pi * F.col("day_of_week") / 7)).withColumn(
        "month_sin", F.sin(2 * np.pi * F.col("month") / 12)
    ).withColumn(
        "month_cos", F.cos(2 * np.pi * F.col("month") / 12)
    )

    return temporal


def create_market_features(spreads_df):
    """Create cross-market features."""
    market_features = spreads_df.select(
        "card_id",
        "condition",
        "date",
        # Spread features if they exist
        *[
            F.col(c)
            for c in spreads_df.columns
            if c.startswith("spread_") or c.startswith("tcgplayer")
        ],
    )

    # Calculate arbitrage opportunity score
    spread_cols = [c for c in spreads_df.columns if c.startswith("spread_")]
    if spread_cols:
        market_features = market_features.withColumn(
            "max_spread", F.greatest(*[F.abs(F.col(c)) for c in spread_cols])
        ).withColumn(
            "arbitrage_score",
            F.when(F.col("max_spread") > 0.15, 1.0)
            .when(F.col("max_spread") > 0.10, 0.5)
            .otherwise(0.0),
        )

    return market_features


def create_social_features(signals_df, window_days=7):
    """Create social signal features."""
    if signals_df is None:
        return None

    # Aggregate signals by card and date
    social = signals_df.groupBy("card_id", F.to_date("collected_at").alias("date")).agg(
        F.count("*").alias("mention_count"),
        F.avg("sentiment").alias("avg_sentiment"),
        F.sum("engagement").alias("total_engagement"),
        F.countDistinct("source").alias("source_count"),
    )

    # Calculate rolling social metrics
    window = Window.partitionBy("card_id").orderBy("date").rowsBetween(-window_days + 1, 0)

    social = social.withColumn(
        "mentions_7d", F.sum("mention_count").over(window)
    ).withColumn("sentiment_7d", F.avg("avg_sentiment").over(window)).withColumn(
        "engagement_7d", F.sum("total_engagement").over(window)
    )

    # Social momentum
    prev_window = Window.partitionBy("card_id").orderBy("date").rowsBetween(-14, -7)
    social = social.withColumn(
        "mentions_prev_7d", F.sum("mention_count").over(prev_window)
    ).withColumn(
        "social_momentum",
        (F.col("mentions_7d") - F.col("mentions_prev_7d"))
        / F.greatest(F.col("mentions_prev_7d"), F.lit(1)),
    )

    return social


def create_card_features(catalog_df):
    """Create card metadata features."""
    if catalog_df is None:
        return None

    card_features = catalog_df.select(
        "card_id",
        "set_code",
        "card_number",
        "variant_type",
        "rarity",
        "color",
        "card_type",
        "cost",
        "power",
        "release_date",
    )

    # Calculate card age
    card_features = card_features.withColumn(
        "card_age_days",
        F.datediff(F.current_date(), F.to_date("release_date")),
    )

    # Encode categorical features
    indexers = [
        StringIndexer(inputCol=col, outputCol=f"{col}_idx", handleInvalid="keep")
        for col in ["set_code", "variant_type", "rarity", "color", "card_type"]
        if col in card_features.columns
    ]

    for indexer in indexers:
        card_features = indexer.fit(card_features).transform(card_features)

    return card_features


def create_lag_features(df, lag_days=[1, 3, 7, 14, 30]):
    """Create lagged price features for time series prediction."""
    window = Window.partitionBy("card_id", "source", "condition").orderBy("date")

    for lag in lag_days:
        df = df.withColumn(f"price_lag_{lag}d", F.lag("price_current", lag).over(window))

        # Change from lag
        df = df.withColumn(
            f"change_{lag}d",
            (F.col("price_current") - F.col(f"price_lag_{lag}d"))
            / F.col(f"price_lag_{lag}d"),
        )

    return df


def create_target_variable(df, horizon_days=7):
    """Create target variable for price prediction."""
    window = Window.partitionBy("card_id", "source", "condition").orderBy("date")

    # Future price
    df = df.withColumn(
        f"price_future_{horizon_days}d",
        F.lead("price_current", horizon_days).over(window),
    )

    # Future return (target)
    df = df.withColumn(
        "target_return",
        (F.col(f"price_future_{horizon_days}d") - F.col("price_current"))
        / F.col("price_current"),
    )

    # Categorical target
    df = df.withColumn(
        "target_direction",
        F.when(F.col("target_return") > 0.05, "up")
        .when(F.col("target_return") < -0.05, "down")
        .otherwise("flat"),
    )

    return df


def assemble_feature_vector(df, feature_cols):
    """Assemble features into a vector for ML."""
    # Fill nulls with 0
    for col in feature_cols:
        df = df.withColumn(col, F.coalesce(F.col(col), F.lit(0.0)))

    assembler = VectorAssembler(inputCols=feature_cols, outputCol="features_raw")
    df = assembler.transform(df)

    # Scale features
    scaler = StandardScaler(inputCol="features_raw", outputCol="features", withStd=True, withMean=True)
    scaler_model = scaler.fit(df)
    df = scaler_model.transform(df)

    return df, scaler_model


# =============================================================================
# MAIN
# =============================================================================


def main():
    print(f"Training window: {TRAINING_WINDOW} days")
    print(f"Input path: {PROCESSED_PATH}")
    print(f"Output path: {FEATURES_PATH}")

    # Load data
    print("Loading data...")
    prices_df, spreads_df, signals_df, catalog_df = load_data()

    # Create price features
    print("Creating price features...")
    price_features = create_price_features(prices_df)

    # Add temporal features
    print("Creating temporal features...")
    temporal_features = create_temporal_features(price_features)

    # Add lag features
    print("Creating lag features...")
    lag_features = create_lag_features(temporal_features)

    # Create target variable
    print("Creating target variable...")
    with_target = create_target_variable(lag_features)

    # Join market features
    print("Creating market features...")
    if spreads_df is not None:
        market_features = create_market_features(spreads_df)
        with_target = with_target.join(
            market_features, on=["card_id", "condition", "date"], how="left"
        )

    # Join social features
    print("Creating social features...")
    social_features = create_social_features(signals_df)
    if social_features is not None:
        with_target = with_target.join(
            social_features, on=["card_id", "date"], how="left"
        )

    # Join card features
    print("Creating card features...")
    card_features = create_card_features(catalog_df)
    if card_features is not None:
        with_target = with_target.join(card_features, on=["card_id"], how="left")

    # Define feature columns for model
    numeric_feature_cols = [
        # Price features
        "price_current",
        "price_ma7",
        "price_ma30",
        "volatility_7d",
        "volatility_30d",
        "momentum_7d",
        "momentum_30d",
        "price_vs_ma7",
        "price_vs_ma30",
        "price_range",
        "listings_count",
        # Temporal features
        "day_sin",
        "day_cos",
        "month_sin",
        "month_cos",
        "is_weekend",
        "is_month_end",
        # Lag features
        "price_lag_1d",
        "price_lag_7d",
        "price_lag_30d",
        "change_1d",
        "change_7d",
        "change_30d",
    ]

    # Add market features if available
    if "max_spread" in with_target.columns:
        numeric_feature_cols.extend(["max_spread", "arbitrage_score"])

    # Add social features if available
    if "mentions_7d" in with_target.columns:
        numeric_feature_cols.extend(
            ["mentions_7d", "sentiment_7d", "engagement_7d", "social_momentum"]
        )

    # Filter valid feature columns
    available_cols = with_target.columns
    feature_cols = [c for c in numeric_feature_cols if c in available_cols]
    print(f"Using {len(feature_cols)} features: {feature_cols}")

    # Assemble feature vector
    print("Assembling feature vector...")
    final_df, scaler_model = assemble_feature_vector(with_target, feature_cols)

    # Filter to training window and valid targets
    cutoff_date = datetime.now() - timedelta(days=TRAINING_WINDOW)
    training_df = final_df.filter(
        (F.col("date") >= cutoff_date.strftime("%Y-%m-%d"))
        & (F.col("target_return").isNotNull())
    )

    # Split by time for train/validation
    training_df = training_df.withColumn(
        "split",
        F.when(F.col("date") < (datetime.now() - timedelta(days=14)).strftime("%Y-%m-%d"), "train")
        .otherwise("validation"),
    )

    train_count = training_df.filter(F.col("split") == "train").count()
    val_count = training_df.filter(F.col("split") == "validation").count()
    print(f"Training samples: {train_count}")
    print(f"Validation samples: {val_count}")

    # Write outputs
    print("Writing feature dataset...")

    # Full feature dataset
    training_df.write.mode("overwrite").partitionBy("split").parquet(
        f"{FEATURES_PATH}/training_data/"
    )

    # Feature metadata
    feature_meta = spark.createDataFrame(
        [(col, idx) for idx, col in enumerate(feature_cols)],
        ["feature_name", "feature_index"],
    )
    feature_meta.write.mode("overwrite").parquet(f"{FEATURES_PATH}/feature_metadata/")

    # Sample for quick testing
    sample_df = training_df.sample(0.1)
    sample_df.write.mode("overwrite").parquet(f"{FEATURES_PATH}/sample_data/")

    print("Feature engineering complete!")
    print(f"  Total features: {len(feature_cols)}")
    print(f"  Training samples: {train_count}")
    print(f"  Validation samples: {val_count}")


if __name__ == "__main__":
    main()
    job.commit()
