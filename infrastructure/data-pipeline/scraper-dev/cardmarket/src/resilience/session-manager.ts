/**
 * Session Manager for Cardmarket BWSTATE System
 *
 * Handles the custom anti-bot protection:
 * - BWSTATE cookie management
 * - Session harvesting via browser
 * - Automatic re-authentication
 * - Session health monitoring
 */

import type { Page, BrowserContext, Cookie } from 'playwright';
import { SESSION_CONFIG, DETECTION_PATTERNS } from '../config/cardmarket-optimized.js';
import { sleep } from '../utils/index.js';

export interface SessionState {
  cookies: Cookie[];
  bwstate: string | null;
  harvestedAt: Date;
  lastValidated: Date;
  failureCount: number;
  isValid: boolean;
}

export interface SessionManagerConfig {
  criticalCookies: string[];
  validationIntervalMs: number;
  reharvestAfterFailures: number;
  manualCaptchaTimeoutMs: number;
}

/**
 * BWSTATE Session Manager
 */
export class CardmarketSessionManager {
  private config: SessionManagerConfig;
  private sessionState: SessionState | null = null;
  private browserContext: BrowserContext | null = null;

  constructor(config?: Partial<SessionManagerConfig>) {
    this.config = { ...SESSION_CONFIG, ...config };
  }

  /**
   * Check if current session is valid
   */
  isSessionValid(): boolean {
    if (!this.sessionState) return false;
    if (!this.sessionState.isValid) return false;

    // Check if session needs re-validation
    const timeSinceValidation = Date.now() - this.sessionState.lastValidated.getTime();
    if (timeSinceValidation > this.config.validationIntervalMs) {
      return false;  // Needs re-validation
    }

    // Check failure count
    if (this.sessionState.failureCount >= this.config.reharvestAfterFailures) {
      return false;  // Too many failures, needs re-harvest
    }

    return true;
  }

  /**
   * Get current session cookies
   */
  getCookies(): Cookie[] {
    return this.sessionState?.cookies || [];
  }

  /**
   * Get BWSTATE cookie value
   */
  getBWSTATE(): string | null {
    return this.sessionState?.bwstate || null;
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    if (this.sessionState) {
      this.sessionState.failureCount = 0;
      this.sessionState.lastValidated = new Date();
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    if (this.sessionState) {
      this.sessionState.failureCount++;
    }
  }

  /**
   * Check if page shows BWSTATE challenge
   */
  async detectBWSTATEChallenge(page: Page): Promise<boolean> {
    const html = await page.content();

    for (const pattern of DETECTION_PATTERNS.bwstateChallenge) {
      if (html.includes(pattern)) {
        return true;
      }
    }

    // Also check for human-test endpoints
    const url = page.url();
    if (url.includes('/human-test/')) {
      return true;
    }

    return false;
  }

  /**
   * Harvest session via browser (manual CAPTCHA solve)
   */
  async harvestSession(
    context: BrowserContext,
    options?: {
      url?: string;
      allowManualSolve?: boolean;
      onChallengeDetected?: () => void;
    }
  ): Promise<SessionState> {
    const url = options?.url || 'https://www.cardmarket.com/en/OnePiece';
    const page = await context.newPage();

    try {
      console.log('[Session] Navigating to Cardmarket...');
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Check for BWSTATE challenge
      const hasChallenge = await this.detectBWSTATEChallenge(page);

      if (hasChallenge) {
        console.log('[Session] BWSTATE challenge detected');
        options?.onChallengeDetected?.();

        if (options?.allowManualSolve) {
          console.log('[Session] Waiting for manual CAPTCHA solve...');

          // Wait for challenge to be solved
          await this.waitForChallengeResolution(page);
        } else {
          throw new Error('BWSTATE challenge detected but manual solve not allowed');
        }
      }

      // Wait for page to fully load
      await this.waitForValidPage(page);

      // Extract cookies
      const cookies = await context.cookies();
      const bwstateCookie = cookies.find(c => c.name === 'BWSTATE');

      this.sessionState = {
        cookies,
        bwstate: bwstateCookie?.value || null,
        harvestedAt: new Date(),
        lastValidated: new Date(),
        failureCount: 0,
        isValid: true,
      };

      console.log(`[Session] Harvested ${cookies.length} cookies, BWSTATE: ${bwstateCookie ? 'present' : 'absent'}`);

      return this.sessionState;
    } finally {
      await page.close();
    }
  }

  /**
   * Wait for BWSTATE challenge to be resolved
   */
  private async waitForChallengeResolution(page: Page): Promise<void> {
    const startTime = Date.now();
    const timeout = this.config.manualCaptchaTimeoutMs;

    while (Date.now() - startTime < timeout) {
      // Check if challenge is gone
      const hasChallenge = await this.detectBWSTATEChallenge(page);

      if (!hasChallenge) {
        // Verify we're on a valid page
        const isValid = await this.isValidCardmarketPage(page);
        if (isValid) {
          console.log('[Session] Challenge resolved successfully');
          return;
        }
      }

      await sleep(1000);
    }

    throw new Error('Timeout waiting for CAPTCHA resolution');
  }

  /**
   * Wait for valid Cardmarket page to load
   */
  private async waitForValidPage(page: Page, timeout: number = 30000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await this.isValidCardmarketPage(page)) {
        return;
      }
      await sleep(500);
    }

