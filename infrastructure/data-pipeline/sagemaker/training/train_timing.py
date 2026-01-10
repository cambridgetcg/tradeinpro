"""
Timing Prediction Model Training Script

Prophet-based model for predicting optimal buy/sell timing:
- Price seasonality patterns
- Weekly/monthly cycles
- Release cycle effects
- Market phase transitions

Run via SageMaker Training Job
"""

import argparse
import os
import json
import pickle
from pathlib import Path
from datetime import datetime, timedelta

import pandas as pd
import numpy as np


def load_data(input_path: str) -> pd.DataFrame:
    """Load training data from S3."""
    print(f"Loading data from {input_path}")

    df = pd.read_parquet(input_path)

    print(f"Loaded {len(df)} records")

    return df


def prepare_prophet_data(df: pd.DataFrame, card_id: str = None) -> pd.DataFrame:
    """Prepare data for Prophet model."""

    # Filter to specific card if provided
    if card_id:
        df = df[df["card_id"] == card_id].copy()

    # Ensure date column exists and is properly formatted
    if "date" in df.columns:
        df["ds"] = pd.to_datetime(df["date"])
    elif "collected_at" in df.columns:
        df["ds"] = pd.to_datetime(df["collected_at"]).dt.date

    # Use average price as target
    if "avg_price" in df.columns:
        df["y"] = df["avg_price"]
    elif "price_current" in df.columns:
        df["y"] = df["price_current"]

    # Aggregate by date if multiple records
    prophet_df = df.groupby("ds").agg({
        "y": "mean",
    }).reset_index()

    # Sort by date
    prophet_df = prophet_df.sort_values("ds")

    # Fill gaps with forward fill
    date_range = pd.date_range(
        start=prophet_df["ds"].min(),
        end=prophet_df["ds"].max(),
        freq="D"
    )
    prophet_df = prophet_df.set_index("ds").reindex(date_range).ffill().reset_index()
    prophet_df = prophet_df.rename(columns={"index": "ds"})

    return prophet_df


def train_prophet_model(df: pd.DataFrame, params: dict):
    """Train Prophet model."""
    try:
        from prophet import Prophet
    except ImportError:
        print("Prophet not available, using fallback model")
        return train_fallback_model(df, params)

    # Initialize Prophet with parameters
    model = Prophet(
        changepoint_prior_scale=params.get("changepoint_prior_scale", 0.05),
        seasonality_prior_scale=params.get("seasonality_prior_scale", 10.0),
        holidays_prior_scale=params.get("holidays_prior_scale", 10.0),
        seasonality_mode=params.get("seasonality_mode", "multiplicative"),
        yearly_seasonality=params.get("yearly_seasonality", True),
        weekly_seasonality=params.get("weekly_seasonality", True),
        daily_seasonality=False,
        interval_width=0.95,
    )

    # Add custom seasonalities
    model.add_seasonality(
        name="monthly",
        period=30.5,
        fourier_order=5,
    )

    # Add card game release cycle seasonality (approximately every 3 months)
    model.add_seasonality(
        name="release_cycle",
        period=91.25,
        fourier_order=3,
    )

    # Fit model
    print("Fitting Prophet model...")
    model.fit(df)

    return model


