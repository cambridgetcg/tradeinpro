"""
Anomaly Detection Model Training Script

Isolation Forest model for detecting:
- Price anomalies (spikes, drops)
- Listing anomalies (unusual volumes)
- Market anomalies (cross-market discrepancies)

Run via SageMaker Training Job
"""

import argparse
import os
import json
import pickle
from pathlib import Path

import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import precision_score, recall_score, f1_score


def load_data(input_path: str) -> pd.DataFrame:
    """Load training data from S3."""
    print(f"Loading data from {input_path}")

    df = pd.read_parquet(input_path)

    print(f"Loaded {len(df)} records")

    return df


def prepare_features(df: pd.DataFrame, feature_cols: list) -> tuple:
    """Prepare features for anomaly detection."""

    # Select available features
    available_features = [c for c in feature_cols if c in df.columns]
    print(f"Using features: {available_features}")

    X = df[available_features].copy()

    # Handle missing values
    X = X.fillna(0)

    # Handle infinities
    X = X.replace([np.inf, -np.inf], 0)

    return X, df


def train_model(X, params: dict) -> tuple:
    """Train Isolation Forest model."""

    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Train Isolation Forest
    model = IsolationForest(
        n_estimators=params.get("n_estimators", 200),
        max_samples=params.get("max_samples", "auto"),
        contamination=params.get("contamination", 0.05),
        max_features=params.get("max_features", 1.0),
        bootstrap=params.get("bootstrap", True),
        random_state=42,
        n_jobs=-1,
        verbose=1,
    )

    print("Fitting Isolation Forest...")
    model.fit(X_scaled)

    return model, scaler


def evaluate_model(model, scaler, X, df=None) -> dict:
    """Evaluate anomaly detection performance."""

    # Scale features
    X_scaled = scaler.transform(X)

    # Get predictions
    predictions = model.predict(X_scaled)  # 1 = normal, -1 = anomaly
    scores = model.decision_function(X_scaled)  # Higher = more normal

    # Convert to anomaly labels (1 = anomaly, 0 = normal)
    anomalies = (predictions == -1).astype(int)

    metrics = {
        "total_samples": len(X),
        "anomalies_detected": int(anomalies.sum()),
        "anomaly_rate": float(anomalies.mean()),
        "avg_score": float(scores.mean()),
        "min_score": float(scores.min()),
        "max_score": float(scores.max()),
    }

    # Score distribution
    metrics["score_percentiles"] = {
        "p1": float(np.percentile(scores, 1)),
        "p5": float(np.percentile(scores, 5)),
        "p10": float(np.percentile(scores, 10)),
        "p50": float(np.percentile(scores, 50)),
        "p90": float(np.percentile(scores, 90)),
        "p95": float(np.percentile(scores, 95)),
        "p99": float(np.percentile(scores, 99)),
    }

    print("\nModel Metrics:")
    print(f"  Total samples: {metrics['total_samples']}")
    print(f"  Anomalies detected: {metrics['anomalies_detected']}")
    print(f"  Anomaly rate: {metrics['anomaly_rate']:.2%}")
    print(f"  Score range: [{metrics['min_score']:.3f}, {metrics['max_score']:.3f}]")

    # If we have labeled anomalies, calculate precision/recall
    if df is not None and "is_anomaly" in df.columns:
        true_anomalies = df["is_anomaly"].values.astype(int)

        metrics["precision"] = float(precision_score(true_anomalies, anomalies, zero_division=0))
        metrics["recall"] = float(recall_score(true_anomalies, anomalies, zero_division=0))
        metrics["f1"] = float(f1_score(true_anomalies, anomalies, zero_division=0))

        print(f"  Precision: {metrics['precision']:.3f}")
        print(f"  Recall: {metrics['recall']:.3f}")
        print(f"  F1 Score: {metrics['f1']:.3f}")

    return metrics


