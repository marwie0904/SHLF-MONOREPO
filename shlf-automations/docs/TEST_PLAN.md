# Comprehensive Automation Testing Plan

**Test Matter ID:** 1675950832
**Date:** 2025-10-04
**Objective:** Validate all three automations end-to-end with real Clio API calls

---

## Pre-Test Setup

### 1. Verify Current State
- [ ] Check current matter stage
- [ ] List all existing tasks for this matter
- [ ] List all existing calendar entries for this matter
- [ ] Verify Supabase connection
- [ ] Verify Clio API access token is valid

### 2. Gather Configuration Data
- [ ] Get all configured stages from Supabase (task_list_probate / task_list_non_meeting)
- [ ] Get all configured calendar event mappings
- [ ] Get all configured attempt sequences
- [ ] Get all configured location keywords

---

## Test Suite 1: Matter Stage Change Automation

### Test 1.1: Stage Change - Initial Consultation (Probate)
**Objective:** Verify task generation when changing to Initial Consultation stage

**Steps:**
1. Get current matter stage
2. Update matter to stage: "Initial Consultation" (stage_id: 707058)
3. Trigger webhook manually or wait for Clio to send it
4. Verify webhook was received and processed
5. Query Supabase webhook_events table
6. Verify tasks were created in Clio
7. Verify tasks were recorded in Supabase tasks table
8. Validate due dates are correct (based on task templates)

**Expected Results:**
- Webhook: `success: true, action: 'created_tasks'`
- Tasks created: X tasks (based on templates for stage 707058)
- All tasks have correct assignees
- All tasks have correct due dates
- No failures in failure_details

**Validation Queries:**
```sql
-- Check webhook processing
SELECT * FROM webhook_events
WHERE resource_id = '1675950832'
ORDER BY created_at DESC LIMIT 5;

-- Check tasks created
SELECT task_id, task_name, assigned_user, due_date, stage_name
FROM tasks
WHERE matter_id = '1675950832'
AND stage_id = 707058
ORDER BY task_number;
```

### Test 1.2: Stage Change - Estate Opened (Probate)
**Objective:** Verify task generation for different stage

**Steps:**
1. Update matter to stage: "Estate Opened" (stage_id: TBD)
2. Trigger webhook
3. Verify new tasks created
4. Verify old tasks from previous stage still exist
5. Check matter_history table for stage change record

**Expected Results:**
- New set of tasks created for Estate Opened stage
- Previous tasks remain untouched
- matter_history shows stage change

### Test 1.3: Stage Change Rollback (within 3 minutes)
**Objective:** Test rollback window protection

**Steps:**
1. Change matter to stage A
2. Wait for tasks to be created
3. Immediately change back to stage B (within 3 minutes)
4. Verify rollback logic triggers
5. Check that tasks from stage A are deleted

**Expected Results:**
- Rollback detected
- Previous stage tasks deleted
- New stage tasks created

