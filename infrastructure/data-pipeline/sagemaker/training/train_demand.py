"""
Demand Prediction Model Training Script

XGBoost-based model for predicting card demand based on:
- Price momentum and volatility
- Social signal features
- Seasonal patterns
- Market phase indicators

Run via SageMaker Training Job
"""

import argparse
import os
import json
import pickle
from pathlib import Path

import pandas as pd
import numpy as np
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from sklearn.preprocessing import LabelEncoder
import xgboost as xgb


def load_data(input_path: str) -> pd.DataFrame:
    """Load training data from S3."""
    print(f"Loading data from {input_path}")

    # Load parquet files
    df = pd.read_parquet(input_path)

    print(f"Loaded {len(df)} records")
    print(f"Columns: {df.columns.tolist()}")

    return df


def prepare_features(df: pd.DataFrame, feature_cols: list) -> tuple:
    """Prepare features and target for training."""

    # Filter to valid rows
    df = df.dropna(subset=["target_return"])

    # Select features
    available_features = [c for c in feature_cols if c in df.columns]
    print(f"Using features: {available_features}")

    X = df[available_features].copy()
    y = df["target_return"].copy()

    # Handle missing values in features
    X = X.fillna(0)

    # Clip extreme targets
    y = y.clip(-0.5, 0.5)

    return X, y, df


def train_model(X_train, y_train, X_val, y_val, params: dict) -> xgb.XGBRegressor:
    """Train XGBoost model."""

    model = xgb.XGBRegressor(
        n_estimators=params.get("n_estimators", 500),
        max_depth=params.get("max_depth", 6),
        learning_rate=params.get("learning_rate", 0.05),
        min_child_weight=params.get("min_child_weight", 3),
        subsample=params.get("subsample", 0.8),
        colsample_bytree=params.get("colsample_bytree", 0.8),
        reg_alpha=params.get("reg_alpha", 0.1),
        reg_lambda=params.get("reg_lambda", 1.0),
        random_state=42,
        n_jobs=-1,
        early_stopping_rounds=50,
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        verbose=True,
    )

    return model


def evaluate_model(model, X, y, split_name: str) -> dict:
    """Evaluate model performance."""

    y_pred = model.predict(X)

    metrics = {
        "mse": mean_squared_error(y, y_pred),
        "rmse": np.sqrt(mean_squared_error(y, y_pred)),
        "mae": mean_absolute_error(y, y_pred),
        "r2": r2_score(y, y_pred),
    }

    # Direction accuracy
    direction_actual = np.sign(y)
    direction_pred = np.sign(y_pred)
    metrics["direction_accuracy"] = (direction_actual == direction_pred).mean()

    print(f"\n{split_name} Metrics:")
    for name, value in metrics.items():
        print(f"  {name}: {value:.4f}")

    return metrics


def get_feature_importance(model, feature_names: list) -> pd.DataFrame:
    """Get feature importance ranking."""

    importance = model.feature_importances_

    df = pd.DataFrame({
        "feature": feature_names,
        "importance": importance,
    }).sort_values("importance", ascending=False)

    return df


def save_model(model, output_path: str, feature_names: list, metrics: dict):
    """Save model and artifacts."""

    # Create output directory
    os.makedirs(output_path, exist_ok=True)

    # Save model
    model_path = os.path.join(output_path, "model.json")
    model.save_model(model_path)
    print(f"Model saved to {model_path}")

    # Save feature names
    features_path = os.path.join(output_path, "features.json")
    with open(features_path, "w") as f:
        json.dump(feature_names, f)

    # Save metrics
    metrics_path = os.path.join(output_path, "metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)

    # Save feature importance
    importance = get_feature_importance(model, feature_names)
    importance_path = os.path.join(output_path, "feature_importance.csv")
    importance.to_csv(importance_path, index=False)

    print(f"Artifacts saved to {output_path}")


def main():
    parser = argparse.ArgumentParser()

    # Data paths
    parser.add_argument("--train-data", type=str, default=os.environ.get("SM_CHANNEL_TRAIN"))
    parser.add_argument("--validation-data", type=str, default=os.environ.get("SM_CHANNEL_VALIDATION"))
    parser.add_argument("--model-dir", type=str, default=os.environ.get("SM_MODEL_DIR", "/opt/ml/model"))
    parser.add_argument("--output-dir", type=str, default=os.environ.get("SM_OUTPUT_DATA_DIR", "/opt/ml/output"))

    # Hyperparameters
    parser.add_argument("--n-estimators", type=int, default=500)
    parser.add_argument("--max-depth", type=int, default=6)
    parser.add_argument("--learning-rate", type=float, default=0.05)
    parser.add_argument("--min-child-weight", type=int, default=3)
    parser.add_argument("--subsample", type=float, default=0.8)
    parser.add_argument("--colsample-bytree", type=float, default=0.8)
    parser.add_argument("--reg-alpha", type=float, default=0.1)
    parser.add_argument("--reg-lambda", type=float, default=1.0)

    args = parser.parse_args()

    # Feature columns to use
    feature_cols = [
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

    # Hyperparameters
    params = {
        "n_estimators": args.n_estimators,
        "max_depth": args.max_depth,
        "learning_rate": args.learning_rate,
        "min_child_weight": args.min_child_weight,
        "subsample": args.subsample,
        "colsample_bytree": args.colsample_bytree,
        "reg_alpha": args.reg_alpha,
        "reg_lambda": args.reg_lambda,
    }

    print("Hyperparameters:")
    for k, v in params.items():
        print(f"  {k}: {v}")

    # Load data
    train_df = load_data(args.train_data)
    val_df = load_data(args.validation_data)

    # Prepare features
    X_train, y_train, _ = prepare_features(train_df, feature_cols)
    X_val, y_val, _ = prepare_features(val_df, feature_cols)

    print(f"\nTraining set: {len(X_train)} samples")
    print(f"Validation set: {len(X_val)} samples")

    # Get actual feature names used
    feature_names = X_train.columns.tolist()

    # Train model
    print("\nTraining model...")
    model = train_model(X_train, y_train, X_val, y_val, params)

    # Evaluate
    train_metrics = evaluate_model(model, X_train, y_train, "Training")
    val_metrics = evaluate_model(model, X_val, y_val, "Validation")

    # Combine metrics
    all_metrics = {
        "train": train_metrics,
        "validation": val_metrics,
        "params": params,
        "feature_count": len(feature_names),
        "train_samples": len(X_train),
        "val_samples": len(X_val),
    }

    # Feature importance
    importance = get_feature_importance(model, feature_names)
    print("\nTop 10 Features:")
    print(importance.head(10).to_string(index=False))

    # Save model
    save_model(model, args.model_dir, feature_names, all_metrics)

    print("\nTraining complete!")


if __name__ == "__main__":
    main()
