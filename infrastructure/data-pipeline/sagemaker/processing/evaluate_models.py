"""
Model Evaluation Processing Script for SageMaker

Evaluates trained models on held-out test data:
1. Load trained models
2. Make predictions on test set
3. Calculate evaluation metrics
4. Generate evaluation report

Run via SageMaker Processing Job
"""

import os
import json
import tarfile
import pickle
from pathlib import Path
from datetime import datetime

import pandas as pd
import numpy as np
from sklearn.metrics import (
    mean_squared_error,
    mean_absolute_error,
    r2_score,
    precision_score,
    recall_score,
    f1_score,
    accuracy_score,
    confusion_matrix,
)


def load_model_artifact(model_path: str, artifact_name: str):
    """Load model artifact from tar.gz."""
    tar_path = os.path.join(model_path, "model.tar.gz")

    if os.path.exists(tar_path):
        # Extract tar.gz
        with tarfile.open(tar_path, "r:gz") as tar:
            tar.extractall(model_path)

    # Load the model
    model_file = os.path.join(model_path, artifact_name)
    if artifact_name.endswith(".json"):
        import xgboost as xgb
        model = xgb.XGBRegressor()
        model.load_model(model_file)
    elif artifact_name.endswith(".pkl"):
        with open(model_file, "rb") as f:
            model = pickle.load(f)
    else:
        raise ValueError(f"Unknown model format: {artifact_name}")

    return model


def load_test_data(test_path: str) -> pd.DataFrame:
    """Load test data."""
    path = Path(test_path)

    if path.is_file():
        return pd.read_parquet(path)

    # Load all parquet files
    dfs = []
    for file in path.rglob("*.parquet"):
        df = pd.read_parquet(file)
        dfs.append(df)

    return pd.concat(dfs, ignore_index=True) if dfs else pd.DataFrame()


def evaluate_demand_model(model, test_df: pd.DataFrame) -> dict:
    """Evaluate demand prediction model."""

    # Feature columns
    feature_cols = [
        "price_current", "price_ma7", "price_ma30",
        "volatility_7d", "volatility_30d",
        "momentum_7d", "momentum_30d",
        "price_vs_ma7", "price_vs_ma30",
        "price_range", "listings_count",
        "day_sin", "day_cos", "month_sin", "month_cos",
        "is_weekend", "is_month_end",
        "price_lag_1d", "price_lag_7d", "price_lag_30d",
        "change_1d", "change_7d", "change_30d",
        "max_spread", "arbitrage_score",
        "mentions_7d", "sentiment_7d", "engagement_7d", "social_momentum",
    ]

    # Get available features
    available_features = [c for c in feature_cols if c in test_df.columns]

    X_test = test_df[available_features].fillna(0)
    y_test = test_df["target_return"].values

    # Make predictions
    y_pred = model.predict(X_test)

    # Calculate metrics
    metrics = {
        "mse": float(mean_squared_error(y_test, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_test, y_pred))),
        "mae": float(mean_absolute_error(y_test, y_pred)),
        "r2": float(r2_score(y_test, y_pred)),
    }

    # Direction accuracy
    direction_actual = np.sign(y_test)
    direction_pred = np.sign(y_pred)
    metrics["direction_accuracy"] = float((direction_actual == direction_pred).mean())

    # Prediction distribution
    metrics["pred_mean"] = float(y_pred.mean())
    metrics["pred_std"] = float(y_pred.std())
    metrics["actual_mean"] = float(y_test.mean())
    metrics["actual_std"] = float(y_test.std())

    # Percentile analysis
    for pct in [10, 25, 50, 75, 90]:
        threshold = np.percentile(y_pred, pct)
        high_pred = y_pred >= threshold
        metrics[f"actual_when_pred_top_{100-pct}pct"] = float(y_test[high_pred].mean())

    print("Demand Model Metrics:")
    print(f"  RMSE: {metrics['rmse']:.4f}")
    print(f"  MAE: {metrics['mae']:.4f}")
    print(f"  R2: {metrics['r2']:.4f}")
    print(f"  Direction Accuracy: {metrics['direction_accuracy']:.2%}")

    return metrics


