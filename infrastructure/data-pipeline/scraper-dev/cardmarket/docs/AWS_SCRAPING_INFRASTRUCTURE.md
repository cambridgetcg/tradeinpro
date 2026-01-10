# Cardmarket Scraping Infrastructure on AWS

> Comprehensive guide to AWS services, tools, and architecture for web scraping
> Last Updated: January 2025

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Compute Options](#compute-options)
4. [Proxy Infrastructure](#proxy-infrastructure)
5. [Headless Browser Solutions](#headless-browser-solutions)
6. [Anti-Detection Strategies](#anti-detection-strategies)
7. [Data Pipeline Integration](#data-pipeline-integration)
8. [Cost Analysis](#cost-analysis)
9. [Recommended Architecture](#recommended-architecture)
10. [Implementation Checklist](#implementation-checklist)

---

## Executive Summary

### Why Scraping is Necessary

Cardmarket **does not offer a public API** as of January 2025. Their partner API requires direct business partnership approval, which is difficult to obtain for independent projects. Web scraping is the only viable option for accessing EU market price data.

### Key Challenges

| Challenge | Impact | Mitigation |
|-----------|--------|------------|
| Bot Detection | Blocks, CAPTCHAs | Proxy rotation, browser fingerprinting |
| Rate Limiting | Temporary bans | Request throttling, distributed scraping |
| Dynamic Content | Missing data | Headless browser with JavaScript execution |
| HTML Changes | Parser failures | Multi-strategy parsing, monitoring |
| Legal/ToS | Service disruption | Respectful scraping, data caching |

### Recommended Approach

**Hybrid Architecture:**
- **Primary:** AWS Lambda with rotating residential proxies for simple pages
- **Fallback:** ECS Fargate with Playwright for JavaScript-heavy pages
- **Caching:** CloudFront + S3 to minimize repeat requests

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        CARDMARKET SCRAPING ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌─────────────┐      ┌──────────────┐      ┌─────────────────────────────────┐ │
│  │ EventBridge │─────▶│ Step Functions│─────▶│        SCRAPER ORCHESTRATOR     │ │
│  │ (Schedule)  │      │ (Workflow)    │      │   • Expansion discovery         │ │
│  └─────────────┘      └──────────────┘      │   • Card URL generation         │ │
│                                              │   • Batch distribution          │ │
│                                              └───────────────┬─────────────────┘ │
│                                                              │                    │
│          ┌───────────────────────────────────────────────────┼───────────┐       │
│          ▼                                                   ▼           ▼       │
│  ┌───────────────┐                                  ┌───────────────────────┐   │
│  │  Lambda Pool  │                                  │     ECS Fargate       │   │
│  │  (Light)      │                                  │     (Heavy)           │   │
│  │               │                                  │                       │   │
│  │ • Static HTML │                                  │ • JS-rendered pages   │   │
│  │ • Price lists │                                  │ • CAPTCHA handling    │   │
│  │ • Metadata    │                                  │ • Complex navigation  │   │
│  └───────┬───────┘                                  └───────────┬───────────┘   │
│          │                                                      │               │
│          │                    ┌─────────────────┐              │               │
│          └───────────────────▶│ PROXY LAYER     │◀─────────────┘               │
│                               │                 │                               │
│                               │ ┌─────────────┐ │                               │
│                               │ │ Bright Data │ │                               │
│                               │ │ SmartProxy  │ │                               │
│                               │ │ Oxylabs     │ │                               │
│                               │ └─────────────┘ │                               │
│                               └────────┬────────┘                               │
│                                        │                                        │
│                                        ▼                                        │
│                               ┌─────────────────┐                               │
│                               │   CARDMARKET    │                               │
│                               │   Website       │                               │
│                               └────────┬────────┘                               │
│                                        │                                        │
│          ┌─────────────────────────────┼─────────────────────────────┐         │
│          ▼                             ▼                             ▼         │
│  ┌───────────────┐           ┌───────────────┐           ┌───────────────┐    │
│  │ S3 Raw Data   │           │ SQS Dead      │           │ CloudWatch    │    │
│  │ (HTML Cache)  │           │ Letter Queue  │           │ Logs/Metrics  │    │
│  └───────┬───────┘           └───────────────┘           └───────────────┘    │
│          │                                                                      │
│          ▼                                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                         DATA PROCESSING PIPELINE                           │ │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐ │ │
│  │  │ Parser  │───▶│ Quality │───▶│ Transform│───▶│ Kinesis │───▶│DynamoDB │ │ │
│  │  │ Lambda  │    │ Validator│   │ Lambda  │    │ Stream  │    │Timestream│ │ │
│  │  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘ │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Compute Options

### Option 1: AWS Lambda (Recommended for Most Cases)

**Best for:** Static HTML pages, API-like endpoints, high-volume simple requests

| Aspect | Details |
|--------|---------|
| **Max Runtime** | 15 minutes |
| **Memory** | 128 MB - 10 GB |
| **Concurrency** | 1,000 default (adjustable) |
| **Cold Start** | 100-500ms (Node.js) |
| **Cost** | ~$0.20 per 1M requests + compute |

**Lambda Configuration for Scraping:**

```typescript
// lambda/config.ts
export const SCRAPER_LAMBDA_CONFIG = {
  memorySize: 1024,        // MB - enough for HTML parsing
  timeout: Duration.minutes(5),
  reservedConcurrency: 50, // Limit concurrent executions
  retryAttempts: 2,

  environment: {
    PROXY_ENDPOINT: process.env.PROXY_ENDPOINT,
    USER_AGENT_ROTATION: 'true',
    REQUEST_DELAY_MS: '2000',
  },
};
```

**Pros:**
- Automatic scaling
- Pay-per-use
- No server management
- Easy deployment

**Cons:**
- No persistent browser sessions
- 15-minute timeout limit
- Cold starts can affect rate limiting
- No IP persistence

### Option 2: ECS Fargate (For Complex Scraping)

**Best for:** JavaScript-heavy pages, CAPTCHA solving, long-running sessions

| Aspect | Details |
|--------|---------|
| **Runtime** | Unlimited |
| **Memory** | 0.5 GB - 120 GB |
| **vCPU** | 0.25 - 16 |
| **Scaling** | Auto-scaling with target tracking |
| **Cost** | ~$0.04/vCPU/hour + $0.004/GB/hour |

**Fargate Task Definition:**

```typescript
// infrastructure/fargate-scraper.ts
const scraperTaskDefinition = new ecs.FargateTaskDefinition(this, 'ScraperTask', {
  memoryLimitMiB: 2048,
  cpu: 1024,
  runtimePlatform: {
    cpuArchitecture: ecs.CpuArchitecture.X86_64,
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
  },
});

scraperTaskDefinition.addContainer('playwright-scraper', {
  image: ecs.ContainerImage.fromAsset('./docker/playwright'),
  memoryLimitMiB: 2048,
  logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'cardmarket-scraper' }),
  environment: {
    HEADLESS: 'true',
    PROXY_SERVER: process.env.PROXY_ENDPOINT!,
  },
});
```

**Pros:**
- Full browser support (Playwright/Puppeteer)
- Persistent sessions
- No timeout limits
- Better for stealth

**Cons:**
- More complex deployment
- Higher base cost
- Requires container management
- Slower scaling

### Option 3: EC2 Spot Instances (For Heavy Workloads)

**Best for:** Large-scale scraping, cost optimization, predictable workloads

| Instance Type | vCPU | Memory | Spot Price* | Use Case |
|---------------|------|--------|-------------|----------|
| t3.medium | 2 | 4 GB | ~$0.01/hr | Light scraping |
| c5.large | 2 | 4 GB | ~$0.03/hr | CPU-intensive parsing |
| m5.large | 2 | 8 GB | ~$0.03/hr | Browser automation |
| r5.large | 2 | 16 GB | ~$0.04/hr | Memory-intensive |

*Spot prices vary by region and demand

**Pros:**
- Cheapest for sustained workloads
- Full control over environment
- Persistent storage

**Cons:**
- Spot interruptions
- Manual scaling
- Server management overhead

### Comparison Matrix

| Criteria | Lambda | Fargate | EC2 Spot |
|----------|--------|---------|----------|
| Setup Complexity | Low | Medium | High |
| Cost (Light) | $ | $$ | $$$ |
| Cost (Heavy) | $$$ | $$ | $ |
| Browser Support | Limited | Full | Full |
| Scaling Speed | Fast | Medium | Slow |
| Maintenance | None | Low | High |
| IP Control | No | Partial | Full |

---

## Proxy Infrastructure

### Why Proxies are Essential

Cardmarket implements sophisticated bot detection:
- IP reputation scoring
- Request pattern analysis
- Geographic validation (EU-focused)
- Rate limiting per IP

### Proxy Provider Comparison

| Provider | Type | Price | EU Coverage | Cardmarket Success Rate* |
|----------|------|-------|-------------|--------------------------|
| **Bright Data** | Residential | $15/GB | Excellent | ~95% |
| **Oxylabs** | Residential | $12/GB | Excellent | ~93% |
| **SmartProxy** | Residential | $12.5/GB | Good | ~90% |
| **IPRoyal** | Residential | $7/GB | Good | ~85% |
| **Proxy-Seller** | Datacenter | $2/GB | Limited | ~60% |

*Based on community reports, actual results may vary

### Recommended: Bright Data

**Configuration for Cardmarket:**

```typescript
// config/proxy.ts
export const BRIGHT_DATA_CONFIG = {
  // Residential rotating proxy
  endpoint: 'brd.superproxy.io:22225',

  // Country targeting (EU countries)
  country: 'de,fr,es,it,nl,be,at', // Rotate through EU

  // Session settings
  session_type: 'rotating', // New IP per request

  // Authentication
  username: `${process.env.BRIGHT_DATA_CUSTOMER}-country-${country}-session-${sessionId}`,
  password: process.env.BRIGHT_DATA_PASSWORD,
};

// Proxy rotation with session stickiness for multi-page scraping
export function getProxyUrl(options: {
  country?: string;
  sessionId?: string;
  sessionDuration?: number; // minutes
}): string {
  const { country = 'de', sessionId = crypto.randomUUID(), sessionDuration = 10 } = options;

  const username = [
    process.env.BRIGHT_DATA_CUSTOMER,
    `country-${country}`,
    `session-${sessionId}`,
    `session_ttl-${sessionDuration * 60}`, // Convert to seconds
  ].join('-');

  return `http://${username}:${process.env.BRIGHT_DATA_PASSWORD}@brd.superproxy.io:22225`;
}
```

### AWS-Native Proxy Alternative: VPC + NAT Gateway Pool

For lower costs at scale, consider multiple NAT Gateways:

```typescript
// infrastructure/nat-pool.ts
const natGateways: ec2.NatGateway[] = [];
const availabilityZones = ['eu-central-1a', 'eu-central-1b', 'eu-central-1c'];

for (const az of availabilityZones) {
  const eip = new ec2.CfnEIP(this, `ScraperEIP-${az}`);
  const natGateway = new ec2.NatGateway(this, `ScraperNAT-${az}`, {
    subnet: vpc.selectSubnets({ availabilityZones: [az] }).subnets[0],
    allocationId: eip.attrAllocationId,
  });
  natGateways.push(natGateway);
}
```

**Cost:** ~$32/month per NAT Gateway + data transfer
**Limitation:** Only 3-5 IPs without additional Elastic IPs

---

## Headless Browser Solutions

### Option 1: Playwright (Recommended)

**Why Playwright:**
- Best cross-browser support (Chromium, Firefox, WebKit)
- Built-in stealth features
- Excellent async support
- Better fingerprint randomization

```typescript
// src/browser/playwright-scraper.ts
import { chromium, Browser, Page, BrowserContext } from 'playwright';

export class PlaywrightScraper {
  private browser: Browser | null = null;

  async initialize(proxyUrl?: string): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
      proxy: proxyUrl ? { server: proxyUrl } : undefined,
    });
  }

  async createStealthContext(): Promise<BrowserContext> {
    if (!this.browser) throw new Error('Browser not initialized');

    return this.browser.newContext({
      userAgent: this.getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'de-DE', // German locale for Cardmarket
      timezoneId: 'Europe/Berlin',
      geolocation: { latitude: 52.52, longitude: 13.405 }, // Berlin
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
  }

  async scrapePricePage(url: string): Promise<CardmarketPriceData> {
    const context = await this.createStealthContext();
    const page = await context.newPage();

    try {
      // Add stealth scripts
      await page.addInitScript(() => {
        // Override navigator.webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

        // Override chrome object
        window.chrome = { runtime: {} };

        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission } as PermissionStatus) :
            originalQuery(parameters)
        );
      });

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      // Wait for price data to load
      await page.waitForSelector('.price-container', { timeout: 10000 });

      return this.extractPriceData(page);
    } finally {
      await context.close();
    }
  }

  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }
}
```

### Option 2: Puppeteer with Stealth Plugin

```typescript
// src/browser/puppeteer-scraper.ts
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

export async function createStealthBrowser(proxyUrl?: string) {
  return puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certifcate-errors',
      '--ignore-certifcate-errors-spki-list',
      proxyUrl ? `--proxy-server=${proxyUrl}` : '',
    ].filter(Boolean),
  });
}
```

### Docker Image for Playwright

```dockerfile
# docker/playwright/Dockerfile
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy scraper code
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Set environment
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Run scraper
CMD ["node", "dist/index.js"]
```

---

## Anti-Detection Strategies

### 1. Request Pattern Randomization

```typescript
// src/utils/request-patterns.ts
export class RequestPatternRandomizer {
  // Random delay between requests (2-5 seconds base)
  async randomDelay(): Promise<void> {
    const baseDelay = 2000;
    const variance = Math.random() * 3000;
    const humanVariance = Math.random() * 500; // Simulate human reaction time

    await sleep(baseDelay + variance + humanVariance);
  }

