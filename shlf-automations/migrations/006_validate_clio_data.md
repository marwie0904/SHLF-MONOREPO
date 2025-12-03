# Migration 006: Validate Clio Data

**Created:** 2025-10-03
**Status:** Ready for execution
**Risk Level:** LOW (defensive validation)

---

## Problem Statement

**Current Issue:**
- Clio API may return incomplete data structures
- We access nested properties without validation
- Undefined values inserted into database
- Data integrity compromised

**Example Scenarios:**

### Scenario 1: Matter Without Stage
```javascript
// Matter created in Clio without stage assignment
const matterDetails = await ClioService.getMatter(matterId);
// matterDetails.matter_stage = undefined

const currentStageId = matterDetails.matter_stage?.id; // undefined
const currentStageName = matterDetails.matter_stage?.name; // undefined

await SupabaseService.upsertMatterInfo({
  matter_id: matterId,
  stage_id: undefined, // ❌ Invalid data
  stage_name: undefined, // ❌ Invalid data
});

// Tries to get task templates for undefined stage → fails
const taskTemplates = await SupabaseService.getTaskListNonMeeting(undefined);
```

### Scenario 2: Task Without Matter
```javascript
// Orphaned task in Clio (matter was deleted)
const clioTask = await ClioService.getTask(taskId);
// clioTask.matter = undefined

const matterId = clioTask.matter?.id; // undefined
await SupabaseService.getTasksByMatterAndStage(undefined, stageId); // ❌ Invalid query
```

### Scenario 3: Calendar Entry Without Event Type
```javascript
// Calendar entry created without event type
const calendarEntry = await ClioService.getCalendarEntry(calendarEntryId);
// calendarEntry.calendar_entry_event_type = undefined

const calendarEventTypeId = calendarEntry.calendar_entry_event_type?.id; // undefined
const mapping = await SupabaseService.getCalendarEventMapping(undefined); // ❌ Returns null
```

---

## Solution

Add validation after fetching data from Clio API, before using it.

### Validation Points

1. **matter-stage-change.js** - Validate matter has stage
2. **task-completion.js** - Validate task has matter
3. **meeting-scheduled.js** - Validate calendar entry has event type and matter
4. **All automations** - Validate required fields in Clio responses

---

## Code Changes

### 1. matter-stage-change.js - Validate Matter Stage

**Location:** After fetching matter details (line ~98)

```javascript
// Step 2: Fetch full matter details
const matterDetails = await ClioService.getMatter(matterId);

const currentStageId = matterDetails.matter_stage?.id;
const currentStageName = matterDetails.matter_stage?.name;
const practiceArea = matterDetails.practice_area?.name;
const practiceAreaId = matterDetails.practice_area?.id;

// Validate required fields
if (!currentStageId || !currentStageName) {
  const error = `Matter missing required stage information`;
  console.error(`[MATTER] ${matterId} ${error}`);

  await SupabaseService.logError(
    ERROR_CODES.CLIO_API_FAILED,
    error,
    {
      matter_id: matterId,
      matter_data: matterDetails,
    }
  );

  await SupabaseService.updateWebhookProcessed(idempotencyKey, {
    processing_duration_ms: Date.now() - startTime,
    success: false,
    action: 'missing_stage',
  });

  console.log(`[MATTER] ${matterId} COMPLETED (missing stage)\n`);
  return { success: false, action: 'missing_stage' };
}

// Validate practice area (optional but recommended)
if (!practiceArea || !practiceAreaId) {
  console.warn(`[MATTER] ${matterId} Missing practice area information`);
  // Don't fail, but log warning
}
```

### 2. task-completion.js - Validate Task Has Matter

**Location:** After fetching task details (line ~67)

```javascript
// Step 1: Fetch task details from Clio
const clioTask = await ClioService.getTask(taskId);

// Validate task has matter
const taskMatterId = clioTask.matter?.id;
if (!taskMatterId) {
  const error = `Task missing required matter association`;
  console.error(`[TASK] ${taskId} ${error}`);

  await SupabaseService.logError(
    ERROR_CODES.CLIO_API_FAILED,
    error,
    {
      task_id: taskId,
      task_data: clioTask,
    }
  );

  await SupabaseService.updateWebhookProcessed(idempotencyKey, {
    processing_duration_ms: Date.now() - startTime,
    success: false,
    action: 'missing_matter',
  });

  console.log(`[TASK] ${taskId} COMPLETED (missing matter)\n`);
  return { success: false, action: 'missing_matter' };
}

// TEMPORARY: Test mode filter - only process tasks from specific matter
const TEST_MATTER_ID = 1675950832;
if (taskMatterId !== TEST_MATTER_ID) {
  // ... existing test mode logic
}
```

### 3. meeting-scheduled.js - Validate Calendar Entry Data

**Location:** After fetching calendar entry (line ~71)

