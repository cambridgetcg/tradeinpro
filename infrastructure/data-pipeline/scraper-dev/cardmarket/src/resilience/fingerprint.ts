/**
 * Browser Fingerprint Randomization
 *
 * Generates realistic browser fingerprints to avoid detection.
 * Based on real-world browser distributions and characteristics.
 */

/**
 * Browser fingerprint data
 */
export interface BrowserFingerprint {
  userAgent: string;
  acceptLanguage: string;
  acceptEncoding: string;
  accept: string;
  secFetchDest: string;
  secFetchMode: string;
  secFetchSite: string;
  secFetchUser: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  viewport: { width: number; height: number };
  screenResolution: { width: number; height: number };
  colorDepth: number;
  timezone: string;
  language: string;
  platform: string;
}

/**
 * Browser profile for consistent fingerprinting
 */
interface BrowserProfile {
  name: string;
  versions: string[];
  platforms: Array<{
    os: string;
    osVersion: string;
    platform: string;
    uaTemplate: string;
  }>;
  chromeVersion: string;
}

/**
 * Common screen resolutions
 */
const SCREEN_RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 2560, height: 1440 },
  { width: 1680, height: 1050 },
  { width: 1600, height: 900 },
];

/**
 * Common viewport sizes (slightly smaller than screen)
 */
const VIEWPORT_OFFSETS = [
  { widthOffset: 0, heightOffset: 80 },   // Small browser chrome
  { widthOffset: 0, heightOffset: 100 },  // Medium browser chrome
  { widthOffset: 0, heightOffset: 120 },  // Large browser chrome
];

/**
 * Common timezones for EU
 */
const EU_TIMEZONES = [
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Vienna',
  'Europe/Brussels',
];

/**
 * Browser profiles with realistic data
 */
const BROWSER_PROFILES: BrowserProfile[] = [
  {
    name: 'Chrome',
    versions: ['120', '121', '122', '123'],
    chromeVersion: '120.0.0.0',
    platforms: [
      {
        os: 'Windows',
        osVersion: '10',
        platform: 'Win32',
        uaTemplate: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36',
      },
      {
        os: 'Windows',
        osVersion: '11',
        platform: 'Win32',
        uaTemplate: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36',
      },
      {
        os: 'macOS',
        osVersion: '14.0',
        platform: 'MacIntel',
        uaTemplate: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36',
      },
      {
        os: 'Linux',
        osVersion: '',
        platform: 'Linux x86_64',
        uaTemplate: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36',
      },
    ],
  },
  {
    name: 'Firefox',
    versions: ['121', '122', '123', '124'],
    chromeVersion: '',
    platforms: [
      {
        os: 'Windows',
        osVersion: '10',
        platform: 'Win32',
        uaTemplate: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:{version}.0) Gecko/20100101 Firefox/{version}.0',
      },
      {
        os: 'macOS',
        osVersion: '14.0',
        platform: 'MacIntel',
        uaTemplate: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:{version}.0) Gecko/20100101 Firefox/{version}.0',
      },
      {
        os: 'Linux',
        osVersion: '',
        platform: 'Linux x86_64',
        uaTemplate: 'Mozilla/5.0 (X11; Linux x86_64; rv:{version}.0) Gecko/20100101 Firefox/{version}.0',
      },
    ],
  },
  {
    name: 'Safari',
    versions: ['17.2', '17.3', '17.4'],
    chromeVersion: '',
    platforms: [
      {
        os: 'macOS',
        osVersion: '14.0',
        platform: 'MacIntel',
        uaTemplate: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{version} Safari/605.1.15',
      },
    ],
  },
  {
    name: 'Edge',
    versions: ['120', '121', '122'],
    chromeVersion: '120.0.0.0',
    platforms: [
      {
        os: 'Windows',
        osVersion: '10',
        platform: 'Win32',
        uaTemplate: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36 Edg/{version}.0.0.0',
      },
      {
        os: 'Windows',
        osVersion: '11',
        platform: 'Win32',
        uaTemplate: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36 Edg/{version}.0.0.0',
      },
    ],
  },
];

/**
 * Accept-Language header variations for EU
 */
const ACCEPT_LANGUAGES = [
  'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
  'de,en-US;q=0.9,en;q=0.8',
  'en-GB,en;q=0.9,de;q=0.8',
  'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
  'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
];

