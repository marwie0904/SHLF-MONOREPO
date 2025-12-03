# Migration 007: Webhook Signature Validation

**Created:** 2025-10-03
**Status:** Ready for execution
**Risk Level:** MEDIUM (security enhancement)

---

## Problem Statement

**Current Issue:**
- No validation that webhooks actually came from Clio
- Anyone with the webhook URL can POST malicious data
- Potential for unauthorized task creation/deletion
- No protection against replay attacks

**Attack Scenarios:**

### Scenario 1: Malicious Webhook
```bash
# Attacker discovers webhook URL
curl -X POST https://our-app.com/webhooks/matters \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "id": 123,
      "matter_stage": { "id": 707058, "name": "Initial Consultation" },
      "matter_stage_updated_at": "2025-10-03T10:00:00Z"
    }
  }'

# Our server processes it as legitimate → creates 10 tasks! ❌
```

### Scenario 2: Replay Attack
```bash
# Attacker captures legitimate webhook
# Replays it multiple times
# Idempotency key prevents duplicates, but still wastes resources
```

### Scenario 3: Data Manipulation
```bash
# Attacker sends webhook with malicious data
# Could trigger errors, log spam, or data corruption
```

---

## Solution

Implement Clio webhook signature validation using HMAC-SHA256.

### How Clio Webhook Signatures Work

1. **Clio generates signature:**
   ```javascript
   const signature = crypto
     .createHmac('sha256', WEBHOOK_SECRET)
     .update(JSON.stringify(webhookPayload))
     .digest('hex');
   ```

2. **Clio sends signature in header:**
   ```
   X-Clio-Signature: abc123...
   ```

3. **We verify signature:**
   ```javascript
   const expectedSignature = crypto
     .createHmac('sha256', WEBHOOK_SECRET)
     .update(rawBody)
     .digest('hex');

   if (signature !== expectedSignature) {
     return 401 Unauthorized;
   }
   ```

---

## Implementation

### 1. Create Signature Validation Middleware

**File:** `src/middleware/validate-signature.js`

```javascript
import crypto from 'crypto';
import { config } from '../config/index.js';

/**
 * Validate Clio webhook signature
 *
 * Clio signs webhooks using HMAC-SHA256 with the webhook secret.
 * Signature is sent in X-Clio-Signature header.
 */
export const validateClioSignature = (req, res, next) => {
  // Skip signature validation during webhook activation
  // (activation requests have X-Hook-Secret, not X-Clio-Signature)
  if (req.headers['x-hook-secret']) {
    return next();
  }

  // Get signature from header
  const signature = req.headers['x-clio-signature'];

  if (!signature) {
    console.error('🔐 Missing X-Clio-Signature header');
    return res.status(401).json({
      success: false,
      error: 'Missing webhook signature',
    });
  }

  // Validate webhook secret is configured
  if (!config.clio.webhookSecret) {
    console.error('🔐 CLIO_WEBHOOK_SECRET not configured');
    return res.status(500).json({
      success: false,
      error: 'Webhook secret not configured',
    });
  }

  // Calculate expected signature
  // IMPORTANT: Must use raw body string, not parsed JSON
  const payload = req.rawBody || JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac('sha256', config.clio.webhookSecret)
    .update(payload)
    .digest('hex');

  // Compare signatures (constant-time comparison to prevent timing attacks)
  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );

  if (!isValid) {
    console.error('🔐 Invalid webhook signature');
    console.error(`   Expected: ${expectedSignature}`);
    console.error(`   Received: ${signature}`);

    return res.status(401).json({
      success: false,
      error: 'Invalid webhook signature',
    });
  }

  console.log('✅ Webhook signature validated');
  next();
};
```

### 2. Preserve Raw Body for Signature Validation

**File:** `src/middleware/raw-body.js`

```javascript
/**
 * Preserve raw body for signature validation
 *
 * IMPORTANT: Must run BEFORE express.json() middleware
 * because signature validation requires the raw body string,
 * not the parsed JSON object.
 */
export const preserveRawBody = (req, res, next) => {
  let data = '';

  req.on('data', chunk => {
    data += chunk;
  });

  req.on('end', () => {
    req.rawBody = data;
    next();
  });
};
```

### 3. Update Express App Configuration

**File:** `src/index.js`

**Before:**
```javascript
app.use(express.json());
app.use('/webhooks', webhookRoutes);
```

**After:**
```javascript
// Preserve raw body for signature validation
app.use('/webhooks', preserveRawBody);

// Parse JSON (after raw body preserved)
app.use(express.json());

// Apply signature validation to all webhook routes
app.use('/webhooks', validateClioSignature);

// Webhook routes
app.use('/webhooks', webhookRoutes);
```

### 4. Update .env.example

```bash
# Clio API Configuration
CLIO_API_BASE_URL=https://app.clio.com
CLIO_ACCESS_TOKEN=your_access_token_here
CLIO_WEBHOOK_SECRET=your_webhook_secret_here  # ← REQUIRED for security
```

