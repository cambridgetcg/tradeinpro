/**
 * TCGplayer Scraper Configuration
 *
 * Central configuration management for multi-source price data fetching.
 * Supports: OPTCG API, JustTCG API, Direct Scraping fallback
 */

import { z } from 'zod';

// Environment variable schema validation
const EnvSchema = z.object({
  // API Keys
  JUSTTCG_API_KEY: z.string().optional(),

  // AWS Configuration
  AWS_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('tcgplayer-price-data'),
  SQS_QUEUE_URL: z.string().optional(),

  // Database
  DATABASE_URL: z.string().optional(),

  // Scraping Configuration
  SCRAPING_ENABLED: z.coerce.boolean().default(false),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().default(2),
  REQUEST_DELAY_MS: z.coerce.number().default(3000),

  // Proxy Configuration
  PROXY_HOST: z.string().optional(),
  PROXY_PORT: z.coerce.number().optional(),
  PROXY_USERNAME: z.string().optional(),
  PROXY_PASSWORD: z.string().optional(),

  // Development
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DEBUG: z.coerce.boolean().default(false),
});

type EnvConfig = z.infer<typeof EnvSchema>;

// Parse and validate environment
let envConfig: EnvConfig;
try {
  envConfig = EnvSchema.parse(process.env);
} catch {
  envConfig = EnvSchema.parse({});
}

/**
 * Data source configuration
 */
export interface DataSourceConfig {
  optcg: {
    enabled: boolean;
    baseUrl: string;
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
  justTcg: {
    enabled: boolean;
    apiKey: string | null;
    baseUrl: string;
    timeout: number;
    retryAttempts: number;
  };
  scraper: {
    enabled: boolean;
    baseUrl: string;
    timeout: number;
    maxConcurrent: number;
    requestDelay: number;
    headless: boolean;
  };
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  optcg: {
    requestsPerMinute: number;
    requestsPerHour: number;
  };
  justTcg: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  scraper: {
    requestsPerMinute: number;
    pageDelay: number;
    sessionRotateAfter: number;
  };
}

/**
 * Main configuration object
 */
export const config = {
  env: envConfig,

  // Data sources with priority order
  dataSources: {
    optcg: {
      enabled: true,
      baseUrl: 'https://api.optcgapi.com/api',
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
    },
    justTcg: {
      enabled: !!envConfig.JUSTTCG_API_KEY,
      apiKey: envConfig.JUSTTCG_API_KEY || null,
      baseUrl: 'https://api.justtcg.com/v1',
      timeout: 30000,
      retryAttempts: 3,
    },
    scraper: {
      enabled: envConfig.SCRAPING_ENABLED,
      baseUrl: 'https://www.tcgplayer.com',
      timeout: 60000,
      maxConcurrent: envConfig.MAX_CONCURRENT_REQUESTS,
      requestDelay: envConfig.REQUEST_DELAY_MS,
      headless: envConfig.NODE_ENV === 'production',
    },
  } as DataSourceConfig,

  // Rate limiting per source
  rateLimits: {
    optcg: {
      requestsPerMinute: 60, // Generous limits for free API
      requestsPerHour: 1000,
    },
    justTcg: {
      requestsPerMinute: 30, // Paid API, still be respectful
      requestsPerDay: 10000,
    },
    scraper: {
      requestsPerMinute: 5, // Conservative for direct scraping
      pageDelay: 3000,
      sessionRotateAfter: 50, // Rotate fingerprint after N requests
    },
  } as RateLimitConfig,

  // AWS Configuration
  aws: {
    region: envConfig.AWS_REGION,
    s3: {
      bucket: envConfig.S3_BUCKET,
      prefix: 'tcgplayer',
    },
    sqs: {
      queueUrl: envConfig.SQS_QUEUE_URL,
    },
  },

  // Database
  database: {
    url: envConfig.DATABASE_URL,
  },

  // Proxy configuration
  proxy: envConfig.PROXY_HOST
    ? {
        host: envConfig.PROXY_HOST,
        port: envConfig.PROXY_PORT || 8080,
        username: envConfig.PROXY_USERNAME,
        password: envConfig.PROXY_PASSWORD,
      }
    : null,

  // Currency conversion (USD to GBP)
  currency: {
    defaultExchangeRate: 0.79, // Updated periodically
    exchangeRateApiUrl: 'https://api.exchangerate-api.com/v4/latest/USD',
  },

  // Logging
  logging: {
    level: envConfig.DEBUG ? 'debug' : 'info',
    format: envConfig.NODE_ENV === 'production' ? 'json' : 'pretty',
  },

  // Development/Debug
  isDevelopment: envConfig.NODE_ENV === 'development',
  isProduction: envConfig.NODE_ENV === 'production',
  isTest: envConfig.NODE_ENV === 'test',
  debug: envConfig.DEBUG,
} as const;

export type Config = typeof config;
export default config;