def train_fallback_model(df: pd.DataFrame, params: dict):
    """Simple fallback model when Prophet is not available."""

    class SimpleForecastModel:
        def __init__(self):
            self.avg_by_weekday = None
            self.avg_by_month = None
            self.overall_mean = None
            self.trend_slope = None

        def fit(self, df):
            df = df.copy()
            df["weekday"] = pd.to_datetime(df["ds"]).dt.dayofweek
            df["month"] = pd.to_datetime(df["ds"]).dt.month

            self.avg_by_weekday = df.groupby("weekday")["y"].mean().to_dict()
            self.avg_by_month = df.groupby("month")["y"].mean().to_dict()
            self.overall_mean = df["y"].mean()

            # Simple trend
            df["day_num"] = (pd.to_datetime(df["ds"]) - pd.to_datetime(df["ds"]).min()).dt.days
            if len(df) > 1:
                self.trend_slope = np.polyfit(df["day_num"], df["y"], 1)[0]
            else:
                self.trend_slope = 0

            return self

        def predict(self, future):
            future = future.copy()
            future["weekday"] = pd.to_datetime(future["ds"]).dt.dayofweek
            future["month"] = pd.to_datetime(future["ds"]).dt.month
            future["day_num"] = (pd.to_datetime(future["ds"]) - pd.to_datetime(future["ds"]).min()).dt.days

            # Base prediction
            future["yhat"] = self.overall_mean

            # Apply weekday seasonality
            future["weekly_effect"] = future["weekday"].map(self.avg_by_weekday) / self.overall_mean
            future["yhat"] = future["yhat"] * future["weekly_effect"]

            # Apply monthly seasonality
            future["monthly_effect"] = future["month"].map(self.avg_by_month) / self.overall_mean
            future["yhat"] = future["yhat"] * future["monthly_effect"]

            # Apply trend
            future["yhat"] = future["yhat"] + self.trend_slope * future["day_num"]

            # Simple confidence intervals
            std = self.overall_mean * 0.1
            future["yhat_lower"] = future["yhat"] - 1.96 * std
            future["yhat_upper"] = future["yhat"] + 1.96 * std

            return future[["ds", "yhat", "yhat_lower", "yhat_upper"]]

        def make_future_dataframe(self, periods, freq="D"):
            last_date = pd.to_datetime("2024-01-01")  # Placeholder
            future_dates = pd.date_range(start=last_date, periods=periods, freq=freq)
            return pd.DataFrame({"ds": future_dates})

    model = SimpleForecastModel()
    model.fit(df)

    return model


def evaluate_model(model, df: pd.DataFrame, holdout_days: int = 14) -> dict:
    """Evaluate model with time-based holdout."""

    # Split into train/test
    cutoff_date = df["ds"].max() - timedelta(days=holdout_days)
    train_df = df[df["ds"] <= cutoff_date]
    test_df = df[df["ds"] > cutoff_date]

    if len(test_df) == 0:
        print("Not enough data for holdout evaluation")
        return {"error": "insufficient_data"}

    # Make predictions
    future = model.make_future_dataframe(periods=len(test_df))
    forecast = model.predict(future)

    # Merge with actuals
    forecast = forecast.merge(test_df[["ds", "y"]], on="ds", how="inner")

    if len(forecast) == 0:
        return {"error": "no_overlapping_dates"}

    # Calculate metrics
    y_true = forecast["y"].values
    y_pred = forecast["yhat"].values

    metrics = {
        "mae": float(np.mean(np.abs(y_true - y_pred))),
        "mape": float(np.mean(np.abs(y_true - y_pred) / np.abs(y_true))) * 100,
        "rmse": float(np.sqrt(np.mean((y_true - y_pred) ** 2))),
        "coverage": float(
            ((forecast["yhat_lower"] <= forecast["y"]) &
             (forecast["y"] <= forecast["yhat_upper"])).mean()
        ) * 100,
        "holdout_days": holdout_days,
        "test_samples": len(forecast),
    }

    print("\nEvaluation Metrics:")
    print(f"  MAE: ${metrics['mae']:.2f}")
    print(f"  MAPE: {metrics['mape']:.1f}%")
    print(f"  RMSE: ${metrics['rmse']:.2f}")
    print(f"  Coverage (95% CI): {metrics['coverage']:.1f}%")

    return metrics


def extract_seasonality(model, df: pd.DataFrame) -> dict:
    """Extract seasonality patterns from model."""

    try:
        # For Prophet
        future = model.make_future_dataframe(periods=365)
        forecast = model.predict(future)

        # Weekly seasonality
        weekly = forecast.groupby(forecast["ds"].dt.dayofweek)["weekly"].mean()
        weekly_pattern = {
            "Monday": float(weekly.get(0, 0)),
            "Tuesday": float(weekly.get(1, 0)),
            "Wednesday": float(weekly.get(2, 0)),
            "Thursday": float(weekly.get(3, 0)),
            "Friday": float(weekly.get(4, 0)),
            "Saturday": float(weekly.get(5, 0)),
            "Sunday": float(weekly.get(6, 0)),
        }

        # Monthly seasonality
        monthly = forecast.groupby(forecast["ds"].dt.month)["monthly"].mean()
        monthly_pattern = {str(k): float(v) for k, v in monthly.items()}

        # Best days to buy/sell
        best_buy_day = min(weekly_pattern, key=weekly_pattern.get)
        best_sell_day = max(weekly_pattern, key=weekly_pattern.get)

        return {
            "weekly": weekly_pattern,
            "monthly": monthly_pattern,
            "best_buy_day": best_buy_day,
            "best_sell_day": best_sell_day,
        }

    except Exception as e:
        print(f"Could not extract seasonality: {e}")
        return {}