def evaluate_anomaly_model(model, scaler, test_df: pd.DataFrame) -> dict:
    """Evaluate anomaly detection model."""

    # Feature columns
    feature_cols = [
        "price_current", "price_ma7", "price_ma30",
        "volatility_7d", "volatility_30d",
        "momentum_7d", "momentum_30d",
        "price_vs_ma7", "price_vs_ma30",
        "price_range", "listings_count",
        "change_1d", "change_7d", "change_30d",
        "max_spread", "arbitrage_score",
    ]

    # Get available features
    available_features = [c for c in feature_cols if c in test_df.columns]

    X_test = test_df[available_features].fillna(0).replace([np.inf, -np.inf], 0)

    # Scale features
    X_scaled = scaler.transform(X_test)

    # Get predictions
    predictions = model.predict(X_scaled)
    scores = model.decision_function(X_scaled)

    # Convert to anomaly labels
    anomalies_detected = (predictions == -1).astype(int)

    metrics = {
        "total_samples": len(X_test),
        "anomalies_detected": int(anomalies_detected.sum()),
        "anomaly_rate": float(anomalies_detected.mean()),
        "avg_score": float(scores.mean()),
        "score_std": float(scores.std()),
    }

    # If we have ground truth
    if "is_anomaly" in test_df.columns:
        true_anomalies = test_df["is_anomaly"].values.astype(int)

        metrics["precision"] = float(precision_score(true_anomalies, anomalies_detected, zero_division=0))
        metrics["recall"] = float(recall_score(true_anomalies, anomalies_detected, zero_division=0))
        metrics["f1"] = float(f1_score(true_anomalies, anomalies_detected, zero_division=0))

        cm = confusion_matrix(true_anomalies, anomalies_detected)
        metrics["confusion_matrix"] = cm.tolist()

        print("Anomaly Model Metrics:")
        print(f"  Precision: {metrics['precision']:.3f}")
        print(f"  Recall: {metrics['recall']:.3f}")
        print(f"  F1: {metrics['f1']:.3f}")
    else:
        print("Anomaly Model Metrics (no ground truth):")
        print(f"  Anomaly Rate: {metrics['anomaly_rate']:.2%}")
        print(f"  Avg Score: {metrics['avg_score']:.3f}")

    return metrics


def evaluate_timing_model(model, test_df: pd.DataFrame) -> dict:
    """Evaluate timing prediction model."""

    # Prepare data for Prophet
    if "date" in test_df.columns:
        df = test_df.groupby("date").agg({
            "price_current": "mean" if "price_current" in test_df.columns else "first",
        }).reset_index()
        df.columns = ["ds", "y"]
    else:
        print("No date column found for timing model evaluation")
        return {"error": "no_date_column"}

    # Make predictions
    try:
        forecast = model.predict(df[["ds"]])
        forecast = forecast.merge(df, on="ds")

        y_true = forecast["y"].values
        y_pred = forecast["yhat"].values

        metrics = {
            "mae": float(mean_absolute_error(y_true, y_pred)),
            "mape": float(np.mean(np.abs(y_true - y_pred) / np.abs(y_true))) * 100,
            "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
            "coverage_95": float(
                ((forecast["yhat_lower"] <= forecast["y"]) &
                 (forecast["y"] <= forecast["yhat_upper"])).mean()
            ) * 100,
        }

        print("Timing Model Metrics:")
        print(f"  MAE: ${metrics['mae']:.2f}")
        print(f"  MAPE: {metrics['mape']:.1f}%")
        print(f"  Coverage: {metrics['coverage_95']:.1f}%")

        return metrics

    except Exception as e:
        print(f"Timing model evaluation failed: {e}")
        return {"error": str(e)}


