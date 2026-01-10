# Cardmarket Scraper Development

> Development workspace for Cardmarket EU market data scraping
> One Piece TCG Price Data Collection

**[>>> DOCUMENTATION INDEX <<<](docs/INDEX.md)** - Start here to navigate all documentation

---

## Overview

Cardmarket is Europe's largest trading card marketplace. Since they **no longer offer a public API** (as of January 2025), web scraping is required to access EU market pricing data. This directory contains all resources for developing and deploying a production-grade Cardmarket scraper.

### Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| Basic Scraper | ✅ Implemented | `lambda/collectors/cardmarket/cardmarket-scraper.ts` |
| AWS Infrastructure Docs | ✅ Complete | `docs/AWS_SCRAPING_INFRASTRUCTURE.md` |
| Tools & Resources | ✅ Complete | `docs/TOOLS_AND_RESOURCES.md` |
| Playwright Integration | 🔄 Planned | For JS-rendered pages |
| Proxy Rotation | 🔄 Planned | Bright Data integration |
| CAPTCHA Handling | 📋 Backlog | 2Captcha integration |

---

## Directory Structure

```
scraper-dev/cardmarket/
├── README.md                    # This file
├── docs/
│   ├── AWS_SCRAPING_INFRASTRUCTURE.md  # AWS architecture guide
│   ├── TOOLS_AND_RESOURCES.md          # Tools catalog
│   ├── URL_PATTERNS.md                 # Cardmarket URL analysis (TODO)
│   └── HTML_SELECTORS.md               # CSS selector reference (TODO)
├── src/
│   ├── scrapers/                # Scraper implementations
│   ├── parsers/                 # HTML parsing logic
│   ├── browser/                 # Playwright/Puppeteer code
│   └── utils/                   # Helper functions
├── tests/
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── fixtures/                # Test HTML fixtures
├── config/
│   ├── proxy.ts                 # Proxy configuration
│   ├── selectors.ts             # CSS selectors config
│   └── sets.ts                  # One Piece set definitions
├── scripts/
│   ├── test-scraper.ts          # Local testing script
│   ├── analyze-html.ts          # HTML structure analyzer
│   └── benchmark.ts             # Performance benchmarking
└── docker/
    └── playwright/              # Playwright Docker image
        └── Dockerfile
```

---

## Quick Start

### 1. Prerequisites

```bash
# Node.js 18+
node --version  # v18.x or higher

# AWS CLI configured
aws sts get-caller-identity

# Optional: Docker for Playwright
docker --version
```

### 2. Setup

```bash
# Navigate to scraper directory
cd infrastructure/data-pipeline/scraper-dev/cardmarket

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your credentials
```

### 3. Local Testing

```bash
# Run basic scraper test
npx tsx scripts/test-scraper.ts

# Run with proxy
PROXY_URL=http://user:pass@proxy:port npx tsx scripts/test-scraper.ts

# Run tests
npm test
```

---

## Implementation Phases

### Phase 1: Foundation (Current)
- [x] Basic HTML scraper with Cheerio
- [x] Multi-strategy parsing (fallback patterns)
- [x] Rate limiting and delays
- [x] AWS infrastructure documentation
- [ ] Unit tests for parsers

### Phase 2: Resilience
- [ ] Proxy rotation integration (Bright Data)
- [ ] Session management
- [ ] User-agent rotation
- [ ] Cookie persistence
- [ ] Error recovery

### Phase 3: Scale
- [ ] Playwright integration for JS pages
- [ ] Fargate task for heavy scraping
- [ ] Step Functions orchestration
- [ ] Dead-letter queue handling
- [ ] CloudWatch alarms

### Phase 4: Production
- [ ] CAPTCHA handling
- [ ] Cost optimization
- [ ] Performance tuning
- [ ] Monitoring dashboards
- [ ] Runbook documentation

---

## Key Documentation

### Infrastructure
- **[AWS Scraping Infrastructure](docs/AWS_SCRAPING_INFRASTRUCTURE.md)**
  - Compute options (Lambda vs Fargate vs EC2)
  - Proxy infrastructure setup
  - Anti-detection strategies
  - Cost analysis
  - Recommended architecture

### Tools
- **[Tools & Resources](docs/TOOLS_AND_RESOURCES.md)**
  - Core libraries (Playwright, Cheerio, etc.)
  - Proxy service comparison
  - CAPTCHA solving services
  - AWS SDK configuration
  - Development tools

---

## Cardmarket URL Patterns

### Base URLs

```
Main site: https://www.cardmarket.com
One Piece: https://www.cardmarket.com/en/OnePiece
```

### Key Endpoints

| Pattern | Purpose | Example |
|---------|---------|---------|
| `/Products/Singles/{Set}` | Set listing | `/Products/Singles/Romance-Dawn` |
| `/Products/Singles/{Set}/{Card}` | Card detail | `/Products/Singles/Romance-Dawn/Monkey-D-Luffy-OP01-003` |
| `/Users/{User}/Offers/Singles` | Seller listings | `/Users/CardShop/Offers/Singles` |
| `/Products/Search` | Search results | `/Products/Search?searchString=Luffy` |

### One Piece Set Mappings