  // Randomize request order
  shuffleUrls<T>(urls: T[]): T[] {
    const shuffled = [...urls];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Simulate browsing patterns
  async simulateBrowsing(page: Page): Promise<void> {
    // Random scroll
    await page.evaluate(() => {
      window.scrollTo({
        top: Math.random() * document.body.scrollHeight * 0.5,
        behavior: 'smooth',
      });
    });

    await sleep(500 + Math.random() * 1000);

    // Random mouse movement
    await page.mouse.move(
      Math.random() * 800 + 100,
      Math.random() * 600 + 100,
      { steps: 10 }
    );
  }
}
```

### 2. Fingerprint Rotation

```typescript
// src/utils/fingerprint.ts
export interface BrowserFingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  locale: string;
  timezone: string;
  platform: string;
  webglVendor: string;
  webglRenderer: string;
}

export function generateFingerprint(): BrowserFingerprint {
  const fingerprints: BrowserFingerprint[] = [
    {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'de-DE',
      timezone: 'Europe/Berlin',
      platform: 'Win32',
      webglVendor: 'Intel Inc.',
      webglRenderer: 'Intel Iris OpenGL Engine',
    },
    {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      viewport: { width: 2560, height: 1440 },
      locale: 'en-GB',
      timezone: 'Europe/London',
      platform: 'MacIntel',
      webglVendor: 'Apple Inc.',
      webglRenderer: 'Apple M1',
    },
    // Add more fingerprints...
  ];

  return fingerprints[Math.floor(Math.random() * fingerprints.length)];
}
```

### 3. Cookie and Session Management

```typescript
// src/utils/session-manager.ts
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

