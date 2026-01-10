/**
 * Proxy Configuration for Cardmarket Scraping
 *
 * Supports multiple proxy providers with automatic failover
 */

import crypto from 'node:crypto';

export type ProxyProvider = 'brightdata' | 'smartproxy' | 'oxylabs' | 'none';
export type ProxyType = 'residential' | 'datacenter' | 'mobile';
export type RotationStrategy = 'per-request' | 'sticky' | 'session';

export interface ProxyConfig {
  provider: ProxyProvider;
  type: ProxyType;
  rotationStrategy: RotationStrategy;
  geo: string[];
  sessionTtlSeconds: number;
  credentials: {
    username?: string;
    password?: string;
    customerId?: string;
  };
}

export interface ProxyUrl {
  url: string;
  sessionId: string;
  country: string;
  expiresAt: Date;
}

/**
 * Default proxy configuration
 */
export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  provider: 'none',
  type: 'residential',
  rotationStrategy: 'per-request',
  geo: ['de', 'fr', 'it', 'es', 'nl', 'be', 'at'], // EU countries
  sessionTtlSeconds: 600, // 10 minutes
  credentials: {},
};

/**
 * Load proxy configuration from environment
 */
export function loadProxyConfig(): ProxyConfig {
  const config = { ...DEFAULT_PROXY_CONFIG };

  // Detect provider from environment
  if (process.env.BRIGHT_DATA_CUSTOMER && process.env.BRIGHT_DATA_PASSWORD) {
    config.provider = 'brightdata';
    config.credentials = {
      customerId: process.env.BRIGHT_DATA_CUSTOMER,
      password: process.env.BRIGHT_DATA_PASSWORD,
    };
  } else if (process.env.SMARTPROXY_USER && process.env.SMARTPROXY_PASSWORD) {
    config.provider = 'smartproxy';
    config.credentials = {
      username: process.env.SMARTPROXY_USER,
      password: process.env.SMARTPROXY_PASSWORD,
    };
  } else if (process.env.OXYLABS_USER && process.env.OXYLABS_PASSWORD) {
    config.provider = 'oxylabs';
    config.credentials = {
      username: process.env.OXYLABS_USER,
      password: process.env.OXYLABS_PASSWORD,
    };
  } else if (process.env.PROXY_URL) {
    // Direct proxy URL provided
    config.provider = 'none'; // Will use PROXY_URL directly
  }

  // Override settings from environment
  if (process.env.PROXY_TYPE) {
    config.type = process.env.PROXY_TYPE as ProxyType;
  }
  if (process.env.PROXY_ROTATION) {
    config.rotationStrategy = process.env.PROXY_ROTATION as RotationStrategy;
  }
  if (process.env.PROXY_GEO) {
    config.geo = process.env.PROXY_GEO.split(',').map((g) => g.trim().toLowerCase());
  }
  if (process.env.PROXY_SESSION_TTL) {
    config.sessionTtlSeconds = parseInt(process.env.PROXY_SESSION_TTL, 10);
  }

  return config;
}

/**
 * Generate a new session ID
 */
export function generateSessionId(): string {
  return `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Get a random country from the geo list
 */
export function getRandomCountry(geo: string[]): string {
  return geo[Math.floor(Math.random() * geo.length)];
}

/**
 * Build proxy URL for Bright Data
 */
function buildBrightDataUrl(
  config: ProxyConfig,
  sessionId: string,
  country: string
): string {
  const { customerId, password } = config.credentials;

  const usernameSegments = [customerId];

  // Add country targeting
  usernameSegments.push(`country-${country}`);

  // Add session for sticky sessions
  if (config.rotationStrategy === 'sticky' || config.rotationStrategy === 'session') {
    usernameSegments.push(`session-${sessionId}`);
    usernameSegments.push(`session_ttl-${config.sessionTtlSeconds}`);
  }

  const username = usernameSegments.join('-');

  return `http://${username}:${password}@brd.superproxy.io:22225`;
}

/**
 * Build proxy URL for SmartProxy
 */
