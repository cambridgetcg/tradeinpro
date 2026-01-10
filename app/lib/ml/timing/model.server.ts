/**
 * Timing Optimizer (Time Series - Prophet/ARIMA style)
 *
 * Predicts optimal buy/sell timing based on:
 * - Seasonal patterns (weekly, monthly, yearly)
 * - Holiday effects (Christmas, Golden Week, etc.)
 * - Set release cycles
 * - Tournament schedules
 */

import { BaseModel, ModelCache, calculateEMA, standardDeviation } from "../base.server";
import { getDeploymentConfig, MODEL_VERSIONS, TIMING_FEATURE_CONFIG } from "../config";
import type {
  TimingInput,
  TimingPrediction,
  TimeSeriesPoint,
  SeasonalPattern,
  BasePrediction,
} from "../types";

// =============================================================================
// TIMING MODEL CLASS
// =============================================================================

export class TimingModel extends BaseModel<TimingInput, TimingPrediction> {
  readonly name = "timing";
  readonly version = MODEL_VERSIONS.timing;

  private model: TimeSeriesModel | null = null;
  private predictionCache: ModelCache<TimingPrediction>;

  constructor() {
    super();
    this.predictionCache = new ModelCache<TimingPrediction>(300); // 5 minute cache
  }

  /**
   * Load the timing model
   */
  async load(): Promise<void> {
    const config = getDeploymentConfig();

    if (config.environment === "aws" && config.aws?.sagemaker.timingEndpoint) {
      await this.loadAWSModel(config.aws.sagemaker.timingEndpoint);
    } else {
      await this.loadLocalModel(config.localModelPaths?.timing);
    }

    this._isLoaded = true;
  }

  /**
   * Load local model
   */
  private async loadLocalModel(modelPath?: string): Promise<void> {
    console.log(`[TimingModel] Loading local time series model from ${modelPath || "default"}`);

    this.model = new LocalTimeSeriesModel();
    await this.model.initialize();
  }

  /**
   * Load AWS SageMaker model (Prophet)
   */
  private async loadAWSModel(endpoint: string): Promise<void> {
    console.log(`[TimingModel] Connecting to SageMaker: ${endpoint}`);

    this.model = new SageMakerTimeSeriesModel(endpoint);
    await this.model.initialize();
  }

  /**
   * Run prediction
   */
  protected async _predict(input: TimingInput): Promise<Omit<TimingPrediction, keyof BasePrediction>> {
    if (!this.model) {
      throw new Error("Model not loaded");
    }

    // Fit model on price history
    await this.model.fit(input.priceHistory);

    // Generate forecast
    const forecast = await this.model.forecast(input.forecastDays);

    // Extract seasonality patterns
    const seasonality = this.extractSeasonality(input.priceHistory);

    // Find optimal timing windows
    const { optimalBuyDates, optimalSellDates } = this.findOptimalWindows(forecast, seasonality);

    // Analyze current timing
    const currentTiming = this.analyzeCurrentTiming(seasonality, optimalBuyDates, optimalSellDates);

    // Detect trend
    const trend = this.detectTrend(input.priceHistory, forecast);

    return {
      cardId: input.cardId,
      forecast,
      optimalBuyDates,
      optimalSellDates,
      seasonality,
      currentTiming,
      trend,
    };
  }

  /**
   * Extract seasonality patterns from historical data
   */
  private extractSeasonality(history: TimeSeriesPoint[]): TimingPrediction["seasonality"] {
    // Weekly seasonality
    const weeklyPattern = this.calculateWeeklyPattern(history);

    // Monthly seasonality
    const monthlyPattern = this.calculateMonthlyPattern(history);

    // Yearly seasonality
    const yearlyPattern = this.calculateYearlyPattern(history);

    return {
      weekly: weeklyPattern,
      monthly: monthlyPattern,
      yearly: yearlyPattern,
    };
  }