export class SessionManager {
  private s3: S3Client;
  private bucket: string;

  constructor(bucket: string) {
    this.s3 = new S3Client({});
    this.bucket = bucket;
  }

  async loadCookies(sessionId: string): Promise<Cookie[] | null> {
    try {
      const response = await this.s3.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: `sessions/${sessionId}/cookies.json`,
      }));

      const body = await response.Body?.transformToString();
      return body ? JSON.parse(body) : null;
    } catch {
      return null;
    }
  }

  async saveCookies(sessionId: string, cookies: Cookie[]): Promise<void> {
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `sessions/${sessionId}/cookies.json`,
      Body: JSON.stringify(cookies),
      ContentType: 'application/json',
    }));
  }

  // Rotate sessions to avoid detection
  generateSessionId(): string {
    return `session_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  }
}
```

### 4. CAPTCHA Handling Strategies

| Strategy | Cost | Success Rate | Latency |
|----------|------|--------------|---------|
| 2Captcha | $2.99/1000 | ~90% | 20-60s |
| Anti-Captcha | $2.00/1000 | ~88% | 15-45s |
| CapSolver | $1.50/1000 | ~85% | 10-30s |
| Avoid (Stealth) | $0 | ~70% | 0s |

```typescript
// src/utils/captcha-solver.ts
export async function solve2Captcha(
  siteKey: string,
  pageUrl: string
): Promise<string> {
  const apiKey = process.env.CAPTCHA_2CAPTCHA_API_KEY!;

  // Submit CAPTCHA
  const submitResponse = await fetch(
    `http://2captcha.com/in.php?key=${apiKey}&method=hcaptcha&sitekey=${siteKey}&pageurl=${pageUrl}&json=1`
  );
  const { request: taskId } = await submitResponse.json();

  // Poll for result
  for (let i = 0; i < 30; i++) {
    await sleep(5000);

    const resultResponse = await fetch(
      `http://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`
    );
    const result = await resultResponse.json();

    if (result.status === 1) {
      return result.request;
    }
  }

  throw new Error('CAPTCHA solving timeout');
}
```

---

## Data Pipeline Integration

### S3 Raw Data Storage

```typescript
// infrastructure/storage.ts
const rawDataBucket = new s3.Bucket(this, 'CardmarketRawData', {
  bucketName: 'tcg-cardmarket-raw-data',
  versioned: true,
  lifecycleRules: [
    {
      id: 'archive-old-data',
      transitions: [
        {
          storageClass: s3.StorageClass.INFREQUENT_ACCESS,
          transitionAfter: Duration.days(30),
        },
        {
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: Duration.days(90),
        },
      ],
      expiration: Duration.days(365),
    },
  ],
});
```

### SQS for Job Distribution

```typescript
// infrastructure/queues.ts
const scrapeJobQueue = new sqs.Queue(this, 'ScrapeJobQueue', {
  queueName: 'cardmarket-scrape-jobs',
  visibilityTimeout: Duration.minutes(15),
  retentionPeriod: Duration.days(7),
  deadLetterQueue: {
    queue: new sqs.Queue(this, 'ScrapeJobDLQ', {
      queueName: 'cardmarket-scrape-jobs-dlq',
    }),
    maxReceiveCount: 3,
  },
});

