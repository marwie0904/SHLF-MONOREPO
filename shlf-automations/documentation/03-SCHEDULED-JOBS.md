# Scheduled Jobs Documentation

## Table of Contents
- [Overview](#overview)
- [Job Scheduler](#job-scheduler)
- [Job 1: Token Refresh](#job-1-token-refresh)
- [Job 2: Webhook Renewal](#job-2-webhook-renewal)
- [Job 3: Stale Matter Checker](#job-3-stale-matter-checker)
- [Manual Job Execution](#manual-job-execution)

---

## Overview

The system runs 3 scheduled jobs via `node-cron`:

| Job | Schedule | Timezone | Purpose |
|-----|----------|----------|---------|
| Token Refresh | 1:00 AM | America/New_York | Refresh Clio OAuth tokens |
| Webhook Renewal | 2:00 AM | America/New_York | Renew expiring webhooks |
| Stale Matter Checker | 3:00 AM | America/New_York | Create tasks for stuck matters |

---

## Job Scheduler

**File:** `src/jobs/scheduler.js`

### Initialization

The scheduler is initialized when the server starts:

```javascript
// src/index.js
import { JobScheduler } from './jobs/scheduler.js';

// Start all scheduled jobs
JobScheduler.start();
```

### Cron Expressions

| Expression | Meaning |
|------------|---------|
| `0 1 * * *` | Every day at 1:00 AM |
| `0 2 * * *` | Every day at 2:00 AM |
| `0 3 * * *` | Every day at 3:00 AM |

### Job Management

```javascript
// Start all jobs
JobScheduler.start();

// Stop all jobs
JobScheduler.stop();

// Run a specific job manually
await JobScheduler.runJob('token-refresh');
await JobScheduler.runJob('webhook-renewal');
await JobScheduler.runJob('stale-matter-checker');
```

---

## Job 1: Token Refresh

**File:** `src/jobs/refresh-token.js`

### Purpose
Proactively refresh Clio OAuth access tokens before they expire.

### Schedule
- **Time:** 1:00 AM EST daily
- **Cron:** `0 1 * * *`

### Token Lifecycle

```
DAY 0: Token issued (7-day lifespan)
       └── expires_at = NOW + 7 days

DAY 6: Token Refresh Job runs
       └── Check: expires_at - NOW < 24 hours?
       └── YES: Refresh token
       └── New token issued (another 7 days)

DAY 7: (If not refreshed) Token expires
       └── API calls fail with 401
       └── Auto-refresh kicks in (service layer)
```

### Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: CHECK TOKEN EXPIRATION                               │
│ - Get token_expires_at from config                           │
│ - Calculate time until expiry                                │
└─────────────────────────────┬───────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            │                                   │
    (> 24 hours)                        (< 24 hours)
            │                                   │
            ▼                                   ▼
┌─────────────────────┐            ┌─────────────────────────────┐
│ SKIP - No refresh   │            │ STEP 2: REFRESH TOKEN        │
│ needed              │            │ - POST to Clio OAuth endpoint│
└─────────────────────┘            │ - Use refresh_token          │
                                   │ - Get new access_token       │
                                   └─────────────────┬───────────┘
                                                     │
                                                     ▼
                                   ┌─────────────────────────────┐
                                   │ STEP 3: UPDATE TOKEN         │
                                   │ - Update Supabase clio_tokens│
                                   │ - Update process.env         │
                                   │ - Update config in memory    │
                                   └─────────────────────────────┘
```

### Token Storage

Tokens are stored in the `clio_tokens` table:

```sql
CREATE TABLE clio_tokens (
  id SERIAL PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### OAuth Refresh Request

```javascript
// POST https://app.clio.com/oauth/token
{
  grant_type: 'refresh_token',
  refresh_token: '{current_refresh_token}',
  client_id: '{CLIO_CLIENT_ID}',
  client_secret: '{CLIO_CLIENT_SECRET}'
}
```

### Response

```json
{
  "access_token": "new_access_token_here",
  "refresh_token": "new_refresh_token_here",
  "token_type": "Bearer",
  "expires_in": 604800
}
```

---

## Job 2: Webhook Renewal

**File:** `src/jobs/renew-webhooks.js`

### Purpose
Automatically renew Clio webhooks before they expire.

### Schedule
- **Time:** 2:00 AM EST daily
- **Cron:** `0 2 * * *`

### Webhook Lifecycle

```
DAY 0: Webhook created (28-day lifespan)
       └── expires_at = NOW + 28 days

DAY 14: Webhook Renewal Job detects expiring webhook
        └── expires_at - NOW < 14 days
        └── Renew webhook

RENEWED: New expiry = NOW + 28 days
```

### Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: FETCH ALL WEBHOOKS                                   │
│ - GET /api/v4/webhooks.json                                  │
│ - Get id, model, events, url, status, expires_at             │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: FILTER EXPIRING WEBHOOKS                             │
│ - expires_at within 14 days                                  │
│ - status != "suspended"                                      │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: RENEW EACH WEBHOOK                                   │
│ - PUT /api/v4/webhooks/{id}.json                             │
│ - Set expires_at = NOW + 28 days                             │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: REPORT RESULTS                                       │
│ - Count renewed, failed                                      │
│ - Log details                                                │
└─────────────────────────────────────────────────────────────┘
```

### Renewal Request

```javascript
// PUT https://app.clio.com/api/v4/webhooks/{id}.json
{
  "data": {
    "expires_at": "2024-02-15T00:00:00.000Z"
  }
}
```

### Registered Webhooks

| Model | Events | Endpoint |
|-------|--------|----------|
| Matter | updated | `/webhooks/matters` |
| Task | updated | `/webhooks/tasks` |
| CalendarEntry | created, updated | `/webhooks/calendar` |
| Document | created | `/webhooks/documents` |

---

## Job 3: Stale Matter Checker

**File:** `src/jobs/check-stale-matters.js`

### Purpose
Create reminder tasks for matters that have been stuck in a stage for too long.

### Schedule
- **Time:** 3:00 AM EST daily
- **Cron:** `0 3 * * *`

### Task Types

| Type | Trigger | Task Name | Due Date | Assignee |
|------|---------|-----------|----------|----------|
| Initial | 30 days in ANY stage | "Action Required: MATTER HAS NO PROGRESS - PLEASE REVIEW" | 6 business days | User 357379471 |
| Recurring | Every 30 days in "Funding in Progress" | "30 Day Notification" | 7 business days | User 357378676 |

### Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: GET ALL MATTERS WITH STAGES                          │
│ - Query tasks table for unique matter_id + stage_name        │
│ - Filter by test mode if enabled                             │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: FOR EACH MATTER                                      │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2.1: CHECK MATTER STATUS                                │
│ - Fetch from Clio API                                        │
│ - If "Closed": Skip                                          │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2.2: GET/CREATE TRACKING RECORD                         │
│ - Query matter_stage_tracking table                          │
│ - If not found: Create with stage_entered_at from Clio       │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2.3: CALCULATE DAYS IN STAGE                            │
│ - NOW - stage_entered_at                                     │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2.4: CHECK INITIAL NOTIFICATION                         │
│ - If NOT sent AND days >= 30:                                │
│   - Create "MATTER HAS NO PROGRESS" task                     │
│   - Update tracking: initial_notification_sent = true        │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2.5: CHECK RECURRING NOTIFICATION                       │
│ - ONLY for "Funding in Progress" stage                       │
│ - If initial sent AND 30+ days since last notification:      │
│   - Create "30 Day Notification" task                        │
│   - Update tracking: last_recurring_notification_at = NOW    │
└─────────────────────────────────────────────────────────────┘
```

### Tracking Table

```sql
CREATE TABLE matter_stage_tracking (
  id SERIAL PRIMARY KEY,
  matter_id BIGINT NOT NULL,
  stage_name TEXT NOT NULL,
  stage_entered_at TIMESTAMP WITH TIME ZONE NOT NULL,
  initial_notification_sent BOOLEAN DEFAULT FALSE,
  initial_notification_sent_at TIMESTAMP WITH TIME ZONE,
  last_recurring_notification_at TIMESTAMP WITH TIME ZONE,
  recurring_notification_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(matter_id, stage_name)
);
```

### Task Details

**Initial Alert Task:**
```javascript
{
  name: "Action Required: MATTER HAS NO PROGRESS - PLEASE REVIEW",
  description: "This is an automated task. Matter stage has not changed for more than a month. Please close or move to the correct stage.",
  assignee: { id: 357379471, type: "User" },
  due_at: addBusinessDays(NOW, 6)
}
```

**Recurring Alert Task:**
```javascript
{
  name: "30 Day Notification",
  description: "This is an auto-generated task triggered every 30 days while the matter remains in the 'Funding in Progress' stage. Please review and either progress the matter or close it out if appropriate.",
  assignee: { id: 357378676, type: "User" },
  due_at: addBusinessDays(NOW, 7)
}
```

---

## Manual Job Execution

### Via npm Scripts

```bash
# Run token refresh
npm run job:token-refresh

# Run webhook renewal
npm run job:webhook-renewal

# Run stale matter checker
npm run job:stale-matters
```

### Via Code

```javascript
import { JobScheduler } from './src/jobs/scheduler.js';

// Run specific job
await JobScheduler.runJob('token-refresh');
await JobScheduler.runJob('webhook-renewal');
await JobScheduler.runJob('stale-matter-checker');
```

### Via Direct Script Execution

```bash
# Token refresh
node src/jobs/refresh-token.js

# Webhook renewal
node src/jobs/renew-webhooks.js

# Stale matter checker
node src/jobs/check-stale-matters.js
```

---

## Job Logging

All jobs output structured logs:

```
========================================
🔐 TOKEN REFRESH JOB STARTED
========================================

✅ Token expires in 5 days - refresh needed
🔄 Refreshing token...
✅ New token obtained
✅ Token saved to Supabase
✅ Environment updated

========================================
✅ TOKEN REFRESH JOB COMPLETED - Token was refreshed
⏱️  Duration: 1234ms
========================================
```

---

## Error Handling

### Job Failures

Jobs are designed to:
1. Log errors but not crash the server
2. Continue with next item if one fails
3. Return structured results

```javascript
try {
  await JobClass.run();
} catch (error) {
  console.error('[SCHEDULER] Job failed:', error);
  // Don't rethrow - let other jobs continue
}
```

### Monitoring

Check job status via logs or implement monitoring:

```javascript
// Example job result
{
  success: true,
  renewed: 3,
  failed: 0,
  results: [
    { webhookId: 123, success: true, newExpiry: "2024-02-15T00:00:00Z" },
    { webhookId: 456, success: true, newExpiry: "2024-02-15T00:00:00Z" },
    { webhookId: 789, success: true, newExpiry: "2024-02-15T00:00:00Z" }
  ]
}
```

---

## Related Documentation

- [00-OVERVIEW.md](./00-OVERVIEW.md) - System overview
- [06-SERVICES.md](./06-SERVICES.md) - Service layer (token refresh service)
