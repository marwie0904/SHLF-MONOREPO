# Database Schema Documentation

## Table of Contents
- [Overview](#overview)
- [Core Tables](#core-tables)
- [Template Tables](#template-tables)
- [Lookup Tables](#lookup-tables)
- [Tracking Tables](#tracking-tables)
- [Configuration Tables](#configuration-tables)
- [Entity Relationships](#entity-relationships)

---

## Overview

The automation system uses Supabase (PostgreSQL) for:
- Task tracking and history
- Task templates and configuration
- Assignee lookups
- Webhook event tracking
- OAuth token storage
- Error logging

---

## Core Tables

### 1. tasks

**Purpose:** Track all tasks created by the automation system.

```sql
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  task_id BIGINT UNIQUE NOT NULL,          -- Clio task ID
  task_name TEXT NOT NULL,
  task_desc TEXT,
  matter_id BIGINT NOT NULL,               -- Clio matter ID
  assigned_user_id BIGINT,                 -- Clio user ID
  assigned_user TEXT,                      -- User name for reference
  due_date DATE,
  stage_id TEXT,                           -- Clio stage ID
  stage_name TEXT,
  task_number INTEGER,                     -- Template task number
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'pending',           -- pending, completed, deleted
  calendar_entry_id BIGINT,                -- For meeting tasks
  task_date_generated TIMESTAMP WITH TIME ZONE,
  due_date_generated TIMESTAMP WITH TIME ZONE,
  verification_attempted BOOLEAN DEFAULT FALSE,
  verification_attempted_at TIMESTAMP WITH TIME ZONE,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tasks_matter_id ON tasks(matter_id);
CREATE INDEX idx_tasks_matter_stage ON tasks(matter_id, stage_id);
CREATE INDEX idx_tasks_task_number ON tasks(task_number);
CREATE INDEX idx_tasks_status ON tasks(status);
```

**Special task_number values:**
| Value | Meaning |
|-------|---------|
| -2 | "Client did not engage" task |
| -1 | Error task (assignee resolution failed) |
| 1+ | Regular stage tasks |
| NULL | System-generated tasks (documents, stale matters) |

---

### 2. matters

**Purpose:** Audit trail of matter stage changes.

```sql
CREATE TABLE matters (
  id SERIAL PRIMARY KEY,
  matter_id BIGINT NOT NULL,               -- Clio matter ID
  matter_display_number TEXT,
  stage_id TEXT,
  stage_name TEXT,
  previous_stage_id TEXT,
  previous_stage_name TEXT,
  stage_changed_at TIMESTAMP WITH TIME ZONE,
  webhook_id TEXT,                         -- Original webhook ID
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for rollback detection
CREATE INDEX idx_matters_recent ON matters(matter_id, created_at DESC);
```

---

### 3. matter-info

**Purpose:** Current state of each matter (upserted on each stage change).

```sql
CREATE TABLE "matter-info" (
  id SERIAL PRIMARY KEY,
  matter_id BIGINT UNIQUE NOT NULL,
  display_number TEXT,
  current_stage_id TEXT,
  current_stage_name TEXT,
  status TEXT,                             -- Open, Closed, etc.
  location TEXT,
  responsible_attorney_id BIGINT,
  responsible_attorney_name TEXT,
  originating_attorney_id BIGINT,
  originating_attorney_name TEXT,
  practice_area_id BIGINT,
  practice_area_name TEXT,
  last_stage_change_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

### 4. matters-meetings-booked

**Purpose:** Track meeting bookings for matters.

```sql
CREATE TABLE "matters-meetings-booked" (
  id SERIAL PRIMARY KEY,
  matter_id BIGINT NOT NULL,
  calendar_entry_id BIGINT UNIQUE NOT NULL,
  event_type_id BIGINT,
  event_type_name TEXT,
  meeting_date TIMESTAMP WITH TIME ZONE,
  location TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_meetings_matter ON "matters-meetings-booked"(matter_id);
```

---

### 5. webhook_events

**Purpose:** Idempotency tracking and webhook audit trail.

```sql
CREATE TABLE webhook_events (
  id SERIAL PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,    -- {event}:{resource_id}:{timestamp}
  webhook_id TEXT,                          -- Clio webhook event ID
  event_type TEXT NOT NULL,                -- matter.stage_changed, task.completed, etc.
  resource_type TEXT,                      -- matter, task, calendar_entry, document
  resource_id BIGINT,
  success BOOLEAN,                         -- NULL = processing, true/false = done
  action TEXT,                             -- task_created, skipped_test_mode, etc.
  error_message TEXT,
  tasks_created INTEGER,
  processing_duration_ms INTEGER,
  webhook_payload JSONB,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_idempotency ON webhook_events(idempotency_key);
CREATE INDEX idx_webhook_events_resource ON webhook_events(resource_type, resource_id);
```

---

### 6. error_logs

**Purpose:** Centralized error logging.

```sql
CREATE TABLE error_logs (
  id SERIAL PRIMARY KEY,
  error_code TEXT NOT NULL,                -- ERR_ASSIGNEE_NO_CSC, etc.
  error_message TEXT NOT NULL,
  context JSONB,                           -- Additional error context
  stack_trace TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_error_logs_code ON error_logs(error_code);
CREATE INDEX idx_error_logs_created ON error_logs(created_at DESC);
```

---

## Template Tables

### 7. task-list-non-meeting

**Purpose:** Task templates for stage changes (non-probate matters).

```sql
CREATE TABLE "task-list-non-meeting" (
  id SERIAL PRIMARY KEY,
  stage_id TEXT NOT NULL,                  -- Clio stage ID
  stage_name TEXT,
  task_number INTEGER NOT NULL,            -- Order/identifier
  task_title TEXT NOT NULL,
  "task-description" TEXT,
  assignee TEXT,                           -- CSC, PARALEGAL, ATTORNEY, numeric ID
  assignee_id BIGINT,                      -- Specific user ID if applicable
  lookup_reference TEXT,                   -- location, attorney_id, etc.
  require_meeting_location BOOLEAN DEFAULT FALSE,

  -- Due date configuration
  "due_date-value" INTEGER,
  "due_date-value-only" INTEGER,
  "due_date-time-relation" TEXT,           -- days, hours, minutes
  "due_date-relational" TEXT,              -- after creation, before meeting, after task X

  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_task_templates_stage ON "task-list-non-meeting"(stage_id);
CREATE UNIQUE INDEX idx_task_templates_unique ON "task-list-non-meeting"(stage_id, task_number);
```

---

### 8. task-list-probate

**Purpose:** Task templates for probate practice area matters.

```sql
CREATE TABLE "task-list-probate" (
  id SERIAL PRIMARY KEY,
  stage_id TEXT NOT NULL,
  stage_name TEXT,
  task_number INTEGER NOT NULL,
  task_title TEXT NOT NULL,
  "task-description" TEXT,
  assignee TEXT,
  assignee_id BIGINT,
  lookup_reference TEXT,
  "due_date-value" INTEGER,
  "due_date-value-only" INTEGER,
  "due_date-time-relation" TEXT,
  "due_date-relational" TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_task_probate_stage ON "task-list-probate"(stage_id);
```

---

### 9. task-list-meeting

**Purpose:** Task templates for calendar entry events (meetings).

```sql
CREATE TABLE "task-list-meeting" (
  id SERIAL PRIMARY KEY,
  calendar_event_id BIGINT NOT NULL,       -- Clio calendar event type ID
  calendar_event_name TEXT,
  task_number INTEGER NOT NULL,
  task_title TEXT NOT NULL,
  "task-description" TEXT,
  assignee TEXT,
  assignee_id BIGINT,
  lookup_reference TEXT,
  require_meeting_location BOOLEAN DEFAULT FALSE,
  "due_date-value" INTEGER,
  "due_date-time-relation" TEXT,           -- days, hours
  "due_date-relational" TEXT,              -- before meeting, after meeting
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_task_meeting_event ON "task-list-meeting"(calendar_event_id);
```

---

## Lookup Tables

### 10. assigned_user_reference

**Purpose:** Dynamic assignee lookups based on location, attorney, or role.

```sql
CREATE TABLE assigned_user_reference (
  id SERIAL PRIMARY KEY,
  lookup_type TEXT NOT NULL,               -- location, attorney_id, fund_table
  lookup_value TEXT NOT NULL,              -- "fort myers", "357123456", etc.
  user_id BIGINT NOT NULL,                 -- Clio user ID
  user_name TEXT,
  role TEXT,                               -- CSC, PARALEGAL, etc.
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_assignee_lookup ON assigned_user_reference(lookup_type, lookup_value);
```

**Example Data:**
```sql
-- CSC by location
INSERT INTO assigned_user_reference (lookup_type, lookup_value, user_id, user_name, role)
VALUES
  ('location', 'fort myers', 357123456, 'Jane Smith', 'CSC'),
  ('location', 'naples', 357123457, 'John Doe', 'CSC'),
  ('location', 'tampa', 357123458, 'Mary Johnson', 'CSC');

-- Paralegal by attorney
INSERT INTO assigned_user_reference (lookup_type, lookup_value, user_id, user_name, role)
VALUES
  ('attorney_id', '357111111', 357222222, 'Alice Brown', 'PARALEGAL'),
  ('attorney_id', '357111112', 357222223, 'Bob Wilson', 'PARALEGAL');

-- Fund table by attorney
INSERT INTO assigned_user_reference (lookup_type, lookup_value, user_id, user_name, role)
VALUES
  ('fund_table', '357111111', 357333333, 'Carol White', 'FUNDING_COOR');
```

---

### 11. location_keywords

**Purpose:** Valid location keywords for extracting location from meeting addresses.

```sql
CREATE TABLE location_keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT UNIQUE NOT NULL,            -- "fort myers", "naples", "tampa"
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Example Data:**
```sql
INSERT INTO location_keywords (keyword) VALUES
  ('fort myers'),
  ('naples'),
  ('tampa'),
  ('orlando'),
  ('jacksonville');
```

---

### 12. calendar_event_mappings

**Purpose:** Map Clio calendar event types to stages.

```sql
CREATE TABLE calendar_event_mappings (
  id SERIAL PRIMARY KEY,
  calendar_event_id BIGINT UNIQUE NOT NULL,  -- Clio event type ID
  calendar_event_name TEXT,
  stage_id TEXT,                              -- Associated stage
  stage_name TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Example Data:**
```sql
INSERT INTO calendar_event_mappings (calendar_event_id, calendar_event_name, stage_id, stage_name)
VALUES
  (789012, 'Signing', '67890', 'Signing Scheduled'),
  (789013, 'Client Meeting', '67891', 'Client Meeting Scheduled'),
  (789014, 'Court Date', '67892', 'Court Date Scheduled');
```

---

### 13. attempt_sequences

**Purpose:** Define task attempt sequences (Attempt 1 → 2 → 3 → No Response).

```sql
CREATE TABLE attempt_sequences (
  id SERIAL PRIMARY KEY,
  sequence_name TEXT NOT NULL,
  task_name_pattern TEXT NOT NULL,         -- Regex or exact match
  next_task_name TEXT,                     -- Next task in sequence (NULL = end)
  due_date_value INTEGER DEFAULT 1,
  due_date_units TEXT DEFAULT 'days',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Example Data:**
```sql
INSERT INTO attempt_sequences (sequence_name, task_name_pattern, next_task_name)
VALUES
  ('client_contact', 'Contact Client - Attempt 1', 'Contact Client - Attempt 2'),
  ('client_contact', 'Contact Client - Attempt 2', 'Contact Client - Attempt 3'),
  ('client_contact', 'Contact Client - Attempt 3', 'Client - No Response'),
  ('client_contact', 'Client - No Response', NULL);
```

---

## Tracking Tables

### 14. matter_stage_tracking

**Purpose:** Track how long matters stay in each stage (for stale matter detection).

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

CREATE INDEX idx_stage_tracking_matter ON matter_stage_tracking(matter_id);
```

---

### 15. sheila-temp-assignee-changes

**Purpose:** Track assignee changes for specific user (Sheila).

```sql
CREATE TABLE "sheila-temp-assignee-changes" (
  id SERIAL PRIMARY KEY,
  matter_id BIGINT NOT NULL,
  task_id BIGINT NOT NULL,
  original_assignee_id BIGINT,
  new_assignee_id BIGINT,
  new_assignee_name TEXT,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## Configuration Tables

### 16. clio_tokens

**Purpose:** Store OAuth tokens for Clio API.

```sql
CREATE TABLE clio_tokens (
  id SERIAL PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

### 17. stage_status_mappings

**Purpose:** Map stages to matter statuses (for auto-updating status).

```sql
CREATE TABLE stage_status_mappings (
  id SERIAL PRIMARY KEY,
  stage_id TEXT NOT NULL,
  stage_name TEXT,
  matter_status TEXT NOT NULL,             -- Open, Pending, Closed, etc.
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

### 18. automation_config

**Purpose:** Runtime configuration values.

```sql
CREATE TABLE automation_config (
  id SERIAL PRIMARY KEY,
  config_key TEXT UNIQUE NOT NULL,
  config_value TEXT,
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Example Data:**
```sql
INSERT INTO automation_config (config_key, config_value, description)
VALUES
  ('rollback_window_minutes', '3', 'Minutes to detect stage rollback'),
  ('verification_delay_seconds', '30', 'Seconds to wait before verification'),
  ('stale_matter_days', '30', 'Days before matter is considered stale');
```

---

### 19. excluded_folders

**Purpose:** Document folders that should skip automation.

```sql
CREATE TABLE excluded_folders (
  id SERIAL PRIMARY KEY,
  folder_name TEXT UNIQUE NOT NULL,
  reason TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## Entity Relationships

```
┌─────────────────┐
│    matters      │ (audit trail)
└────────┬────────┘
         │ matter_id
         │
┌────────▼────────┐
│   matter-info   │ (current state)
└────────┬────────┘
         │ matter_id
         │
    ┌────┴────┬───────────────────────────┐
    │         │                           │
┌───▼───┐ ┌───▼───────────────┐ ┌─────────▼─────────────┐
│ tasks │ │ matters-meetings- │ │ matter_stage_tracking │
└───┬───┘ │ booked            │ └───────────────────────┘
    │     └───────────────────┘
    │
    └──► Linked to task templates via:
         - stage_id → task-list-non-meeting / task-list-probate
         - calendar_entry_id → task-list-meeting

┌─────────────────────────┐
│ assigned_user_reference │ ◄── Lookup by location, attorney_id, fund_table
└─────────────────────────┘

┌─────────────────────────┐
│ calendar_event_mappings │ ◄── Map event types to stages
└─────────────────────────┘

┌─────────────────────────┐
│    webhook_events       │ ◄── Track all processed webhooks
└─────────────────────────┘
```

---

## Database Queries (Common Patterns)

### Get task templates for a stage:
```sql
SELECT * FROM "task-list-non-meeting"
WHERE stage_id = '67890'
  AND active = true
ORDER BY task_number;
```

### Check if tasks exist for matter + stage:
```sql
SELECT * FROM tasks
WHERE matter_id = 12345678
  AND stage_id = '67890'
  AND status != 'deleted'
ORDER BY task_number;
```

### Get CSC by location:
```sql
SELECT user_id, user_name FROM assigned_user_reference
WHERE lookup_type = 'location'
  AND lookup_value = 'fort myers'
  AND active = true
LIMIT 1;
```

### Check idempotency:
```sql
SELECT * FROM webhook_events
WHERE idempotency_key = 'matter.stage_changed:12345678:2024-01-15T10:30:00Z';
```

### Get matters in rollback window:
```sql
SELECT * FROM matters
WHERE matter_id = 12345678
  AND created_at >= NOW() - INTERVAL '3 minutes'
ORDER BY created_at DESC;
```

---

## Related Documentation

- [00-OVERVIEW.md](./00-OVERVIEW.md) - System overview
- [06-SERVICES.md](./06-SERVICES.md) - Supabase service layer
