"""
Data Preparation Processing Script for SageMaker

Prepares training data from raw features:
1. Load feature data
2. Handle missing values
3. Create train/validation/test splits
4. Save for model training

Run via SageMaker Processing Job
"""

import os
import json
from pathlib import Path
from datetime import datetime, timedelta

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split


def load_parquet_files(input_path: str) -> pd.DataFrame:
    """Load all parquet files from directory."""
    path = Path(input_path)

    if path.is_file():
        return pd.read_parquet(path)

    # Load all parquet files in directory
    dfs = []
    for file in path.rglob("*.parquet"):
        df = pd.read_parquet(file)
        dfs.append(df)

    if not dfs:
        raise ValueError(f"No parquet files found in {input_path}")

    return pd.concat(dfs, ignore_index=True)


def prepare_features(df: pd.DataFrame) -> pd.DataFrame:
    """Prepare and clean features."""

    # Ensure date column exists
    if "date" not in df.columns and "collected_at" in df.columns:
        df["date"] = pd.to_datetime(df["collected_at"]).dt.date

    # Remove rows without target
    if "target_return" in df.columns:
        df = df.dropna(subset=["target_return"])

    # Feature columns
    numeric_cols = [
        # Price features
        "price_current", "price_ma7", "price_ma30",
        "volatility_7d", "volatility_30d",
        "momentum_7d", "momentum_30d",
        "price_vs_ma7", "price_vs_ma30",
        "price_range", "listings_count",
        # Temporal features
        "day_sin", "day_cos", "month_sin", "month_cos",
        "is_weekend", "is_month_end",
        # Lag features
        "price_lag_1d", "price_lag_7d", "price_lag_30d",
        "change_1d", "change_7d", "change_30d",
        # Market features
        "max_spread", "arbitrage_score",
        # Social features
        "mentions_7d", "sentiment_7d", "engagement_7d", "social_momentum",
    ]

    # Keep only available columns
    available_cols = [c for c in numeric_cols if c in df.columns]

    # Handle missing values
    for col in available_cols:
        df[col] = df[col].fillna(0)
        # Handle infinities
        df[col] = df[col].replace([np.inf, -np.inf], 0)

    # Clip extreme values
    for col in available_cols:
        if df[col].dtype in [np.float64, np.float32]:
            p01, p99 = df[col].quantile([0.01, 0.99])
            df[col] = df[col].clip(p01, p99)

    # Clip target
    if "target_return" in df.columns:
        df["target_return"] = df["target_return"].clip(-0.5, 0.5)

    return df


def create_time_split(
    df: pd.DataFrame,
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    date_col: str = "date",
) -> tuple:
    """Create time-based train/validation/test splits."""

    # Sort by date
    df = df.sort_values(date_col)

    # Calculate split dates
    dates = df[date_col].unique()
    n_dates = len(dates)

    train_end_idx = int(n_dates * train_ratio)
    val_end_idx = int(n_dates * (train_ratio + val_ratio))

    train_end_date = dates[train_end_idx]
    val_end_date = dates[val_end_idx]

    # Split data
    train_df = df[df[date_col] < train_end_date]
    val_df = df[(df[date_col] >= train_end_date) & (df[date_col] < val_end_date)]
    test_df = df[df[date_col] >= val_end_date]

    print(f"Train: {len(train_df)} samples ({train_df[date_col].min()} to {train_df[date_col].max()})")
    print(f"Validation: {len(val_df)} samples ({val_df[date_col].min()} to {val_df[date_col].max()})")
    print(f"Test: {len(test_df)} samples ({test_df[date_col].min()} to {test_df[date_col].max()})")

    return train_df, val_df, test_df


def save_data(df: pd.DataFrame, output_path: str, name: str):
    """Save dataframe to parquet."""
    os.makedirs(output_path, exist_ok=True)
    output_file = os.path.join(output_path, f"{name}.parquet")
    df.to_parquet(output_file, index=False)
    print(f"Saved {len(df)} records to {output_file}")


def generate_statistics(train_df: pd.DataFrame, val_df: pd.DataFrame, test_df: pd.DataFrame) -> dict:
    """Generate dataset statistics."""

    stats = {
        "created_at": datetime.now().isoformat(),
        "train_samples": len(train_df),
        "val_samples": len(val_df),
        "test_samples": len(test_df),
        "total_samples": len(train_df) + len(val_df) + len(test_df),
        "feature_count": len([c for c in train_df.columns if c not in ["card_id", "date", "source", "condition", "target_return", "target_direction"]]),
    }

    # Target distribution
    if "target_return" in train_df.columns:
        stats["target_stats"] = {
            "train_mean": float(train_df["target_return"].mean()),
            "train_std": float(train_df["target_return"].std()),
            "val_mean": float(val_df["target_return"].mean()),
            "val_std": float(val_df["target_return"].std()),
        }

    # Feature statistics
    numeric_cols = train_df.select_dtypes(include=[np.number]).columns
    stats["feature_stats"] = {}
    for col in numeric_cols:
        if col not in ["target_return"]:
            stats["feature_stats"][col] = {
                "mean": float(train_df[col].mean()),
                "std": float(train_df[col].std()),
                "min": float(train_df[col].min()),
                "max": float(train_df[col].max()),
            }

    return stats


def main():
    # SageMaker paths
    input_prices_path = "/opt/ml/processing/input/prices"
    input_signals_path = "/opt/ml/processing/input/signals"
    output_train_path = "/opt/ml/processing/output/train"
    output_val_path = "/opt/ml/processing/output/validation"
    output_test_path = "/opt/ml/processing/output/test"

    # Load price data
    print("Loading price data...")
    prices_df = load_parquet_files(input_prices_path)
    print(f"Loaded {len(prices_df)} price records")

    # Load signal data (optional)
    try:
        print("Loading signal data...")
        signals_df = load_parquet_files(input_signals_path)
        print(f"Loaded {len(signals_df)} signal records")

        # Aggregate signals by card and date
        signals_agg = signals_df.groupby(["card_id", pd.to_datetime(signals_df["collected_at"]).dt.date]).agg({
            "sentiment": "mean",
            "engagement": "sum",
        }).reset_index()
        signals_agg.columns = ["card_id", "date", "sentiment_7d", "engagement_7d"]

        # Merge with prices
        prices_df = prices_df.merge(signals_agg, on=["card_id", "date"], how="left")
    except Exception as e:
        print(f"Could not load signals: {e}")

    # Prepare features
    print("\nPreparing features...")
    df = prepare_features(prices_df)
    print(f"Prepared {len(df)} samples with {len(df.columns)} columns")

    # Create time-based splits
    print("\nCreating train/validation/test splits...")
    train_df, val_df, test_df = create_time_split(df)

    # Save splits
    print("\nSaving data...")
    save_data(train_df, output_train_path, "train")
    save_data(val_df, output_val_path, "validation")
    save_data(test_df, output_test_path, "test")

    # Generate and save statistics
    stats = generate_statistics(train_df, val_df, test_df)
    stats_path = os.path.join(output_train_path, "statistics.json")
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2)
    print(f"\nStatistics saved to {stats_path}")

    print("\nData preparation complete!")
    print(f"  Total samples: {stats['total_samples']}")
    print(f"  Features: {stats['feature_count']}")


if __name__ == "__main__":
    main()
