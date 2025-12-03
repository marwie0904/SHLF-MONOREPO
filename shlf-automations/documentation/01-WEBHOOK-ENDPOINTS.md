# Webhook Endpoints Documentation

## Table of Contents
- [Overview](#overview)
- [Incoming Webhooks (From Clio)](#incoming-webhooks-from-clio)
- [Outgoing API Calls (To Clio)](#outgoing-api-calls-to-clio)
- [Webhook Security](#webhook-security)
- [Webhook Queue System](#webhook-queue-system)

---

## Overview

The automation system receives webhooks from Clio Manage and makes outgoing API calls back to Clio. All webhook endpoints are defined in `src/routes/webhooks.js`.

### Base URL
```
https://your-server.com/webhooks
```

---

## Incoming Webhooks (From Clio)

### 1. Matter Webhooks

**Endpoint:** `POST /webhooks/matters`

**Triggers:**
- Matter stage changes
- Matter status changes (e.g., closed)

**Webhook Payload Structure:**
```json
{
  "id": "webhook-event-uuid",
  "model": "Matter",
  "event": "updated",
  "occurred_at": "2024-01-15T10:30:00Z",
  "data": {
    "id": 12345678,
    "display_number": "00001-Smith",
    "status": "Open",
    "updated_at": "2024-01-15T10:30:00Z",
    "matter_stage": {
      "id": 67890,
      "name": "Client Intake"
    },
    "matter_stage_updated_at": "2024-01-15T10:30:00Z",
    "user": {
      "id": 111222,
      "name": "John Doe"
    }
  }
}
```

**Processing Logic:**
1. Check for stage change vs status change
2. If stage changed → `MatterStageChangeAutomation`
3. If status changed to "Closed" → `MatterClosedAutomation`

**File:** `src/routes/webhooks.js:67-150`

---

### 2. Task Webhooks

**Endpoint:** `POST /webhooks/tasks`

**Triggers:**
- Task completed
- Task deleted

**Webhook Payload Structure:**
```json
{
  "id": "webhook-event-uuid",
  "model": "Task",
  "event": "updated",
  "occurred_at": "2024-01-15T10:30:00Z",
  "data": {
    "id": 98765432,
    "name": "Review Documents",
    "status": "complete",
    "completed_at": "2024-01-15T10:30:00Z",
    "deleted_at": null,
    "matter": {
      "id": 12345678
    },
    "assignee": {
      "id": 111222,
      "type": "User"
    }
  }
}
```

**Processing Logic:**
1. If `deleted_at` present → `TaskDeletedAutomation`
2. If `status === "complete"` → `TaskCompletionAutomation`

**File:** `src/routes/webhooks.js:152-230`

---

### 3. Calendar Webhooks

**Endpoint:** `POST /webhooks/calendar`

**Triggers:**
- Calendar entry created
- Calendar entry updated
- Calendar entry deleted

**Webhook Payload Structure:**
```json
{
  "id": "webhook-event-uuid",
  "model": "CalendarEntry",
  "event": "created",
  "occurred_at": "2024-01-15T10:30:00Z",
  "data": {
    "id": 55566677,
    "summary": "Signing Meeting",
    "start_at": "2024-01-20T14:00:00Z",
    "end_at": "2024-01-20T15:00:00Z",
    "location": "123 Main St, Fort Myers, FL",
    "deleted_at": null,
    "calendar_entry_event_type": {
      "id": 789012,
      "name": "Signing"
    },
    "matter": {
      "id": 12345678
    }
  }
}
```

**Processing Logic:**
1. If `deleted_at` present → `CalendarEntryDeletedAutomation`
2. If created/updated → `MeetingScheduledAutomation`

**File:** `src/routes/webhooks.js:232-320`

---

### 4. Document Webhooks

**Endpoint:** `POST /webhooks/documents`

**Triggers:**
- Document created in Clio Drive

**Webhook Payload Structure:**
```json
{
  "id": "webhook-event-uuid",
  "model": "Document",
  "event": "created",
  "occurred_at": "2024-01-15T10:30:00Z",
  "data": {
    "id": 44455566,
    "name": "Contract.pdf",
    "created_at": "2024-01-15T10:30:00Z",
    "matter": {
      "id": 12345678
    }
  }
}
```

**Processing Logic:**
1. Validate document has matter association
2. Check if document is in root folder (not subfolder)
3. Create "New Clio Drive Document Save to OD" task

**File:** `src/routes/webhooks.js:322-380`

---

### 5. Health Check

**Endpoint:** `GET /webhooks/health`

**Purpose:** Health check endpoint for monitoring

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### 6. Queue Statistics

**Endpoint:** `GET /webhooks/queue-stats`

**Purpose:** Monitor webhook processing queue status

**Response:**
```json
{
  "totalMatters": 2,
  "matters": [
    {
      "matterId": 12345678,
      "queueSize": 3,
      "processing": true
    },
    {
      "matterId": 87654321,
      "queueSize": 0,
      "processing": false
    }
  ]
}
```

---

## Outgoing API Calls (To Clio)

The system makes the following API calls to Clio:

### Task Operations

| Operation | Method | Endpoint | Service Method |
|-----------|--------|----------|----------------|
| Create Task | POST | `/api/v4/tasks.json` | `ClioService.createTask()` |
| Get Task | GET | `/api/v4/tasks/{id}.json` | `ClioService.getTask()` |
| Update Task | PATCH | `/api/v4/tasks/{id}.json` | `ClioService.updateTask()` |
| Delete Task | DELETE | `/api/v4/tasks/{id}.json` | `ClioService.deleteTask()` |
| Get Tasks by Matter | GET | `/api/v4/tasks.json?matter_id={id}` | `ClioService.getTasksByMatter()` |

### Matter Operations

| Operation | Method | Endpoint | Service Method |
|-----------|--------|----------|----------------|
| Get Matter | GET | `/api/v4/matters/{id}.json` | `ClioService.getMatter()` |
| Update Matter | PATCH | `/api/v4/matters/{id}.json` | `ClioService.updateMatter()` |
| Get Bills | GET | `/api/v4/bills.json?matter_id={id}` | `ClioService.getBillsByMatter()` |

### Calendar Operations

| Operation | Method | Endpoint | Service Method |
|-----------|--------|----------|----------------|
| Get Calendar Entry | GET | `/api/v4/calendar_entries/{id}.json` | `ClioService.getCalendarEntry()` |
| Create Calendar Entry | POST | `/api/v4/calendar_entries.json` | `ClioService.createCalendarEntry()` |

### Document Operations

| Operation | Method | Endpoint | Service Method |
|-----------|--------|----------|----------------|
| Get Document | GET | `/api/v4/documents/{id}.json` | `ClioService.getDocument()` |

### Webhook Operations

| Operation | Method | Endpoint | Service Method |
|-----------|--------|----------|----------------|
| List Webhooks | GET | `/api/v4/webhooks.json` | `WebhookRenewalJob.fetchWebhooks()` |
| Update Webhook | PUT | `/api/v4/webhooks/{id}.json` | `WebhookRenewalJob.renewWebhook()` |

---

## Webhook Security

### Signature Validation

**File:** `src/middleware/validate-signature.js`

Clio webhooks include an HMAC-SHA256 signature for verification:

```
Header: X-Clio-Signature: sha256=<signature>
```

**Validation Process:**
1. Extract signature from `X-Clio-Signature` header
2. Compute HMAC-SHA256 of raw request body using webhook secret
3. Compare signatures using timing-safe comparison
4. Reject if signatures don't match

**Current Status:** Signature validation is currently disabled during testing.

### Webhook Activation

New webhooks require activation. When a webhook is first created, Clio sends a test request with:
```
Header: X-Hook-Secret: <activation-secret>
```

The server must respond with this secret to activate the webhook.

---

## Webhook Queue System

**File:** `src/utils/webhook-queue.js`

### Purpose
Prevents race conditions when multiple webhooks arrive for the same matter simultaneously.

### How It Works

```
Matter 123 receives webhook A
  │
  ├─► Queue webhook A for matter 123
  │   └─► Start processing A
  │
Matter 123 receives webhook B (while A processing)
  │
  ├─► Queue webhook B for matter 123
  │   └─► Wait in queue...
  │
Webhook A completes
  │
  └─► Process webhook B
```

### Queue Behavior

1. **Matter ID Extraction:**
   - Direct matter webhook: `webhookData.data.id`
   - Task/calendar webhook: `webhookData.data.matter.id`

2. **Sequential Processing:**
   - One webhook per matter at a time
   - Different matters process in parallel

3. **Queue Cleanup:**
   - Empty queues are removed
   - No memory leak from accumulating queues

### Monitoring

Use the `/webhooks/queue-stats` endpoint to monitor queue status.

---

## Webhook Registration in Clio

Webhooks are registered in Clio using utility scripts in `utilities/webhooks/`:

| Script | Purpose |
|--------|---------|
| `create-matter-webhook.mjs` | Register matter webhook |
| `create-task-webhook.mjs` | Register task webhook |
| `create-calendar-webhook-v3.mjs` | Register calendar webhook |
| `create-document-webhook.mjs` | Register document webhook |
| `list-all-webhooks.mjs` | List all registered webhooks |
| `get-webhook-details.mjs` | Get webhook details |

### Webhook Configuration

When creating webhooks in Clio:

```json
{
  "data": {
    "url": "https://your-server.com/webhooks/matters",
    "fields": "id,display_number,status,matter_stage,matter_stage_updated_at,updated_at,user",
    "events": ["updated"],
    "model": "Matter",
    "expires_at": "2024-02-15T00:00:00Z"
  }
}
```

### Webhook Expiration

- Clio webhooks expire after a set date
- The `WebhookRenewalJob` automatically renews webhooks expiring within 2 weeks
- Renewal extends expiration by 28 days

---

## Error Handling

### Retry Logic

Each webhook endpoint implements 3x retry with 1-second delays:

```javascript
const MAX_RETRIES = 3;

async function processWithRetry(processor, webhookData) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await processor(webhookData);
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}
```

### Error Responses

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Invalid webhook payload |
| 401 | Invalid signature |
| 500 | Processing error |

### Error Logging

All errors are logged to:
1. Console output
2. Supabase `error_logs` table

---

## Related Documentation

- [00-OVERVIEW.md](./00-OVERVIEW.md) - System overview
- [02-AUTOMATIONS.md](./02-AUTOMATIONS.md) - Automation details
- [05-ERROR-HANDLING.md](./05-ERROR-HANDLING.md) - Error codes