// FIFO queue for ordered processing
const priorityQueue = new sqs.Queue(this, 'PriorityScrapeQueue', {
  queueName: 'cardmarket-priority-scrapes.fifo',
  fifo: true,
  contentBasedDeduplication: true,
});
```

### Step Functions Orchestration

```typescript
// infrastructure/step-functions.ts
const scrapeWorkflow = new sfn.StateMachine(this, 'CardmarketScrapeWorkflow', {
  stateMachineName: 'cardmarket-scrape-workflow',
  definition: sfn.Chain
    .start(new tasks.LambdaInvoke(this, 'DiscoverExpansions', {
      lambdaFunction: discoveryLambda,
      outputPath: '$.Payload',
    }))
    .next(new sfn.Map(this, 'ProcessExpansions', {
      itemsPath: '$.expansions',
      maxConcurrency: 5,
    }).iterator(
      new tasks.LambdaInvoke(this, 'ScrapeExpansion', {
        lambdaFunction: scraperLambda,
      })
    ))
    .next(new tasks.LambdaInvoke(this, 'AggregateResults', {
      lambdaFunction: aggregatorLambda,
    })),
  timeout: Duration.hours(4),
});
```

---

## Cost Analysis

### Monthly Cost Estimates (1,000 cards/day)

| Component | Usage | Cost |
|-----------|-------|------|
| **Lambda** | 30K invocations × 1GB × 5s | ~$5 |
| **Fargate** | 2 tasks × 4hr/day | ~$15 |
| **Bright Data Proxy** | 5 GB residential | ~$75 |
| **S3 Storage** | 10 GB raw data | ~$0.25 |
| **DynamoDB** | 100K writes | ~$1.25 |
| **Kinesis** | 1M records | ~$0.04 |
| **Step Functions** | 1K executions | ~$0.025 |
| **CloudWatch** | Logs + Metrics | ~$5 |
| **NAT Gateway** | If using VPC | ~$32 |
| | | |
| **Total (with proxy)** | | **~$100/month** |
| **Total (with NAT only)** | | **~$60/month** |

### Cost Optimization Strategies

1. **Use Lambda for simple pages** - ~80% of pages don't need JavaScript rendering
2. **Cache aggressively** - Most card data doesn't change daily
3. **Batch requests** - Reduce proxy costs by reusing sessions
4. **Off-peak scraping** - Lower spot instance prices at night
5. **Tiered scheduling** - High-value cards hourly, others daily

---

## Recommended Architecture

### For Cardmarket TCG Scraping

```yaml
# Recommended configuration
architecture:
  primary_compute: Lambda
  fallback_compute: ECS Fargate (Playwright)
  proxy_provider: Bright Data Residential

