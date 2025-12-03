# Migration 004: Add Failure Tracking to Webhook Events

**Created:** 2025-10-03
**Status:** Ready for execution
**Risk Level:** LOW (additive only)

---

## Problem Statement

**Current Issue:**
- Webhook marked as "success: true" even if some tasks fail
- No visibility into partial failures
- Clio doesn't retry when some tasks fail → tasks permanently missing

**Example Scenario:**
1. 10 tasks to create for matter stage change
2. Tasks 1-5 succeed ✅
3. Task 6 fails ❌ (assignee resolution error)
4. Tasks 7-10 succeed ✅
5. Webhook marked as `success: true, tasks_created: 10`
6. Clio sees success → doesn't retry
7. **Task 6 is permanently missing!**

---

## Solution

Track partial failures and mark webhook appropriately:
- `success: false` if ANY task fails
- `action: 'partial_failure'` to indicate partial success
- Store failure details for debugging

---

## Database Schema Change

Add `failure_details` column to store information about failed tasks:

```sql
ALTER TABLE webhook_events
ADD COLUMN failure_details JSONB;

COMMENT ON COLUMN webhook_events.failure_details IS 'Details of failed tasks (for partial failures)';
```

**Example data:**
```json
{
  "failure_details": [
    {
      "task_title": "Send Initial Consultation Packet",
      "task_number": 6,
      "error": "No CSC found for location: naples",
      "error_code": "ERR_ASSIGNEE_NO_CSC"
    },
    {
      "task_title": "Schedule Follow-up Call",
      "task_number": 8,
      "error": "Clio API failed: 500 Internal Server Error",
      "error_code": "ERR_CLIO_API_FAILED"
    }
  ]
}
```

---

## Code Changes

### 1. Update generateTasks to Track Failures

**Before:**
```javascript
for (const template of taskTemplates) {
  try {
    // Create task
  } catch (error) {
    console.error(`Failed: ${error.message}`);
    continue; // ❌ No tracking
  }
}
```

**After:**
```javascript
let tasksCreated = 0;
let tasksFailed = 0;
const failures = [];

for (const template of taskTemplates) {
  try {
    // Create task
    tasksCreated++;
  } catch (error) {
    tasksFailed++;
    failures.push({
      task_title: template.task_title,
      task_number: template.task_number,
      error: error.message,
      error_code: error.code,
    });
    continue;
  }
}

return { tasksCreated, tasksFailed, failures };
```

### 2. Update Webhook Recording

**Before:**
```javascript
await SupabaseService.recordWebhookProcessed({
  success: true, // ❌ Always true
  action: 'created_tasks',
  tasks_created: tasksCreated,
});
```

**After:**
```javascript
const success = result.tasksFailed === 0;
const action = result.tasksFailed > 0 ? 'partial_failure' : 'created_tasks';

await SupabaseService.recordWebhookProcessed({
  success: success, // ✅ False if any failures
  action: action,
  tasks_created: result.tasksCreated,
  failure_details: result.tasksFailed > 0 ? result.failures : undefined,
});
```

---

## Handling Partial Failures

### Scenario 1: All Tasks Succeed
```javascript
{
  success: true,
  action: 'created_tasks',
  tasks_created: 10,
  tasks_updated: 0,
  failure_details: null
}
```

### Scenario 2: Partial Failure
```javascript
{
  success: false, // ✅ Marked as failed
  action: 'partial_failure',
  tasks_created: 9,
  tasks_updated: 0,
  failure_details: [
    {
      task_title: "Send Initial Consultation Packet",
      task_number: 6,
      error: "No CSC found for location: naples",
      error_code: "ERR_ASSIGNEE_NO_CSC"
    }
  ]
}
```

**Result:** Clio sees `success: false` → retries webhook → tasks created again

**BUT:** We have idempotency! Second attempt:
- Checks idempotency key
- Finds existing record with partial_failure
- Returns cached result (doesn't re-process)

**Problem:** Task 6 is still missing!

---

## Manual Intervention Required

For partial failures, we need manual intervention:

### Query to Find Partial Failures
```sql
SELECT
  id,
  event_type,
  resource_id,
  tasks_created,
  failure_details,
  created_at
FROM webhook_events
WHERE action = 'partial_failure'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Resolution Process
1. Review failure_details
2. Fix root cause (e.g., add missing CSC assignment)
3. Manually create missing tasks in Clio
4. Update webhook_events record:
```sql
UPDATE webhook_events
SET
  success = true,
  action = 'manually_resolved',
  updated_at = NOW()
WHERE id = '<webhook-event-id>';
```

---

## Future Enhancement: Auto-Retry

**Phase 2:** Implement auto-retry for recoverable failures:

```javascript
if (result.tasksFailed > 0) {
  // Check if failures are recoverable
  const recoverableErrors = [
    'ERR_ASSIGNEE_NO_CSC',
    'ERR_ASSIGNEE_NO_PARALEGAL'
  ];

  const allRecoverable = result.failures.every(f =>
    recoverableErrors.includes(f.error_code)
  );

  if (allRecoverable) {
    // Schedule retry in 5 minutes
    await scheduleRetry(webhookData, result.failures);
  }
}
```

---

## Testing

### Test 1: All Tasks Succeed
```javascript
// 10 templates, all succeed
result = { tasksCreated: 10, tasksFailed: 0, failures: [] }
// Expected: success: true, action: 'created_tasks'
```

### Test 2: Partial Failure
```javascript
// 10 templates, 1 fails
result = {
  tasksCreated: 9,
  tasksFailed: 1,
  failures: [
    {
      task_title: "Task 6",
      task_number: 6,
      error: "No CSC found",
      error_code: "ERR_ASSIGNEE_NO_CSC"
    }
  ]
}
// Expected: success: false, action: 'partial_failure'
```

### Test 3: Complete Failure
```javascript
// 10 templates, all fail
result = { tasksCreated: 0, tasksFailed: 10, failures: [...] }
// Expected: success: false, action: 'partial_failure'
```

---

## Monitoring Queries

### Daily Partial Failure Count
```sql
SELECT
  DATE(created_at) as date,
  COUNT(*) as partial_failures,
  SUM((failure_details::jsonb->>'count')::int) as total_failed_tasks
FROM webhook_events
WHERE action = 'partial_failure'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### Most Common Failure Reasons
```sql
SELECT
  failure->>'error_code' as error_code,
  COUNT(*) as occurrences
FROM webhook_events,
  jsonb_array_elements(failure_details::jsonb) as failure
WHERE action = 'partial_failure'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY failure->>'error_code'
ORDER BY occurrences DESC;
```

---

**Ready for execution:** YES
**Requires downtime:** NO
**Estimated time:** 1 hour
**Risk level:** LOW
