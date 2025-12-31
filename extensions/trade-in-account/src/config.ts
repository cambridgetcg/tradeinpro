/**
 * Configuration for the Trade-In Customer Account Extension
 *
 * Centralized configuration for API endpoints, timeouts, and token management.
 * Follows best practices from production Shopify apps.
 */

export const CONFIG = {
  /**
   * App Proxy path (appended to shop domain)
   * Full URL will be: https://{shop}/apps/trade-in
   */
  API_PROXY_PATH: '/apps/trade-in',

  /**
   * Token refresh interval in milliseconds
   * Session tokens expire in 5 minutes, so we refresh at 4 minutes
   */
  TOKEN_REFRESH_INTERVAL: 240000, // 4 minutes

  /**
   * API request timeout in milliseconds
   */
  API_TIMEOUT: 10000, // 10 seconds

  /**
   * Enable debug logging
   * Set to true to see detailed logs in browser console
   */
  DEBUG_MODE: true,

  /**
   * Maximum retry attempts for failed API calls
   */
  MAX_RETRIES: 2,

  /**
   * Retry delay in milliseconds
   */
  RETRY_DELAY: 1000,
} as const;

export type Config = typeof CONFIG;
