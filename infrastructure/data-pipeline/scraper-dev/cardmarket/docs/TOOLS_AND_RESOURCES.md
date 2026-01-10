# Cardmarket Scraping Tools & Resources

> Comprehensive catalog of tools, libraries, services, and resources for Cardmarket scraping
> Last Updated: January 2025

---

## Table of Contents

1. [Core Libraries](#core-libraries)
2. [Proxy Services](#proxy-services)
3. [CAPTCHA Solving Services](#captcha-solving-services)
4. [Browser Automation](#browser-automation)
5. [HTML Parsing Libraries](#html-parsing-libraries)
6. [AWS SDK & Services](#aws-sdk--services)
7. [Monitoring & Debugging](#monitoring--debugging)
8. [Third-Party Scraping Services](#third-party-scraping-services)
9. [Development Tools](#development-tools)
10. [Reference Resources](#reference-resources)

---

## Core Libraries

### Node.js / TypeScript

| Library | Purpose | Install | Documentation |
|---------|---------|---------|---------------|
| **playwright** | Browser automation | `npm i playwright` | [playwright.dev](https://playwright.dev) |
| **puppeteer** | Browser automation | `npm i puppeteer` | [pptr.dev](https://pptr.dev) |
| **puppeteer-extra** | Stealth plugins | `npm i puppeteer-extra` | [GitHub](https://github.com/berstend/puppeteer-extra) |
| **cheerio** | HTML parsing | `npm i cheerio` | [cheerio.js.org](https://cheerio.js.org) |
| **jsdom** | DOM simulation | `npm i jsdom` | [GitHub](https://github.com/jsdom/jsdom) |
| **node-fetch** | HTTP client | `npm i node-fetch` | [GitHub](https://github.com/node-fetch/node-fetch) |
| **axios** | HTTP client | `npm i axios` | [axios-http.com](https://axios-http.com) |
| **got** | HTTP client | `npm i got` | [GitHub](https://github.com/sindresorhus/got) |
| **p-queue** | Concurrency control | `npm i p-queue` | [GitHub](https://github.com/sindresorhus/p-queue) |
| **bottleneck** | Rate limiting | `npm i bottleneck` | [GitHub](https://github.com/SGrondin/bottleneck) |

### Recommended package.json

```json
{
  "name": "cardmarket-scraper",
  "version": "1.0.0",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.x",
    "@aws-sdk/client-kinesis": "^3.x",
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/client-secrets-manager": "^3.x",
    "@aws-sdk/client-sqs": "^3.x",
    "@aws-sdk/util-dynamodb": "^3.x",
    "axios": "^1.6.x",
    "bottleneck": "^2.19.x",
    "cheerio": "^1.0.0-rc.12",
    "got": "^14.x",
    "p-queue": "^8.x",
    "playwright": "^1.40.x",
    "puppeteer": "^21.x",
    "puppeteer-extra": "^3.3.x",
    "puppeteer-extra-plugin-stealth": "^2.11.x",
    "user-agents": "^1.1.x",
    "uuid": "^9.x"
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "typescript": "^5.x",
    "vitest": "^1.x"
  }
}
```

---

## Proxy Services

### Tier 1: Residential Proxies (Recommended)

| Provider | Pricing | Features | Best For |
|----------|---------|----------|----------|
| **[Bright Data](https://brightdata.com)** | $15/GB | 72M+ IPs, EU coverage, API | Production |
| **[Oxylabs](https://oxylabs.io)** | $12/GB | 100M+ IPs, real-time | High volume |
| **[SmartProxy](https://smartproxy.com)** | $12.5/GB | 40M+ IPs, sticky sessions | Mid-scale |
| **[IPRoyal](https://iproyal.com)** | $7/GB | Budget option, decent EU | Testing |

### Tier 2: Datacenter Proxies (Cheaper, Riskier)

| Provider | Pricing | IPs | Success Rate |
|----------|---------|-----|--------------|
| **[Webshare](https://www.webshare.io)** | $5/100 IPs/mo | Shared/Dedicated | ~50% |
| **[Proxy-Seller](https://proxy-seller.com)** | $1.10/IP/mo | Dedicated | ~60% |
| **[Shifter](https://shifter.io)** | $5/5GB | Rotating | ~55% |

### Proxy Configuration Examples

#### Bright Data

```typescript
// Residential rotating proxy
const proxyUrl = `http://${CUSTOMER_ID}-country-de-session-${SESSION_ID}:${PASSWORD}@brd.superproxy.io:22225`;

// Datacenter proxy
const dcProxyUrl = `http://${CUSTOMER_ID}-zone-datacenter:${PASSWORD}@brd.superproxy.io:22225`;

// Mobile proxy (best success, highest cost)
const mobileProxyUrl = `http://${CUSTOMER_ID}-zone-mobile:${PASSWORD}@brd.superproxy.io:22225`;
```

#### Oxylabs

```typescript
// Residential
const proxyUrl = `http://customer-${USERNAME}-cc-de:${PASSWORD}@pr.oxylabs.io:7777`;

// Datacenter
const dcProxyUrl = `http://${USERNAME}:${PASSWORD}@dc.pr.oxylabs.io:10000`;
```

#### SmartProxy

```typescript
// Residential rotating
const proxyUrl = `http://user-${USERNAME}-country-de:${PASSWORD}@gate.smartproxy.com:7000`;

// Sticky session (same IP for 10 min)
const stickyProxyUrl = `http://user-${USERNAME}-country-de-session-${SESSION}:${PASSWORD}@gate.smartproxy.com:7000`;
```

### Free/Testing Proxies

| Service | Type | Limit | Notes |
|---------|------|-------|-------|
| **[ScraperAPI Free](https://www.scraperapi.com)** | API | 1000/mo | Good for testing |
| **[ProxyScrape](https://proxyscrape.com)** | List | N/A | Unreliable, testing only |
| **[Free-Proxy-List](https://free-proxy-list.net)** | List | N/A | Very unreliable |

---

## CAPTCHA Solving Services

### Automated Solving

| Service | Price/1000 | Speed | Captcha Types |
|---------|-----------|-------|---------------|
| **[2Captcha](https://2captcha.com)** | $2.99 | 20-60s | reCAPTCHA, hCaptcha, image |
| **[Anti-Captcha](https://anti-captcha.com)** | $2.00 | 15-45s | reCAPTCHA, hCaptcha, FunCaptcha |
| **[CapSolver](https://capsolver.com)** | $1.50 | 10-30s | reCAPTCHA, hCaptcha |
| **[DeathByCaptcha](https://www.deathbycaptcha.com)** | $1.39 | 15-50s | All types |
| **[CapMonster](https://capmonster.cloud)** | $0.60 | 5-20s | AI-based, variable |

### Integration Example

```typescript
// 2Captcha integration
export async function solveCaptcha(
  type: 'recaptcha_v2' | 'hcaptcha',
  siteKey: string,
  pageUrl: string
): Promise<string> {
  const apiKey = process.env.CAPTCHA_API_KEY!;

  const method = type === 'hcaptcha' ? 'hcaptcha' : 'userrecaptcha';
  const submitUrl = `http://2captcha.com/in.php?key=${apiKey}&method=${method}&sitekey=${siteKey}&pageurl=${pageUrl}&json=1`;

  const submitRes = await fetch(submitUrl);
  const { request: taskId } = await submitRes.json();

  // Poll for result (max 2 minutes)
  for (let i = 0; i < 24; i++) {
    await sleep(5000);

    const resultRes = await fetch(
      `http://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`
    );
    const result = await resultRes.json();

    if (result.status === 1) {
      return result.request; // CAPTCHA token
    }
    if (result.request === 'ERROR_CAPTCHA_UNSOLVABLE') {
      throw new Error('CAPTCHA unsolvable');
    }
  }

  throw new Error('CAPTCHA solving timeout');
}
```

---

## Browser Automation

### Playwright (Recommended)

```bash
npm install playwright
npx playwright install chromium  # Install browser
```

```typescript
import { chromium, firefox, webkit } from 'playwright';

// Chromium (best compatibility)
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
});

// Firefox (better fingerprinting)
const firefoxBrowser = await firefox.launch({ headless: true });

// WebKit (Safari-like)
const webkitBrowser = await webkit.launch({ headless: true });
```

### Puppeteer with Stealth

```bash
npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth puppeteer-extra-plugin-adblocker
```

```typescript
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
  ],
});
```

### Browser Fingerprinting Tools

| Tool | Purpose | Link |
|------|---------|------|
| **FingerprintJS** | Detect fingerprinting | [fingerprint.com](https://fingerprint.com) |
| **CreepJS** | Fingerprint testing | [GitHub](https://github.com/nickytonline/creepjs) |
| **BrowserLeaks** | Test browser leaks | [browserleaks.com](https://browserleaks.com) |
| **Bot.sannysoft** | Bot detection test | [bot.sannysoft.com](https://bot.sannysoft.com) |

---

## HTML Parsing Libraries

### Cheerio (Fastest)

```typescript
import * as cheerio from 'cheerio';

const $ = cheerio.load(html);

// Select elements
const price = $('.price-container .trend').text();
const cards = $('.product-list .product-row').map((i, el) => ({
  name: $(el).find('.product-name').text(),
  price: parseFloat($(el).find('.price').text().replace('€', '')),
})).get();
```

### JSDOM (Full DOM)

```typescript
import { JSDOM } from 'jsdom';

const dom = new JSDOM(html);
const document = dom.window.document;

const price = document.querySelector('.price-container .trend')?.textContent;
const elements = document.querySelectorAll('.product-row');
```

### CSS Selector Tools

| Tool | Purpose |
|------|---------|
| **[SelectorGadget](https://selectorgadget.com)** | Chrome extension for selector discovery |
| **Chrome DevTools** | Built-in element inspection |
| **[CSS Selector Tester](https://www.w3schools.com/cssref/trysel.asp)** | Online selector testing |

---

## AWS SDK & Services

### Required SDK Packages

```bash
npm install @aws-sdk/client-lambda @aws-sdk/client-s3 @aws-sdk/client-sqs \
  @aws-sdk/client-dynamodb @aws-sdk/client-kinesis @aws-sdk/client-secrets-manager \
  @aws-sdk/client-cloudwatch @aws-sdk/client-ecs @aws-sdk/client-sfn \
  @aws-sdk/util-dynamodb
```

### AWS Service Configuration

```typescript
// config/aws.ts
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { KinesisClient } from '@aws-sdk/client-kinesis';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { ECSClient } from '@aws-sdk/client-ecs';
import { SFNClient } from '@aws-sdk/client-sfn';

const REGION = process.env.AWS_REGION || 'eu-central-1';

export const s3Client = new S3Client({ region: REGION });
export const dynamoClient = new DynamoDBClient({ region: REGION });
export const kinesisClient = new KinesisClient({ region: REGION });
export const sqsClient = new SQSClient({ region: REGION });
export const secretsClient = new SecretsManagerClient({ region: REGION });
export const cloudwatchClient = new CloudWatchClient({ region: REGION });
export const ecsClient = new ECSClient({ region: REGION });
export const sfnClient = new SFNClient({ region: REGION });
```

### AWS CDK Resources

```bash
npm install aws-cdk-lib constructs
```

```typescript
// infrastructure/scraper-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
```

---

## Monitoring & Debugging

### AWS CloudWatch

```typescript
// utils/metrics.ts
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

export async function recordMetric(
  name: string,
  value: number,
  unit: string = 'Count',
  dimensions: Record<string, string> = {}
): Promise<void> {
  const client = new CloudWatchClient({});

  await client.send(new PutMetricDataCommand({
    Namespace: 'CardmarketScraper',
    MetricData: [{
      MetricName: name,
      Value: value,
      Unit: unit,
      Dimensions: Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value })),
      Timestamp: new Date(),
    }],
  }));
}

// Usage
await recordMetric('ScrapeSuccess', 1, 'Count', { Source: 'cardmarket', Set: 'OP01' });
await recordMetric('ResponseTime', 1500, 'Milliseconds', { Endpoint: 'price_guide' });
await recordMetric('ProxyCost', 0.015, 'None', { Provider: 'brightdata' });
```

### Logging Best Practices

```typescript
// utils/logger.ts
export const logger = {
  info: (message: string, data?: object) => {
    console.log(JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      message,
      ...data,
    }));
  },
  error: (message: string, error?: Error, data?: object) => {
    console.error(JSON.stringify({
      level: 'ERROR',
      timestamp: new Date().toISOString(),
      message,
      error: error?.message,
      stack: error?.stack,
      ...data,
    }));
  },
  metric: (name: string, value: number, dimensions?: object) => {
    console.log(JSON.stringify({
      level: 'METRIC',
      timestamp: new Date().toISOString(),
      metric: name,
      value,
      ...dimensions,
    }));
  },
};
```

### Debugging Tools

| Tool | Purpose | Usage |
|------|---------|-------|
| **AWS X-Ray** | Distributed tracing | SDK integration |
| **CloudWatch Logs Insights** | Log analysis | Query language |
| **Playwright Inspector** | Debug automation | `PWDEBUG=1` env var |
| **Puppeteer Recorder** | Record interactions | Chrome extension |

---

## Third-Party Scraping Services

### Managed Scraping APIs

| Service | Pricing | Features |
|---------|---------|----------|
| **[ScraperAPI](https://www.scraperapi.com)** | $49/mo (100K) | Proxy rotation, JS rendering |
| **[Scrapingbee](https://www.scrapingbee.com)** | $49/mo (150K) | Stealth mode, screenshots |
| **[Apify](https://apify.com)** | $49/mo | Actor marketplace, cloud |
| **[Crawlbase](https://crawlbase.com)** | $29/mo (100K) | Simple API |

### Apify Cardmarket Actor

```bash
# Existing Cardmarket actors on Apify
apify call drobnikj/cardmarket-trend-scraper
```

| Actor | Cost | Output |
|-------|------|--------|
| `drobnikj/cardmarket-trend-scraper` | ~$10/mo | Trend prices, card data |

---

## Development Tools

### Local Development

```bash
# AWS SAM for local Lambda testing
npm install -g aws-sam-cli
sam local invoke --event event.json

# Docker for Fargate testing
docker build -t cardmarket-scraper .
docker run -e PROXY_URL=xxx cardmarket-scraper

# LocalStack for AWS emulation
docker run -d -p 4566:4566 localstack/localstack
```

### Testing Libraries

```bash
npm install -D vitest @vitest/coverage-v8 msw nock
```

```typescript
// tests/scraper.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CardmarketScraper } from '../src/scraper';

describe('CardmarketScraper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse price from HTML', async () => {
    const scraper = new CardmarketScraper();
    const html = `<div class="price-container"><span class="trend">€10.99</span></div>`;

    const price = scraper.parsePrice(html);

    expect(price).toBe(10.99);
  });
});
```

### Useful VS Code Extensions

| Extension | Purpose |
|-----------|---------|
| **REST Client** | Test HTTP requests |
| **Playwright Test** | Run/debug Playwright tests |
| **AWS Toolkit** | AWS integration |
| **Thunder Client** | API testing |

---

## Reference Resources

### Cardmarket-Specific

| Resource | Description |
|----------|-------------|
| [Cardmarket One Piece](https://www.cardmarket.com/en/OnePiece) | Main marketplace |
| [URL Structure Analysis](./URL_PATTERNS.md) | URL patterns for scraping |
| [HTML Selectors](./HTML_SELECTORS.md) | CSS selectors for data extraction |

### Web Scraping Best Practices

| Resource | Link |
|----------|------|
| **Scraping Best Practices** | [scrapingbee.com/blog](https://www.scrapingbee.com/blog/web-scraping-best-practices/) |
| **Anti-Bot Detection** | [incolumitas.com](https://incolumitas.com/pages/BotDetection/) |
| **Playwright Stealth** | [GitHub](https://github.com/nickytonline/playwright-extra) |
| **AWS Lambda for Scraping** | [AWS Blog](https://aws.amazon.com/blogs/compute/web-scraping-with-aws-lambda/) |

### Legal Considerations

| Topic | Notes |
|-------|-------|
| **robots.txt** | Check and respect (Cardmarket allows limited scraping) |
| **Terms of Service** | Review ToS for restrictions |
| **Rate Limiting** | Stay below 1 request/second as best practice |
| **Data Usage** | Personal/research use typically acceptable |

---

## Quick Reference

### Environment Variables

```bash
# .env.example
AWS_REGION=eu-central-1
AWS_ACCOUNT_ID=123456789012

# Proxy Configuration
BRIGHT_DATA_CUSTOMER=customer-id
BRIGHT_DATA_PASSWORD=password
PROXY_ENDPOINT=brd.superproxy.io:22225

# CAPTCHA (optional)
CAPTCHA_2CAPTCHA_API_KEY=your-api-key

# AWS Resources
PRICE_STREAM_NAME=cardmarket-prices
CURRENT_PRICES_TABLE=cardmarket-current-prices
RAW_DATA_BUCKET=tcg-cardmarket-raw-data
SECRETS_ARN=arn:aws:secretsmanager:eu-central-1:xxx:secret:xxx

# Scraping Configuration
REQUEST_DELAY_MS=2000
MAX_CONCURRENCY=10
RETRY_ATTEMPTS=3
```

### Useful Commands

```bash
# Deploy infrastructure
cdk deploy CardmarketScraperStack

# Test Lambda locally
sam local invoke CardmarketScraper -e events/test.json

# View logs
aws logs tail /aws/lambda/cardmarket-scraper --follow

# Query metrics
aws cloudwatch get-metric-statistics \
  --namespace CardmarketScraper \
  --metric-name ScrapeSuccess \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-02T00:00:00Z \
  --period 3600 \
  --statistics Sum
```
