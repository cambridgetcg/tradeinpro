/**
 * CAPTCHA Detection and Solving Integration
 *
 * Integrates with external CAPTCHA solving services:
 * - 2Captcha
 * - Anti-Captcha
 *
 * Supports:
 * - reCAPTCHA v2/v3
 * - hCaptcha
 * - Image-based CAPTCHAs
 */

export type CaptchaType = 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'image';
export type CaptchaProvider = '2captcha' | 'anticaptcha' | 'none';

export interface CaptchaConfig {
  provider: CaptchaProvider;
  apiKey: string;
  timeout: number;       // Max time to wait for solution in ms
  pollingInterval: number; // How often to check for solution
}

export interface CaptchaChallenge {
  type: CaptchaType;
  siteKey?: string;       // For reCAPTCHA/hCaptcha
  pageUrl: string;
  imageBase64?: string;   // For image CAPTCHAs
  minScore?: number;      // For reCAPTCHA v3
}

export interface CaptchaSolution {
  token: string;
  cost: number;
  solveTime: number;
}

export interface CaptchaDetectionResult {
  detected: boolean;
  type: CaptchaType | null;
  siteKey: string | null;
  confidence: number;
}

const DEFAULT_CONFIG: CaptchaConfig = {
  provider: 'none',
  apiKey: '',
  timeout: 120000,      // 2 minutes
  pollingInterval: 5000, // 5 seconds
};

/**
 * CAPTCHA detection patterns
 */
const CAPTCHA_PATTERNS = {
  recaptcha_v2: [
    /class="g-recaptcha"/i,
    /data-sitekey="([^"]+)"/i,
    /www\.google\.com\/recaptcha/i,
    /grecaptcha\.render/i,
  ],
  recaptcha_v3: [
    /grecaptcha\.execute/i,
    /recaptcha\/api\.js\?render=/i,
  ],
  hcaptcha: [
    /class="h-captcha"/i,
    /data-sitekey="([^"]+)"/i,
    /hcaptcha\.com\/1\/api\.js/i,
  ],
  image: [
    /captcha/i,
    /verify.*human/i,
  ],
};

/**
 * Detect CAPTCHA in HTML
 */