### Test 1.4: Stage Change with Missing Stage Info
**Objective:** Test validation (Critical Issue #4 fix)

**Steps:**
1. Simulate matter without stage (if possible via API)
2. Or verify validation code would catch it

**Expected Results:**
- Webhook: `success: false, action: 'missing_stage'`
- Error logged to error_logs
- No tasks created

---

## Test Suite 2: Meeting Scheduled Automation

### Test 2.1: Create Initial Consultation Meeting (Before Stage Change)
**Objective:** Verify meeting-related task due dates are set correctly

**Steps:**
1. Create calendar entry for matter 1675950832
2. Set event type to: "Initial Consultation" (event_type_id: 334801)
3. Set meeting date: 7 days from now
4. Set location: "Fort Myers Office"
5. Trigger webhook
6. Verify tasks are created with due dates relative to meeting

**Expected Results:**
- Webhook: `success: true, action: 'tasks_created'`
- Tasks created with due dates relative to meeting date
- Meeting recorded in matters_meetings_booked table
- Tasks with "X days before meeting" have correct due dates

**Validation:**
```sql
-- Check meeting booking
SELECT * FROM matters_meetings_booked
WHERE matter_id = '1675950832';

-- Check meeting-related tasks
SELECT task_name, due_date,
  DATE_PART('day', due_date - '[MEETING_DATE]') as days_from_meeting
FROM tasks
WHERE matter_id = '1675950832'
AND stage_id = 707058;
```

### Test 2.2: Update Meeting Date
**Objective:** Verify existing tasks get updated when meeting is rescheduled

**Steps:**
1. Update existing calendar entry to new date (14 days from now)
2. Trigger webhook
3. Verify task due dates were updated

**Expected Results:**
- Webhook: `success: true, action: 'tasks_updated'`
- Task due dates recalculated based on new meeting date
- tasks_updated count matches expected

### Test 2.3: Meeting with Invalid Location
**Objective:** Test location validation for signing meetings

**Steps:**
1. Create signing meeting calendar entry
2. Set location to invalid location (not in location_keywords)
3. Trigger webhook

**Expected Results:**
- Error task created for meeting creator
- Error message lists valid location keywords
- Original tasks not created due to assignee resolution failure

### Test 2.4: Meeting Without Date
**Objective:** Test validation (Critical Issue #4 fix)

**Steps:**
1. Create calendar entry without start_at date (if possible)
2. Trigger webhook

**Expected Results:**
- Webhook: `success: false, action: 'missing_meeting_date'`
- Error logged to error_logs

---

## Test Suite 3: Task Completion Automation

### Test 3.1: Complete Task - Attempt Sequence
**Objective:** Verify "Attempt 1" → "Attempt 2" progression

**Steps:**
1. Find task named "Attempt 1" for the matter
2. Mark task as complete via Clio API
3. Trigger webhook
4. Verify "Attempt 2" task is created
5. Check due date is correct (X days after completion)

**Expected Results:**
- Webhook: `success: true, action: 'attempt_sequence'`
- "Attempt 2" task created
- Due date set correctly
- Original "Attempt 1" marked as completed in Supabase

**Validation:**
```sql
-- Check completed task
SELECT * FROM tasks
WHERE matter_id = '1675950832'
AND task_name LIKE '%Attempt 1%'
AND completed = true;

-- Check next task created
SELECT * FROM tasks
WHERE matter_id = '1675950832'
AND task_name LIKE '%Attempt 2%';
```

### Test 3.2: Complete Attempt 2 → Attempt 3
**Objective:** Continue attempt sequence

**Steps:**
1. Complete "Attempt 2" task
2. Verify "Attempt 3" task is created

### Test 3.3: Complete Attempt 3 → No Response
**Objective:** Final task in attempt sequence

**Steps:**
1. Complete "Attempt 3" task
2. Verify "No Response" task is created

### Test 3.4: Complete Task - Dependent Tasks
**Objective:** Verify tasks with "after task X" due dates are updated

**Steps:**
1. Find task that has dependent tasks (due_date_relation: "after task X")
2. Complete the task
3. Verify dependent tasks get updated due dates

**Expected Results:**
- Webhook: `success: true, action: 'dependent_tasks'`
- Dependent tasks updated
- tasks_updated count correct

### Test 3.5: Complete Task Without Matter
**Objective:** Test validation (Critical Issue #4 fix)

**Steps:**
1. Simulate task without matter (if possible)
2. Or verify validation code would catch it

**Expected Results:**
- Webhook: `success: false, action: 'missing_matter'`
- Error logged to error_logs

---

## Test Suite 4: Partial Failure Scenarios (Critical Issue #2 fix)

### Test 4.1: Task Creation with Assignee Error
**Objective:** Verify partial failure tracking

**Steps:**
1. Set up scenario where 1 task will fail (invalid assignee)
2. Trigger stage change
3. Verify some tasks succeed, one fails
4. Check webhook marked as partial failure

**Expected Results:**
- Webhook: `success: false, action: 'partial_failure'`
- tasks_created: X (successful tasks)
- tasks_failed: 1
- failure_details populated with error info

**Validation:**
```sql
SELECT
  success,
  action,
  tasks_created,
  failure_details
FROM webhook_events
WHERE resource_id = '1675950832'
AND action = 'partial_failure';
```

---

## Test Suite 5: Idempotency & Database Resilience

### Test 5.1: Duplicate Webhook (Idempotency Key)
**Objective:** Verify idempotency prevents duplicate processing

**Steps:**
1. Send webhook for matter stage change
2. Wait for processing to complete
3. Send EXACT same webhook again (same timestamp)
4. Verify second request returns cached result

**Expected Results:**
- First webhook: Processes normally
- Second webhook: `action: 'already_processed', cached: true`
- No duplicate tasks created

### Test 5.2: Concurrent Webhooks (Early Reservation - Critical Issue #3 fix)
**Objective:** Verify early webhook reservation prevents race conditions

**Steps:**
1. Send same webhook twice simultaneously
2. Verify only one processes, second sees "still_processing"

**Expected Results:**
- First webhook: Processes normally, reserves with success=NULL
- Second webhook: `action: 'still_processing'`
- No duplicate tasks

### Test 5.3: Webhook Timestamp Validation (Critical Issue #1 fix)
**Objective:** Verify webhooks without timestamps are rejected

**Steps:**
1. Send webhook without matter_stage_updated_at or updated_at
2. Verify webhook is rejected

**Expected Results:**
- Webhook rejected with error
- Error logged to error_logs
- No processing occurs

---

## Test Suite 6: Security

### Test 6.1: Valid Webhook Signature (Critical Issue #5 fix)
**Objective:** Verify signature validation works

**Steps:**
1. Generate valid HMAC-SHA256 signature
2. Send webhook with X-Clio-Signature header
3. Verify webhook is processed

**Expected Results:**
- Signature validated successfully
- Webhook processed normally

### Test 6.2: Invalid Webhook Signature
**Objective:** Verify invalid signatures are rejected

**Steps:**
1. Send webhook with wrong signature
2. Verify webhook is rejected

**Expected Results:**
- 401 Unauthorized response
- Error logged to error_logs with signature details
- No processing occurs

### Test 6.3: Missing Webhook Signature
**Objective:** Verify missing signatures are rejected

**Steps:**
1. Send webhook without X-Clio-Signature header
2. Verify webhook is rejected

**Expected Results:**
- 401 Unauthorized response
- Error: "Missing webhook signature"

---

## Test Suite 7: Edge Cases

### Test 7.1: Empty Task Templates
**Objective:** Handle stage with no templates

**Steps:**
1. Change to stage with no task templates
2. Verify graceful handling

**Expected Results:**
- Webhook: `success: true, action: 'no_templates'` or similar
- No tasks created
- No errors

### Test 7.2: Template Validation Failure
**Objective:** Verify duplicate task_number detection

**Steps:**
1. Simulate templates with duplicate task_numbers
2. Trigger automation

**Expected Results:**
- Webhook: `success: false, action: 'template_validation_failed'`
- Error logged
- No tasks created

### Test 7.3: Practice Area Detection
**Objective:** Verify Probate vs Estate Planning template selection

**Steps:**
1. Verify matter practice area
2. Change stage
3. Verify correct template set is used (Probate vs Non-Meeting)

---

## Post-Test Validation

### Database Integrity Checks
```sql
-- Check for orphaned tasks (in Clio but not Supabase)
-- Check for duplicate tasks (same matter, stage, task_number)
SELECT matter_id, stage_id, task_number, COUNT(*)
FROM tasks
GROUP BY matter_id, stage_id, task_number
HAVING COUNT(*) > 1;

-- Check webhook success rate
SELECT
  action,
  success,
  COUNT(*) as count
FROM webhook_events
WHERE resource_id = '1675950832'
GROUP BY action, success;

-- Check error logs
SELECT
  error_code,
  error_message,
  created_at
FROM error_logs
WHERE context->>'matter_id' = '1675950832'
ORDER BY created_at DESC;
```

### Performance Metrics
- Average webhook processing time
- Task creation time
- API call count per automation

---

## Test Execution Checklist

**Before Testing:**
- [ ] Server is running
- [ ] Environment variables configured
- [ ] Clio API access token valid
- [ ] Supabase connection working
- [ ] Webhook endpoints accessible

**During Testing:**
- [ ] Monitor server logs in real-time
- [ ] Record all API responses
- [ ] Take screenshots of Clio UI changes
- [ ] Note any unexpected behavior

**After Testing:**
- [ ] Review all webhook_events records
- [ ] Review all error_logs records
- [ ] Verify data consistency between Clio and Supabase
- [ ] Clean up test data (if needed)
- [ ] Document any bugs found

---

## Success Criteria

✅ **All automations must:**
1. Process webhooks successfully
2. Create/update tasks correctly
3. Calculate due dates accurately
4. Handle errors gracefully
5. Prevent duplicate processing (idempotency)
6. Validate signatures (security)
7. Track partial failures
8. Log all errors

✅ **No critical failures:**
- No data corruption
- No orphaned records
- No duplicate tasks
- No security vulnerabilities

---

## Test Results Template

```
Test ID: [e.g., 1.1]
Test Name: [e.g., Stage Change - Initial Consultation]
Date/Time: [timestamp]
Status: [PASS/FAIL]
Notes: [observations]

Webhook Response:
{
  "success": true/false,
  "action": "...",
  ...
}

Tasks Created: [list]
Errors: [list if any]
Screenshots: [if applicable]
```
