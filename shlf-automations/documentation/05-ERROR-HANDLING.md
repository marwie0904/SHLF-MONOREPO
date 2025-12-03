# Error Handling Documentation

## Table of Contents
- [Overview](#overview)
- [Error Codes](#error-codes)
- [Error Handling Patterns](#error-handling-patterns)
- [Error Tasks](#error-tasks)
- [Logging Strategy](#logging-strategy)
- [Recovery Mechanisms](#recovery-mechanisms)

---

## Overview

The automation system uses a comprehensive error handling strategy:

1. **Error Codes** - Standardized codes for categorization
2. **Error Logging** - Persistent logging to Supabase
3. **Error Tasks** - In-app notifications for critical failures
4. **Retry Logic** - Automatic retries for transient failures
5. **Graceful Degradation** - Continue processing other items on partial failure

---

## Error Codes

**File:** `src/constants/error-codes.js`

### Assignee Resolution Errors

| Code | Description | Cause |
|------|-------------|-------|
| `ERR_ASSIGNEE_NO_ATTORNEY` | No originating attorney found on matter | Matter missing responsible/originating attorney |
| `ERR_ASSIGNEE_NO_CSC` | No CSC found for location | Location keyword not in assigned_user_reference |
| `ERR_ASSIGNEE_NO_PARALEGAL` | No paralegal found for attorney | Attorney not mapped to paralegal |
| `ERR_ASSIGNEE_NO_FUND_TABLE` | No user found for fund table | Attorney not in fund_table lookup |
| `ERR_ASSIGNEE_INVALID_TYPE` | Invalid assignee type | Unknown assignee type in template |

### Meeting/Location Errors

| Code | Description | Cause |
|------|-------------|-------|
| `ERR_MEETING_NO_LOCATION` | Signing meeting has no location | Calendar entry missing location field |
| `ERR_MEETING_INVALID_LOCATION` | Meeting location does not contain required keywords | Location string has no recognized keyword |

### Template Errors

| Code | Description | Cause |
|------|-------------|-------|
| `ERR_TEMPLATE_MISSING` | No task templates found for stage | Stage ID not in task templates table |
| `ERR_TEMPLATE_DUPLICATE` | Duplicate task_number found in templates | Data integrity issue in templates |
| `ERR_TEMPLATE_NOT_FOUND` | Task template not found | Specific task template missing |

### API Errors

| Code | Description | Cause |
|------|-------------|-------|
| `ERR_CLIO_API_FAILED` | Clio API request failed | API timeout, 500 error, network issue |
| `ERR_SUPABASE_SYNC_FAILED` | Supabase sync failed after Clio success | Database write failed |
| `ERR_TASK_NOT_FOUND_IN_CLIO` | Task not found in Clio (404) | Task was deleted externally |

### Validation Errors

| Code | Description | Cause |
|------|-------------|-------|
| `ERR_VALIDATION_MISSING_STAGE` | Matter missing required stage information | Webhook payload incomplete |
| `ERR_VALIDATION_MISSING_MATTER` | Task missing required matter association | Task not linked to matter |
| `ERR_VALIDATION_MISSING_EVENT_TYPE` | Calendar entry missing required event type | No event type on calendar entry |
| `ERR_VALIDATION_MISSING_REQUIRED_FIELD` | Missing required field from Clio API | API response missing expected field |

### Webhook Security Errors

| Code | Description | Cause |
|------|-------------|-------|
| `ERR_WEBHOOK_INVALID_SIGNATURE` | Invalid webhook signature | HMAC mismatch |
| `ERR_WEBHOOK_MISSING_SIGNATURE` | Missing webhook signature | No X-Clio-Signature header |

### Payment/Bill Errors

| Code | Description | Cause |
|------|-------------|-------|
| `ERR_BILL_CHECK_FAILED` | Failed to retrieve or check bills for matter | Bills API failed |
| `ERR_PAYMENT_CHECK_FAILED` | Failed to check payment status for matter | Payment check failed |
| `ERR_CLOSED_MATTER_TASK_FAILED` | Failed to create task for closed matter | Task creation failed |

### General Errors

| Code | Description | Cause |
|------|-------------|-------|
| `ERR_AUTOMATION_FAILED` | Generic automation failure | Unhandled exception |

---

## Error Handling Patterns

### 1. Assignee Resolution Errors

**Pattern:** Create error task, continue with other tasks

```javascript
// src/automations/matter-stage-change.js
for (const template of taskTemplates) {
  try {
    const assignee = await resolveAssignee(template.assignee, matterDetails);
    // Create task...
  } catch (assigneeError) {
    if (assigneeError instanceof AssigneeError) {
      // Create error task in Clio
      const errorTask = await createAssigneeErrorTask(
        matterId,
        assigneeError,
        stageId,
        stageName,
        template.task_title
      );

      // Log to database
      await SupabaseService.logError(
        assigneeError.code,
        assigneeError.message,
        { matter_id: matterId, template: template.task_title }
      );

      // Continue with next template (don't fail entire automation)
      continue;
    }
    throw assigneeError;
  }
}
```

### 2. Clio API Errors

**Pattern:** Throw and let retry logic handle

```javascript
// src/services/clio.js
try {
  const response = await axios.post('/api/v4/tasks.json', taskData);
  return response.data.data;
} catch (error) {
  if (error.response?.status === 401) {
    // Token expired - auto-refresh and retry
    await this.refreshToken();
    return this.createTask(taskData);
  }

  // Log and rethrow
  await SupabaseService.logError(
    ERROR_CODES.CLIO_API_FAILED,
    `Failed to create task: ${error.message}`,
    { task_data: taskData, status: error.response?.status }
  );

  throw error;
}
```

### 3. Supabase Errors

**Pattern:** Log but don't fail (Clio task already exists)

```javascript
// After successful Clio task creation
try {
  await SupabaseService.insertTask(taskRecord);
} catch (supabaseError) {
  // Log the error but don't fail the automation
  // Task exists in Clio, just not tracked in our database
  console.error(`[TASK] Supabase insert failed: ${supabaseError.message}`);

  await SupabaseService.logError(
    ERROR_CODES.SUPABASE_SYNC_FAILED,
    `Task created in Clio but not recorded: ${supabaseError.message}`,
    { task_id: clioTask.id, matter_id: matterId }
  );
}
```

### 4. Validation Errors

**Pattern:** Early return with appropriate status

```javascript
// Validate required fields
if (!webhookData.data.matter_stage) {
  await SupabaseService.logError(
    ERROR_CODES.VALIDATION_MISSING_STAGE,
    `Webhook missing matter_stage field`,
    { matter_id: matterId, webhook_data: webhookData }
  );

  await SupabaseService.updateWebhookProcessed(idempotencyKey, {
    success: false,
    action: 'validation_failed',
    error_message: 'Missing matter_stage'
  });

  return { success: false, action: 'validation_failed' };
}
```

---

## Error Tasks

When certain errors occur, the system creates **error tasks** in Clio to notify users.

### Error Task Structure

```javascript
{
  name: "Assignment Error - 00001-Smith",
  description: "Unable to generate tasks for stage. No CSC found for location: fort myers",
  matter: { id: 12345678 },
  assignee: { id: attorneyId, type: "User" },  // Assign to matter's attorney
  due_at: new Date().toISOString(),
  priority: "high"
}
```

### When Error Tasks Are Created

| Scenario | Task Created |
|----------|-------------|
| Assignee resolution fails | Yes - "Assignment Error" |
| No templates for stage | No - Silent success |
| Clio API failure | No - Webhook marked failed |
| Meeting location invalid | Yes - "Assignment Error" |

### Error Task in Supabase

```javascript
{
  task_id: 98765432,
  task_name: "Assignment Error - 00001-Smith",
  matter_id: 12345678,
  task_number: -1,           // Special identifier for error tasks
  status: "error"
}
```

---

## Logging Strategy

### Console Logging

All automations use prefixed console logs:

```javascript
console.log(`[MATTER] ${matterId} Stage changed to ${stageName}`);
console.log(`[TASK] ${taskId} Created successfully`);
console.log(`[CALENDAR] ${entryId} Processing meeting...`);
console.log(`[DOCUMENT] ${documentId} Creating save task`);
console.log(`[QUEUE] Matter ${matterId} - Adding to queue`);
console.log(`[VERIFY] ${matterId} Starting verification`);
console.error(`[MATTER] ${matterId} ERROR: ${error.message}`);
```

### Database Logging

All significant errors are logged to `error_logs` table:

```javascript
// src/services/supabase.js
static async logError(errorCode, errorMessage, context = {}) {
  try {
    await supabase.from('error_logs').insert({
      error_code: errorCode,
      error_message: errorMessage,
      context: context,
      created_at: new Date().toISOString()
    });
  } catch (logError) {
    // Don't throw - logging should never break the flow
    console.error('Failed to log error:', logError.message);
  }
}
```

### Log Levels

| Level | Usage |
|-------|-------|
| `console.log()` | Normal flow, status updates |
| `console.warn()` | Non-critical issues, skipped items |
| `console.error()` | Errors that affect processing |

---

## Recovery Mechanisms

### 1. Retry Logic

**Location:** `src/routes/webhooks.js`

```javascript
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function processWithRetry(processor, webhookData) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await processor(webhookData);
    } catch (error) {
      console.error(`Attempt ${attempt} failed: ${error.message}`);

      if (attempt === MAX_RETRIES) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
```

### 2. Token Auto-Refresh

**Location:** `src/services/clio.js`

```javascript
// Axios interceptor for 401 responses
axios.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;

      // Refresh token
      await TokenRefreshService.refreshAccessToken();

      // Update auth header
      error.config.headers.Authorization = `Bearer ${config.clio.accessToken}`;

      // Retry original request
      return axios(error.config);
    }
    throw error;
  }
);
```

### 3. Post-Verification Recovery

**Location:** `src/services/task-verification.js`

```javascript
// After task creation, verify all tasks exist
const verification = await TaskVerificationService.verifyTaskGeneration({
  matterId,
  stageId,
  stageName,
  expectedCount: templates.length,
  matterDetails
});

// If tasks missing, regenerate them
if (!verification.success) {
  console.log(`Regenerated ${verification.tasksRegenerated} missing tasks`);
}
```

### 4. Idempotency Recovery

**Pattern:** Webhook can be safely retried

```javascript
// Check if already processed
const existing = await SupabaseService.checkWebhookProcessed(idempotencyKey);

if (existing) {
  if (existing.success === null) {
    // Still processing - don't duplicate
    return { action: 'still_processing' };
  }

  // Already done - return cached result
  return {
    action: existing.action,
    cached: true
  };
}
```

---

## Error Monitoring

### Query Recent Errors

```sql
-- Last 24 hours of errors
SELECT error_code, error_message, context, created_at
FROM error_logs
WHERE created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Error Code Summary

```sql
-- Error count by code
SELECT error_code, COUNT(*) as count
FROM error_logs
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY error_code
ORDER BY count DESC;
```

### Failed Webhooks

```sql
-- Failed webhook processing
SELECT resource_type, resource_id, error_message, created_at
FROM webhook_events
WHERE success = false
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

---

## Error Response Codes (HTTP)

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | Webhook processed |
| 400 | Bad Request | Invalid payload - don't retry |
| 401 | Unauthorized | Invalid signature - check config |
| 500 | Server Error | Log and retry |

---

## Troubleshooting Guide

### "ERR_ASSIGNEE_NO_CSC"

**Problem:** No CSC found for matter location

**Solutions:**
1. Check `assigned_user_reference` table for location mapping
2. Verify location keyword in `location_keywords` table
3. Check matter has location field populated

### "ERR_MEETING_INVALID_LOCATION"

**Problem:** Meeting location doesn't contain recognized keywords

**Solutions:**
1. Check meeting location string in Clio
2. Add missing keyword to `location_keywords` table
3. Update `assigned_user_reference` for new location

### "ERR_TEMPLATE_MISSING"

**Problem:** No task templates for stage

**Solutions:**
1. Check stage_id in `task-list-non-meeting` table
2. Verify stage is configured for automation
3. Add templates for new stage

### "ERR_CLIO_API_FAILED"

**Problem:** Clio API request failed

**Solutions:**
1. Check token expiration
2. Verify API credentials
3. Check Clio status page
4. Review rate limits

---

## Related Documentation

- [00-OVERVIEW.md](./00-OVERVIEW.md) - System overview
- [02-AUTOMATIONS.md](./02-AUTOMATIONS.md) - Automation details
- [06-SERVICES.md](./06-SERVICES.md) - Service implementations