def generate_trading_signals(model, forecast: pd.DataFrame, threshold: float = 0.05) -> pd.DataFrame:
    """Generate buy/sell signals from forecast."""

    signals = forecast.copy()

    # Calculate expected return over next 7 days
    signals["return_7d"] = (signals["yhat"].shift(-7) - signals["yhat"]) / signals["yhat"]

    # Generate signals
    signals["signal"] = "hold"
    signals.loc[signals["return_7d"] > threshold, "signal"] = "buy"
    signals.loc[signals["return_7d"] < -threshold, "signal"] = "sell"

    # Confidence based on prediction interval width
    signals["confidence"] = 1 - (
        (signals["yhat_upper"] - signals["yhat_lower"]) / signals["yhat"]
    )
    signals["confidence"] = signals["confidence"].clip(0, 1)

    return signals[["ds", "yhat", "signal", "confidence", "return_7d"]]


def save_model(model, output_path: str, params: dict, metrics: dict, seasonality: dict):
    """Save model and artifacts."""

    os.makedirs(output_path, exist_ok=True)

    # Save model
    model_path = os.path.join(output_path, "model.pkl")
    with open(model_path, "wb") as f:
        pickle.dump(model, f)
    print(f"Model saved to {model_path}")

    # Save parameters
    params_path = os.path.join(output_path, "params.json")
    with open(params_path, "w") as f:
        json.dump(params, f, indent=2)

    # Save metrics
    metrics_path = os.path.join(output_path, "metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)

    # Save seasonality patterns
    seasonality_path = os.path.join(output_path, "seasonality.json")
    with open(seasonality_path, "w") as f:
        json.dump(seasonality, f, indent=2)

    print(f"Artifacts saved to {output_path}")


def main():
    parser = argparse.ArgumentParser()

    # Data paths
    parser.add_argument("--train-data", type=str, default=os.environ.get("SM_CHANNEL_TRAIN"))
    parser.add_argument("--model-dir", type=str, default=os.environ.get("SM_MODEL_DIR", "/opt/ml/model"))
    parser.add_argument("--output-dir", type=str, default=os.environ.get("SM_OUTPUT_DATA_DIR", "/opt/ml/output"))

    # Hyperparameters
    parser.add_argument("--changepoint-prior-scale", type=float, default=0.05)
    parser.add_argument("--seasonality-prior-scale", type=float, default=10.0)
    parser.add_argument("--seasonality-mode", type=str, default="multiplicative")
    parser.add_argument("--holdout-days", type=int, default=14)
    parser.add_argument("--card-id", type=str, default=None)

    args = parser.parse_args()

    # Hyperparameters
    params = {
        "changepoint_prior_scale": args.changepoint_prior_scale,
        "seasonality_prior_scale": args.seasonality_prior_scale,
        "seasonality_mode": args.seasonality_mode,
        "yearly_seasonality": True,
        "weekly_seasonality": True,
    }

    print("Hyperparameters:")
    for k, v in params.items():
        print(f"  {k}: {v}")

    # Load data
    df = load_data(args.train_data)

    # Prepare for Prophet
    prophet_df = prepare_prophet_data(df, args.card_id)

    print(f"\nDataset: {len(prophet_df)} daily observations")
    print(f"Date range: {prophet_df['ds'].min()} to {prophet_df['ds'].max()}")

    # Train model
    print("\nTraining timing model...")
    model = train_prophet_model(prophet_df, params)

    # Evaluate
    metrics = evaluate_model(model, prophet_df, args.holdout_days)

    # Extract seasonality
    seasonality = extract_seasonality(model, prophet_df)
    if seasonality:
        print(f"\nBest day to buy: {seasonality.get('best_buy_day', 'Unknown')}")
        print(f"Best day to sell: {seasonality.get('best_sell_day', 'Unknown')}")

    # Generate forecast
    print("\nGenerating 30-day forecast...")
    future = model.make_future_dataframe(periods=30)
    forecast = model.predict(future)

    # Generate trading signals
    signals = generate_trading_signals(model, forecast)
    recent_signals = signals.tail(30)
    buy_signals = (recent_signals["signal"] == "buy").sum()
    sell_signals = (recent_signals["signal"] == "sell").sum()
    print(f"Next 30 days: {buy_signals} buy signals, {sell_signals} sell signals")

    # Save model
    save_model(model, args.model_dir, params, metrics, seasonality)

    print("\nTraining complete!")


if __name__ == "__main__":
    main()
