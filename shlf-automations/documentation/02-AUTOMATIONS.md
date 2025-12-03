# Automation Flows Documentation

## Table of Contents
- [Overview](#overview)
- [Automation 1: Matter Stage Change](#automation-1-matter-stage-change)
- [Automation 2: Task Completion](#automation-2-task-completion)
- [Automation 3: Meeting Scheduled](#automation-3-meeting-scheduled)
- [Automation 4: Matter Closed](#automation-4-matter-closed)
- [Automation 5: Task Deleted](#automation-5-task-deleted)
- [Automation 6: Calendar Entry Deleted](#automation-6-calendar-entry-deleted)
- [Automation 7: Document Created](#automation-7-document-created)
- [Duplicate Detection](#duplicate-detection)
- [Task Verification](#task-verification)

---

## Overview

The system has 7 distinct automations that process different Clio events:

| # | Automation | Trigger | Output |
|---|------------|---------|--------|
| 1 | Matter Stage Change | Matter moves to new stage | Creates stage-specific tasks |
| 2 | Task Completion | Task marked complete | Creates dependent/attempt tasks |
| 3 | Meeting Scheduled | Calendar entry created | Creates meeting tasks, updates due dates |
| 4 | Matter Closed | Matter status → Closed | Creates "Client did not engage" task (if no payments) |
| 5 | Task Deleted | Task deleted in Clio | Soft-deletes task in Supabase |
| 6 | Calendar Entry Deleted | Calendar entry deleted | Records deletion in Supabase |
| 7 | Document Created | Document uploaded | Creates "Save to OD" task |

---

## Automation 1: Matter Stage Change

**File:** `src/automations/matter-stage-change.js`

### Purpose
When a matter moves to a new stage in Clio, automatically create all tasks associated with that stage.

### Trigger
- Webhook: `POST /webhooks/matters`
- Event: Matter `matter_stage` field changes

### Complete Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: RECEIVE WEBHOOK                                      │
│ Extract: matter_id, matter_stage, timestamp                  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: IDEMPOTENCY CHECK                                    │
│ - Generate key: matter.stage_changed:{matterId}:{timestamp}  │
│ - Query webhook_events table                                 │
│ - If exists: Return cached result                            │
│ - If processing: Return "still_processing"                   │
└─────────────────────────────┬───────────────────────────────┘
                              │ (not processed yet)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: TEST MODE CHECK                                      │
│ - If TEST_MODE=true AND matter_id != TEST_MATTER_ID          │
│ - Skip processing                                            │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: RESERVE WEBHOOK                                      │
│ - Insert webhook_events with success=null (processing)       │
│ - Prevents duplicate processing                              │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: 1-SECOND API DELAY                                   │
│ - Wait 1 second for Clio API consistency                     │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: FETCH MATTER DETAILS                                 │
│ - GET /api/v4/matters/{id}.json                              │
│ - Fields: id, display_number, status, matter_stage,          │
│   responsible_attorney, originating_attorney, location,      │
│   practice_area, matter_stage_updated_at                     │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: VALIDATE MATTER                                      │
│ - Check matter status != "Closed"                            │
│ - Check matter_stage exists                                  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 8: ROLLBACK DETECTION (3-MINUTE WINDOW)                 │
│ - Query matters table for this matter                        │
│ - If previous stage entry within 3 minutes:                  │
│   - Delete tasks from previous stage                         │
│   - This handles rapid stage reversals                       │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 9: CHECK EXISTING STAGE TASKS                           │
│ - Query tasks table for this matter + stage                  │
│ - If tasks already exist AND not within rollback window:     │
│   - Skip task creation (prevent duplicates)                  │
└─────────────────────────────┬───────────────────────────────┘
                              │ (no existing tasks)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 10: FETCH TASK TEMPLATES                                │
│ - If practice_area = Probate (ID: 45045123):                 │
│   - Query task-list-probate                                  │
│ - Else:                                                      │
│   - Query task-list-non-meeting                              │
│ - Filter by stage_id                                         │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 11: RECORD MATTER HISTORY                               │
│ - Insert into matters table (audit trail)                    │
│ - Upsert into matter-info table (current state)              │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 12: CREATE TASKS (FOR EACH TEMPLATE)                    │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ A. RESOLVE ASSIGNEE                                      ││
│ │    - CSC: Look up by matter location                     ││
│ │    - PARALEGAL: Look up by attorney_id                   ││
│ │    - ATTORNEY: Use responsible/originating attorney      ││
│ │    - FUND TABLE: Look up by attorney_id                  ││
│ │    - VA: Hardcoded user 357379471                        ││
│ │    - Numeric: Direct user ID                             ││
│ │    - If fails: Create error task, continue               ││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ B. CALCULATE DUE DATE                                    ││
│ │    - If "after task X": Set to NULL (calculated later)   ││
│ │    - Parse due_date_value + due_date_time_relation       ││
│ │    - Apply hours/days/minutes offset                     ││
│ │    - Weekend protection: Shift Sat/Sun → Monday          ││
│ │    - All calculations in EST/EDT timezone                ││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ C. CREATE TASK IN CLIO                                   ││
│ │    - POST /api/v4/tasks.json                             ││
│ │    - Payload: name, description, matter, assignee, due_at││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ D. RECORD IN SUPABASE                                    ││
│ │    - Insert into tasks table                             ││
│ │    - Fields: task_id, task_name, matter_id, stage_id,    ││
│ │      task_number, assigned_user_id, due_date, etc.       ││
│ └──────────────────────────────────────────────────────────┘│
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 13: UPDATE MATTER STATUS (IF APPLICABLE)                │
│ - Check stage_status_mappings table                          │
│ - If mapping exists: Update matter status in Clio            │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 14: POST-VERIFICATION                                   │
│ - Wait 30 seconds                                            │
│ - Query Supabase for created tasks                           │
│ - Compare against expected task numbers                      │
│ - Regenerate any missing tasks                               │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 15: UPDATE WEBHOOK STATUS                               │
│ - Update webhook_events: success=true                        │
│ - Record tasks_created count                                 │
│ - Record processing_duration_ms                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Data Structures

**Task Template (from task-list-non-meeting):**
```javascript
{
  id: 1,
  stage_id: "67890",
  task_number: 1,
  task_title: "Review Initial Documents",
  task_description: "Review all documents provided by client",
  assignee: "CSC",                    // or "PARALEGAL", "ATTORNEY", numeric ID
  assignee_id: null,                  // specific user ID if applicable
  lookup_reference: "location",       // "location", "attorney_id", null
  due_date_value: 2,
  due_date_time_relation: "days",
  due_date_relational: "after creation"
}
```

### Error Handling

| Error Scenario | Handling |
|---------------|----------|
| Assignee not found | Create error task, continue with other tasks |
| Clio API failure | Log error, mark webhook failed, throw |
| Supabase failure | Log error, continue (Clio task exists) |
| No templates found | Log warning, complete successfully |

---

## Automation 2: Task Completion

**File:** `src/automations/task-completion.js`

### Purpose
Handle task completion to:
1. Create next attempt task (if attempt sequence)
2. Update due dates for dependent tasks

### Trigger
- Webhook: `POST /webhooks/tasks`
- Event: Task `status` changes to "complete"

### Complete Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: RECEIVE WEBHOOK                                      │
│ Extract: task_id, completed_at, matter_id                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: IDEMPOTENCY CHECK                                    │
│ - Check webhook_events for this task completion              │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: FETCH TASK DETAILS                                   │
│ - GET /api/v4/tasks/{id}.json                                │
│ - Get task name, matter, assignee                            │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: UPDATE SUPABASE TASK                                 │
│ - Set completed=true, status='completed'                     │
│ - Record completed_at timestamp                              │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: CHECK ATTEMPT SEQUENCE                               │
│ - Query attempt_sequences table                              │
│ - Match task name to sequence (e.g., "Attempt 1")            │
│ - If match found: Create next attempt task                   │
│                                                              │
│ Sequence Example:                                            │
│ "Attempt 1" → "Attempt 2" → "Attempt 3" → "No Response"      │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: CHECK DEPENDENT TASKS                                │
│ - Query tasks table for tasks with:                          │
│   due_date_relational = "after task {task_number}"           │
│ - For each dependent task:                                   │
│   - Calculate new due date from completion time              │
│   - Update task due date in Clio                             │
│   - Update Supabase record                                   │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: UPDATE WEBHOOK STATUS                                │
│ - Record success, any tasks created                          │
└─────────────────────────────────────────────────────────────┘
```

### Attempt Sequence Logic

```javascript
// Example attempt sequence in database
{
  sequence_name: "client_contact",
  steps: [
    { task_name: "Contact Client - Attempt 1", next: "Contact Client - Attempt 2" },
    { task_name: "Contact Client - Attempt 2", next: "Contact Client - Attempt 3" },
    { task_name: "Contact Client - Attempt 3", next: "Client - No Response" },
    { task_name: "Client - No Response", next: null }  // End of sequence
  ]
}
```

### Dependent Task Updates

When a task with `task_number: 5` completes:
- Find tasks where `due_date_relational = "after task 5"`
- Calculate their due dates from the completion timestamp
- Update both Clio and Supabase

---

## Automation 3: Meeting Scheduled

**File:** `src/automations/meeting-scheduled.js`

### Purpose
When a meeting is scheduled (calendar entry created):
1. Record the meeting booking
2. Create meeting-specific tasks
3. Update due dates for stage tasks based on meeting date

### Trigger
- Webhook: `POST /webhooks/calendar`
- Event: Calendar entry created or updated

### Complete Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: RECEIVE WEBHOOK                                      │
│ Extract: calendar_entry_id, event_type, matter_id,           │
│          location, start_at                                  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: IDEMPOTENCY CHECK                                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: FETCH CALENDAR ENTRY DETAILS                         │
│ - GET /api/v4/calendar_entries/{id}.json                     │
│ - Get event_type, location, attendees, matter                │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: MAP EVENT TYPE TO STAGE                              │
│ - Query calendar_event_mappings table                        │
│ - Get stage_id associated with this event type               │
│ - Example: "Signing" → Stage "Signing Scheduled"             │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: RECORD MEETING BOOKING                               │
│ - Upsert into matters-meetings-booked table                  │
│ - Store: matter_id, calendar_entry_id, event_type,           │
│   meeting_date, location                                     │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: FETCH MEETING TASK TEMPLATES                         │
│ - Query task-list-meeting table                              │
│ - Filter by calendar_event_id                                │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: CREATE MEETING TASKS (FOR EACH TEMPLATE)             │
│                                                              │
│ SPECIAL: For signing meetings, use MEETING LOCATION          │
│ (not matter location) for CSC assignment                     │
│                                                              │
│ - Resolve assignee (with meeting location if signing)        │
│ - Calculate due date relative to meeting date                │
│   - "2 days before meeting" → meeting_date - 2 days          │
│   - "1 hour before meeting" → meeting_time - 1 hour          │
│ - Create in Clio, record in Supabase                         │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 8: UPDATE STAGE TASK DUE DATES                          │
│ - Query tasks for this matter + stage                        │
│ - For incomplete tasks with meeting-relative due dates:      │
│   - Recalculate due date based on new meeting date           │
│   - Update in Clio and Supabase                              │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 9: POST-VERIFICATION                                    │
│ - Verify all meeting tasks created                           │
└─────────────────────────────────────────────────────────────┘
```

### Signing Meeting Special Handling

For "Signing" meetings, the CSC is determined by the **meeting location**, not the matter location:

```javascript
// Extract location keyword from meeting location
// "123 Main St, Fort Myers, FL" → "fort myers"
const locationKeyword = extractLocationKeyword(meetingLocation);

// Look up CSC for that location
const csc = await SupabaseService.getAssigneeByLocation(locationKeyword);
```

This is because signing meetings may occur at a different office than where the matter is based.

---

## Automation 4: Matter Closed

**File:** `src/automations/matter-closed.js`

### Purpose
When a matter is closed, check if any payments were made. If NO payments, create a "Client did not engage" task.

### Trigger
- Webhook: `POST /webhooks/matters`
- Event: Matter `status` changes to "Closed"

### Complete Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: RECEIVE WEBHOOK                                      │
│ Extract: matter_id, status="Closed"                          │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: IDEMPOTENCY CHECK                                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: FETCH MATTER DETAILS                                 │
│ - Verify status is actually "Closed"                         │
│ - Get location for CSC assignment                            │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: CHECK FOR PAYMENTS                                   │
│ - GET /api/v4/bills.json?matter_id={id}                      │
│ - Check if any bills have payments > 0                       │
└─────────────────────────────┬───────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            │                                   │
    (Has Payments)                      (No Payments)
            │                                   │
            ▼                                   ▼
┌─────────────────────┐            ┌─────────────────────────────┐
│ SKIP - Return       │            │ STEP 5: RESOLVE CSC          │
│ "skipped_has_       │            │ - Look up by matter location │
│  payments"          │            │ - If fails: Create error task│
└─────────────────────┘            └─────────────────┬───────────┘
                                                     │
                                                     ▼
                                   ┌─────────────────────────────┐
                                   │ STEP 6: CREATE TASK          │
                                   │ - Name: "Client did not      │
                                   │   engage"                    │
                                   │ - Description: "Purge Green  │
                                   │   Folder - Client did not    │
                                   │   engage"                    │
                                   │ - Assignee: CSC              │
                                   │ - Due: 24 hours from now     │
                                   │ - task_number: -2 (special)  │
                                   └─────────────────┬───────────┘
                                                     │
                                                     ▼
                                   ┌─────────────────────────────┐
                                   │ STEP 7: RECORD IN SUPABASE   │
                                   │ - task_number = -2 identifies│
                                   │   these special tasks        │
                                   └─────────────────────────────┘
```

### Special Task Numbers

| task_number | Meaning |
|-------------|---------|
| -2 | "Client did not engage" task |
| -1 | Error task (assignee resolution failed) |
| 1+ | Regular stage tasks |
| null | System-generated tasks |

---

## Automation 5: Task Deleted

**File:** `src/automations/task-deleted.js`

### Purpose
Keep Supabase in sync when tasks are deleted in Clio.

### Trigger
- Webhook: `POST /webhooks/tasks`
- Event: Task `deleted_at` is populated

### Complete Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: RECEIVE WEBHOOK                                      │
│ Extract: task_id, deleted_at                                 │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: IDEMPOTENCY CHECK                                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: CHECK IF TASK EXISTS IN SUPABASE                     │
│ - Query tasks table by task_id                               │
│ - If not found: Return "task_not_found"                      │
└─────────────────────────────┬───────────────────────────────┘
                              │ (task exists)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: SOFT DELETE IN SUPABASE                              │
│ - Update task: status = 'deleted'                            │
│ - Preserve all other data for history                        │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: UPDATE WEBHOOK STATUS                                │
│ - Return "task_marked_deleted"                               │
└─────────────────────────────────────────────────────────────┘
```

### Why Soft Delete?
- Preserves historical data for audit trails
- Allows verification service to skip deleted tasks
- Can identify patterns of deleted tasks

---

## Automation 6: Calendar Entry Deleted

**File:** `src/automations/calendar-entry-deleted.js`

### Purpose
Track when calendar entries are deleted in Clio.

### Trigger
- Webhook: `POST /webhooks/calendar`
- Event: Calendar entry `deleted_at` is populated

### Complete Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: RECEIVE WEBHOOK                                      │
│ Extract: calendar_entry_id, deleted_at                       │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: IDEMPOTENCY CHECK                                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: LOG DELETION                                         │
│ - Record that calendar entry was deleted                     │
│ - Note: Associated tasks are NOT deleted                     │
│   (can be regenerated by stage automation if needed)         │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: UPDATE WEBHOOK STATUS                                │
│ - Return "calendar_entry_deleted"                            │
└─────────────────────────────────────────────────────────────┘
```

### Task Preservation
Meeting tasks created by `MeetingScheduledAutomation` are **not deleted** when the calendar entry is deleted. This is intentional:
- Tasks may have been partially completed
- New meeting can regenerate new tasks
- Prevents accidental data loss

---

## Automation 7: Document Created

**File:** `src/automations/document-created.js`

### Purpose
When a document is uploaded to Clio Drive in the root folder of a matter, create a task to save it to OneDrive.

### Trigger
- Webhook: `POST /webhooks/documents`
- Event: Document created

### Complete Flow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: RECEIVE WEBHOOK                                      │
│ Extract: document_id, matter_id, created_at                  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: IDEMPOTENCY CHECK                                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: VALIDATE MATTER ASSOCIATION                          │
│ - Document must have matter_id                               │
│ - If missing: Return "missing_matter"                        │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: CHECK MATTER STATUS                                  │
│ - Fetch matter details                                       │
│ - If status = "Closed": Skip                                 │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: FETCH DOCUMENT DETAILS                               │
│ - Get document name, parent folder                           │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: CHECK IF IN ROOT FOLDER                              │
│ - Root folder name = matter display_number                   │
│ - If parent.name != display_number: Skip (in subfolder)      │
└─────────────────────────────┬───────────────────────────────┘
                              │ (in root folder)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: CREATE TASK                                          │
│ - Name: "New Clio Drive Document Save to OD"                 │
│ - Description: "New document: {document_name}"               │
│ - Assignee: User 357379471 (hardcoded)                       │
│ - Due: 1 business day from now                               │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 8: RECORD IN SUPABASE                                   │
│ - task_number = null (system task)                           │
│ - stage_id = null                                            │
└─────────────────────────────────────────────────────────────┘
```

### Root Folder Detection

In Clio Drive, the root folder for a matter has the same name as the matter's `display_number`:

```
Matter: 00001-Smith
├── 00001-Smith/              ← Root folder (name = display_number)
│   ├── Contract.pdf          ← Triggers task
│   ├── ID.jpg                ← Triggers task
│   └── Subfolder/
│       └── Notes.pdf         ← Does NOT trigger task
```

---

## Duplicate Detection

### 1. Idempotency Keys

Every webhook generates a unique idempotency key:

```javascript
// Format: {event_type}:{resource_id}:{timestamp}
const key = `matter.stage_changed:12345678:2024-01-15T10:30:00Z`;
```

The `webhook_events` table tracks:
- `idempotency_key` (unique)
- `success` (null = processing, true = done, false = failed)
- `processed_at`

### 2. Rollback Window (3 Minutes)

If a matter stage changes twice within 3 minutes (user accidentally moves stage then reverts):

```
10:00 - Matter moves to "Client Intake" → Creates 5 tasks
10:02 - Matter moves back to "Lead" → Within 3 minutes!
        → Delete the 5 tasks just created
        → Create tasks for "Lead" stage
```

### 3. Existing Task Check

Before creating stage tasks:
1. Query Supabase for tasks with this matter_id + stage_id
2. If tasks exist (and not in rollback window): Skip creation

---

## Task Verification

**File:** `src/services/task-verification.js`

### Purpose
Ensure all expected tasks were created successfully.

### Process

```
1. WAIT 30 SECONDS
   └── Allow task creation to settle

2. QUERY EXPECTED TASK NUMBERS
   └── From task templates for this stage

3. QUERY ACTUAL TASKS IN SUPABASE
   └── Filter by matter_id, stage_id, recent creation

4. COMPARE
   └── Identify missing task numbers

5. IF MISSING TASKS:
   └── Regenerate each missing task
   └── Use same assignee resolution logic
   └── Record with verification_attempted = true

6. REPORT RESULTS
   └── {success, tasksVerified, tasksRegenerated, failures}
```

### Verification Triggers
- After `MatterStageChangeAutomation`
- After `MeetingScheduledAutomation`

---

## Related Documentation

- [00-OVERVIEW.md](./00-OVERVIEW.md) - System overview
- [01-WEBHOOK-ENDPOINTS.md](./01-WEBHOOK-ENDPOINTS.md) - Endpoint details
- [05-ERROR-HANDLING.md](./05-ERROR-HANDLING.md) - Error codes
- [07-UTILITIES.md](./07-UTILITIES.md) - Utility functions