def analyze_anomalies(X, df, model, scaler, feature_cols) -> pd.DataFrame:
    """Analyze detected anomalies."""

    X_scaled = scaler.transform(X)
    predictions = model.predict(X_scaled)
    scores = model.decision_function(X_scaled)

    # Add results to dataframe
    results = df.copy()
    results["anomaly_score"] = scores
    results["is_detected_anomaly"] = (predictions == -1)

    # Get anomalies sorted by score
    anomalies = results[results["is_detected_anomaly"]].sort_values("anomaly_score")

    print(f"\nTop 20 Anomalies:")
    display_cols = ["card_id", "source", "price_current", "anomaly_score"]
    display_cols = [c for c in display_cols if c in anomalies.columns]

    if len(anomalies) > 0:
        print(anomalies[display_cols].head(20).to_string())

    # Anomaly type classification based on features
    if "z_score" in results.columns:
        price_spike = (results["is_detected_anomaly"]) & (results["z_score"] > 2)
        price_drop = (results["is_detected_anomaly"]) & (results["z_score"] < -2)

        print(f"\n  Price spikes: {price_spike.sum()}")
        print(f"  Price drops: {price_drop.sum()}")

    return anomalies


def save_model(model, scaler, output_path: str, feature_names: list, metrics: dict):
    """Save model and artifacts."""

    os.makedirs(output_path, exist_ok=True)

    # Save model
    model_path = os.path.join(output_path, "model.pkl")
    with open(model_path, "wb") as f:
        pickle.dump(model, f)
    print(f"Model saved to {model_path}")

    # Save scaler
    scaler_path = os.path.join(output_path, "scaler.pkl")
    with open(scaler_path, "wb") as f:
        pickle.dump(scaler, f)

    # Save feature names
    features_path = os.path.join(output_path, "features.json")
    with open(features_path, "w") as f:
        json.dump(feature_names, f)

    # Save metrics
    metrics_path = os.path.join(output_path, "metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)

    print(f"Artifacts saved to {output_path}")


def main():
    parser = argparse.ArgumentParser()

    # Data paths
    parser.add_argument("--train-data", type=str, default=os.environ.get("SM_CHANNEL_TRAIN"))
    parser.add_argument("--model-dir", type=str, default=os.environ.get("SM_MODEL_DIR", "/opt/ml/model"))
    parser.add_argument("--output-dir", type=str, default=os.environ.get("SM_OUTPUT_DATA_DIR", "/opt/ml/output"))

    # Hyperparameters
    parser.add_argument("--n-estimators", type=int, default=200)
    parser.add_argument("--contamination", type=float, default=0.05)
    parser.add_argument("--max-features", type=float, default=1.0)

    args = parser.parse_args()

    # Feature columns for anomaly detection
    feature_cols = [
        # Price features
        "price_current", "price_ma7", "price_ma30",
        "volatility_7d", "volatility_30d",
        "momentum_7d", "momentum_30d",
        "price_vs_ma7", "price_vs_ma30",
        "price_range",
        # Volume features
        "listings_count", "price_samples",
        # Lag features
        "change_1d", "change_7d", "change_30d",
        # Cross-market features
        "max_spread", "arbitrage_score",
    ]

    # Hyperparameters
    params = {
        "n_estimators": args.n_estimators,
        "contamination": args.contamination,
        "max_features": args.max_features,
        "max_samples": "auto",
        "bootstrap": True,
    }

    print("Hyperparameters:")
    for k, v in params.items():
        print(f"  {k}: {v}")

    # Load data
    df = load_data(args.train_data)

    # Prepare features
    X, df = prepare_features(df, feature_cols)

    print(f"\nDataset: {len(X)} samples, {X.shape[1]} features")

    # Get actual feature names used
    feature_names = X.columns.tolist()

    # Train model
    print("\nTraining Isolation Forest...")
    model, scaler = train_model(X, params)

    # Evaluate
    metrics = evaluate_model(model, scaler, X, df)
    metrics["params"] = params
    metrics["feature_count"] = len(feature_names)

    # Analyze anomalies
    anomalies = analyze_anomalies(X, df, model, scaler, feature_cols)

    # Save model
    save_model(model, scaler, args.model_dir, feature_names, metrics)

    print("\nTraining complete!")


if __name__ == "__main__":
    main()