    throw new Error('Timeout waiting for valid Cardmarket page');
  }

  /**
   * Check if page is a valid Cardmarket page (not blocked)
   */
  private async isValidCardmarketPage(page: Page): Promise<boolean> {
    const html = await page.content();

    // Check for valid page indicators
    for (const pattern of DETECTION_PATTERNS.validPage) {
      if (html.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Apply session cookies to a browser context
   */
  async applyToContext(context: BrowserContext): Promise<void> {
    if (!this.sessionState || this.sessionState.cookies.length === 0) {
      throw new Error('No session cookies to apply');
    }

    await context.addCookies(this.sessionState.cookies);
    console.log(`[Session] Applied ${this.sessionState.cookies.length} cookies to context`);
  }

  /**
   * Export session for HTTP client use
   */
  exportForHttp(): { cookie: string; headers: Record<string, string> } {
    if (!this.sessionState) {
      throw new Error('No session to export');
    }

    // Build cookie header
    const cookieString = this.sessionState.cookies
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    // Build headers including critical cookies
    const headers: Record<string, string> = {
      'Cookie': cookieString,
    };

    // Add BWSTATE as custom header if needed
    if (this.sessionState.bwstate) {
      headers['X-BWSTATE'] = this.sessionState.bwstate;
    }

    return { cookie: cookieString, headers };
  }

  /**
   * Invalidate current session
   */
  invalidate(): void {
    if (this.sessionState) {
      this.sessionState.isValid = false;
    }
    console.log('[Session] Session invalidated');
  }

  /**
   * Clear all session data
   */
  clear(): void {
    this.sessionState = null;
    console.log('[Session] Session cleared');
  }

  /**
   * Get session statistics
   */
  getStats(): {
    hasSession: boolean;
    isValid: boolean;
    age: number | null;
    failureCount: number;
    hasBWSTATE: boolean;
    cookieCount: number;
  } {
    if (!this.sessionState) {
      return {
        hasSession: false,
        isValid: false,
        age: null,
        failureCount: 0,
        hasBWSTATE: false,
        cookieCount: 0,
      };
    }

    return {
      hasSession: true,
      isValid: this.sessionState.isValid,
      age: Date.now() - this.sessionState.harvestedAt.getTime(),
      failureCount: this.sessionState.failureCount,
      hasBWSTATE: !!this.sessionState.bwstate,
      cookieCount: this.sessionState.cookies.length,
    };
  }
}

/**
 * Create a session manager instance
 */
export function createSessionManager(config?: Partial<SessionManagerConfig>): CardmarketSessionManager {
  return new CardmarketSessionManager(config);
}