function buildSmartProxyUrl(
  config: ProxyConfig,
  sessionId: string,
  country: string
): string {
  const { username, password } = config.credentials;

  const userSegments = [`user-${username}`, `country-${country}`];

  if (config.rotationStrategy === 'sticky' || config.rotationStrategy === 'session') {
    userSegments.push(`session-${sessionId}`);
  }

  const fullUsername = userSegments.join('-');

  return `http://${fullUsername}:${password}@gate.smartproxy.com:7000`;
}

/**
 * Build proxy URL for Oxylabs
 */
function buildOxylabsUrl(
  config: ProxyConfig,
  sessionId: string,
  country: string
): string {
  const { username, password } = config.credentials;

  const userSegments = [`customer-${username}`, `cc-${country}`];

  if (config.rotationStrategy === 'sticky' || config.rotationStrategy === 'session') {
    userSegments.push(`sessid-${sessionId}`);
    userSegments.push(`sesstime-${config.sessionTtlSeconds}`);
  }

  const fullUsername = userSegments.join('-');

  return `http://${fullUsername}:${password}@pr.oxylabs.io:7777`;
}

/**
 * Get a proxy URL with configuration
 */
export function getProxyUrl(config?: Partial<ProxyConfig>): ProxyUrl | null {
  const fullConfig = { ...loadProxyConfig(), ...config };

  // If direct PROXY_URL is set, use it
  if (process.env.PROXY_URL && fullConfig.provider === 'none') {
    return {
      url: process.env.PROXY_URL,
      sessionId: 'direct',
      country: 'unknown',
      expiresAt: new Date(Date.now() + 86400000), // 24 hours
    };
  }

  if (fullConfig.provider === 'none') {
    return null;
  }

  const sessionId = generateSessionId();
  const country = getRandomCountry(fullConfig.geo);
  const expiresAt = new Date(Date.now() + fullConfig.sessionTtlSeconds * 1000);

  let url: string;

  switch (fullConfig.provider) {
    case 'brightdata':
      url = buildBrightDataUrl(fullConfig, sessionId, country);
      break;
    case 'smartproxy':
      url = buildSmartProxyUrl(fullConfig, sessionId, country);
      break;
    case 'oxylabs':
      url = buildOxylabsUrl(fullConfig, sessionId, country);
      break;
    default:
      return null;
  }

  return { url, sessionId, country, expiresAt };
}

/**
 * Create a proxy agent for use with fetch/axios
 * Note: Requires additional package like https-proxy-agent
 */
export function createProxyAgent(proxyUrl: string): unknown {
  // This would require: npm install https-proxy-agent
  // import { HttpsProxyAgent } from 'https-proxy-agent';
  // return new HttpsProxyAgent(proxyUrl);

  // For now, return the URL for manual configuration
  console.log(`Proxy URL: ${proxyUrl.replace(/:[^:@]+@/, ':***@')}`);
  return proxyUrl;
}

/**
 * Proxy session manager for maintaining sticky sessions
 */
export class ProxySessionManager {
  private sessions: Map<string, ProxyUrl> = new Map();
  private config: ProxyConfig;

  constructor(config?: Partial<ProxyConfig>) {
    this.config = { ...loadProxyConfig(), ...config };
  }

  /**
   * Get or create a session for a specific key (e.g., expansion name)
   */
  getSession(key: string): ProxyUrl | null {
    const existing = this.sessions.get(key);

    // Return existing if not expired
    if (existing && existing.expiresAt > new Date()) {
      return existing;
    }

    // Create new session
    const newSession = getProxyUrl(this.config);
    if (newSession) {
      this.sessions.set(key, newSession);
    }

    return newSession;
  }

  /**
   * Invalidate a session (e.g., after rate limiting)
   */
  invalidateSession(key: string): void {
    this.sessions.delete(key);
  }

  /**
   * Clear all sessions
   */
  clearSessions(): void {
    this.sessions.clear();
  }

  /**
   * Get count of active sessions
   */
  getActiveSessionCount(): number {
    // Clean up expired sessions
    const now = new Date();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key);
      }
    }
    return this.sessions.size;
  }
}
