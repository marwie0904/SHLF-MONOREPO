# Utilities Documentation

## Table of Contents
- [Overview](#overview)
- [Webhook Queue](#webhook-queue)
- [Assignee Resolver](#assignee-resolver)
- [Date Helpers](#date-helpers)
- [Assignee Error Class](#assignee-error-class)

---

## Overview

The utilities provide reusable functions across the automation system:

| Utility | File | Purpose |
|---------|------|---------|
| Webhook Queue | `src/utils/webhook-queue.js` | Per-matter sequential processing |
| Assignee Resolver | `src/utils/assignee-resolver.js` | Dynamic assignee lookup |
| Date Helpers | `src/utils/date-helpers.js` | Date calculations |
| Assignee Error | `src/utils/assignee-error.js` | Custom error class |

---

## Webhook Queue

**File:** `src/utils/webhook-queue.js`

### Purpose
Prevent race conditions when multiple webhooks arrive for the same matter simultaneously.

### Problem Solved

Without queueing:
```
10:00:00.000 - Webhook A arrives for Matter 123
10:00:00.050 - Webhook B arrives for Matter 123
10:00:00.100 - Both start processing simultaneously
10:00:01.000 - Both create duplicate tasks!
```

With queueing:
```
10:00:00.000 - Webhook A arrives for Matter 123 → Starts processing
10:00:00.050 - Webhook B arrives for Matter 123 → Queued
10:00:01.000 - Webhook A completes
10:00:01.001 - Webhook B starts processing
10:00:02.000 - Webhook B completes
```

### Class: WebhookQueue

```javascript
class WebhookQueue {
  constructor() {
    this.queues = new Map();     // matter_id → [queued items]
    this.processing = new Map(); // matter_id → boolean
  }
}
```

### Methods

#### extractMatterId(webhookData)
Extract matter ID from different webhook types.

```javascript
extractMatterId(webhookData) {
  // Direct matter webhook
  if (webhookData.model === 'Matter') {
    return webhookData.data.id;
  }

  // Task or calendar webhook - matter is nested
  if (webhookData.data?.matter?.id) {
    return webhookData.data.matter.id;
  }

  return null;
}
```

---

#### enqueue(webhookData, processor)
Add webhook to queue and return promise.

```javascript
async enqueue(webhookData, processor) {
  const matterId = this.extractMatterId(webhookData);

  // No matter ID - process immediately
  if (!matterId) {
    return await processor();
  }

  // Initialize queue for this matter
  if (!this.queues.has(matterId)) {
    this.queues.set(matterId, []);
    this.processing.set(matterId, false);
  }

  // Return promise that resolves when processed
  return new Promise((resolve, reject) => {
    this.queues.get(matterId).push({
      processor,
      resolve,
      reject,
      webhookId: webhookData.id
    });

    // Start processing if not already
    this.processNext(matterId);
  });
}
```

---

#### processNext(matterId)
Process next item in queue.

```javascript
async processNext(matterId) {
  // Already processing?
  if (this.processing.get(matterId)) {
    return;
  }

  const queue = this.queues.get(matterId);

  // Queue empty - cleanup
  if (!queue || queue.length === 0) {
    this.queues.delete(matterId);
    this.processing.delete(matterId);
    return;
  }

  // Get next item
  const item = queue.shift();

  // Mark as processing
  this.processing.set(matterId, true);

  try {
    const result = await item.processor();
    item.resolve(result);
  } catch (error) {
    item.reject(error);
  } finally {
    this.processing.set(matterId, false);
    setImmediate(() => this.processNext(matterId));
  }
}
```

---

#### getStats()
Get queue statistics for monitoring.

```javascript
getStats() {
  const stats = {
    totalMatters: this.queues.size,
    matters: []
  };

  for (const [matterId, queue] of this.queues.entries()) {
    stats.matters.push({
      matterId,
      queueSize: queue.length,
      processing: this.processing.get(matterId)
    });
  }

  return stats;
}
```

### Usage

```javascript
import { webhookQueue } from '../utils/webhook-queue.js';

// In webhook handler
router.post('/matters', async (req, res) => {
  const result = await webhookQueue.enqueue(
    req.body,
    async () => {
      return await MatterStageChangeAutomation.process(req.body);
    }
  );

  res.json(result);
});
```

---

## Assignee Resolver

**File:** `src/utils/assignee-resolver.js`

### Purpose
Dynamically resolve assignee IDs based on type, location, attorney, or role.

### Assignee Types

| Type | Resolution Method |
|------|-------------------|
| `CSC` | Look up by matter/meeting location |
| `PARALEGAL` | Look up by attorney ID |
| `ATTORNEY` | Use matter's responsible/originating attorney |
| `FUND TABLE` / `FUND_TABLE` | Look up by attorney ID in fund table |
| `FUNDING_COOR` | Use direct assignee_id from template |
| `VA` | Hardcoded user 357379471 |
| Numeric | Direct user ID |

### Main Function: resolveAssignee()

```javascript
export async function resolveAssignee(
  assigneeType,
  matterData,
  meetingLocation = null,
  lookupReference = null,
  requireMeetingLocation = false
) {
  const type = assigneeType?.toString().toUpperCase().trim();

  // Handle lookup by reference
  if (lookupReference?.toLowerCase() === 'location') {
    return await resolveByLocation(matterData, meetingLocation, requireMeetingLocation);
  }

  if (lookupReference?.toLowerCase() === 'attorney') {
    return resolveByAttorney(matterData);
  }

  // Handle specific types
  switch (type) {
    case 'CSC':
      return await resolveCSC(matterData, meetingLocation, requireMeetingLocation);

    case 'PARALEGAL':
      return await resolveParalegal(matterData);

    case 'ATTORNEY':
      return resolveByAttorney(matterData);

    case 'FUND TABLE':
    case 'FUND_TABLE':
      return await resolveFundTable(matterData);

    case 'FUNDING_COOR':
      return resolveFundingCoordinator(lookupReference);

    case 'VA':
      return { id: 357379471, name: 'Jacqui', type: 'User' };

    default:
      // Check if numeric
      if (!isNaN(assigneeType)) {
        return { id: parseInt(assigneeType), name: 'Direct Assignment', type: 'User' };
      }

      throw new AssigneeError(
        ERROR_CODES.ASSIGNEE_INVALID_TYPE,
        `Invalid assignee type: "${assigneeType}"`
      );
  }
}
```

### Location Keyword Extraction

```javascript
async function extractLocationKeyword(locationString) {
  if (!locationString) return null;

  // Get valid keywords from database
  const keywords = await SupabaseService.getLocationKeywords();

  // Build regex pattern
  const pattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'i');
  const match = locationString.match(pattern);

  return match ? match[1].toLowerCase() : null;
}

// Example:
// "123 Main St, Fort Myers, FL 33901" → "fort myers"
// "Tampa Bay Convention Center" → "tampa"
```

### CSC Resolution

```javascript
async function resolveCSC(matterData, meetingLocation, requireMeetingLocation) {
  let location;

  if (requireMeetingLocation) {
    if (!meetingLocation) {
      throw new AssigneeError(ERROR_CODES.MEETING_NO_LOCATION, 'Meeting location required');
    }
    location = meetingLocation;
  } else {
    location = meetingLocation || matterData.location;
  }

  // If using meeting location, extract keyword
  if (meetingLocation) {
    const keyword = await extractLocationKeyword(meetingLocation);
    if (!keyword) {
      throw new AssigneeError(ERROR_CODES.MEETING_INVALID_LOCATION,
        `Invalid location: ${meetingLocation}`);
    }
    location = keyword;
  }

  const assignee = await SupabaseService.getAssigneeByLocation(location);
  if (!assignee) {
    throw new AssigneeError(ERROR_CODES.ASSIGNEE_NO_CSC, `No CSC for: ${location}`);
  }

  return { id: assignee.id, name: assignee.name, type: 'User' };
}
```

### Error Task Creation

```javascript
export function createAssigneeErrorTask(matterData, stageId, errorMessage) {
  const attorney = matterData.responsible_attorney || matterData.originating_attorney;

  return {
    name: `Assignment Error - ${matterData.display_number}`,
    description: `Unable to generate tasks for stage. ${errorMessage}`,
    matter: { id: matterData.id },
    assignee: attorney ? { id: attorney.id, type: 'User' } : undefined,
    due_at: new Date().toISOString(),
    priority: 'high'
  };
}
```

---

## Date Helpers

**File:** `src/utils/date-helpers.js`

### Purpose
Handle date calculations with timezone awareness and weekend protection.

### Timezone Handling

All calculations use EST/EDT timezone (Florida time):

```javascript
import { config } from '../config/index.js';

// config.automation.timezoneOffsetHours = 4 (UTC-4 for EDT) or 5 (UTC-5 for EST)

export function getNowInEST() {
  const now = new Date();
  return addHours(now, -config.automation.timezoneOffsetHours);
}
```

### Main Function: calculateDueDate()

```javascript
export function calculateDueDate(taskTemplate, referenceDate = new Date(), relation = 'creation') {
  // Use EST for current time calculations
  let dueDate;
  const now = new Date();

  if (Math.abs(now - referenceDate) < 1000) {
    dueDate = getNowInEST();
  } else {
    dueDate = new Date(referenceDate);
  }

  // Get template values
  const value = parseInt(taskTemplate.due_date_value ||
                         taskTemplate['due_date-value-only'] ||
                         taskTemplate['due_date-value'] || 0);

  const timeRelation = taskTemplate.due_date_time_relation ||
                       taskTemplate['due_date-time-relation'] || 'days';

  const relationType = taskTemplate.due_date_relation ||
                       taskTemplate['due_date-relational'] || 'after creation';

  // Apply offset based on time relation
  if (timeRelation.includes('hour')) {
    dueDate = relationType.includes('before')
      ? addHours(dueDate, -value)
      : addHours(dueDate, value);
  } else if (timeRelation.includes('day')) {
    dueDate = relationType.includes('before')
      ? addDays(dueDate, -value)
      : addDays(dueDate, value);
  } else if (timeRelation.includes('minute')) {
    dueDate = relationType.includes('before')
      ? addMinutes(dueDate, -value)
      : addMinutes(dueDate, value);
  }

  // Weekend protection
  return shiftWeekendToMonday(dueDate);
}
```

### Weekend Protection

```javascript
export function shiftWeekendToMonday(date) {
  if (isWeekend(date)) {
    return nextMonday(date);
  }
  return date;
}

// Examples:
// Saturday Jan 20 → Monday Jan 22
// Sunday Jan 21 → Monday Jan 22
// Monday Jan 22 → Monday Jan 22 (no change)
```

### Business Days

```javascript
export function addBusinessDays(startDate, days) {
  let currentDate = new Date(startDate);
  let daysAdded = 0;

  while (daysAdded < days) {
    currentDate = addDays(currentDate, 1);

    // Skip weekends
    if (!isWeekend(currentDate)) {
      daysAdded++;
    }
  }

  return currentDate;
}

// Examples:
// addBusinessDays(Friday Jan 19, 1) → Monday Jan 22
// addBusinessDays(Friday Jan 19, 2) → Tuesday Jan 23
// addBusinessDays(Monday Jan 22, 3) → Thursday Jan 25
```

### Formatting for Clio

```javascript
export function formatForClio(date) {
  return format(date, 'yyyy-MM-dd');
}

// Example: "2024-01-20"

export function formatDateTimeForClio(date) {
  return format(date, "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

// Example: "2024-01-20T14:30:00Z"
```

### Time Window Check

```javascript
export function isWithinMinutes(referenceTime, minutes) {
  const ref = typeof referenceTime === 'string' ? parseISO(referenceTime) : referenceTime;
  const now = new Date();
  const diffMs = now - ref;
  const diffMinutes = diffMs / (1000 * 60);
  return diffMinutes <= minutes;
}

// Used for rollback detection (3-minute window)
```

---

## Assignee Error Class

**File:** `src/utils/assignee-error.js`

### Purpose
Custom error class for assignee resolution failures with error codes.

### Class Definition

```javascript
export class AssigneeError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = 'AssigneeError';
    this.code = code;
    this.context = context;
  }
}
```

### Usage

```javascript
import { AssigneeError } from '../utils/assignee-error.js';
import { ERROR_CODES } from '../constants/error-codes.js';

// Throwing an error
if (!assignee) {
  throw new AssigneeError(
    ERROR_CODES.ASSIGNEE_NO_CSC,
    `No CSC found for location: ${location}`,
    { matter_id: matterData.id, location }
  );
}

// Catching an error
try {
  const assignee = await resolveAssignee('CSC', matterData);
} catch (error) {
  if (error instanceof AssigneeError) {
    console.error(`Assignee error [${error.code}]: ${error.message}`);
    console.error('Context:', error.context);

    // Create error task
    const errorTask = createAssigneeErrorTask(matterData, stageId, error.message);
    await ClioService.createTask(errorTask);
  } else {
    throw error;  // Re-throw non-assignee errors
  }
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Always "AssigneeError" |
| `code` | string | Error code (e.g., ERR_ASSIGNEE_NO_CSC) |
| `message` | string | Human-readable error message |
| `context` | object | Additional context (matter_id, location, etc.) |

---

## Usage Examples

### Complete Task Creation Flow

```javascript
import { resolveAssignee, createAssigneeErrorTask } from '../utils/assignee-resolver.js';
import { calculateDueDate, formatForClio } from '../utils/date-helpers.js';
import { AssigneeError } from '../utils/assignee-error.js';

async function createTaskFromTemplate(template, matterDetails, meetingLocation = null) {
  // 1. Resolve assignee
  let assignee;
  try {
    assignee = await resolveAssignee(
      template.assignee,
      matterDetails,
      meetingLocation,
      template.lookup_reference,
      template.require_meeting_location
    );
  } catch (error) {
    if (error instanceof AssigneeError) {
      // Create error task instead
      return await createAssigneeErrorTask(matterDetails, template.stage_id, error.message);
    }
    throw error;
  }

  // 2. Calculate due date
  const dueDate = calculateDueDate(template);
  const dueDateFormatted = dueDate ? formatForClio(dueDate) : null;

  // 3. Create task
  const taskData = {
    name: template.task_title,
    description: template['task-description'],
    matter: { id: matterDetails.id },
    assignee: { id: assignee.id, type: 'User' }
  };

  if (dueDateFormatted) {
    taskData.due_at = dueDateFormatted;
  }

  return await ClioService.createTask(taskData);
}
```

### Queue Integration

```javascript
import { webhookQueue } from '../utils/webhook-queue.js';

// Webhook route
router.post('/matters', async (req, res) => {
  try {
    const result = await webhookQueue.enqueue(req.body, async () => {
      // This function runs when it's this webhook's turn
      return await MatterStageChangeAutomation.process(req.body);
    });

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Monitoring endpoint
router.get('/queue-stats', (req, res) => {
  res.json(webhookQueue.getStats());
});
```

---

## Related Documentation

- [00-OVERVIEW.md](./00-OVERVIEW.md) - System overview
- [02-AUTOMATIONS.md](./02-AUTOMATIONS.md) - Automation flows
- [05-ERROR-HANDLING.md](./05-ERROR-HANDLING.md) - Error codes
- [06-SERVICES.md](./06-SERVICES.md) - Service layer
