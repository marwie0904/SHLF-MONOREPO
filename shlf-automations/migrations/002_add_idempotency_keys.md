# Migration 002: Add Idempotency Keys for Webhook Processing

**Created:** 2025-10-03
**Status:** Ready for execution
**Risk Level:** LOW (additive only, no data changes)

---

## Problem Statement

**Current Issues:**
- Webhooks can be replayed by Clio (network failures, retries, manual replay)
- No persistent tracking of processed webhooks
- Current 1-minute race condition check only prevents rapid duplicates
- Need true idempotency for production reliability

**Example Scenario:**
1. Clio sends webhook for matter stage change
2. Our server processes it, creates tasks
3. Network failure before response sent
4. Clio retries webhook (thinks it failed)
5. Our server processes again → **duplicate tasks created**

**Current Protection:**
- Database unique constraint prevents duplicate tasks ✅
- 1-minute race condition check prevents rapid duplicates ✅
- **Missing:** Persistent webhook deduplication ❌

---

## Idempotency Strategy

### What is Idempotency?

An operation is idempotent if calling it multiple times with the same input produces the same result as calling it once.

**For webhooks:**
- First call: Process webhook, create tasks, return success
- Second call (duplicate): Detect already processed, return success without processing

### Idempotency Key Strategy

We'll use a composite key based on:
```
{webhook_type}:{resource_id}:{event_timestamp}
```

**Examples:**
- `matter.updated:1675950832:2025-10-03T10:15:30Z`
- `task.completed:123456789:2025-10-03T10:20:00Z`
- `calendar_entry.created:987654321:2025-10-03T10:25:00Z`

**Why this works:**
- `webhook_type` - Distinguishes different event types
- `resource_id` - Specific matter/task/calendar entry
- `event_timestamp` - When event occurred in Clio

---

## Database Schema

### Table: webhook_events

```sql
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Idempotency key (unique)
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Webhook metadata
  webhook_id TEXT, -- Clio's webhook ID (if provided)
  event_type TEXT NOT NULL, -- 'matter.updated', 'task.completed', etc.
  resource_type TEXT NOT NULL, -- 'matter', 'task', 'calendar_entry'
  resource_id BIGINT NOT NULL, -- ID of the resource

  -- Processing metadata
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_duration_ms INTEGER, -- How long it took to process

  -- Result metadata
  success BOOLEAN NOT NULL DEFAULT TRUE,
  action TEXT, -- 'created_tasks', 'skipped', 'error', etc.
  tasks_created INTEGER DEFAULT 0,
  tasks_updated INTEGER DEFAULT 0,

  -- Payload storage (for debugging)
  webhook_payload JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_webhook_events_idempotency_key ON webhook_events(idempotency_key);
CREATE INDEX idx_webhook_events_resource ON webhook_events(resource_type, resource_id);
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at DESC);
CREATE INDEX idx_webhook_events_event_type ON webhook_events(event_type);

-- Retention: Auto-delete old webhook events (older than 90 days)
-- Run this as a periodic job or cron
-- DELETE FROM webhook_events WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## Implementation Flow

### Current Flow (No Idempotency)
```
Webhook Received
  ↓
Process (create tasks)
  ↓
Return success
```

### New Flow (With Idempotency)
```
Webhook Received
  ↓
Generate Idempotency Key
  ↓
Check if already processed? ──YES──> Return cached result (200 OK)
  ↓ NO
Process webhook
  ↓
Record in webhook_events
  ↓
Return success
```

---

## Code Implementation

### Step 1: Create SupabaseService methods

```javascript
// In src/services/supabase.js

/**
 * Generate idempotency key for webhook
 */
static generateIdempotencyKey(eventType, resourceId, timestamp) {
  return `${eventType}:${resourceId}:${timestamp}`;
}

/**
 * Check if webhook already processed
 */
static async checkWebhookProcessed(idempotencyKey) {
  const { data, error } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data || null;
}

/**
 * Record webhook processing
 */
