# Webhook Processing Root Cause Analysis

## 🎯 ROOT CAUSE IDENTIFIED

### The Problem
All webhooks failing with:
```
Error Code: ERR_TEMPLATE_MISSING
Error Message: No templates found
Stage: 707058 (Design Meeting)
Webhook Success Rate: 0%
```

### The Discovery
✅ **Stage 707058 (Design Meeting) DOES have task templates!**
- task-list-meeting: **5 templates** ✅
- task-list-non-meeting: 0 templates
- task-list-probate: 0 templates

**Templates Found:**
1. Send meeting confirmation (24 hours after creation)
2. Prepare rough draft (3 days before meeting)
3. Ensure Payment was received (3 days after creation)
4. Confirm Engagement Agreement (3 days after creation)
5. Make sure ID is on file (24 hours after creation)

### The Bug
**Location:** `src/automations/matter-stage-change.js:204-209`

```javascript
// Current code - ONLY checks 2 tables:
if (practiceArea === 'Probate') {
  taskTemplates = await SupabaseService.getTaskListProbate(currentStageId);
} else {
  // Estate Planning or other
  taskTemplates = await SupabaseService.getTaskListNonMeeting(currentStageId);
}
```

**The automation NEVER checks task-list-meeting table!**

### Why This Fails
1. Matter stage changes to 707058 "Design Meeting"
2. Webhook triggers matter-stage-change automation
3. Automation only checks:
   - task-list-probate (0 templates) ❌
   - task-list-non-meeting (0 templates) ❌
4. Finds no templates → throws ERR_TEMPLATE_MISSING
5. Webhook fails

**But the 5 templates ARE there in task-list-meeting!**

## 📋 Understanding the Table Structure

### task-list-meeting
- **Triggered by:** Calendar events (meetings)
- **Key field:** `calendar_event_id`
- **When used:** When a meeting is scheduled/updated
- **Example:** Design Meeting (334801) → 5 templates

### task-list-non-meeting
- **Triggered by:** Stage changes
- **Key field:** `stage_id`
- **When used:** Matter stage change (non-probate)
- **Example:** Drafting (828768) → 6 templates

### task-list-probate
- **Triggered by:** Stage changes (Probate matters only)
- **Key field:** `stage_id`
- **When used:** Matter stage change (probate practice area)
- **Example:** Various probate stages

## 🔧 The Fix Options

### Option 1: Fix the Automation Logic ✅ RECOMMENDED
Update matter-stage-change.js to also check task-list-meeting:

```javascript
// Step 7: Get task templates based on practice area
let taskTemplates = [];

if (practiceArea === 'Probate') {
  taskTemplates = await SupabaseService.getTaskListProbate(currentStageId);
} else {
  // Estate Planning or other
  taskTemplates = await SupabaseService.getTaskListNonMeeting(currentStageId);
}

// NEW: Also check if this stage is tied to a meeting event type
if (taskTemplates.length === 0) {
  // Check if there's a calendar event mapping for this stage
  const eventMapping = await SupabaseService.getCalendarEventMappingByStage(currentStageId);
  if (eventMapping) {
    taskTemplates = await SupabaseService.getTaskListMeeting(eventMapping.calendar_event_id);
  }
}
```

### Option 2: Change Test Matter Stage ❌ NOT RECOMMENDED
- Move matter to stage with non-meeting templates (e.g., Drafting 828768)
- This would make tests pass but doesn't fix the underlying bug
- Real users would still hit this issue

### Option 3: Create Stage-Event Mapping ✅ ALSO RECOMMENDED
Add a record to `calendar_event_mappings` table:
```sql
INSERT INTO calendar_event_mappings (calendar_event_id, calendar_event_name, stage_id, stage_name)
VALUES ('334801', 'Design Meeting', '707058', 'Design Meeting');
```

Then update automation to use this mapping when stage changes.

## 🎯 Recommended Solution

**Implement BOTH Option 1 and Option 3:**

1. **Fix the automation** to check all 3 tables in order:
   - Primary: task-list-probate OR task-list-non-meeting (based on practice area)
   - Fallback: task-list-meeting (if stage maps to a calendar event)

2. **Ensure calendar_event_mappings** has stage linkages:
   - This allows stage changes to trigger meeting-based tasks
   - Currently we only have 1 mapping: 334846 → Initial Meeting

3. **Add proper logging** to help debug which table was used

## 📊 Impact Analysis

### Affected Stages
Any stage that:
- Has templates ONLY in task-list-meeting
- Gets triggered via matter stage change (not calendar event)
- Will fail with ERR_TEMPLATE_MISSING

**Known affected:**
- 707058 (Design Meeting) ✅ CONFIRMED

**Potentially affected:**
- Need to audit all meeting-based stages

### Test Results Impact
**Current:** 15/20 tests passing (75%)
**After fix:** Should be 20/20 tests passing (100%)

All 5 failing tests are due to this single root cause.

## 🚀 Next Steps

1. ✅ Root cause identified
2. ⏳ Implement fix in matter-stage-change.js
3. ⏳ Update calendar_event_mappings table
4. ⏳ Re-run integration tests
5. ⏳ Verify 100% pass rate
