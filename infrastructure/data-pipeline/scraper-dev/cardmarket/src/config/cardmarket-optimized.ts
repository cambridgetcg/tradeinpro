/**
 * Cardmarket-Optimized Configuration
 *
 * Based on technology stack analysis:
 * - React frontend with SSR + hydration
 * - TypeScript/AWS Lambda backend
 * - Custom BWSTATE anti-bot system (NOT standard Cloudflare)
 * - Proof-of-Work + Image CAPTCHA challenges
 */

/**
 * Rate limit configuration based on community research
 * Sources:
 * - RichyLe69/CardMarketScraper: 3-5 seconds recommended
 * - Apify scrapers: batch processing with delays
 * - Community consensus: sequential processing essential
 */
export const RATE_LIMIT_CONFIG = {
  // Base delay between requests (ms)
  baseDelayMs: 3500,

  // Variance to appear human (±30%)
  variancePercent: 0.3,

  // Longer delay between different cards
  interCardDelayMs: 5000,

  // Very long delay between sets (avoid pattern detection)
  interSetDelayMs: 30000,

  // Daily limits to avoid long-term blocking
  maxRequestsPerHour: 180,
  maxRequestsPerDay: 1800,

  // Off-peak hours (UTC) for safer scraping
  preferredHoursUTC: [2, 3, 4, 5, 6, 7],

  // Token bucket configuration
  bucketSize: 10,
  refillRate: 0.3,  // tokens per second (~18/min)
} as const;

/**
 * Browser configuration optimized for Cardmarket's anti-bot
 */
export const BROWSER_CONFIG = {
  // Use new Chrome headless mode (better stealth)
  headless: 'new' as const,

  // Chrome remote debugging for session persistence
  useRemoteDebugging: true,
  debuggingPort: 9222,

  // Persist session data
  userDataDir: './cardmarket-session',

  // Args to avoid detection
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ],

  // Viewport matching common resolution
  viewport: {
    width: 1920,
    height: 1080,
  },

  // Timeouts
  navigationTimeout: 30000,
  selectorTimeout: 10000,
} as const;

/**
 * Escalation triggers for hybrid scraper
 * Cardmarket-specific: detect BWSTATE challenges
 */
export const ESCALATION_CONFIG = {
  triggers: [
    { type: 'status', value: 403, threshold: 1 },
    { type: 'status', value: 429, threshold: 1 },
    { type: 'status', value: 503, threshold: 2 },
    { type: 'bodyContains', value: 'human-test', threshold: 1 },
    { type: 'bodyContains', value: 'BWSTATE', threshold: 1 },
    { type: 'bodyContains', value: '/human-test/start', threshold: 1 },
  ],

  // De-escalate after sustained HTTP success
  deescalationThreshold: 10,

  // Browser session TTL before refresh
  sessionTTL: 30 * 60 * 1000,  // 30 minutes

  // Max retries before giving up
  maxRetries: 3,
} as const;

/**
 * Circuit breaker configuration
 */
export const CIRCUIT_BREAKER_CONFIG = {
  // Global defaults
  default: {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 5 * 60 * 1000,  // 5 minutes
    monitoringWindow: 60 * 1000,  // 1 minute
  },

  // Per-endpoint overrides
  endpoints: {
    expansion: {
      failureThreshold: 5,
      successThreshold: 3,
    },
    cardDetail: {
      failureThreshold: 3,
      successThreshold: 2,
    },
    articles: {
      failureThreshold: 3,
      successThreshold: 2,
    },
  },
} as const;

/**
 * Selector degradation monitoring
 */
export const SELECTOR_MONITORING_CONFIG = {
  // Alert when success rate drops below threshold
  alertThreshold: 0.3,

  // Weight for exponential moving average
  emaWeight: 0.9,

  // Minimum attempts before alerting
  minAttempts: 10,

  // Log selector performance every N requests
  logInterval: 50,
} as const;

/**
 * Session management for BWSTATE cookies
 */
export const SESSION_CONFIG = {
  // Cookie names to preserve
  criticalCookies: [
    'BWSTATE',
    'PHPSESSID',
    'cf_clearance',
  ],

  // Session validation interval
  validationIntervalMs: 5 * 60 * 1000,  // 5 minutes

  // Re-harvest session after this many failures
  reharvestAfterFailures: 3,

  // Manual CAPTCHA timeout (development only)
  manualCaptchaTimeoutMs: 5 * 60 * 1000,  // 5 minutes
} as const;

/**
 * Proxy configuration optimized for Cardmarket
 */
export const PROXY_CONFIG = {
  // Residential proxies required (datacenter blocked)
  type: 'residential' as const,

  // EU countries only (Cardmarket is EU-based)
  allowedCountries: ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PL'],

  // Sticky sessions for request consistency
  rotationStrategy: 'sticky' as const,

  // Session duration
  sessionDurationMs: 10 * 60 * 1000,  // 10 minutes

  // Rotate on specific errors
  rotateOnStatus: [403, 429, 503],
} as const;

/**
 * Content detection patterns
 */
export const DETECTION_PATTERNS = {
  // BWSTATE challenge indicators
  bwstateChallenge: [
    '/human-test/start',
    '/human-test/prompt',
    '/human-test/verify',
    'X-Captcha-Id',
    'BWSTATE',
  ],

  // Cloudflare challenge indicators (less common)
  cloudflareChallenge: [
    'cf_clearance',
    'cf-ray',
    '_cf_chl_tk',
    'Checking your browser',
  ],

  // Rate limit indicators
  rateLimited: [
    'too many requests',
    'rate limit',
    'please try again later',
    '429',
  ],

  // Valid page indicators
  validPage: [
    'cardmarket.com',
    'Cardmarket',
    'MKM',
    'info-list-container',
    'col-product',
  ],
} as const;

/**
 * Hydration wait configuration for React pages
 */
export const HYDRATION_CONFIG = {
  // Wait for React hydration indicators
  hydrationSelectors: [
    '[data-reactroot]',
    '#app[data-server-rendered]',
    '.hydrated',
  ],

  // Content selectors to wait for
  contentSelectors: {
    expansion: '.table-body .row, .product-row',
    cardDetail: '.info-list-container',
    articles: '.article-row',
  },

  // Timeout for hydration
  hydrationTimeoutMs: 10000,

  // Additional wait after hydration for dynamic content
  postHydrationDelayMs: 1000,
} as const;

/**
 * Full optimized configuration export
 */
export const CARDMARKET_OPTIMIZED_CONFIG = {
  rateLimit: RATE_LIMIT_CONFIG,
  browser: BROWSER_CONFIG,
  escalation: ESCALATION_CONFIG,
  circuitBreaker: CIRCUIT_BREAKER_CONFIG,
  selectorMonitoring: SELECTOR_MONITORING_CONFIG,
  session: SESSION_CONFIG,
  proxy: PROXY_CONFIG,
  detection: DETECTION_PATTERNS,
  hydration: HYDRATION_CONFIG,
} as const;

export type CardmarketOptimizedConfig = typeof CARDMARKET_OPTIMIZED_CONFIG;