/**
 * Pick a random item from an array
 */
function randomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generate a random browser fingerprint
 */
export function generateFingerprint(): BrowserFingerprint {
  // Pick a browser profile
  const browser = randomItem(BROWSER_PROFILES);
  const version = randomItem(browser.versions);
  const platformConfig = randomItem(browser.platforms);

  // Generate user agent
  const userAgent = platformConfig.uaTemplate.replace(/{version}/g, version);

  // Pick screen resolution
  const screen = randomItem(SCREEN_RESOLUTIONS);
  const viewportOffset = randomItem(VIEWPORT_OFFSETS);
  const viewport = {
    width: screen.width - viewportOffset.widthOffset,
    height: screen.height - viewportOffset.heightOffset,
  };

  // Generate sec-ch-ua header (Chrome-based browsers only)
  let secChUa = '';
  let secChUaPlatform = '';

  if (browser.name === 'Chrome' || browser.name === 'Edge') {
    const brands = [
      `"Not_A Brand";v="8"`,
      `"Chromium";v="${version}"`,
    ];
    if (browser.name === 'Chrome') {
      brands.push(`"Google Chrome";v="${version}"`);
    } else {
      brands.push(`"Microsoft Edge";v="${version}"`);
    }
    secChUa = brands.join(', ');
    secChUaPlatform = `"${platformConfig.os}"`;
  }

  return {
    userAgent,
    acceptLanguage: randomItem(ACCEPT_LANGUAGES),
    acceptEncoding: 'gzip, deflate, br',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    secFetchDest: 'document',
    secFetchMode: 'navigate',
    secFetchSite: 'none',
    secFetchUser: '?1',
    secChUa,
    secChUaMobile: '?0',
    secChUaPlatform,
    viewport,
    screenResolution: screen,
    colorDepth: 24,
    timezone: randomItem(EU_TIMEZONES),
    language: randomItem(ACCEPT_LANGUAGES).split(',')[0].split('-')[0],
    platform: platformConfig.platform,
  };
}

/**
 * Convert fingerprint to HTTP headers
 */
export function fingerprintToHeaders(fingerprint: BrowserFingerprint): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': fingerprint.userAgent,
    'Accept': fingerprint.accept,
    'Accept-Language': fingerprint.acceptLanguage,
    'Accept-Encoding': fingerprint.acceptEncoding,
    'Sec-Fetch-Dest': fingerprint.secFetchDest,
    'Sec-Fetch-Mode': fingerprint.secFetchMode,
    'Sec-Fetch-Site': fingerprint.secFetchSite,
    'Sec-Fetch-User': fingerprint.secFetchUser,
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
  };

  // Add Chrome-specific headers
  if (fingerprint.secChUa) {
    headers['Sec-CH-UA'] = fingerprint.secChUa;
    headers['Sec-CH-UA-Mobile'] = fingerprint.secChUaMobile;
    headers['Sec-CH-UA-Platform'] = fingerprint.secChUaPlatform;
  }

  return headers;
}

/**
 * Fingerprint manager for maintaining consistent sessions
 */
export class FingerprintManager {
  private fingerprints: Map<string, BrowserFingerprint> = new Map();

  /**
   * Get or create a fingerprint for a session key
   */
  getFingerprint(sessionKey: string): BrowserFingerprint {
    let fingerprint = this.fingerprints.get(sessionKey);
    if (!fingerprint) {
      fingerprint = generateFingerprint();
      this.fingerprints.set(sessionKey, fingerprint);
    }
    return fingerprint;
  }

  /**
   * Get headers for a session
   */
  getHeaders(sessionKey: string): Record<string, string> {
    return fingerprintToHeaders(this.getFingerprint(sessionKey));
  }

  /**
   * Rotate fingerprint for a session
   */
  rotateFingerprint(sessionKey: string): BrowserFingerprint {
    const fingerprint = generateFingerprint();
    this.fingerprints.set(sessionKey, fingerprint);
    return fingerprint;
  }

  /**
   * Clear a session's fingerprint
   */
  clearFingerprint(sessionKey: string): void {
    this.fingerprints.delete(sessionKey);
  }

  /**
   * Clear all fingerprints
   */
  clearAll(): void {
    this.fingerprints.clear();
  }

  /**
   * Get count of active fingerprints
   */
  getActiveCount(): number {
    return this.fingerprints.size;
  }
}