```javascript
// Step 1: Fetch calendar entry details
const calendarEntry = await ClioService.getCalendarEntry(calendarEntryId);

const calendarEventTypeId = calendarEntry.calendar_entry_event_type?.id;
const matterId = calendarEntry.matter?.id;
const meetingLocation = calendarEntry.location;
const meetingDate = calendarEntry.start_at;

// NOTE: calendarEventTypeId and matterId are already validated below
// Just adding explicit validation for meetingDate

// Validate required fields for meeting-related tasks
if (!meetingDate) {
  console.warn(`[CALENDAR] ${calendarEntryId} Missing meeting date`);
  // Don't fail - calendar entry might not have a date yet
  // But log for visibility
}
```

**Note:** meeting-scheduled.js already validates `calendarEventTypeId` and `matterId` further down, so we just need to ensure those validations happen before use.

---

## Additional Validation - Practice Area

Currently, practice area is used to determine which task templates to load:

```javascript
if (practiceArea === 'Probate') {
  taskTemplates = await SupabaseService.getTaskListProbate(currentStageId);
} else {
  // Estate Planning or other
  taskTemplates = await SupabaseService.getTaskListNonMeeting(currentStageId);
}
```

**Issue:** If `practiceArea` is undefined, it will use the `else` branch (Estate Planning).

**Fix:** Add validation or default value:

```javascript
if (!practiceArea) {
  console.warn(`[MATTER] ${matterId} Missing practice area, defaulting to Estate Planning`);
  // Use default template set
  taskTemplates = await SupabaseService.getTaskListNonMeeting(currentStageId);
} else if (practiceArea === 'Probate') {
  taskTemplates = await SupabaseService.getTaskListProbate(currentStageId);
} else {
  // Estate Planning or other
  taskTemplates = await SupabaseService.getTaskListNonMeeting(currentStageId);
}
```

---

## Error Codes

Add new error code for validation failures:

**File:** `src/constants/error-codes.js`

```javascript
export const ERROR_CODES = {
  // ... existing codes ...

  // Validation errors
  VALIDATION_MISSING_STAGE: 'ERR_VALIDATION_MISSING_STAGE',
  VALIDATION_MISSING_MATTER: 'ERR_VALIDATION_MISSING_MATTER',
  VALIDATION_MISSING_EVENT_TYPE: 'ERR_VALIDATION_MISSING_EVENT_TYPE',
  VALIDATION_MISSING_REQUIRED_FIELD: 'ERR_VALIDATION_MISSING_REQUIRED_FIELD',
};
```

---

## Testing

### Test 1: Matter Without Stage
```javascript
// Simulate Clio API returning matter without stage
const matterDetails = {
  id: 123,
  // matter_stage: undefined ❌
  practice_area: { id: 1, name: 'Estate Planning' }
};

// Expected behavior:
// - Log error to error_logs
// - Update webhook with success: false, action: 'missing_stage'
// - Return early without processing tasks
```

### Test 2: Task Without Matter
```javascript
// Simulate Clio API returning task without matter
const clioTask = {
  id: 456,
  name: 'Orphaned Task',
  // matter: undefined ❌
};

// Expected behavior:
// - Log error to error_logs
// - Update webhook with success: false, action: 'missing_matter'
// - Return early
```

### Test 3: Valid Data
```javascript
// All required fields present
const matterDetails = {
  id: 123,
  matter_stage: { id: 707058, name: 'Initial Consultation' },
  practice_area: { id: 1, name: 'Estate Planning' }
};

// Expected behavior:
// - Validation passes
// - Processing continues normally
```

---

## Impact Analysis

**Benefits:**
- Prevents undefined values in database
- Fails fast with clear error messages
- Better visibility into Clio data quality issues
- Easier debugging

**Risks:**
- May reject webhooks that would have partially succeeded before
- Need to monitor error_logs for new validation failures

**Mitigation:**
- All validation failures are logged to error_logs with context
- Webhook marked as failed → Clio retries
- Manual intervention can fix data in Clio and replay webhook

---

## Monitoring Queries

### Find Validation Failures
```sql
SELECT
  error_code,
  error_message,
  context,
  created_at
FROM error_logs
WHERE error_code IN (
  'ERR_VALIDATION_MISSING_STAGE',
  'ERR_VALIDATION_MISSING_MATTER',
  'ERR_VALIDATION_MISSING_EVENT_TYPE',
  'ERR_VALIDATION_MISSING_REQUIRED_FIELD'
)
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Webhook Failures by Action
```sql
SELECT
  action,
  COUNT(*) as count
FROM webhook_events
WHERE success = FALSE
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY action
ORDER BY count DESC;
```

---

**Ready for execution:** YES
**Requires database changes:** NO (only code changes)
**Estimated time:** 1 hour
**Risk level:** LOW
