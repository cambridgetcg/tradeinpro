# Japanese Price Sync Fix Plan

**Date:** 2026-01-07
**Issue:** Cron jobs stopped executing on 2025-12-30
**Status:** ✅ FIXED - Protection Bypass for Automation implemented

---

## Root Cause Analysis

### Primary Issue: Vercel Deployment Protection Blocking Cron Requests

When accessing the cron endpoint externally, we receive a **Vercel SSO authentication page** (not a 401 from our code):

```
curl https://cardforum-cambridgetcgs-projects.vercel.app/api/cron/jp-price-sync
→ Returns: Vercel Authentication page (not our 401 response)
```

This indicates **Deployment Protection** is set to "All Deployments" rather than "Only Preview Deployments", which blocks even production cron invocations.

### Contributing Factor: CRON_SECRET Modified 8 Days Ago

```bash
vercel env ls | grep CRON
→ CRON_SECRET  Encrypted  Development, Preview, Production  8d ago
```

The timing coincides exactly with when the sync stopped (Dec 30). Possible issues:
- Secret contains invalid characters (newlines, special chars)
- Secret was regenerated but deployment didn't pick it up
- Secret mismatch between env var and what Vercel sends

### Current Auth Flow (Broken)

```
Vercel Scheduler
       │
       ▼
┌──────────────────┐
│ Vercel Cron      │ Sends: Authorization: Bearer ${CRON_SECRET}
│ Infrastructure   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Deployment       │ ← BLOCKED HERE
│ Protection (SSO) │   Returns SSO page, not 200/401
└──────────────────┘
         ✕
         ✕ (never reaches)
         ▼
┌──────────────────┐
│ api.cron.        │ Our auth check:
│ jp-price-sync    │ if (authHeader !== `Bearer ${CRON_SECRET}`)
└──────────────────┘
```

---

## Solution: Fix Deployment Protection Settings

### Step 1: Update Vercel Dashboard Settings

**Navigate to:** Project Settings → Security → Deployment Protection

**Current State (Suspected):**
```
☐ Standard Protection (recommended)
☐ Only Preview Deployments
☑ All Deployments          ← This is blocking crons
```

**Target State:**
```
☑ Standard Protection (recommended)  ← Or this
☑ Only Preview Deployments           ← Or this
☐ All Deployments
```

**Why "Only Preview Deployments" is recommended:**
- Production deployments are public (as intended)
- Preview/development deployments are protected
- Vercel's built-in crons work on production without interference
- External API consumers can reach production endpoints

### Step 2: Verify CRON_SECRET (If Needed)

1. **Check current value:**
   ```bash
   vercel env pull .env.local
   cat .env.local | grep CRON_SECRET
   ```

2. **Validate no special characters:**
   - No newlines
   - No quotes in the value itself
   - Alphanumeric + basic punctuation only

3. **Regenerate if suspicious:**
   ```bash
   # Generate new secret
   openssl rand -hex 32

   # Update in Vercel
   vercel env rm CRON_SECRET production
   vercel env add CRON_SECRET production
   # Paste the new value
   ```

### Step 3: Trigger Redeploy

After settings change, redeploy to ensure new configuration takes effect:

```bash
# Option A: Push empty commit
git commit --allow-empty -m "chore: trigger redeploy for cron fix"
git push

# Option B: Force redeploy via CLI
vercel --prod
```

### Step 4: Monitor and Verify

1. **Check immediate status:**
   ```bash
   # Manually trigger the cron endpoint (from Vercel's perspective)
   # This requires being logged in to Vercel or using bypass token
   ```

2. **Wait for next scheduled run:**
   - jp-price-sync: 14:00 UTC daily
   - Check logs in Vercel dashboard after that time

3. **Verify database updated:**
   ```bash
   npx tsx -e "
   const { PrismaClient } = require('@prisma/client');
   const p = new PrismaClient();
   p.japanesePriceSource.findFirst({orderBy:{updatedAt:'desc'}})
     .then(r => console.log('Last update:', r?.updatedAt));
   "
   ```

---

## Alternative Solution: Automation Bypass (If "All Deployments" Required)

If business requirements mandate "All Deployments" protection, configure bypass:

### Step 1: Generate Bypass Secret

1. Go to Project Settings → Security → Deployment Protection
2. Click "Protection Bypass for Automation"
3. Create new secret, note for "Cron Jobs"
4. Copy the generated secret

### Step 2: Update Cron Endpoints

Modify `app/routes/api.cron.jp-price-sync.tsx`:

```typescript
export async function loader({ request }: LoaderFunctionArgs) {
  // Check Vercel's automation bypass header
  const bypassHeader = request.headers.get("x-vercel-protection-bypass");
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  // Also check traditional CRON_SECRET for backwards compatibility
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  const isValidBypass = bypassSecret && bypassHeader === bypassSecret;
  const isValidCronSecret = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isValidBypass && !isValidCronSecret) {
    console.warn("Cron: Invalid or missing authorization");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // ... rest of function
}
```

### Step 3: Redeploy

The `VERCEL_AUTOMATION_BYPASS_SECRET` is automatically added as an env var when you create the bypass secret. Redeploy to pick it up.

---

## Code Improvement: Add Staleness Alert

To prevent future silent failures, add monitoring to the dashboard:

### Add to Dashboard Route (`app/routes/app._index.tsx`)

```typescript
// In loader function
const lastJpSync = await prisma.japanesePriceSource.findFirst({
  orderBy: { updatedAt: 'desc' },
  select: { updatedAt: true }
});

const jpSyncStaleHours = lastJpSync
  ? (Date.now() - lastJpSync.updatedAt.getTime()) / (1000 * 60 * 60)
  : null;

return {
  // ... existing data
  jpSyncStaleHours,
  jpSyncIsStale: jpSyncStaleHours !== null && jpSyncStaleHours > 26, // 26h = 1 day + buffer
};

// In component
{jpSyncIsStale && (
  <Banner tone="warning" title="Japanese Prices Stale">
    JP prices haven't updated in {Math.round(jpSyncStaleHours)} hours.
    Check Vercel cron logs.
  </Banner>
)}
```

---

## Verification Checklist

- [x] Protection Bypass for Automation enabled in Vercel Dashboard
- [x] `VERCEL_AUTOMATION_BYPASS_SECRET` added to environment variables
- [x] CRON_SECRET verified (no special characters)
- [x] Redeployment triggered (`vercel --prod`)
- [x] Bypass header tested successfully (`x-vercel-protection-bypass`)
- [x] Manual cron trigger successful (price-snapshot: 200 OK)
- [x] Staleness monitoring added to dashboard
- [ ] Automatic cron execution verified (wait for 14:00 UTC)

---

## Timeline

| Task | Duration | Notes |
|------|----------|-------|
| Update Vercel settings | 2 min | Dashboard change |
| Verify CRON_SECRET | 5 min | If needed |
| Trigger redeploy | 2 min | Push or CLI |
| Wait for cron | Up to 24h | Next scheduled run at 14:00 UTC |
| Add staleness alert | 30 min | Optional but recommended |

---

## References

- [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)
- [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
- [Troubleshooting Vercel Cron Jobs](https://vercel.com/kb/guide/troubleshooting-vercel-cron-jobs)
- [GitHub Issue #11303 - CRON_SECRET not sent](https://github.com/vercel/vercel/issues/11303)