compute:
  lambda:
    memory: 1024 MB
    timeout: 5 minutes
    concurrency: 50
    layers:
      - cheerio
      - shared-utils

  fargate:
    cpu: 1024
    memory: 2048 MB
    image: playwright:latest
    autoscaling:
      min: 0
      max: 5
      target_cpu: 70%

proxy:
  provider: brightdata
  type: residential_rotating
  geo: eu
  session_ttl: 10 minutes

scheduling:
  full_catalog: daily at 02:00 UTC
  trending_cards: every 6 hours
  high_value_cards: hourly

storage:
  raw_html: S3 (Standard → IA → Glacier)
  current_prices: DynamoDB
  price_history: Timestream

monitoring:
  success_rate_threshold: 95%
  latency_p99_threshold: 30s
  cost_alert_threshold: $150/month
```

---

## Implementation Checklist

### Phase 1: Foundation (Week 1)

- [ ] Set up AWS infrastructure with CDK
- [ ] Configure Bright Data proxy account
- [ ] Create base Lambda scraper function
- [ ] Set up S3 bucket for raw data
- [ ] Configure SQS job queues
- [ ] Set up CloudWatch dashboards

### Phase 2: Scraper Development (Week 2)

- [ ] Implement HTML parser with multiple strategies
- [ ] Add proxy rotation logic
- [ ] Implement anti-detection measures
- [ ] Create Playwright Fargate task for JS pages
- [ ] Add CAPTCHA handling (if needed)
- [ ] Test against Cardmarket staging

### Phase 3: Pipeline Integration (Week 3)

- [ ] Connect to Kinesis data stream
- [ ] Integrate with quality validator
- [ ] Set up DynamoDB current prices table
- [ ] Configure Timestream for history
- [ ] Implement Step Functions orchestration
- [ ] Add dead-letter queue handling

### Phase 4: Production & Monitoring (Week 4)

- [ ] Deploy to production
- [ ] Set up alerting
- [ ] Configure cost alerts
- [ ] Implement automatic recovery
- [ ] Document runbooks
- [ ] Performance tuning

---

## References

- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Bright Data Documentation](https://brightdata.com/docs)
- [AWS Step Functions Developer Guide](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
- [Web Scraping Best Practices](https://www.scrapingbee.com/blog/web-scraping-best-practices/)
