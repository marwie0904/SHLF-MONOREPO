# Calendar Event Update Fix

## Problem
When updating a calendar event (e.g., changing a signing meeting's location or date):
1. **Assignees were NOT being updated** - even though the location changed, tasks kept the old assignee
2. **Wrong tasks were being updated** - system couldn't distinguish between tasks created by calendar events vs tasks created by stage changes

## Root Cause
The system had no way to track which automation created each task:
- Calendar event automation creates tasks from `task-list-meeting` table
- Stage change automation ALSO creates tasks from `task-list-meeting` table (for meeting-based stages)
- When calendar event was updated, the code would find ALL tasks with matching task_numbers and update the wrong ones

## Solution

### 1. Track Calendar Entry Source
Added `calendar_entry_id` field to tasks table to track which calendar entry created each task.

**Database Migration** (run in Supabase SQL Editor):
```sql
-- Add calendar_entry_id column (nullable - tasks from stage changes won't have this)
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS calendar_entry_id BIGINT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tasks_calendar_entry_id
ON tasks(calendar_entry_id);

-- Add comment
COMMENT ON COLUMN tasks.calendar_entry_id IS
'ID of the calendar entry that created this task (NULL for tasks created by stage changes)';
```

### 2. Store calendar_entry_id When Creating Tasks
Modified [meeting-scheduled.js:532](src/automations/meeting-scheduled.js#L532):
```javascript
await SupabaseService.insertTask({
  // ... other fields
  calendar_entry_id: calendarEntryId, // Track which calendar entry created this task
});
```

### 3. Filter Tasks by Calendar Entry
Modified [meeting-scheduled.js:250-254](src/automations/meeting-scheduled.js#L250-254):
```javascript
// OLD: Got ALL tasks for matter+stage (including stage-generated tasks)
const existingTasks = await SupabaseService.getTasksByMatterAndStage(
  matterId, mapping.stage_id, false
);

// NEW: Only get tasks created by THIS calendar entry
const existingTasks = await SupabaseService.getTasksByCalendarEntry(
  calendarEntryId, matterId, mapping.stage_id
);
```

Added new method to [supabase.js:356-367](src/services/supabase.js#L356-367):
```javascript
static async getTasksByCalendarEntry(calendarEntryId, matterId, stageId) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('calendar_entry_id', calendarEntryId)
    .eq('matter_id', matterId)
    .eq('stage_id', stageId)
    .eq('completed', false);

  if (error) throw error;
  return data || [];
}
```

### 4. Update Assignees When Meeting Location Changes
Modified [meeting-scheduled.js:573-634](src/automations/meeting-scheduled.js#L573-634):

**Before:**
```javascript
static async updateMeetingRelatedTasks(tasks, meetingDate) {
  // Only updated due_at
  await ClioService.updateTask(task.task_id, {
    due_at: dueDateFormatted,
  });
}
```

**After:**
```javascript
static async updateMeetingRelatedTasks(tasks, meetingDate, meetingLocation, matterDetails, mapping) {
  // Resolve assignee (may have changed if meeting location changed)
  const locationForAssignee = mapping.uses_meeting_location
    ? meetingLocation
    : matterDetails.location;

  const assignee = await resolveAssignee(template.assignee, matterDetails, locationForAssignee);

  // Check if due date OR assignee changed
  const dueDateChanged = !task.due_date || task.due_date !== dueDateFormatted;
  const assigneeChanged = task.assigned_user_id !== assignee.id;

  if (dueDateChanged || assigneeChanged) {
    // Update BOTH due_at and assignee
    await ClioService.updateTask(task.task_id, {
      due_at: dueDateFormatted,
      assignee: { id: assignee.id, type: assignee.type },
    });

    await SupabaseService.updateTask(task.task_id, {
      due_date: dueDateFormatted,
      assigned_user_id: assignee.id,
      assigned_user: assignee.name,
      due_date_generated: new Date().toISOString(),
    });
  }
}
```

## Files Changed
1. [src/automations/meeting-scheduled.js](src/automations/meeting-scheduled.js)
   - Line 250-254: Filter tasks by calendar_entry_id
   - Line 532: Store calendar_entry_id when creating tasks
   - Line 292: Pass additional parameters to updateMeetingRelatedTasks
   - Line 573-634: Update assignee when meeting location changes

2. [src/services/supabase.js](src/services/supabase.js)
   - Line 356-367: New method `getTasksByCalendarEntry`

3. [scripts/add-calendar-entry-id-column.mjs](scripts/add-calendar-entry-id-column.mjs) (NEW)
   - Displays SQL migration instructions

## Deployment Steps

### 1. Run Database Migration
```bash
node scripts/add-calendar-entry-id-column.mjs
```
Copy the SQL and run it in Supabase SQL Editor.

### 2. Deploy Code Changes
Push changes to Digital Ocean:
```bash
git add .
git commit -m "Fix: Track calendar entry source and update assignees on meeting changes"
git push origin main
```

Then redeploy on Digital Ocean App Platform.

### 3. Test
1. Create a signing meeting at one location
2. Verify tasks are created with correct assignee
3. Update the meeting to a different location
4. Verify assignees are updated to match new location

## Expected Behavior After Fix

### When calendar event is CREATED:
- ✅ Tasks created with `calendar_entry_id` set
- ✅ Assignees resolved based on meeting location (for signing meetings)
- ✅ Due dates calculated relative to meeting date

### When calendar event is UPDATED:
- ✅ Only updates tasks with matching `calendar_entry_id` (not stage-generated tasks)
- ✅ Updates BOTH due dates AND assignees
- ✅ Assignees recalculated if meeting location changed
- ✅ Meeting-related tasks from stage changes also updated with new dates/assignees

### When stage is changed (without calendar event):
- ✅ Tasks created with `calendar_entry_id` = NULL
- ✅ Meeting-related tasks have NULL due dates (until calendar event created)
- ✅ Non-meeting tasks have due dates calculated from stage change date

## Answer to Original Question

**Q: When I update a signing meeting to different location and due date:**
1. **Will due dates be updated?** ✅ **YES** - Both calendar-generated and stage-generated meeting tasks
2. **Will assigned user be updated?** ✅ **YES** - Both calendar-generated and stage-generated meeting tasks (AFTER this fix)

Before this fix, only calendar-generated tasks would update assignee, and we couldn't tell them apart from stage-generated tasks.