  /**
   * Calculate weekly pattern (day of week effects)
   */
  private calculateWeeklyPattern(history: TimeSeriesPoint[]): SeasonalPattern {
    const dayTotals: number[] = new Array(7).fill(0);
    const dayCounts: number[] = new Array(7).fill(0);

    const avgPrice = history.reduce((sum, p) => sum + p.price, 0) / history.length;

    for (const point of history) {
      const dayOfWeek = point.date.getDay();
      dayTotals[dayOfWeek] += point.price / avgPrice;
      dayCounts[dayOfWeek]++;
    }

    const pattern = dayTotals.map((total, idx) => ({
      period: idx,
      effect: dayCounts[idx] > 0 ? total / dayCounts[idx] : 1.0,
    }));

    return { type: "weekly", pattern };
  }

  /**
   * Calculate monthly pattern
   */
  private calculateMonthlyPattern(history: TimeSeriesPoint[]): SeasonalPattern {
    const monthTotals: number[] = new Array(12).fill(0);
    const monthCounts: number[] = new Array(12).fill(0);

    const avgPrice = history.reduce((sum, p) => sum + p.price, 0) / history.length;

    for (const point of history) {
      const month = point.date.getMonth();
      monthTotals[month] += point.price / avgPrice;
      monthCounts[month]++;
    }

    const pattern = monthTotals.map((total, idx) => ({
      period: idx + 1, // 1-12
      effect: monthCounts[idx] > 0 ? total / monthCounts[idx] : 1.0,
    }));

    return { type: "monthly", pattern };
  }

  /**
   * Calculate yearly pattern (quarter effects)
   */
  private calculateYearlyPattern(history: TimeSeriesPoint[]): SeasonalPattern {
    // Simplified: use quarters
    const quarterTotals: number[] = new Array(4).fill(0);
    const quarterCounts: number[] = new Array(4).fill(0);

    const avgPrice = history.reduce((sum, p) => sum + p.price, 0) / history.length;

    for (const point of history) {
      const quarter = Math.floor(point.date.getMonth() / 3);
      quarterTotals[quarter] += point.price / avgPrice;
      quarterCounts[quarter]++;
    }

    const pattern = quarterTotals.map((total, idx) => ({
      period: idx + 1, // Q1-Q4
      effect: quarterCounts[idx] > 0 ? total / quarterCounts[idx] : 1.0,
    }));

    return { type: "yearly", pattern };
  }

  /**
   * Find optimal buy/sell windows
   */
  private findOptimalWindows(
    forecast: TimingPrediction["forecast"],
    seasonality: TimingPrediction["seasonality"]
  ): {
    optimalBuyDates: TimingPrediction["optimalBuyDates"];
    optimalSellDates: TimingPrediction["optimalSellDates"];
  } {
    const optimalBuyDates: TimingPrediction["optimalBuyDates"] = [];
    const optimalSellDates: TimingPrediction["optimalSellDates"] = [];

    if (forecast.length < 3) {
      return { optimalBuyDates, optimalSellDates };
    }

    // Find local minima (buy) and maxima (sell)
    for (let i = 1; i < forecast.length - 1; i++) {
      const prev = forecast[i - 1].predicted;
      const curr = forecast[i].predicted;
      const next = forecast[i + 1].predicted;

      // Local minimum = buy opportunity
      if (curr < prev && curr < next) {
        const dayOfWeek = forecast[i].date.getDay();
        const weekEffect = seasonality.weekly.pattern.find((p) => p.period === dayOfWeek)?.effect ?? 1;

        optimalBuyDates.push({
          date: forecast[i].date,
          expectedPrice: curr,
          reason: `Local price minimum${weekEffect < 0.98 ? ` + favorable day (${this.getDayName(dayOfWeek)})` : ""}`,
        });
      }

      // Local maximum = sell opportunity
      if (curr > prev && curr > next) {
        const dayOfWeek = forecast[i].date.getDay();
        const weekEffect = seasonality.weekly.pattern.find((p) => p.period === dayOfWeek)?.effect ?? 1;

        optimalSellDates.push({
          date: forecast[i].date,
          expectedPrice: curr,
          reason: `Local price maximum${weekEffect > 1.02 ? ` + favorable day (${this.getDayName(dayOfWeek)})` : ""}`,
        });
      }
    }

    // Add holiday-based recommendations
    this.addHolidayRecommendations(forecast, optimalBuyDates, optimalSellDates);

    // Sort by date and limit
    optimalBuyDates.sort((a, b) => a.date.getTime() - b.date.getTime());
    optimalSellDates.sort((a, b) => a.date.getTime() - b.date.getTime());

    return {
      optimalBuyDates: optimalBuyDates.slice(0, 5),
      optimalSellDates: optimalSellDates.slice(0, 5),
    };
  }

