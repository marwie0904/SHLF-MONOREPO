# TODO: Add Failure Tracking to meeting-scheduled.js

**Status:** Pending
**Priority:** HIGH (part of Critical Issue #2 fix)
**Estimated Time:** 15 minutes

---

## Required Changes

Apply the same failure tracking pattern as matter-stage-change.js:

### 1. Update processTaskTemplates Method

**Current signature:**
```javascript
static async processTaskTemplates(
  calendarEntryId,
  taskTemplates,
  matterDetails,
  mapping,
  meetingDate,
  meetingLocation,
  existingTasks,
  action
) {
  for (const template of taskTemplates) {
    try {
      // ...
    } catch (error) {
      continue; // ❌ No tracking
    }
  }
}
```

**New signature:**
```javascript
static async processTaskTemplates(...) {
  let tasksCreated = 0;
  let tasksFailed = 0;
  const failures = [];

  for (const template of taskTemplates) {
    try {
      // ... create/update task
      tasksCreated++;
    } catch (error) {
      tasksFailed++;
      failures.push({
        task_title: template.task_title,
        task_number: template.task_number,
        error: error.message,
        error_code: error.code || 'UNKNOWN_ERROR',
      });
      continue;
    }
  }

  return { tasksCreated, tasksFailed, failures };
}
```

### 2. Update Assignee Error Handling

Add failure tracking to continue statements:

```javascript
console.log(`[CALENDAR] ${calendarEntryId} Logged error: ${assigneeError.code}`);
tasksFailed++;
failures.push({
  task_title: template.task_title,
  task_number: template.task_number,
  error: assigneeError.message,
  error_code: assigneeError.code,
});
continue;
```

### 3. Update Clio API Failure Handling

```javascript
console.error(`[CALENDAR] ${calendarEntryId} Clio update failed`);
tasksFailed++;
failures.push({
  task_title: template.task_title,
  task_number: template.task_number,
  error: `Clio update failed: ${clioError.message}`,
  error_code: ERROR_CODES.CLIO_API_FAILED,
});
continue;
```

### 4. Update Main Process Method

Update the code that calls processTaskTemplates:

```javascript
// Before
await this.processTaskTemplates(...);

// After
const result = await this.processTaskTemplates(...);

const success = result.tasksFailed === 0;
const action = result.tasksFailed > 0 ? 'partial_failure' : 'tasks_created';

await SupabaseService.recordWebhookProcessed({
  // ...
  success: success,
  action: action,
  tasks_created: result.tasksCreated,
  tasks_updated: result.tasksUpdated || 0,
  failure_details: result.tasksFailed > 0 ? result.failures : undefined,
});
```

---

## Testing

After implementing, test with:
1. All tasks succeed → success: true, action: 'tasks_created'
2. Some tasks fail → success: false, action: 'partial_failure', failure_details populated
3. All tasks fail → success: false, action: 'partial_failure'

---

**Note:** This follows the exact pattern implemented in matter-stage-change.js