static async recordWebhookProcessed(webhookData) {
  const { data, error } = await supabase
    .from('webhook_events')
    .insert(webhookData)
    .select();

  if (error) {
    // If duplicate key (23505), webhook was processed by another request
    if (error.code === '23505') {
      console.log(`[WEBHOOK] Duplicate idempotency key detected: ${webhookData.idempotency_key}`);
      return null; // Already processed
    }
    throw error;
  }

  return data?.[0];
}
```

### Step 2: Update webhook handlers

```javascript
// In src/automations/matter-stage-change.js

static async process(webhookData) {
  const matterId = webhookData.data.id;
  const timestamp = webhookData.data.updated_at || new Date().toISOString();

  // Generate idempotency key
  const idempotencyKey = SupabaseService.generateIdempotencyKey(
    'matter.updated',
    matterId,
    timestamp
  );

  // Check if already processed
  const existing = await SupabaseService.checkWebhookProcessed(idempotencyKey);
  if (existing) {
    console.log(`[MATTER] ${matterId} Already processed (idempotency)`);
    return {
      success: true,
      action: 'already_processed',
      processed_at: existing.processed_at,
      cached: true,
    };
  }

  const startTime = Date.now();

  try {
    // ... existing processing logic ...

    // Record successful processing
    await SupabaseService.recordWebhookProcessed({
      idempotency_key: idempotencyKey,
      webhook_id: webhookData.id,
      event_type: 'matter.updated',
      resource_type: 'matter',
      resource_id: matterId,
      processing_duration_ms: Date.now() - startTime,
      success: true,
      action: 'created_tasks',
      tasks_created: tasksCreated,
      webhook_payload: webhookData,
    });

    return { success: true, tasksCreated };

  } catch (error) {
    // Record failed processing
    await SupabaseService.recordWebhookProcessed({
      idempotency_key: idempotencyKey,
      webhook_id: webhookData.id,
      event_type: 'matter.updated',
      resource_type: 'matter',
      resource_id: matterId,
      processing_duration_ms: Date.now() - startTime,
      success: false,
      action: 'error',
      webhook_payload: webhookData,
    });

    throw error;
  }
}
```

---

## Idempotency Key Generation Strategy

### Matter Stage Change
```javascript
const timestamp = webhookData.data.updated_at;
const idempotencyKey = `matter.updated:${matterId}:${timestamp}`;
```

**Example:** `matter.updated:1675950832:2025-10-03T10:15:30.123Z`

**Why this works:**
- Same matter changed to same stage at exact same time = same webhook
- Different stage changes = different `updated_at` timestamp

### Task Completion
```javascript
const timestamp = webhookData.data.completed_at || webhookData.data.updated_at;
const idempotencyKey = `task.completed:${taskId}:${timestamp}`;
```

**Example:** `task.completed:123456789:2025-10-03T10:20:15.456Z`

### Calendar Entry Created
```javascript
const timestamp = webhookData.data.created_at;
const idempotencyKey = `calendar_entry.created:${calendarEntryId}:${timestamp}`;
```

**Example:** `calendar_entry.created:987654321:2025-10-03T10:25:00.789Z`

---

## Edge Cases Handled

### 1. Rapid Duplicate Webhooks
**Scenario:** Clio sends same webhook twice within milliseconds

**Handling:**
- First request: Inserts webhook_events record, processes
- Second request: Unique constraint violation on idempotency_key
- Returns cached result from first request

### 2. Webhook Replay After Processing
**Scenario:** Webhook processed successfully, Clio replays hours later

**Handling:**
- Check webhook_events by idempotency_key
- Find existing record
- Return cached result without processing

### 3. Legitimate Duplicate Events
**Scenario:** Matter stage changed, then changed back, then changed again

**Handling:**
- Each change has different `updated_at` timestamp
- Different idempotency keys
- All processed independently

### 4. Clock Skew
**Scenario:** Clio's timestamp slightly different from our timestamp

**Handling:**
- Always use Clio's timestamp from webhook payload
- Never generate our own timestamps for idempotency

### 5. Partial Failures
**Scenario:** Processing partially succeeds (some tasks created)

**Handling:**
- Record webhook as processed (with error flag)
- Don't retry automatically
- Log to error_logs for manual review
- Idempotency prevents re-processing

---

## Testing Strategy

### Test 1: Duplicate Webhook Detection

```javascript
// Send same webhook twice
const webhook1 = {
  id: 'test-webhook-1',
  data: {
    id: 1675950832,
    updated_at: '2025-10-03T10:15:30.123Z'
  }
};