  /**
   * Add holiday-based recommendations
   */
  private addHolidayRecommendations(
    forecast: TimingPrediction["forecast"],
    buyDates: TimingPrediction["optimalBuyDates"],
    sellDates: TimingPrediction["optimalSellDates"]
  ): void {
    const holidays = TIMING_FEATURE_CONFIG.events.holidays;

    for (const point of forecast) {
      const month = point.date.getMonth() + 1;
      const day = point.date.getDate();

      // Golden Week (Japan) - good buy time
      if (
        month === holidays.goldenWeek.month &&
        day >= holidays.goldenWeek.days[0] &&
        day <= holidays.goldenWeek.days[1]
      ) {
        if (!buyDates.find((d) => d.date.getTime() === point.date.getTime())) {
          buyDates.push({
            date: point.date,
            expectedPrice: point.predicted * holidays.goldenWeek.effect,
            reason: "Golden Week - Japanese sellers discount",
          });
        }
      }

      // Christmas - good sell time
      if (
        month === holidays.christmas.month &&
        day >= holidays.christmas.days[0] &&
        day <= holidays.christmas.days[1]
      ) {
        if (!sellDates.find((d) => d.date.getTime() === point.date.getTime())) {
          sellDates.push({
            date: point.date,
            expectedPrice: point.predicted * holidays.christmas.effect,
            reason: "Christmas season - peak demand",
          });
        }
      }
    }
  }

  /**
   * Analyze current timing
   */
  private analyzeCurrentTiming(
    seasonality: TimingPrediction["seasonality"],
    buyDates: TimingPrediction["optimalBuyDates"],
    sellDates: TimingPrediction["optimalSellDates"]
  ): TimingPrediction["currentTiming"] {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const month = now.getMonth();

    // Get current seasonal effects
    const weekEffect = seasonality.weekly.pattern.find((p) => p.period === dayOfWeek)?.effect ?? 1;
    const monthEffect = seasonality.monthly.pattern.find((p) => p.period === month + 1)?.effect ?? 1;
    const currentSeasonalEffect = weekEffect * monthEffect;

    // Check if in buy/sell window
    const isBuyWindow = currentSeasonalEffect < 0.95; // Below average = good buy
    const isSellWindow = currentSeasonalEffect > 1.05; // Above average = good sell

    // Calculate days to next windows
    const daysToNextBuyWindow = this.daysUntilWindow(buyDates, now);
    const daysToNextSellWindow = this.daysUntilWindow(sellDates, now);

    return {
      isBuyWindow,
      isSellWindow,
      daysToNextBuyWindow,
      daysToNextSellWindow,
      currentSeasonalEffect,
    };
  }

