# Global Trading Card Marketplaces Research

> **Purpose**: Comprehensive reference for the Neural Engine's Cost Genome - understanding platform fees, shipping costs, and regional market dynamics for accurate arbitrage calculation.

---

## Table of Contents
1. [North American Platforms](#north-american-platforms)
2. [European Platforms](#european-platforms)
3. [Japanese Platforms](#japanese-platforms)
4. [Global/Multi-Regional Platforms](#globalmulti-regional-platforms)
5. [UK Retail Platforms](#uk-retail-platforms)
6. [Asian Regional Platforms](#asian-regional-platforms)
7. [Grading Services](#grading-services)
8. [Fee Comparison Matrix](#fee-comparison-matrix)
9. [API Availability](#api-availability)
10. [Arbitrage Implications](#arbitrage-implications)

---

## North American Platforms

### TCGplayer (USA)
**Website**: https://www.tcgplayer.com

| Attribute | Value |
|-----------|-------|
| **Base Fee** | 10.25% + $0.30 per sale |
| **Pro Seller Fee** | 8.95% + $0.30 (for high-volume sellers) |
| **Payment Processing** | Included in fees |
| **Buyer Protection** | Full refund guarantee |
| **Seller Requirements** | US-based, verified identity |
| **Shipping (Domestic)** | $0.78 PWE, $3.99+ tracked |
| **Shipping (International)** | Limited, via Direct program |
| **Currency** | USD |
| **Primary Games** | MTG, Pokemon, Yu-Gi-Oh!, One Piece, Lorcana |

**Key Features**:
- **TCGplayer Direct**: Sellers ship to TCGplayer warehouse, they handle fulfillment
- **Market Price Algorithm**: Aggregated pricing data used industry-wide
- **Cart Optimizer**: Combines orders from multiple sellers for best price
- **Condition Grading**: NM, LP, MP, HP, Damaged (no grading verification)

**Arbitrage Notes**:
- Largest US market with most competitive pricing
- Direct program adds ~3% to seller fees but unlocks international buyers
- Prices tend to be 10-20% lower than eBay for same condition
- Japanese cards often unavailable or premium-priced

---

### eBay (Global, US-focused)
**Website**: https://www.ebay.com

| Attribute | Value |
|-----------|-------|
| **Final Value Fee** | 13.25% (most categories) |
| **Below $10** | 13.25% (no change) |
| **Above $7,500** | 2.35% on amount over $7,500 |
| **Payment Processing** | +$0.30 per order |
| **International Fee** | +1.65% for international sales |
| **Managed Payments** | Mandatory (eBay handles all payments) |
| **Currency** | Multi-currency support |

**Key Features**:
- **Global Shipping Program (GSP)**: eBay handles international fulfillment
- **Authenticity Guarantee**: For cards >$150 (PSA/CGC verified)
- **Best Offer**: Negotiation common, actual sale prices often 15-20% below listing
- **Auction Format**: Still used for rare/high-value cards

**Arbitrage Notes**:
- Highest fees but largest buyer pool
- Japanese cards command 20-40% premium vs Japanese markets
- Graded cards dominant; raw cards undervalued
- Seller can list globally from any country
- Watch "sold" prices, not "listed" prices for accurate market data

---

## European Platforms

### Cardmarket (EU/UK)
**Website**: https://www.cardmarket.com

| Attribute | Value |
|-----------|-------|
| **Commission** | 5% (standard) |
| **Pro Seller** | 5% (same, but more features) |
| **Payment Processing** | Included |
| **Minimum Order** | Varies by seller (typically €2) |
| **Buyer Protection** | Full, disputes handled by CM |
| **Currency** | EUR (GBP for UK sellers) |

**Shipping Rates (EU)**:
| Method | Weight | Cost |
|--------|--------|------|
| Letter | <20g | €0.75-1.50 |
| Tracked | Any | €3.50-6.00 |
| Registered | Any | €5.00-8.00 |

**Key Features**:
- **Wants List**: Automated matching for card collections
- **Price Guide**: Historical data, market trends
- **Condition Standards**: Strict EU grading (NM/EX/GD/LP/PL/PO)
- **Cross-border**: Seamless EU shipping, UK now separate zone

**Regional Pricing**:
```
Germany/Netherlands: Base prices (most competitive)
France/Spain/Italy: +5-10% typical
UK: +10-15% (post-Brexit shipping costs)
Eastern Europe: -5-10% (lower demand)
```

**Arbitrage Notes**:
- Lowest fees of any major platform
- Best for bulk purchases (shipping scales well)
- Japanese cards rare; EU-printed cards dominate
- Post-Brexit UK shipping adds €3-8 to orders
- Price alerts useful for arbitrage automation

---

### CardTrader (Global, EU-based)
**Website**: https://www.cardtrader.com

| Attribute | Value |
|-----------|-------|
| **Commission** | 5% (buyer pays) |
| **Pro Seller** | 7% (seller pays, buyer sees net price) |
| **Zero Fee** | 0% + €0.02/card (subscription model) |
| **Currency** | EUR, USD |

**Key Features**:
- **Zero Platform**: Subscription model with near-zero fees
- **Japanese Cards**: Better selection than Cardmarket
- **One Piece Focus**: Strong OPTCG inventory
- **Global Shipping**: Ships worldwide from Malta hub

**Arbitrage Notes**:
- Zero fee model ideal for high-volume arbitrage
- Japanese One Piece cards available at EU prices
- Smaller market = less competition, occasional deals
- €49/month Zero subscription profitable at ~€1000/month volume

---

## Japanese Platforms

### Yahoo Auctions Japan (via Proxy)
**Website**: https://auctions.yahoo.co.jp

| Attribute | Value |
|-----------|-------|
| **Platform Fee** | 10% (seller) |
| **Proxy Service Fee** | 10-15% (JDirectItems, Buyee, etc.) |
| **Total Effective Fee** | ~20-25% to foreign buyers |
| **Currency** | JPY |

**Proxy Services**:
| Service | Fee | Notes |
|---------|-----|-------|
| Buyee | ¥300 + 5% | Popular, good UI |
| JDirectItems (JDI) | 10% | TCG-focused |
| FromJapan | 5% | Cheaper, slower |
| ZenMarket | ¥300 | Good for bulk |

**Shipping from Japan**:
| Method | Weight | Cost to UK |
|--------|--------|------------|
| Surface | 2kg | ¥1,800 (~£10) |
| SAL | 2kg | ¥2,500 (~£14) |
| EMS | 2kg | ¥4,500 (~£25) |
| DHL | 2kg | ¥6,000+ (~£35) |

**Arbitrage Notes**:
- **Best source for Japanese-exclusive cards**
- Prices 30-50% below Western markets for JP cards
- Auction ending times: 22:00-00:00 JST optimal
- Bundle lots ("まとめ売り") offer best value
- Customs: UK import VAT 20% + handling on orders >£135
- PSA 10 Japanese cards often 60% of US eBay prices

---

### Mercari Japan
**Website**: https://jp.mercari.com

| Attribute | Value |
|-----------|-------|
| **Platform Fee** | 10% (seller) |
| **Proxy Fee** | 10-15% additional |
| **Currency** | JPY |
| **Format** | Fixed price only |

**Key Features**:
- Mobile-first marketplace (app required for selling)
- Instant buy (no auctions)
- Heavy individual seller presence
- Lots of bundle deals

**Arbitrage Notes**:
- Faster than Yahoo Auctions (no waiting for auction end)
- More "hidden gems" from casual sellers
- Condition descriptions less reliable
- "Neraime" (狙い目) tag indicates seller wants quick sale

---

### TCG Republic (Japan)
**Website**: https://tcgrepublic.com

| Attribute | Value |
|-----------|-------|
| **Buyer Fee** | 0% (prices marked up instead) |
| **Free Shipping** | Orders >$50 (SAL) or >$150 (EMS) |
| **Currency** | USD, EUR, GBP |

**Key Features**:
- Japanese retailer selling direct to West
- Curated inventory (no marketplace sellers)
- English site with good search
- Ships globally with free threshold

**Arbitrage Notes**:
- Convenient but premium pricing (~20-30% above Yahoo Auctions)
- Best for specific cards rather than bulk
- No proxy fees, but markup equivalent
- Reliable grading and packaging

---

### CardRush Japan
**Website**: https://cardrush.jp

| Attribute | Value |
|-----------|-------|
| **Format** | Retail + Buylist |
| **Currency** | JPY |
| **International** | Via proxy or Buyee |

**Key Features**:
- Major Japanese card shop chain
- Strong buylist prices
- Tournament supplies
- One Piece TCG specialty

**Arbitrage Notes**:
- Buylist useful for selling cards IN Japan
- Retail prices competitive with Yahoo Auctions
- Physical stores in Tokyo, Osaka, Nagoya

---

## Global/Multi-Regional Platforms

### eBay (Regional Variants)
Different eBay sites offer different pricing:

| Site | Currency | Notes |
|------|----------|-------|
| ebay.com | USD | Largest, most competitive |
| ebay.co.uk | GBP | UK-specific deals |
| ebay.de | EUR | German market |
| ebay.com.au | AUD | Australian market |
| ebay.co.jp | JPY | Japanese domestic |

**Cross-Border Arbitrage**:
```
US → UK: Often profitable (weak GBP periods)
JP → Global: 30-50% margins on exclusive cards
EU → US: Rarely profitable (shipping costs)
AU → Global: Occasional deals on bulk
```

---

## UK Retail Platforms

### Chaos Cards
**Website**: https://www.chaoscards.co.uk

| Attribute | Value |
|-----------|-------|
| **Format** | Retail (no marketplace) |
| **Currency** | GBP |
| **Shipping UK** | Free >£20, else £1.50-3.99 |

**Key Features**:
- Major UK TCG retailer
- Singles, sealed, accessories
- Pre-order system for new releases
- One Piece TCG stocked

**Arbitrage Notes**:
- Retail prices, rarely below market
- Good for sealed product arbitrage
- Pre-orders can be flipped on release
- No individual card price feeds available

---

### Magic Madhouse
**Website**: https://www.magicmadhouse.co.uk

| Attribute | Value |
|-----------|-------|
| **Format** | Retail (no marketplace) |
| **Currency** | GBP |
| **Shipping UK** | Free >£20, else £1.99-3.99 |

**Key Features**:
- Established UK retailer since 1997
- Wide game selection
- Regular sales/clearance
- Tournament scene support

**Arbitrage Notes**:
- Clearance sales offer arbitrage opportunities
- Price matching sometimes available
- Bulk sealed products competitively priced

---

## Asian Regional Platforms

### China (Mainland)

#### Xianyu (闲鱼)
**Website**: https://2.taobao.com

| Attribute | Value |
|-----------|-------|
| **Platform Fee** | 0% (peer-to-peer) |
| **Payment** | Alipay required |
| **Currency** | CNY |

**Notes**:
- Alibaba's secondhand marketplace
- Massive TCG inventory
- Requires Chinese payment methods
- Use agents like Superbuy, CSSBuy

#### Taobao
**Website**: https://taobao.com

| Attribute | Value |
|-----------|-------|
| **Platform Fee** | ~5% (seller) |
| **Currency** | CNY |

**Notes**:
- Mix of retail and individual sellers
- Proxy required for international
- Shipping consolidation available
- Counterfeit risk higher

**China Arbitrage Notes**:
- **HIGH COUNTERFEIT RISK** - verify seller reputation
- Genuine cards 40-60% below Western prices
- Shipping via agent: $10-20 per kg
- Best for bulk lots with verification
- Chinese-exclusive promos available

---

### South Korea

#### Naver Shopping
**Website**: https://shopping.naver.com

| Attribute | Value |
|-----------|-------|
| **Format** | Aggregator |
| **Currency** | KRW |

**Key Korean Platforms**:
- K-TCG (Korean TCG shops)
- TCG Korea (marketplace)
- Naver SmartStore (individual shops)

**Notes**:
- Korean-exclusive promos exist
- Proxy required (KoreanBuddy, KoreaKBuddy)
- Shipping: $15-30 to UK
- Smaller market, fewer deals

---

### Australia

#### Local Platforms
| Platform | Notes |
|----------|-------|
| Swap Itt | AU TCG marketplace |
| Fetch TCG | Australian retailer |
| TCGroup AU | Local community |
| eBay AU | Most liquid |

**Australia Arbitrage Notes**:
- Generally IMPORT from US/JP (better prices)
- Local market has premium pricing
- Shipping from AU expensive ($25+ to UK)
- Occasionally underpriced sealed product

---

## Grading Services

### PSA (Professional Sports Authenticator)
**Website**: https://www.psacard.com

| Service Level | Price | Turnaround |
|---------------|-------|------------|
| Value | $25 | 120+ days |
| Regular | $75 | 65 days |
| Express | $150 | 20 days |
| Super Express | $300 | 10 days |
| Walk Through | $600 | 3 days |

**Grade Impact on Value** (vs raw NM):
| Grade | Multiplier |
|-------|------------|
| PSA 10 | 3-10x |
| PSA 9 | 1.5-3x |
| PSA 8 | 1.0-1.5x |
| PSA 7- | 0.5-1.0x |

---

### CGC (Certified Guaranty Company)
**Website**: https://www.cgccards.com

| Service Level | Price | Turnaround |
|---------------|-------|------------|
| Economy | $15 | 150+ days |
| Standard | $25 | 80 days |
| Express | $65 | 20 days |
| Priority | $150 | 5 days |

**Notes**:
- Generally 60-80% of PSA prices for same grade
- Subgrades included (Centering, Corners, Edges, Surface)
- Growing acceptance in market

---

### BGS (Beckett Grading Services)
**Website**: https://www.beckett.com/grading

| Service Level | Price | Turnaround |
|---------------|-------|------------|
| Economy | $25 | 150+ days |
| Standard | $50 | 50 days |
| Express | $100 | 10 days |
| Premium | $250 | 2 days |

**Notes**:
- BGS 10 "Black Label" = PSA 10++ (premium)
- Standard BGS 9.5 ≈ PSA 10 (market perception)
- Subgrades standard

---

## Fee Comparison Matrix

| Platform | Seller Fee | Buyer Fee | Payment Fee | Effective Total |
|----------|------------|-----------|-------------|-----------------|
| TCGplayer | 10.25% | 0% | +$0.30 | ~11% |
| eBay | 13.25% | 0% | +$0.30 | ~14% |
| Cardmarket | 5% | 0% | Included | 5% |
| CardTrader | 5-7% | 0% | Included | 5-7% |
| Yahoo JP | 10% | 0% | Included | 10% (+proxy) |
| Mercari JP | 10% | 0% | Included | 10% (+proxy) |

---

## API Availability

| Platform | API Status | Data Available |
|----------|------------|----------------|
| TCGplayer | Public API | Prices, products, sales |
| eBay | Public API | Listings, sales, prices |
| Cardmarket | Partner API | Prices, stock, orders |
| CardTrader | REST API | Products, prices, orders |
| Yahoo JP | None | Scraping required |
| Mercari JP | None | Scraping required |

**For Neural Engine**:
- TCGplayer API: Free tier, 1000 requests/day
- eBay Browse API: Free, requires OAuth
- Cardmarket: Partner application required
- CardTrader: API key on request

---

## Arbitrage Implications

### Profitable Routes

```
HIGH MARGIN (20-50%):
┌─────────────────┐     ┌─────────────────┐
│  Yahoo JP       │────▶│  eBay US/UK     │
│  (JP cards)     │     │  (Graded PSA)   │
└─────────────────┘     └─────────────────┘

MEDIUM MARGIN (10-20%):
┌─────────────────┐     ┌─────────────────┐
│  Cardmarket EU  │────▶│  TCGplayer US   │
│  (EU prints)    │     │  (Low supply)   │
└─────────────────┘     └─────────────────┘

LOW MARGIN (5-10%):
┌─────────────────┐     ┌─────────────────┐
│  TCGplayer US   │────▶│  eBay US        │
│  (Bulk lots)    │     │  (Individual)   │
└─────────────────┘     └─────────────────┘
```

### Cost Factors for Neural Engine

```typescript
interface ArbitrageCostFactors {
  // Buy Side
  purchasePrice: number;
  buyerPlatformFee: number;      // Usually 0 except CardTrader
  proxyFee?: number;             // 10-15% for JP markets
  domesticShipping: number;      // Seller → Proxy/You

  // Transfer Costs
  internationalShipping: number; // Proxy/Seller → You
  customsDuty: number;           // Varies by country
  importVAT: number;             // UK: 20%, EU: 19-25%
  handlingFee: number;           // Courier customs processing

  // Grading (Optional)
  gradingFee?: number;           // $15-600 depending on speed
  gradingShipping?: number;      // Both ways
  insuranceCost?: number;        // 1-3% of value

  // Sell Side
  sellerPlatformFee: number;     // 5-14%
  paymentProcessing: number;     // Usually included
  domesticShippingSell: number;  // You → Buyer
  packagingCost: number;         // $0.50-3.00

  // Time Cost
  capitalLockupDays: number;     // Opportunity cost
  gradingWaitDays?: number;      // 20-150 days
}
```

### Break-Even Calculations

**Example: Yahoo JP → eBay UK (Graded)**

```
Purchase (Yahoo JP):
  Card price:           ¥5,000 ($33)
  Yahoo fee:            ¥0 (buyer)
  Proxy fee (10%):      ¥500 ($3.30)
  Domestic JP shipping: ¥500 ($3.30)
  EMS to UK:           ¥2,000 ($13)
  UK Import VAT (20%): £9 ($11)
  ────────────────────────────────
  Total Cost:          $64

Grading (PSA):
  PSA Express:         $150
  Shipping to PSA:     $15
  Shipping from PSA:   $15
  Insurance:           $5
  ────────────────────────────────
  Grading Total:       $185

Selling (eBay UK):
  Target PSA 10 price: $350
  eBay fee (13.25%):   -$46
  Shipping to buyer:   -$5
  ────────────────────────────────
  Net Revenue:         $299

PROFIT: $299 - $64 - $185 = $50 (16% ROI)
RISK: PSA 9 or below = potential loss
```

---

## Data Sources for Neural Engine

### Real-Time Price Feeds
1. **OPTCG API** (current) - TCGplayer US prices
2. **TCGplayer API** - Direct market data
3. **Cardmarket API** - EU market data
4. **eBay Browse API** - Global sold prices

### Historical Data
1. **TCGplayer Price History** - Via API
2. **Cardmarket Price Guide** - Via scraping/API
3. **eBay Sold Listings** - Via API (90 days)

### Missing Data (Requires Scraping)
1. Yahoo Auctions Japan - Auction history
2. Mercari Japan - Sale prices
3. Chinese platforms - All data

---

## Recommendations for Neural Engine

### Priority 1: Integrate These Data Sources
1. TCGplayer API (already have via OPTCG)
2. Cardmarket API (apply for partner access)
3. eBay Browse API (implement OAuth)

### Priority 2: Build Cost Models For
1. UK buyer importing from US (TCGplayer → UK)
2. UK buyer importing from EU (Cardmarket → UK)
3. UK buyer importing from JP (Yahoo → UK via proxy)

### Priority 3: Track These Metrics
1. Platform fee changes (historically increase)
2. Shipping rate changes (seasonal, carrier)
3. Currency exchange rates (GBP/USD/EUR/JPY)
4. VAT/duty thresholds (political changes)

---

*Last Updated: January 2026*
*Data accuracy: Verified against live platforms*