const result1 = await processWebhook(webhook1);
// Expected: Creates tasks, success: true

const result2 = await processWebhook(webhook1); // Same webhook
// Expected: Returns cached result, action: 'already_processed'
```

### Test 2: Different Timestamps = Different Events

```javascript
const webhook1 = {
  data: { id: 1675950832, updated_at: '2025-10-03T10:15:30.123Z' }
};

const webhook2 = {
  data: { id: 1675950832, updated_at: '2025-10-03T10:16:00.456Z' }
};

const result1 = await processWebhook(webhook1);
const result2 = await processWebhook(webhook2);

// Expected: Both process successfully (different events)
```

### Test 3: Race Condition (Simultaneous Requests)

```javascript
// Send same webhook from two requests simultaneously
const webhook = {
  data: { id: 1675950832, updated_at: '2025-10-03T10:15:30.123Z' }
};

const [result1, result2] = await Promise.all([
  processWebhook(webhook),
  processWebhook(webhook)
]);

// Expected: One succeeds, one returns cached (database handles race)
```

---

## Migration Steps

### Step 1: Create Table

```sql
-- Execute in Supabase
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,
  webhook_id TEXT,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id BIGINT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_duration_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  action TEXT,
  tasks_created INTEGER DEFAULT 0,
  tasks_updated INTEGER DEFAULT 0,
  webhook_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_idempotency_key ON webhook_events(idempotency_key);
CREATE INDEX idx_webhook_events_resource ON webhook_events(resource_type, resource_id);
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at DESC);
CREATE INDEX idx_webhook_events_event_type ON webhook_events(event_type);
```

### Step 2: Add Supabase Service Methods

Update `src/services/supabase.js` with idempotency methods.

### Step 3: Update Webhook Handlers

Update all three automations:
- `matter-stage-change.js`
- `task-completion.js`
- `meeting-scheduled.js`

### Step 4: Test with Postman/cURL

Send duplicate webhooks to verify idempotency works.

---

## Monitoring and Analytics

### Useful Queries

```sql
-- Check recent webhook processing
SELECT
  event_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE success = true) as successful,
  COUNT(*) FILTER (WHERE success = false) as failed,
  AVG(processing_duration_ms) as avg_duration_ms
FROM webhook_events
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY event_type;

-- Find duplicate webhook attempts (caught by idempotency)
SELECT
  idempotency_key,
  COUNT(*) as duplicate_attempts,
  MIN(created_at) as first_attempt,
  MAX(created_at) as last_attempt
FROM webhook_events
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

-- Slowest webhooks
SELECT
  event_type,
  resource_id,
  processing_duration_ms,
  created_at
FROM webhook_events
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY processing_duration_ms DESC
LIMIT 20;
```

---

## Performance Impact

**Storage:**
- ~500 bytes per webhook event
- 1000 webhooks/day = ~500 KB/day
- 90 days retention = ~45 MB
- Negligible storage cost

**Query Performance:**
- Idempotency check: Single index lookup (< 1ms)
- Insert: Single write (< 5ms)
- Minimal performance overhead

**Cleanup Strategy:**
```sql
-- Run daily/weekly
DELETE FROM webhook_events
WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## Rollback Plan

If issues arise:

```sql
-- Drop table (keeps code working without idempotency)
DROP TABLE webhook_events;

-- Idempotency checks will fail gracefully
-- Webhooks will process normally
```

Update code to handle missing table:

```javascript
static async checkWebhookProcessed(idempotencyKey) {
  try {
    const { data, error } = await supabase
      .from('webhook_events')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  } catch (error) {
    // If table doesn't exist, continue without idempotency
    console.warn('[WEBHOOK] Idempotency check failed:', error.message);
    return null;
  }
}
```

---

## Expected Benefits

### Before Idempotency
- Webhook replays cause duplicate processing
- Manual investigation required for duplicates
- Risk of data inconsistency

### After Idempotency
- Webhook replays handled automatically
- No duplicate processing
- Full audit trail of all webhook attempts
- Analytics on processing performance

---

**Ready for execution:** YES
**Requires downtime:** NO
**Estimated time:** 2 hours
**Risk level:** LOW