---

## Environment Variable Configuration

### How to Get Webhook Secret

1. Go to Clio → Settings → Integrations → Webhooks
2. Create or edit webhook
3. Copy the "Webhook Secret" value
4. Add to `.env`:
   ```
   CLIO_WEBHOOK_SECRET=abc123def456...
   ```

### Required Environment Variables

Update config validation to require webhook secret:

**File:** `src/config/index.js`

```javascript
const required = [
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'CLIO_ACCESS_TOKEN',
  'CLIO_WEBHOOK_SECRET', // ← Add this
];
```

---

## Security Considerations

### 1. Timing Attack Prevention

Use `crypto.timingSafeEqual()` for signature comparison:

```javascript
// ❌ BAD: Vulnerable to timing attacks
if (signature === expectedSignature) { ... }

// ✅ GOOD: Constant-time comparison
if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) { ... }
```

### 2. Raw Body Preservation

**Critical:** Signature must be calculated on the **exact raw body string**, not re-serialized JSON:

```javascript
// ❌ BAD: Re-serializing may change order/spacing
const payload = JSON.stringify(req.body);

// ✅ GOOD: Use original raw body
const payload = req.rawBody;
```

### 3. Webhook Secret Storage

- ✅ Store in environment variable (not in code)
- ✅ Use different secrets for dev/staging/production
- ✅ Rotate secrets periodically
- ❌ Never commit secret to git

---

## Testing

### Test 1: Valid Signature

```javascript
// Generate valid signature
const payload = JSON.stringify(webhookData);
const signature = crypto
  .createHmac('sha256', process.env.CLIO_WEBHOOK_SECRET)
  .update(payload)
  .digest('hex');

// Send webhook with signature
const response = await fetch('http://localhost:3000/webhooks/matters', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Clio-Signature': signature,
  },
  body: payload,
});

// Expected: 200 OK, webhook processed
```

### Test 2: Invalid Signature

```javascript
const response = await fetch('http://localhost:3000/webhooks/matters', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Clio-Signature': 'invalid_signature',
  },
  body: JSON.stringify(webhookData),
});

// Expected: 401 Unauthorized
```

### Test 3: Missing Signature

```javascript
const response = await fetch('http://localhost:3000/webhooks/matters', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // No X-Clio-Signature header
  },
  body: JSON.stringify(webhookData),
});

// Expected: 401 Unauthorized
```

### Test 4: Webhook Activation (Should Skip Validation)

```javascript
const response = await fetch('http://localhost:3000/webhooks/matters', {
  method: 'POST',
  headers: {
    'X-Hook-Secret': 'activation_secret_123',
  },
  body: '{}',
});

// Expected: 200 OK with X-Hook-Secret echoed back
```

---

## Error Handling

### Missing Signature
```json
{
  "success": false,
  "error": "Missing webhook signature"
}
```
**HTTP Status:** 401 Unauthorized

### Invalid Signature
```json
{
  "success": false,
  "error": "Invalid webhook signature"
}
```
**HTTP Status:** 401 Unauthorized

### Missing Webhook Secret Configuration
```json
{
  "success": false,
  "error": "Webhook secret not configured"
}
```
**HTTP Status:** 500 Internal Server Error

---

## Monitoring

### Log Signature Validation Failures

```javascript
if (!isValid) {
  await SupabaseService.logError(
    ERROR_CODES.WEBHOOK_INVALID_SIGNATURE,
    'Invalid webhook signature',
    {
      signature_received: signature,
      signature_expected: expectedSignature,
      headers: req.headers,
      source_ip: req.ip,
    }
  );
}
```

### Query Signature Failures

```sql
SELECT
  error_code,
  error_message,
  context->>'source_ip' as source_ip,
  created_at
FROM error_logs
WHERE error_code = 'ERR_WEBHOOK_INVALID_SIGNATURE'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

---

## Rollout Plan

### Phase 1: Soft Launch (Log Only)
- Implement signature validation
- Log validation results (pass/fail)
- Don't block invalid signatures yet
- Monitor for 1 week

### Phase 2: Hard Enforcement
- Block requests with invalid signatures
- Return 401 Unauthorized
- Alert on signature failures

---

## Impact Analysis

**Benefits:**
- ✅ Prevents unauthorized webhook processing
- ✅ Protects against malicious data injection
- ✅ Reduces risk of replay attacks
- ✅ Industry-standard security practice

**Risks:**
- ⚠️ If webhook secret misconfigured, all webhooks will fail
- ⚠️ If raw body not preserved correctly, signatures won't match
- ⚠️ Clock skew could theoretically cause issues (not applicable to HMAC)

**Mitigation:**
- Test thoroughly in development
- Verify webhook secret is correctly configured
- Monitor error logs for signature validation failures
- Have rollback plan ready

---

**Ready for execution:** YES
**Requires environment changes:** YES (CLIO_WEBHOOK_SECRET)
**Estimated time:** 2 hours
**Risk level:** MEDIUM