| Set Code | Cardmarket Name | Release |
|----------|-----------------|---------|
| OP01 | Romance-Dawn | Jul 2022 |
| OP02 | Paramount-War | Oct 2022 |
| OP03 | Pillars-of-Strength | Jan 2023 |
| OP04 | Kingdoms-of-Intrigue | May 2023 |
| OP05 | Awakening-of-the-New-Era | Aug 2023 |
| OP06 | Wings-of-the-Captain | Nov 2023 |
| OP07 | 500-Years-in-the-Future | Feb 2024 |
| OP08 | Two-Legends | May 2024 |
| OP09 | The-Four-Emperors | Aug 2024 |
| OP10 | Royal-Blood | Nov 2024 |
| OP11 | Uta | Feb 2025 |
| EB01 | Memorial-Collection | Dec 2023 |
| EB02 | Extra-Booster-Anime-25th | Sep 2024 |

---

## HTML Parsing Strategies

### Primary Selectors (Current Implementation)

```typescript
const SELECTORS = {
  // Price page
  trendPrice: '.price-container .trend, .info-list-container dd:contains("Trend")',
  lowPrice: '.price-container .low, .info-list-container dd:contains("From")',
  avgPrice: '.price-container .avg',

  // Product list
  productRow: '.table-body .row, .product-row',
  productName: '.col-product a, .product-name',
  productPrice: '.col-price, .price-container .trend',

  // Expansion page
  expansionList: '.expansion-list .expansion',
  expansionName: '.expansion-name, .name',
  expansionCode: '.expansion-code, [data-code]',
};
```

### Fallback Parsing (Regex)

```typescript
// When selectors fail, extract from raw HTML
const priceRegex = /€\s*(\d+[.,]\d{2})/g;
const cardNumberRegex = /([A-Z]{2,3}\d{2})-(\d{3})/gi;
```

---

## Configuration

### Environment Variables

```bash
# Required
AWS_REGION=eu-central-1

# Proxy (choose one)
BRIGHT_DATA_CUSTOMER=xxx
BRIGHT_DATA_PASSWORD=xxx
# OR
SMARTPROXY_USER=xxx
SMARTPROXY_PASSWORD=xxx

# Optional
CAPTCHA_API_KEY=xxx
REQUEST_DELAY_MS=2000
MAX_CONCURRENCY=10
```

### Proxy Configuration

```typescript
// config/proxy.ts
export const PROXY_CONFIG = {
  provider: 'brightdata', // or 'smartproxy', 'oxylabs'
  type: 'residential',
  geo: ['de', 'fr', 'it', 'es', 'nl'], // EU countries
  sessionTtl: 600, // 10 minutes
  rotationStrategy: 'per-request', // or 'sticky'
};
```

---

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/parser.test.ts

# Watch mode
npm test -- --watch
```

### Integration Tests

```bash
# Requires proxy configuration
npm run test:integration

# Test against live Cardmarket (be careful with rate limits!)
npm run test:live
```

### Manual Testing

```bash
# Test single card scrape
npx tsx scripts/test-scraper.ts --card "OP01-003"

# Test expansion scrape
npx tsx scripts/test-scraper.ts --expansion "Romance-Dawn"

# Test with debug output
DEBUG=cardmarket:* npx tsx scripts/test-scraper.ts
```

---

## Deployment

### Lambda Deployment

```bash
# Build and deploy via CDK
cd ../../infrastructure
cdk deploy CardmarketScraperStack

# Or via SAM
sam build && sam deploy
```

### Fargate Deployment

```bash
# Build Docker image
docker build -t cardmarket-playwright -f docker/playwright/Dockerfile .

# Push to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URI
docker tag cardmarket-playwright:latest $ECR_URI/cardmarket-playwright:latest
docker push $ECR_URI/cardmarket-playwright:latest

# Deploy via CDK
cdk deploy CardmarketFargateStack
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| 403 Forbidden | Bot detection | Use residential proxy, add delays |
| Empty responses | JS rendering required | Use Playwright/Puppeteer |
| CAPTCHA | Too many requests | Slow down, use solver service |
| Price parsing fails | HTML structure changed | Update selectors, check fallbacks |
| Timeout | Slow proxy/page | Increase timeout, retry |

### Debug Commands

```bash
# Check proxy is working
curl -x http://user:pass@proxy:port https://www.cardmarket.com/en/OnePiece

# Test with verbose logging
DEBUG=* npm run test:single

# Capture HTML for analysis
npx tsx scripts/capture-html.ts --url "https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn"
```

---

## Related Files

### Existing Implementations

| File | Purpose |
|------|---------|
| `lambda/collectors/cardmarket/cardmarket-scraper.ts` | Current scraper implementation |
| `lambda/collectors/cardmarket/cardmarket.ts` | Legacy API client (non-functional) |
| `lambda/layers/shared/nodejs/utils.ts` | Shared utilities |

### Documentation

| File | Purpose |
|------|---------|
| `docs/DATA_QUALITY_PIPELINE_PLAN.md` | Overall pipeline documentation |
| `docs/AWS_SCRAPING_INFRASTRUCTURE.md` | Infrastructure guide |
| `docs/TOOLS_AND_RESOURCES.md` | Tools catalog |

---

## Contributing

1. Create feature branch: `git checkout -b feature/cardmarket-xyz`
2. Implement changes with tests
3. Update documentation if needed
4. Submit PR for review

### Code Style

- TypeScript strict mode
- ESLint + Prettier
- JSDoc comments for public functions
- Comprehensive error handling

---

## Support

For questions or issues:
1. Check troubleshooting section above
2. Review AWS CloudWatch logs
3. Open issue in repository

---

## License

Internal use only. Respect Cardmarket's Terms of Service.

---

**[>>> Full Documentation Index <<<](docs/INDEX.md)** | *Navigate all TCG pipeline documentation*
