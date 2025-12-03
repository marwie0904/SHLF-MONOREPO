# Migration 005: Early Idempotency Reservation

**Created:** 2025-10-03
**Status:** Ready for execution
**Risk Level:** MEDIUM (changes processing flow)

---

## Problem Statement

**Current Issue:**
- Webhook creates tasks in Clio successfully
- Database failure occurs when recording webhook completion
- Clio retries webhook (didn't see success response)
- Idempotency check fails (webhook not recorded)
- Tasks created again in Clio → DUPLICATES

**Example Scenario:**
```javascript
// Attempt 1:
1. Check idempotency → not processed ✅
2. Create 10 tasks in Clio ✅
3. Insert tasks into Supabase ✅
4. recordWebhookProcessed() fails ❌ (network issue)
5. Webhook returns error to Clio
6. Clio retries webhook after 1 minute

// Attempt 2 (retry):
1. Check idempotency → not found (step 4 failed in attempt 1)
2. Create 10 tasks in Clio again → DUPLICATES! ❌
3. Try to insert into Supabase → unique constraint violation
4. Some tasks succeed, some fail → partial failure
```

**Why Current Protection Is Insufficient:**
- Task table has unique constraint: `UNIQUE (matter_id, stage_id, task_number)`
- This prevents duplicate inserts into Supabase ✅
- But Clio still gets duplicate tasks created ❌
- Wastes Clio API calls
- Creates data inconsistency (tasks in Clio but not in Supabase)

---

## Solution

**Reserve the webhook immediately after the initial idempotency check:**

```javascript
// Step 0: Idempotency check
const existing = await checkWebhookProcessed(idempotencyKey);
if (existing) return existing;

// Step 0.5: Reserve this webhook immediately (mark as "processing")
await recordWebhookProcessed({
  idempotency_key: idempotencyKey,
  // ... basic fields ...
  success: null, // NULL = processing
  action: 'processing',
});

try {
  // ... do all the work ...

  // Step 8: Update webhook to success
  await updateWebhookProcessed(idempotencyKey, {
    success: true,
    action: 'created_tasks',
    tasks_created: result.tasksCreated,
    processing_duration_ms: Date.now() - startTime,
  });
} catch (error) {
  // Update webhook to failure
  await updateWebhookProcessed(idempotencyKey, {
    success: false,
    action: 'error',
    processing_duration_ms: Date.now() - startTime,
  });
  throw error;
}
```

---

## Database Schema Changes

**Current schema:**
```sql
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,
  success BOOLEAN NOT NULL, -- ❌ Cannot be NULL
  action TEXT NOT NULL,
  -- ...
);
```

**Updated schema:**
```sql
ALTER TABLE webhook_events
ALTER COLUMN success DROP NOT NULL; -- Allow NULL for "processing" state

ALTER TABLE webhook_events
ALTER COLUMN action DROP NOT NULL; -- Allow NULL initially

COMMENT ON COLUMN webhook_events.success IS
  'TRUE = completed successfully, FALSE = failed, NULL = processing';
```

---

## Code Changes

### 1. Add `updateWebhookProcessed` Method

**File:** `src/services/supabase.js`

```javascript
/**
 * Update an existing webhook event record
 */
static async updateWebhookProcessed(idempotencyKey, updates) {
  const { error } = await supabase
    .from('webhook_events')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('idempotency_key', idempotencyKey);

  if (error) {
    console.error('[SUPABASE] Failed to update webhook event:', error);
    throw error;
  }
}
```

### 2. Update matter-stage-change.js

**Before:**
```javascript
static async process(webhookData) {
  // ... idempotency check ...

  try {
    // ... do work ...

    // Record at the END
    await SupabaseService.recordWebhookProcessed({
      success: true,
      action: 'created_tasks',
    });
  } catch (error) {
    // No recording on failure
    throw error;
  }
}
```

**After:**
```javascript
static async process(webhookData) {
  // ... idempotency check ...

  // Reserve immediately
  await SupabaseService.recordWebhookProcessed({
    idempotency_key: idempotencyKey,
    webhook_id: webhookData.id,
    event_type: 'matter.updated',
    resource_type: 'matter',
    resource_id: matterId,
    success: null,
    action: 'processing',
    webhook_payload: webhookData,
  });

  try {
    // ... do work ...

    // Update to success
    await SupabaseService.updateWebhookProcessed(idempotencyKey, {
      success: result.tasksFailed === 0,
      action: result.tasksFailed > 0 ? 'partial_failure' : 'created_tasks',
      tasks_created: result.tasksCreated,
      processing_duration_ms: Date.now() - startTime,
      failure_details: result.tasksFailed > 0 ? result.failures : undefined,
    });
  } catch (error) {
    // Update to failure
    await SupabaseService.updateWebhookProcessed(idempotencyKey, {
      success: false,
      action: 'error',
      processing_duration_ms: Date.now() - startTime,
    });
    throw error;
  }
}
```

### 3. Update task-completion.js

Same pattern as matter-stage-change.js

### 4. Update meeting-scheduled.js

Same pattern as matter-stage-change.js

---

## Handling Race Conditions

**Scenario:** Two webhooks arrive within milliseconds

```javascript
// Webhook A:
1. Check idempotency → not found ✅
2. Reserve webhook → INSERT success ✅
3. Start processing...

// Webhook B (1ms later):
1. Check idempotency → finds "processing" record ✅
2. Return cached result (success: null, action: 'processing')
3. Clio sees "still processing" → waits and retries later
```

**Updated idempotency check:**
```javascript
const existing = await checkWebhookProcessed(idempotencyKey);

if (existing) {
  // Check if webhook is still processing
  if (existing.success === null) {
    console.log(`[MATTER] ${matterId} Still processing (concurrent request)`);
    return {
      success: null,
      action: 'still_processing',
      processing_started_at: existing.created_at,
    };
  }

  // Normal cached result
  return {
    success: existing.success,
    action: existing.action,
    cached: true,
  };
}
```

---

## Edge Cases

### Case 1: Webhook reservation succeeds, but processing crashes

**Problem:**
- Webhook reserved with `success: null`
- Server crashes before updating to success/failure
- Webhook stuck in "processing" state forever

**Solution:** Add processing timeout check

```javascript
const existing = await checkWebhookProcessed(idempotencyKey);

if (existing && existing.success === null) {
  const processingAge = Date.now() - new Date(existing.created_at).getTime();
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  if (processingAge > TIMEOUT_MS) {
    console.log(`[WEBHOOK] Processing timeout, retrying: ${idempotencyKey}`);
    // Allow retry by updating to failure
    await SupabaseService.updateWebhookProcessed(idempotencyKey, {
      success: false,
      action: 'processing_timeout',
    });
    // Continue with processing
  } else {
    return { success: null, action: 'still_processing' };
  }
}
```

### Case 2: Database insert fails during reservation

**Problem:**
- `recordWebhookProcessed()` fails during initial reservation
- Webhook returns error to Clio
- Clio retries → no reservation exists → tries again

**Solution:** This is acceptable behavior
- If we can't write to database, we shouldn't process the webhook
- Webhook will retry and hopefully database is available
- No duplicate tasks created because we never got past step 1

---

## Testing

### Test 1: Normal Success Flow
```javascript
1. Check idempotency → not found
2. Reserve webhook (success: null)
3. Process tasks successfully
4. Update webhook (success: true)
5. Query webhook_events → success: true ✅
```

### Test 2: Database Failure After Task Creation
```javascript
1. Check idempotency → not found
2. Reserve webhook (success: null)
3. Create 5 tasks in Clio ✅
4. Simulate database failure
5. updateWebhookProcessed() fails ❌
6. Webhook returns error to Clio
7. Clio retries webhook
8. Check idempotency → found (success: null)
9. Processing timeout not reached → return "still_processing"
10. Clio waits and retries later
11. Eventually timeout triggers → allow retry
12. Tasks already exist in Clio → idempotency via task number check
```

### Test 3: Concurrent Webhooks
```javascript
1. Webhook A: Check idempotency → not found
2. Webhook A: Reserve webhook
3. Webhook B: Check idempotency → found (success: null)
4. Webhook B: Return "still_processing"
5. Webhook A: Complete successfully
6. Webhook B retry: Check idempotency → found (success: true)
7. Webhook B: Return cached result ✅
```

---

## Monitoring Queries

### Find Webhooks Stuck in Processing
```sql
SELECT
  id,
  idempotency_key,
  event_type,
  resource_id,
  action,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) as processing_seconds
FROM webhook_events
WHERE success IS NULL
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

### Count Processing States
```sql
SELECT
  CASE
    WHEN success = TRUE THEN 'success'
    WHEN success = FALSE THEN 'failure'
    WHEN success IS NULL THEN 'processing'
  END as state,
  COUNT(*) as count
FROM webhook_events
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY state;
```

---

**Ready for execution:** YES
**Requires database migration:** YES (ALTER TABLE)
**Estimated time:** 2 hours
**Risk level:** MEDIUM