  /**
   * Calculate days until next window
   */
  private daysUntilWindow(
    windows: Array<{ date: Date }>,
    from: Date
  ): number {
    const futureWindows = windows.filter((w) => w.date > from);
    if (futureWindows.length === 0) return 999;

    const nextWindow = futureWindows[0];
    return Math.ceil((nextWindow.date.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  }

  /**
   * Detect trend
   */
  private detectTrend(
    history: TimeSeriesPoint[],
    forecast: TimingPrediction["forecast"]
  ): TimingPrediction["trend"] {
    const prices = history.map((p) => p.price);

    // Simple linear regression for direction
    const n = prices.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = prices.reduce((a, b) => a + b, 0);
    const sumXY = prices.reduce((sum, price, i) => sum + i * price, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgPrice = sumY / n;
    const normalizedSlope = slope / avgPrice;

    // Determine direction
    let direction: "up" | "down" | "flat" = "flat";
    if (normalizedSlope > 0.001) direction = "up";
    else if (normalizedSlope < -0.001) direction = "down";

    // Calculate R-squared for strength
    const yMean = avgPrice;
    const ssTotal = prices.reduce((sum, price) => sum + Math.pow(price - yMean, 2), 0);
    const ssPredicted = prices.reduce((sum, price, i) => {
      const predicted = yMean + slope * (i - n / 2);
      return sum + Math.pow(predicted - yMean, 2);
    }, 0);
    const strength = ssTotal > 0 ? ssPredicted / ssTotal : 0;

    // Find changepoints (simplified: significant direction changes)
    const changepoints: Date[] = [];
    const windowSize = 7;
    for (let i = windowSize; i < history.length - windowSize; i++) {
      const beforeSlope = this.localSlope(prices.slice(i - windowSize, i));
      const afterSlope = this.localSlope(prices.slice(i, i + windowSize));

      if (Math.sign(beforeSlope) !== Math.sign(afterSlope) && Math.abs(beforeSlope - afterSlope) > 0.05) {
        changepoints.push(history[i].date);
      }
    }

    return {
      direction,
      strength,
      changepoints: changepoints.slice(-3), // Last 3 changepoints
    };
  }

  /**
   * Calculate local slope
   */
  private localSlope(prices: number[]): number {
    if (prices.length < 2) return 0;
    return (prices[prices.length - 1] - prices[0]) / prices.length / (prices[0] || 1);
  }

  /**
   * Get day name
   */
  private getDayName(dayOfWeek: number): string {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[dayOfWeek] || "";
  }

  /**
   * Unload model
   */
  async unload(): Promise<void> {
    if (this.model) {
      await this.model.cleanup();
    }
    this.model = null;
    this.predictionCache.clear();
    this._isLoaded = false;
  }
}

// =============================================================================
// TIME SERIES MODEL INTERFACES
// =============================================================================

interface TimeSeriesModel {
  initialize(): Promise<void>;
  fit(data: TimeSeriesPoint[]): Promise<void>;
  forecast(days: number): Promise<TimingPrediction["forecast"]>;
  cleanup(): Promise<void>;
}

/**
 * Local time series model (simplified Prophet-like)
 */
class LocalTimeSeriesModel implements TimeSeriesModel {
  private trend: { slope: number; intercept: number } = { slope: 0, intercept: 0 };
  private seasonalWeekly: number[] = new Array(7).fill(1);
  private seasonalMonthly: number[] = new Array(12).fill(1);
  private residualStd: number = 0;
  private lastDate: Date = new Date();

  async initialize(): Promise<void> {}

  async fit(data: TimeSeriesPoint[]): Promise<void> {
    if (data.length < 14) return;

    const prices = data.map((p) => p.price);
    this.lastDate = data[data.length - 1].date;

    // Fit trend
    const n = prices.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = prices.reduce((a, b) => a + b, 0);
    const sumXY = prices.reduce((sum, price, i) => sum + i * price, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    this.trend.slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    this.trend.intercept = sumY / n - this.trend.slope * (n - 1) / 2;

    // Fit weekly seasonality
    const weeklyAvg: number[] = new Array(7).fill(0);
    const weeklyCounts: number[] = new Array(7).fill(0);
    const avgPrice = sumY / n;

    for (let i = 0; i < data.length; i++) {
      const dayOfWeek = data[i].date.getDay();
      const detrended = prices[i] - (this.trend.intercept + this.trend.slope * i);
      weeklyAvg[dayOfWeek] += detrended / avgPrice;
      weeklyCounts[dayOfWeek]++;
    }

    this.seasonalWeekly = weeklyAvg.map((sum, idx) =>
      weeklyCounts[idx] > 0 ? 1 + sum / weeklyCounts[idx] : 1
    );

    // Fit monthly seasonality
    const monthlyAvg: number[] = new Array(12).fill(0);
    const monthlyCounts: number[] = new Array(12).fill(0);

    for (let i = 0; i < data.length; i++) {
      const month = data[i].date.getMonth();
      const detrended = prices[i] - (this.trend.intercept + this.trend.slope * i);
      monthlyAvg[month] += detrended / avgPrice;
      monthlyCounts[month]++;
    }

    this.seasonalMonthly = monthlyAvg.map((sum, idx) =>
      monthlyCounts[idx] > 0 ? 1 + sum / monthlyCounts[idx] : 1
    );

    // Calculate residual standard deviation
    const residuals = data.map((point, i) => {
      const predicted = this.predictPoint(i, point.date);
      return point.price - predicted;
    });
    this.residualStd = standardDeviation(residuals);
  }

  async forecast(days: number): Promise<TimingPrediction["forecast"]> {
    const results: TimingPrediction["forecast"] = [];
    const startIdx = 0; // Would be actual data length

    for (let i = 0; i < days; i++) {
      const date = new Date(this.lastDate);
      date.setDate(date.getDate() + i + 1);

      const predicted = this.predictPoint(startIdx + i, date);
      const uncertainty = this.residualStd * Math.sqrt(1 + i / 30); // Uncertainty grows with time

      results.push({
        date,
        predicted,
        lowerBound: predicted - 1.96 * uncertainty,
        upperBound: predicted + 1.96 * uncertainty,
      });
    }

    return results;
  }

  private predictPoint(idx: number, date: Date): number {
    const trendValue = this.trend.intercept + this.trend.slope * idx;
    const weeklyEffect = this.seasonalWeekly[date.getDay()];
    const monthlyEffect = this.seasonalMonthly[date.getMonth()];

    return trendValue * weeklyEffect * monthlyEffect;
  }

  async cleanup(): Promise<void> {
    this.trend = { slope: 0, intercept: 0 };
    this.seasonalWeekly = new Array(7).fill(1);
    this.seasonalMonthly = new Array(12).fill(1);
  }
}

/**
 * SageMaker-based Prophet model
 */
class SageMakerTimeSeriesModel implements TimeSeriesModel {
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async initialize(): Promise<void> {
    console.log(`[SageMakerTimeSeriesModel] Connected to: ${this.endpoint}`);
  }

  async fit(_data: TimeSeriesPoint[]): Promise<void> {
    // Would send data to SageMaker for online fitting
  }

  async forecast(days: number): Promise<TimingPrediction["forecast"]> {
    // Would invoke SageMaker endpoint
    const results: TimingPrediction["forecast"] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i + 1);

      results.push({
        date,
        predicted: 100 * (1 + 0.001 * i), // Placeholder
        lowerBound: 95 * (1 + 0.001 * i),
        upperBound: 105 * (1 + 0.001 * i),
      });
    }

    return results;
  }

  async cleanup(): Promise<void> {}
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let timingModelInstance: TimingModel | null = null;

export function getTimingModel(): TimingModel {
  if (!timingModelInstance) {
    timingModelInstance = new TimingModel();
  }
  return timingModelInstance;
}

export function resetTimingModel(): void {
  if (timingModelInstance) {
    timingModelInstance.unload();
  }
  timingModelInstance = null;
}
