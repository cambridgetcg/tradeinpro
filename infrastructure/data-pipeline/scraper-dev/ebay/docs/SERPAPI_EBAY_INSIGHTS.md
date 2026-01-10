# SerpAPI eBay Search Insights & Optimization Guide

**Last Updated:** 2026-01-09
**Based on:** Testing during 1-year collection pipeline development

## Key Findings

### 1. Supported vs Unsupported Parameters

SerpAPI's eBay engine does NOT support all native eBay URL parameters. Here's what works:

| Parameter | Description | Status | Example |
|-----------|-------------|--------|---------|
| `engine` | API engine | ✅ Required | `ebay` |
| `_nkw` | Search keywords | ✅ Supported | `one piece tcg` |
| `show_only` | Filter type | ✅ Supported | `Sold` |
| `_ipg` | Items per page | ✅ Supported | `60`, `200` |
| `_pgn` | Page number | ✅ Supported | `1`, `2`, etc. |
| `_sacat` | Category ID | ✅ Supported | `183454` |
| `_udlo` | Min price | ✅ Supported | `10` |
| `_udhi` | Max price | ✅ Supported | `500` |
| `ebay_domain` | eBay site | ✅ Supported | `ebay.com` |
| `_sop` | Sort order | ❌ NOT SUPPORTED | Returns 400 error |
| `LH_Sold` | eBay native sold | ❌ NOT SUPPORTED | Use `show_only: Sold` instead |
| `LH_Complete` | eBay native complete | ❌ NOT SUPPORTED | Use `show_only: Sold` instead |
| `LH_Time` | Date range | ❌ NOT SUPPORTED | Use pagination for historical |

### 2. Sold Listings Filter

**Correct way:**
```javascript
{
  engine: 'ebay',
  _nkw: 'one piece tcg',
  show_only: 'Sold',  // SerpAPI format
  api_key: 'your_key'
}
```

**Incorrect way (returns 400 error):**
```javascript
{
  engine: 'ebay',
  _nkw: 'one piece tcg',
  LH_Sold: '1',       // eBay native - NOT supported
  LH_Complete: '1',   // eBay native - NOT supported
}
```

### 3. Results Per Page (`_ipg`)

- Maximum effective: **240 results** per search
- Valid values: `25`, `50`, `60`, `100`, `200` (or more)
- Setting `_ipg=200` returns up to 240 items (actual max)
- For cost efficiency, use `_ipg=200` to maximize results per API call

```javascript
// Cost efficient
{ _ipg: '200' }  // Returns ~240 results per search

// Less efficient (but okay for precision)
{ _ipg: '60' }   // Returns ~60 results per search
```

### 4. Pagination Behavior

- Use `_pgn` for page numbers (1-indexed)
- eBay sold listings typically go back ~90 days
- Deep pagination works but may have diminishing returns
- Total results count may fluctuate between pages (eBay behavior)

### 5. Category Filtering

**Useful categories for TCG:**
| Category ID | Description |
|-------------|-------------|
| `183454` | CCG Individual Cards (recommended for TCG singles) |
| `183456` | CCG Sealed Products |
| `183457` | CCG Complete Sets |

### 6. Query Optimization Tips

**Do:**
- Use quoted phrases for exact card IDs: `"OP01-120"`
- Exclude unwanted terms: `-lot -bundle -graded`
- Keep queries specific but not too narrow
- Test queries before bulk running

**Don't:**
- Include "sold" in the query text (redundant with `show_only: Sold`)
- Use too many exclusion terms (may eliminate valid listings)
- Combine too many OR conditions (can cause empty results)

### 7. Error Handling

**Common Errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| `400 Bad Request` | Unsupported parameter | Remove `_sop`, `LH_*` params |
| `eBay hasn't returned any results` | Query too specific | Broaden search terms |
| `Invalid API key` | Key issue | Check API key validity |
| Rate limit errors | Too many requests | Increase delay between calls |

### 8. Data Quality Insights

From our 50-search test:
- **Average listings per search:** ~30-60 for specific queries
- **Variant distribution varies:**
  - Parallel cards: Most common (~44%)
  - SEC cards: Good volume (~21%)
  - Manga art: Lower volume but high value (~12%)
  - SP/TR: More niche, some queries return empty

### 9. Optimal Query Structure

**High-yield pattern:**
```
"{SET_CODE}" one piece {variant} {language} -{exclusions}
```

Examples:
```
"OP01" one piece parallel english -graded -lot -bundle
"OP05" one piece SEC secret rare -graded -lot
one piece tcg manga art english -PSA -CGC -graded -lot
```

**Low-yield patterns (avoid):**
- Too specific: `"EB02" SP "OP06-042"` - often returns 0
- Multiple exact matches: `"OP01-016" Nami SP special parallel`

### 10. Cost Optimization Strategy

**Budget allocation by priority:**

| Priority | Type | Why |
|----------|------|-----|
| 1 | Broad variant queries | High volume, good coverage |
| 2 | Set-specific queries | Good for training data diversity |
| 3 | High-value card specific | Important for price data |
| 4 | Graded/condition | Ground truth labels |

**Search efficiency:**
- Use `_ipg=200` for maximum results per search
- Paginate until results < 50% of page size
- Skip to next query when hitting diminishing returns

## API Rate Limits

- Free tier: 100 searches/month
- Paid plans vary (check SerpAPI pricing)
- Recommended delay between calls: 2000ms
- Burst limit: Unknown, but 5-10 concurrent seems safe

## Example Implementation

```typescript
const params = new URLSearchParams({
  engine: 'ebay',
  _nkw: '"OP01" one piece parallel english -graded -lot',
  show_only: 'Sold',
  _ipg: '200',
  _pgn: '1',
  _sacat: '183454',
  api_key: process.env.SERPAPI_API_KEY,
});

const response = await fetch(`https://serpapi.com/search?${params}`);
const data = await response.json();

// Results in data.organic_results[]
// Metadata in data.search_information
```

## References

- [SerpAPI eBay Search API](https://serpapi.com/ebay-search-api)
- [eBay Category IDs](https://pages.ebay.com/sellerinformation/news/categorychanges.html)