def generate_evaluation_report(
    demand_metrics: dict,
    anomaly_metrics: dict,
    timing_metrics: dict,
) -> dict:
    """Generate comprehensive evaluation report."""

    report = {
        "generated_at": datetime.now().isoformat(),
        "demand_model": demand_metrics,
        "anomaly_model": anomaly_metrics,
        "timing_model": timing_metrics,
    }

    # Overall quality score
    quality_score = 0
    quality_factors = []

    # Demand model contribution
    if "r2" in demand_metrics:
        r2 = demand_metrics["r2"]
        if r2 > 0.7:
            quality_score += 40
            quality_factors.append("excellent_demand_r2")
        elif r2 > 0.5:
            quality_score += 30
            quality_factors.append("good_demand_r2")
        elif r2 > 0.3:
            quality_score += 20
            quality_factors.append("acceptable_demand_r2")

    if "direction_accuracy" in demand_metrics:
        acc = demand_metrics["direction_accuracy"]
        if acc > 0.6:
            quality_score += 20
            quality_factors.append("good_direction_accuracy")

    # Anomaly model contribution
    if "anomaly_rate" in anomaly_metrics:
        rate = anomaly_metrics["anomaly_rate"]
        if 0.01 < rate < 0.10:
            quality_score += 20
            quality_factors.append("reasonable_anomaly_rate")

    # Timing model contribution
    if "coverage_95" in timing_metrics:
        coverage = timing_metrics["coverage_95"]
        if coverage > 90:
            quality_score += 20
            quality_factors.append("good_prediction_coverage")

    report["quality_score"] = quality_score
    report["quality_factors"] = quality_factors

    # Pass/fail thresholds
    report["passes_threshold"] = demand_metrics.get("r2", 0) >= 0.5
    report["demand_r2"] = demand_metrics.get("r2", 0)

    return report


def save_report(report: dict, output_path: str):
    """Save evaluation report."""
    os.makedirs(output_path, exist_ok=True)

    # Main report
    report_path = os.path.join(output_path, "evaluation_report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Report saved to {report_path}")

    # Individual model metrics
    for model_name in ["demand_model", "anomaly_model", "timing_model"]:
        if model_name in report:
            metrics_path = os.path.join(output_path, f"{model_name.replace('_model', '')}_metrics.json")
            with open(metrics_path, "w") as f:
                json.dump(report[model_name], f, indent=2)


def main():
    # SageMaker paths
    demand_model_path = "/opt/ml/processing/model/demand"
    anomaly_model_path = "/opt/ml/processing/model/anomaly"
    timing_model_path = "/opt/ml/processing/model/timing"
    test_data_path = "/opt/ml/processing/test"
    output_path = "/opt/ml/processing/evaluation"

    # Load test data
    print("Loading test data...")
    test_df = load_test_data(test_data_path)
    print(f"Loaded {len(test_df)} test samples")

    # Evaluate demand model
    print("\nEvaluating demand model...")
    try:
        demand_model = load_model_artifact(demand_model_path, "model.json")
        demand_metrics = evaluate_demand_model(demand_model, test_df)
    except Exception as e:
        print(f"Demand model evaluation failed: {e}")
        demand_metrics = {"error": str(e)}

    # Evaluate anomaly model
    print("\nEvaluating anomaly model...")
    try:
        anomaly_model = load_model_artifact(anomaly_model_path, "model.pkl")
        scaler_path = os.path.join(anomaly_model_path, "scaler.pkl")
        with open(scaler_path, "rb") as f:
            scaler = pickle.load(f)
        anomaly_metrics = evaluate_anomaly_model(anomaly_model, scaler, test_df)
    except Exception as e:
        print(f"Anomaly model evaluation failed: {e}")
        anomaly_metrics = {"error": str(e)}

    # Evaluate timing model
    print("\nEvaluating timing model...")
    try:
        timing_model = load_model_artifact(timing_model_path, "model.pkl")
        timing_metrics = evaluate_timing_model(timing_model, test_df)
    except Exception as e:
        print(f"Timing model evaluation failed: {e}")
        timing_metrics = {"error": str(e)}

    # Generate report
    print("\nGenerating evaluation report...")
    report = generate_evaluation_report(demand_metrics, anomaly_metrics, timing_metrics)

    # Save report
    save_report(report, output_path)

    print("\nEvaluation complete!")
    print(f"  Quality Score: {report['quality_score']}/100")
    print(f"  Passes Threshold: {report['passes_threshold']}")
    print(f"  Quality Factors: {', '.join(report['quality_factors'])}")


if __name__ == "__main__":
    main()