export function detectCaptcha(html: string): CaptchaDetectionResult {
  // Check for reCAPTCHA v2
  for (const pattern of CAPTCHA_PATTERNS.recaptcha_v2) {
    if (pattern.test(html)) {
      const siteKeyMatch = html.match(/data-sitekey="([^"]+)"/);
      return {
        detected: true,
        type: 'recaptcha_v2',
        siteKey: siteKeyMatch ? siteKeyMatch[1] : null,
        confidence: 0.9,
      };
    }
  }

  // Check for reCAPTCHA v3
  for (const pattern of CAPTCHA_PATTERNS.recaptcha_v3) {
    if (pattern.test(html)) {
      const siteKeyMatch = html.match(/render=([^&"']+)/);
      return {
        detected: true,
        type: 'recaptcha_v3',
        siteKey: siteKeyMatch ? siteKeyMatch[1] : null,
        confidence: 0.85,
      };
    }
  }

  // Check for hCaptcha
  for (const pattern of CAPTCHA_PATTERNS.hcaptcha) {
    if (pattern.test(html)) {
      const siteKeyMatch = html.match(/data-sitekey="([^"]+)"/);
      return {
        detected: true,
        type: 'hcaptcha',
        siteKey: siteKeyMatch ? siteKeyMatch[1] : null,
        confidence: 0.9,
      };
    }
  }

  // Check for generic CAPTCHA indicators
  const lowerHtml = html.toLowerCase();
  if (
    (lowerHtml.includes('captcha') || lowerHtml.includes('verify you are human')) &&
    lowerHtml.includes('security check')
  ) {
    return {
      detected: true,
      type: 'image',
      siteKey: null,
      confidence: 0.6,
    };
  }

  return {
    detected: false,
    type: null,
    siteKey: null,
    confidence: 0,
  };
}

/**
 * CAPTCHA solver class
 */
export class CaptchaSolver {
  private config: CaptchaConfig;
  private stats = {
    attempted: 0,
    solved: 0,
    failed: 0,
    totalCost: 0,
    totalTime: 0,
  };

  constructor(config?: Partial<CaptchaConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Load from environment if not provided
    if (!this.config.apiKey) {
      if (process.env.TWO_CAPTCHA_API_KEY) {
        this.config.provider = '2captcha';
        this.config.apiKey = process.env.TWO_CAPTCHA_API_KEY;
      } else if (process.env.ANTICAPTCHA_API_KEY) {
        this.config.provider = 'anticaptcha';
        this.config.apiKey = process.env.ANTICAPTCHA_API_KEY;
      }
    }
  }

  /**
   * Check if solver is configured
   */
  isConfigured(): boolean {
    return this.config.provider !== 'none' && !!this.config.apiKey;
  }

  /**
   * Solve a CAPTCHA challenge
   */
  async solve(challenge: CaptchaChallenge): Promise<CaptchaSolution | null> {
    if (!this.isConfigured()) {
      console.warn('CAPTCHA solver not configured');
      return null;
    }

    this.stats.attempted++;
    const startTime = Date.now();

    try {
      let solution: string | null = null;

      switch (this.config.provider) {
        case '2captcha':
          solution = await this.solve2Captcha(challenge);
          break;
        case 'anticaptcha':
          solution = await this.solveAntiCaptcha(challenge);
          break;
        default:
          return null;
      }

      if (solution) {
        const solveTime = Date.now() - startTime;
        const cost = this.estimateCost(challenge.type);

        this.stats.solved++;
        this.stats.totalCost += cost;
        this.stats.totalTime += solveTime;

        return {
          token: solution,
          cost,
          solveTime,
        };
      }

      this.stats.failed++;
      return null;
    } catch (error) {
      this.stats.failed++;
      console.error('CAPTCHA solve error:', error);
      return null;
    }
  }

  /**
   * Solve using 2Captcha API
   */
  private async solve2Captcha(challenge: CaptchaChallenge): Promise<string | null> {
    const baseUrl = 'http://2captcha.com';

    // Submit CAPTCHA
    const submitParams = new URLSearchParams({
      key: this.config.apiKey,
      json: '1',
    });

    if (challenge.type === 'recaptcha_v2' && challenge.siteKey) {
      submitParams.append('method', 'userrecaptcha');
      submitParams.append('googlekey', challenge.siteKey);
      submitParams.append('pageurl', challenge.pageUrl);
    } else if (challenge.type === 'recaptcha_v3' && challenge.siteKey) {
      submitParams.append('method', 'userrecaptcha');
      submitParams.append('googlekey', challenge.siteKey);
      submitParams.append('pageurl', challenge.pageUrl);
      submitParams.append('version', 'v3');
      submitParams.append('min_score', String(challenge.minScore || 0.3));
    } else if (challenge.type === 'hcaptcha' && challenge.siteKey) {
      submitParams.append('method', 'hcaptcha');
      submitParams.append('sitekey', challenge.siteKey);
      submitParams.append('pageurl', challenge.pageUrl);
    } else if (challenge.type === 'image' && challenge.imageBase64) {
      submitParams.append('method', 'base64');
      submitParams.append('body', challenge.imageBase64);
    } else {
      return null;
    }

    const submitResponse = await fetch(`${baseUrl}/in.php?${submitParams}`);
    const submitResult = await submitResponse.json();

    if (submitResult.status !== 1) {
      console.error('2Captcha submit error:', submitResult);
      return null;
    }

    const requestId = submitResult.request;

    // Poll for solution
    const startTime = Date.now();
    while (Date.now() - startTime < this.config.timeout) {
      await this.sleep(this.config.pollingInterval);

      const resultParams = new URLSearchParams({
        key: this.config.apiKey,
        action: 'get',
        id: requestId,
        json: '1',
      });

      const resultResponse = await fetch(`${baseUrl}/res.php?${resultParams}`);
      const resultData = await resultResponse.json();

      if (resultData.status === 1) {
        return resultData.request;
      }

      if (resultData.request !== 'CAPCHA_NOT_READY') {
        console.error('2Captcha error:', resultData);
        return null;
      }
    }

    console.error('2Captcha timeout');
    return null;
  }

  /**
   * Solve using Anti-Captcha API
   */
  private async solveAntiCaptcha(challenge: CaptchaChallenge): Promise<string | null> {
    const baseUrl = 'https://api.anti-captcha.com';

    // Build task object
    let task: Record<string, unknown>;

    if (challenge.type === 'recaptcha_v2' && challenge.siteKey) {
      task = {
        type: 'RecaptchaV2TaskProxyless',
        websiteURL: challenge.pageUrl,
        websiteKey: challenge.siteKey,
      };
    } else if (challenge.type === 'recaptcha_v3' && challenge.siteKey) {
      task = {
        type: 'RecaptchaV3TaskProxyless',
        websiteURL: challenge.pageUrl,
        websiteKey: challenge.siteKey,
        minScore: challenge.minScore || 0.3,
      };
    } else if (challenge.type === 'hcaptcha' && challenge.siteKey) {
      task = {
        type: 'HCaptchaTaskProxyless',
        websiteURL: challenge.pageUrl,
        websiteKey: challenge.siteKey,
      };
    } else if (challenge.type === 'image' && challenge.imageBase64) {
      task = {
        type: 'ImageToTextTask',
        body: challenge.imageBase64,
      };
    } else {
      return null;
    }

    // Create task
    const createResponse = await fetch(`${baseUrl}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.config.apiKey,
        task,
      }),
    });

    const createResult = await createResponse.json();

    if (createResult.errorId !== 0) {
      console.error('Anti-Captcha create error:', createResult);
      return null;
    }

    const taskId = createResult.taskId;

    // Poll for solution
    const startTime = Date.now();
    while (Date.now() - startTime < this.config.timeout) {
      await this.sleep(this.config.pollingInterval);

      const resultResponse = await fetch(`${baseUrl}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientKey: this.config.apiKey,
          taskId,
        }),
      });

      const resultData = await resultResponse.json();

      if (resultData.errorId !== 0) {
        console.error('Anti-Captcha error:', resultData);
        return null;
      }

      if (resultData.status === 'ready') {
        return resultData.solution?.gRecaptchaResponse ||
               resultData.solution?.token ||
               resultData.solution?.text;
      }
    }

    console.error('Anti-Captcha timeout');
    return null;
  }

  /**
   * Estimate cost for solving a CAPTCHA (in USD)
   */
  private estimateCost(type: CaptchaType): number {
    const costs: Record<CaptchaType, number> = {
      recaptcha_v2: 0.003,
      recaptcha_v3: 0.003,
      hcaptcha: 0.003,
      image: 0.001,
    };
    return costs[type] || 0.003;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get solver statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      attempted: 0,
      solved: 0,
      failed: 0,
      totalCost: 0,
      totalTime: 0,
    };
  }
}
