/**
 * FX Rate Collector
 *
 * Fetches exchange rates for currency conversion
 * Supports multiple providers with fallback
 *
 * Primary: Open Exchange Rates (free tier: 1000 requests/month)
 * Fallback: Exchange Rate API (exchangerate-api.com)
 */

import type { FXRates, FXRateResponse } from "../types";

// =============================================================================
// CONFIGURATION
// =============================================================================

const OPEN_EXCHANGE_RATES_BASE = "https://openexchangerates.org/api";
const EXCHANGE_RATE_API_BASE = "https://api.exchangerate-api.com/v4";
const DEFAULT_TIMEOUT = 10000;

// Default rates as fallback (updated 2026-01-09)
const DEFAULT_RATES: FXRates = {
  USDGBP: 0.79,
  EURGBP: 0.85,
  JPYGBP: 0.0053,
  timestamp: new Date(),
};

// =============================================================================
// FX RATE CLIENT
// =============================================================================

export class FXRateClient {
  private openExchangeRatesAppId?: string;
  private cachedRates: FXRates | null = null;
  private cacheExpiry: Date | null = null;
  private cacheDurationMs: number;

  constructor(
    openExchangeRatesAppId?: string,
    cacheDurationMs: number = 60 * 60 * 1000 // 1 hour default
  ) {
    this.openExchangeRatesAppId = openExchangeRatesAppId;
    this.cacheDurationMs = cacheDurationMs;
  }

  /**
   * Get current exchange rates with caching
   */
  async getRates(forceRefresh: boolean = false): Promise<FXRates> {
    // Check cache
    if (
      !forceRefresh &&
      this.cachedRates &&
      this.cacheExpiry &&
      new Date() < this.cacheExpiry
    ) {
      return this.cachedRates;
    }

    // Try primary provider
    try {
      const rates = await this.fetchFromOpenExchangeRates();
      this.updateCache(rates);
      return rates;
    } catch (primaryError) {
      console.warn(
        "Primary FX provider failed:",
        primaryError instanceof Error ? primaryError.message : primaryError
      );
    }

    // Try fallback provider
    try {
      const rates = await this.fetchFromExchangeRateAPI();
      this.updateCache(rates);
      return rates;
    } catch (fallbackError) {
      console.warn(
        "Fallback FX provider failed:",
        fallbackError instanceof Error ? fallbackError.message : fallbackError
      );
    }

    // Return cached rates if available (even if expired)
    if (this.cachedRates) {
      console.warn("Using expired cached FX rates");
      return this.cachedRates;
    }

    // Return default rates as last resort
    console.warn("Using default FX rates");
    return DEFAULT_RATES;
  }

  /**
   * Fetch rates from Open Exchange Rates
   */
  private async fetchFromOpenExchangeRates(): Promise<FXRates> {
    if (!this.openExchangeRatesAppId) {
      throw new Error("Open Exchange Rates App ID not configured");
    }

    const url = `${OPEN_EXCHANGE_RATES_BASE}/latest.json?app_id=${this.openExchangeRatesAppId}&base=USD&symbols=GBP,EUR,JPY`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: FXRateResponse = await response.json();

      // Open Exchange Rates returns rates vs USD
      // We need rates vs GBP
      const usdToGbp = data.rates.GBP;
      const eurToUsd = 1 / data.rates.EUR;
      const jpyToUsd = 1 / data.rates.JPY;

      return {
        USDGBP: usdToGbp,
        EURGBP: eurToUsd * usdToGbp,
        JPYGBP: jpyToUsd * usdToGbp,
        timestamp: new Date(data.timestamp * 1000),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch rates from Exchange Rate API (fallback)
   */
  private async fetchFromExchangeRateAPI(): Promise<FXRates> {
    const url = `${EXCHANGE_RATE_API_BASE}/latest/GBP`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Exchange Rate API returns rates vs base currency (GBP in our case)
      // So we need to invert: if GBP->USD is 1.27, then USD->GBP is 1/1.27
      return {
        USDGBP: 1 / data.rates.USD,
        EURGBP: 1 / data.rates.EUR,
        JPYGBP: 1 / data.rates.JPY,
        timestamp: new Date(),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Update the cache
   */
  private updateCache(rates: FXRates): void {
    this.cachedRates = rates;
    this.cacheExpiry = new Date(Date.now() + this.cacheDurationMs);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cachedRates = null;
    this.cacheExpiry = null;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let clientInstance: FXRateClient | null = null;

export function getFXRateClient(): FXRateClient {
  if (!clientInstance) {
    const appId = process.env.OPEN_EXCHANGE_RATES_APP_ID;
    clientInstance = new FXRateClient(appId);
  }
  return clientInstance;
}

export function resetFXRateClient(): void {
  clientInstance = null;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert USD to GBP
 */
export function usdToGbp(usdAmount: number, rates: FXRates): number {
  return usdAmount * rates.USDGBP;
}

/**
 * Convert EUR to GBP
 */
export function eurToGbp(eurAmount: number, rates: FXRates): number {
  return eurAmount * rates.EURGBP;
}

/**
 * Convert JPY to GBP
 */
export function jpyToGbp(jpyAmount: number, rates: FXRates): number {
  return jpyAmount * rates.JPYGBP;
}

/**
 * Convert GBP to USD
 */
export function gbpToUsd(gbpAmount: number, rates: FXRates): number {
  return gbpAmount / rates.USDGBP;
}

/**
 * Convert GBP to EUR
 */
export function gbpToEur(gbpAmount: number, rates: FXRates): number {
  return gbpAmount / rates.EURGBP;
}

/**
 * Get all conversion rates for a given amount in GBP
 */
export function convertFromGbp(
  gbpAmount: number,
  rates: FXRates
): { usd: number; eur: number; jpy: number } {
  return {
    usd: gbpToUsd(gbpAmount, rates),
    eur: gbpToEur(gbpAmount, rates),
    jpy: gbpAmount / rates.JPYGBP,
  };
}

/**
 * Get the inverse rate (e.g., GBP to USD instead of USD to GBP)
 */
export function inverseRate(rate: number): number {
  return 1 / rate;
}
