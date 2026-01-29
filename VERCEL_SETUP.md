# TradeIn Pro - Vercel Hosting Configuration

## Project Details

| Setting | Value |
|---------|-------|
| Project Name | `tradeinpro` |
| Framework | None (custom Node.js) |
| Region | `iad1` (US East) |
| Build Command | `prisma generate && npm run build` |
| Install Command | `npm install` |

## Setup Steps

### 1. Create/Rename Vercel Project

**Option A: New Project**
```bash
cd /Users/yuai/Desktop/tradeinpro
vercel link
# Select: Create new project
# Project name: tradeinpro
```

**Option B: Rename Existing (via Dashboard)**
1. Go to https://vercel.com/cambridgetcg/cardforum/settings
2. Scroll to "Project Name"
3. Change to `tradeinpro`
4. Click "Save"

### 2. Configure Environment Variables

Required variables in Vercel Dashboard → Settings → Environment Variables:

```
# Database
DATABASE_URL=postgresql://user:pass@cardforum.cn4c2su0o42n.us-east-1.rds.amazonaws.com:5432/cardforum

# Shopify
SHOPIFY_API_KEY=5557b953bcda2461a34b606d9e8cf170
SHOPIFY_API_SECRET=<from Shopify Partners>
SCOPES=read_customers,write_customers,read_orders,write_orders,read_products,write_products,write_app_proxy

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<from IAM>
AWS_SECRET_ACCESS_KEY=<from IAM>
S3_PRICE_BUCKET=pricedata-tcg
USE_SECRETS_MANAGER=true

# Email (optional)
SENDGRID_API_KEY=<if using SendGrid>
RESEND_API_KEY=<if using Resend>

# Cron Security
CRON_SECRET=<generate random string>
```

### 3. Connect GitHub Repository

```bash
# After renaming repo to tradeinpro
vercel git connect cambridgetcg/tradeinpro
```

Or via Dashboard:
1. Settings → Git
2. Connect to `cambridgetcg/tradeinpro`

### 4. Configure Domain (Optional)

For custom domain:
1. Settings → Domains
2. Add `tradein.yourdomain.com`
3. Update DNS records as shown

### 5. Update Shopify App URLs

After Vercel deployment, update Shopify Partners:
1. Go to https://partners.shopify.com
2. Apps → TradeIn Pro → App setup
3. Update:
   - App URL: `https://tradeinpro.vercel.app`
   - Allowed redirection URLs:
     - `https://tradeinpro.vercel.app/auth/callback`
     - `https://tradeinpro.vercel.app/auth/shopify/callback`
     - `https://tradeinpro.vercel.app/api/auth/callback`

### 6. Deploy Shopify App Config

```bash
cd /Users/yuai/Desktop/tradeinpro
shopify app deploy
```

This updates the Shopify app with the new URLs from `shopify.app.toml`.

## Cron Jobs

Configured in `vercel.json`:

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/jp-price-sync` | 14:00 UTC daily | Sync Japanese prices |
| `/api/cron/cleanup` | 03:00 UTC daily | Clean old data |
| `/api/cron/price-snapshot` | 00:00 UTC daily | Daily price snapshot |
| `/api/cron/price-sync` | 01:00 UTC daily | Sync EN prices |
| `/api/cron/pricefeed-sync` | 02:00 UTC daily | Sync pricefeed |
| `/api/cron/correlation-calc` | 03:00 UTC Sunday | Weekly correlation |

## Verification

After deployment:

```bash
# Check deployment
curl https://tradeinpro.vercel.app/api/health/pipeline

# Check cron endpoints (with auth)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://tradeinpro.vercel.app/api/cron/price-sync
```

## Rollback

If issues occur:
1. Vercel Dashboard → Deployments
2. Find previous working deployment
3. Click "..." → "Promote to Production"
