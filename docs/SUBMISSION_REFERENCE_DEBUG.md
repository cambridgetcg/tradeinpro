# Submission Reference Number - Debug Investigation

> **Central Reference:** See [TRADE_IN_SYSTEM_SYNAPSE.md](./TRADE_IN_SYSTEM_SYNAPSE.md) for the complete system architecture, weak links, and unhandled scenarios across both frontend and backend.
>
> **Myelin Pathways:**
> - `app/routes/ROUTES_SYNAPSE.md` → api.storefront.$.tsx (splat route), api.packing-slip.$number.tsx
> - `app/lib/CODE_SYNAPSE.md` → submissions.server.ts (formatSubmissionForResponse)
> - Related bug: `trade-in-success-page-bug-analysis.md` → Visual evidence

## Issue
After submission, the reference number shows "undefined" when the success page is displayed, and links like `/packing-slip/undefined` are being called.

## Routes Investigation

### Packing Slip Route
**File:** `app/routes/api.packing-slip.$number.tsx`
**URL Pattern:** `GET /apps/trade-in/packing-slip/:number`

- Validates App Proxy signature (not required for public access)
- Looks up submission by `submissionNumber` (not ID)
- Returns HTML packing slip or 404 error page

### Shipping Instructions Route
**File:** `app/routes/api.shipping-instructions.$number.tsx`
**URL Pattern:** `GET /apps/trade-in/shipping-instructions/:number`

- Validates App Proxy signature (not required for public access)
- Looks up submission by `submissionNumber`
- Returns HTML shipping instructions or 404 error page

### Storefront API Handler (Splat Route)
**File:** `app/routes/api.storefront.$.tsx`

Routes are matched via `matchRoute()` function:
- `/packing-slip/:number` → `packingSlipLoader` with `params.number`
- `/shipping-instructions/:number` → `shippingInstructionsLoader` with `params.number`

## Data Flow Analysis

### Expected Flow
```
1. Client calls POST /submissions with cart data
2. Server creates submission with submissionNumber (TRD-YYYYMM-XXXXX)
3. Server returns: { success: true, submission: { submissionNumber: "TRD-...", ... } }
4. Client extracts submissionNumber from response
5. Client sets links with submissionNumber
6. Success page displays with correct reference
```

### Potential Failure Points

1. **Server Response Missing submissionNumber**
   - `formatSubmissionForResponse()` not including `submissionNumber`
   - `submitSubmission()` not returning `submissionNumber`
   - Prisma select/include missing the field

2. **Idempotency/Duplicate Path Issue**
   - Cached response might be malformed
   - Duplicate detection returning `submissionId` instead of `submissionNumber`
   - Content hash duplicate without cached response returning incomplete data

3. **Client-Side Parsing Issue**
   - Response JSON not parsed correctly
   - Nested object access failing silently
   - `result.submission` is undefined or null

## Added Debug Logging

### Server-Side (api.submissions.tsx)
```javascript
console.log('[api.submissions] Response submission:', JSON.stringify({
  id: formattedSubmission.id,
  submissionNumber: formattedSubmission.submissionNumber,
  status: formattedSubmission.status,
}));
```

### Client-Side (trade-in.js)
```javascript
// In createSubmission():
console.log("[trade-in] API response status:", response.status);
console.log("[trade-in] API response body:", JSON.stringify(result, null, 2));

// In handleSubmit():
console.log("[trade-in] Full response:", JSON.stringify(result, null, 2));
console.log("[trade-in] result.submission:", result.submission);
console.log("[trade-in] result.submission?.submissionNumber:", result.submission?.submissionNumber);
console.log("[trade-in] Using submissionNumber:", submissionNumber);
```

## Verification Steps

1. **Check Vercel Logs** for server-side `[api.submissions]` output
2. **Check Browser Console** for client-side `[trade-in]` output
3. **Compare expected vs actual response structure**

## Expected Response Format

### New Submission
```json
{
  "success": true,
  "submission": {
    "id": "clxxx...",
    "submissionNumber": "TRD-202601-00001",
    "status": "SUBMITTED",
    "payoutType": "STORE_CREDIT",
    "quotedTotal": 5000,
    "bonusAmount": 500,
    "items": [...],
    "createdAt": "2026-01-01T12:00:00.000Z"
  }
}
```

### Duplicate (with cached response)
Same as above, returned from cache with `X-Idempotent-Replay: true` header

### Duplicate (content hash match, no cache)
```json
{
  "success": true,
  "duplicate": true,
  "message": "Submission already exists",
  "submission": {
    "id": "clxxx...",
    "submissionNumber": "TRD-202601-00001",
    ...
  }
}
```

## Fixes Applied

1. **api.submissions.tsx**: Now fetches full submission for duplicates instead of just returning `submissionId`
2. **trade-in.js**: Added optional chaining `result.submission?.submissionNumber` and error handling
3. **Database**: Ran `prisma db push` to ensure `response_body` column is TEXT type

## Next Steps

1. Deploy changes and test
2. Check logs for the actual response structure
3. If `submissionNumber` is still missing, trace back to `submitSubmission()` return value
