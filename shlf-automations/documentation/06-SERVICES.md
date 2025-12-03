# Services Layer Documentation

## Table of Contents
- [Overview](#overview)
- [Clio Service](#clio-service)
- [Supabase Service](#supabase-service)
- [Token Refresh Service](#token-refresh-service)
- [Task Verification Service](#task-verification-service)

---

## Overview

The services layer provides abstracted interfaces for external systems:

| Service | File | Purpose |
|---------|------|---------|
| ClioService | `src/services/clio.js` | Clio REST API client |
| SupabaseService | `src/services/supabase.js` | Database operations |
| TokenRefreshService | `src/services/token-refresh.js` | OAuth token management |
| TaskVerificationService | `src/services/task-verification.js` | Post-creation verification |

---

## Clio Service

**File:** `src/services/clio.js`

### Purpose
HTTP client for Clio REST API v4 with automatic token refresh on 401 errors.

### Configuration

```javascript
import axios from 'axios';
import { config } from '../config/index.js';

const clioApi = axios.create({
  baseURL: config.clio.apiBaseUrl,  // https://app.clio.com
  headers: {
    'Authorization': `Bearer ${config.clio.accessToken}`,
    'Content-Type': 'application/json'
  }
});
```

### Auto-Token Refresh

The service automatically refreshes the token on 401 errors:

```javascript
clioApi.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;

      await TokenRefreshService.refreshAccessToken();
      error.config.headers.Authorization = `Bearer ${config.clio.accessToken}`;

      return clioApi(error.config);
    }
    throw error;
  }
);
```

### Methods

#### getMatter(matterId)
Fetch full matter details.

```javascript
static async getMatter(matterId) {
  const response = await clioApi.get(`/api/v4/matters/${matterId}.json`, {
    params: {
      fields: 'id,display_number,status,matter_stage,matter_stage_updated_at,location,responsible_attorney,originating_attorney,practice_area'
    }
  });
  return response.data.data;
}
```

**Returns:**
```javascript
{
  id: 12345678,
  display_number: "00001-Smith",
  status: "Open",
  matter_stage: {
    id: 67890,
    name: "Client Intake"
  },
  matter_stage_updated_at: "2024-01-15T10:30:00Z",
  location: "Fort Myers",
  responsible_attorney: {
    id: 357123456,
    name: "John Attorney"
  },
  originating_attorney: {
    id: 357123457,
    name: "Jane Attorney"
  },
  practice_area: {
    id: 45045123,
    name: "Estate Planning"
  }
}
```

---

#### getTask(taskId)
Fetch task details.

```javascript
static async getTask(taskId) {
  const response = await clioApi.get(`/api/v4/tasks/${taskId}.json`, {
    params: {
      fields: 'id,name,description,status,completed_at,due_at,matter,assignee'
    }
  });
  return response.data.data;
}
```

---

#### getTasksByMatter(matterId)
Get all tasks for a matter.

```javascript
static async getTasksByMatter(matterId) {
  const response = await clioApi.get('/api/v4/tasks.json', {
    params: {
      matter_id: matterId,
      fields: 'id,name,status,due_at,assignee',
      limit: 200
    }
  });
  return response.data.data;
}
```

---

#### createTask(taskData)
Create a new task in Clio.

```javascript
static async createTask(taskData) {
  const response = await clioApi.post('/api/v4/tasks.json', {
    data: taskData
  });
  return response.data.data;
}
```

**Parameters:**
```javascript
{
  name: "Review Documents",
  description: "Review all client documents",
  matter: { id: 12345678 },
  assignee: { id: 357123456, type: "User" },
  due_at: "2024-01-20"
}
```

---

#### updateTask(taskId, updates)
Update an existing task.

```javascript
static async updateTask(taskId, updates) {
  const response = await clioApi.patch(`/api/v4/tasks/${taskId}.json`, {
    data: updates
  });
  return response.data.data;
}
```

---

#### deleteTask(taskId)
Delete a task.

```javascript
static async deleteTask(taskId) {
  await clioApi.delete(`/api/v4/tasks/${taskId}.json`);
}
```

---

#### getCalendarEntry(entryId)
Fetch calendar entry details.

```javascript
static async getCalendarEntry(entryId) {
  const response = await clioApi.get(`/api/v4/calendar_entries/${entryId}.json`, {
    params: {
      fields: 'id,summary,start_at,end_at,location,calendar_entry_event_type,matter,attendees'
    }
  });
  return response.data.data;
}
```

---

#### getDocument(documentId)
Fetch document details.

```javascript
static async getDocument(documentId) {
  const response = await clioApi.get(`/api/v4/documents/${documentId}.json`, {
    params: {
      fields: 'id,name,created_at,parent,matter'
    }
  });
  return response.data.data;
}
```

---

#### getBillsByMatter(matterId)
Get bills for a matter.

```javascript
static async getBillsByMatter(matterId) {
  const response = await clioApi.get('/api/v4/bills.json', {
    params: {
      matter_id: matterId,
      fields: 'id,total,paid,balance'
    }
  });
  return response.data.data;
}
```

---

#### hasPayments(matterId)
Check if matter has any payments.

```javascript
static async hasPayments(matterId) {
  const bills = await this.getBillsByMatter(matterId);
  return bills.some(bill => bill.paid > 0);
}
```

---

## Supabase Service

**File:** `src/services/supabase.js`

### Purpose
Database operations and queries for all Supabase tables.

### Configuration

```javascript
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);
```

### Methods by Category

#### Idempotency Methods

```javascript
// Generate idempotency key
static generateIdempotencyKey(eventType, resourceId, timestamp) {
  return `${eventType}:${resourceId}:${timestamp}`;
}

// Check if webhook already processed
static async checkWebhookProcessed(idempotencyKey) {
  const { data } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .single();
  return data;
}

// Record webhook as processed
static async recordWebhookProcessed(record) {
  await supabase.from('webhook_events').insert(record);
}

// Update webhook processing status
static async updateWebhookProcessed(idempotencyKey, updates) {
  await supabase
    .from('webhook_events')
    .update({ ...updates, processed_at: new Date().toISOString() })
    .eq('idempotency_key', idempotencyKey);
}
```

---

#### Task Methods

```javascript
// Insert task record
static async insertTask(taskRecord) {
  const { error } = await supabase.from('tasks').insert(taskRecord);
  if (error) throw error;
}

// Get task by ID
static async getTaskById(taskId) {
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .eq('task_id', taskId)
    .single();
  return data;
}

// Get tasks by matter and stage
static async getTasksByMatterAndStage(matterId, stageId) {
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .eq('matter_id', matterId)
    .eq('stage_id', stageId)
    .neq('status', 'deleted');
  return data || [];
}

// Update task
static async updateTask(taskId, updates) {
  await supabase
    .from('tasks')
    .update(updates)
    .eq('task_id', taskId);
}

// Get recent tasks for verification
static async getRecentTasksByMatterAndStage(matterId, stageId, minutesAgo) {
  const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .eq('matter_id', matterId)
    .eq('stage_id', stageId)
    .gte('created_at', cutoff);
  return data || [];
}
```

---

#### Template Methods

```javascript
// Get task templates (non-meeting)
static async getTaskListNonMeeting(stageId) {
  const { data } = await supabase
    .from('task-list-non-meeting')
    .select('*')
    .eq('stage_id', stageId)
    .eq('active', true)
    .order('task_number');
  return data || [];
}

// Get task templates (probate)
static async getTaskListProbate(stageId) {
  const { data } = await supabase
    .from('task-list-probate')
    .select('*')
    .eq('stage_id', stageId)
    .eq('active', true)
    .order('task_number');
  return data || [];
}

// Get task templates (meeting)
static async getTaskListMeeting(calendarEventId) {
  const { data } = await supabase
    .from('task-list-meeting')
    .select('*')
    .eq('calendar_event_id', calendarEventId)
    .eq('active', true)
    .order('task_number');
  return data || [];
}

// Get expected task count for stage
static async getExpectedTaskCount(stageId, practiceAreaId) {
  const PROBATE_ID = 45045123;
  const table = practiceAreaId === PROBATE_ID ? 'task-list-probate' : 'task-list-non-meeting';

  const { data } = await supabase
    .from(table)
    .select('task_number')
    .eq('stage_id', stageId)
    .eq('active', true);

  return {
    count: data?.length || 0,
    expectedTaskNumbers: (data || []).map(t => t.task_number)
  };
}
```

---

#### Assignee Lookup Methods

```javascript
// Get assignee by location
static async getAssigneeByLocation(location) {
  const { data } = await supabase
    .from('assigned_user_reference')
    .select('user_id, user_name')
    .eq('lookup_type', 'location')
    .ilike('lookup_value', location)
    .eq('active', true)
    .single();
  return data ? { id: data.user_id, name: data.user_name } : null;
}

// Get assignee by attorney ID (for paralegal)
static async getAssigneeByAttorneyId(attorneyId) {
  const { data } = await supabase
    .from('assigned_user_reference')
    .select('user_id, user_name')
    .eq('lookup_type', 'attorney_id')
    .eq('lookup_value', attorneyId.toString())
    .eq('active', true)
    .single();
  return data ? { id: data.user_id, name: data.user_name } : null;
}

// Get assignee from fund table by attorney ID
static async getAssigneeByAttorneyFundTable(attorneyId) {
  const { data } = await supabase
    .from('assigned_user_reference')
    .select('user_id, user_name')
    .eq('lookup_type', 'fund_table')
    .eq('lookup_value', attorneyId.toString())
    .eq('active', true)
    .single();
  return data ? { id: data.user_id, name: data.user_name } : null;
}

// Get valid location keywords
static async getLocationKeywords() {
  const { data } = await supabase
    .from('location_keywords')
    .select('keyword')
    .eq('active', true);
  return (data || []).map(row => row.keyword);
}
```

---

#### Matter Methods

```javascript
// Get matter history (for rollback detection)
static async getMatterHistory(matterId, minutesAgo) {
  const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('matters')
    .select('*')
    .eq('matter_id', matterId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });
  return data || [];
}

// Insert matter history record
static async insertMatterHistory(record) {
  await supabase.from('matters').insert(record);
}

// Upsert current matter info
static async upsertMatterInfo(matterInfo) {
  await supabase
    .from('matter-info')
    .upsert(matterInfo, { onConflict: 'matter_id' });
}
```

---

#### Calendar/Meeting Methods

```javascript
// Get calendar event mapping by stage
static async getCalendarEventMappingByStage(stageId) {
  const { data } = await supabase
    .from('calendar_event_mappings')
    .select('*')
    .eq('stage_id', stageId)
    .eq('active', true)
    .single();
  return data;
}

// Get meeting date for matter
static async getMeetingDate(matterId, calendarEntryId) {
  const { data } = await supabase
    .from('matters-meetings-booked')
    .select('meeting_date')
    .eq('matter_id', matterId)
    .eq('calendar_entry_id', calendarEntryId)
    .single();
  return data?.meeting_date;
}

// Record meeting booking
static async upsertMeetingBooking(meetingRecord) {
  await supabase
    .from('matters-meetings-booked')
    .upsert(meetingRecord, { onConflict: 'calendar_entry_id' });
}
```

---

#### Configuration Methods

```javascript
// Get attempt sequence
static async getAttemptSequence(taskName) {
  const { data } = await supabase
    .from('attempt_sequences')
    .select('*')
    .ilike('task_name_pattern', `%${taskName}%`)
    .eq('active', true)
    .single();
  return data;
}

// Get matter status by stage
static async getMatterStatusByStage(stageId) {
  const { data } = await supabase
    .from('stage_status_mappings')
    .select('matter_status')
    .eq('stage_id', stageId)
    .eq('active', true)
    .single();
  return data?.matter_status;
}

// Get automation config value
static async getAutomationConfig(key) {
  const { data } = await supabase
    .from('automation_config')
    .select('config_value')
    .eq('config_key', key)
    .single();
  return data?.config_value;
}
```

---

#### Error Logging

```javascript
// Log error to database
static async logError(errorCode, errorMessage, context = {}) {
  try {
    await supabase.from('error_logs').insert({
      error_code: errorCode,
      error_message: errorMessage,
      context: context,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to log error:', error.message);
  }
}
```

---

## Token Refresh Service

**File:** `src/services/token-refresh.js`

### Purpose
Manage OAuth tokens for Clio API access.

### Properties

```javascript
export class TokenRefreshService {
  static tokenExpiresAt = null;
  static isRefreshing = false;
}
```

### Methods

#### initialize()
Load tokens from Supabase on startup.

```javascript
static async initialize() {
  const { data } = await supabase
    .from('clio_tokens')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (data) {
    config.clio.accessToken = data.access_token;
    config.clio.refreshToken = data.refresh_token;
    this.tokenExpiresAt = new Date(data.expires_at);
    console.log(`Token loaded, expires: ${this.tokenExpiresAt.toISOString()}`);
  }
}
```

---

#### checkAndRefresh()
Check if token needs refresh (expires within 24 hours).

```javascript
static async checkAndRefresh() {
  const now = new Date();
  const hoursUntilExpiry = (this.tokenExpiresAt - now) / (1000 * 60 * 60);

  if (hoursUntilExpiry < 24) {
    await this.refreshAccessToken();
    return true;
  }

  return false;
}
```

---

#### refreshAccessToken()
Refresh the OAuth token.

```javascript
static async refreshAccessToken() {
  if (this.isRefreshing) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return;
  }

  this.isRefreshing = true;

  try {
    const response = await axios.post('https://app.clio.com/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: config.clio.refreshToken,
      client_id: config.clio.clientId,
      client_secret: config.clio.clientSecret
    });

    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Update config
    config.clio.accessToken = access_token;
    config.clio.refreshToken = refresh_token;
    this.tokenExpiresAt = expiresAt;

    // Save to Supabase
    await supabase.from('clio_tokens').upsert({
      id: 1,
      access_token,
      refresh_token,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString()
    });

    console.log(`Token refreshed, new expiry: ${expiresAt.toISOString()}`);

    return { access_token, refresh_token, expires_at: expiresAt };
  } finally {
    this.isRefreshing = false;
  }
}
```

---

## Task Verification Service

**File:** `src/services/task-verification.js`

### Purpose
Verify that all expected tasks were created after stage change or meeting scheduling.

### Methods

#### verifyTaskGeneration(params)
Main verification method.

```javascript
static async verifyTaskGeneration({
  matterId,
  stageId,
  stageName,
  practiceAreaId,
  matterDetails,
  expectedCount,
  context = 'stage_change',
  calendarEntryId = null
}) {
  console.log(`[VERIFY] Waiting 30 seconds...`);
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Get expected task numbers
  const { expectedTaskNumbers } = context === 'meeting_scheduled'
    ? await SupabaseService.getExpectedMeetingTaskCount(calendarEventId)
    : await SupabaseService.getExpectedTaskCount(stageId, practiceAreaId);

  // Get actual tasks created
  const actualTasks = await SupabaseService.getRecentTasksByMatterAndStage(
    matterId, stageId, 1
  );

  // Find missing
  const existingNumbers = actualTasks.map(t => t.task_number);
  const missingNumbers = expectedTaskNumbers.filter(
    num => !existingNumbers.includes(num)
  );

  if (missingNumbers.length === 0) {
    return { success: true, tasksVerified: actualTasks.length };
  }

  // Regenerate missing
  const regenerated = await this._regenerateMissingTasks({
    matterId, stageId, stageName, practiceAreaId,
    matterDetails, missingTaskNumbers: missingNumbers
  });

  return {
    success: regenerated.failed === 0,
    tasksVerified: actualTasks.length,
    tasksRegenerated: regenerated.success,
    failures: regenerated.failures
  };
}
```

---

#### _regenerateMissingTasks(params)
Regenerate specific tasks that were not created.

```javascript
static async _regenerateMissingTasks({
  matterId, stageId, stageName, practiceAreaId,
  matterDetails, missingTaskNumbers
}) {
  let success = 0;
  let failed = 0;
  const failures = [];

  // Get templates for missing task numbers
  const templates = await this._getTemplates(stageId, practiceAreaId);
  const toRegenerate = templates.filter(t =>
    missingTaskNumbers.includes(t.task_number)
  );

  for (const template of toRegenerate) {
    try {
      const assignee = await resolveAssignee(template.assignee, matterDetails);
      const dueDate = calculateDueDate(template);

      const newTask = await ClioService.createTask({
        name: template.task_title,
        description: template['task-description'],
        matter: { id: matterId },
        assignee: { id: assignee.id, type: 'User' },
        due_at: formatForClio(dueDate)
      });

      await SupabaseService.insertTask({
        task_id: newTask.id,
        task_name: newTask.name,
        matter_id: matterId,
        stage_id: stageId,
        task_number: template.task_number,
        verification_attempted: true
      });

      success++;
    } catch (error) {
      failed++;
      failures.push({
        task_number: template.task_number,
        error: error.message
      });
    }
  }

  return { success, failed, failures };
}
```

---

## Related Documentation

- [00-OVERVIEW.md](./00-OVERVIEW.md) - System overview
- [04-DATABASE-SCHEMA.md](./04-DATABASE-SCHEMA.md) - Database tables
- [07-UTILITIES.md](./07-UTILITIES.md) - Utility functions
