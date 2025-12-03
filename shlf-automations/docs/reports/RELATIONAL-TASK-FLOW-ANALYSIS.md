# Relational Task Flow Analysis
**Date:** 2025-10-21
**Question:** When does "4 days after task 2" get calculated?

---

## Your Question Answered

Given your example:
- **Task 2:** "Record Deed" - 2 days after creation
- **Task 3:** "Mail Recorded Deed" - 4 days after task 2

**When you complete Task 2 on October 21:**
- Task 3 due date is set to **October 25** (4 days from completion)

---

## The Implementation Flow

### Phase 1: Stage Change (Matter moved to new stage)

**File:** `src/automations/matter-stage-change.js`

1. **All tasks are created immediately**, including Task 2 and Task 3
2. **Task 2 (Record Deed):**
   - Due date: Calculated as "2 days after creation"
   - Created with actual due date: October 23 (if created on Oct 21)

3. **Task 3 (Mail Recorded Deed):**
   - Detected as relational: `due_date-relational` contains "after task"
   - **Created with NULL due date** (line 489-490)
   - Task exists but has no due date yet

**Code:**
```javascript
// matter-stage-change.js:488-490
if (isRelationalToTask && !isAttemptTask) {
  dueDateFormatted = null;  // Task created with no due date
}
```

### Phase 2: Task Completion (Task 2 is completed)

**File:** `src/automations/task-completion.js`

When Task 2 is marked complete:

1. **Webhook triggered:** `task.completed` for Task 2
2. **handleDependentTasks() called** (line 192)
3. **Finds Task 3** because it has `"after task 2"` in relation field
4. **Task 3 already exists** (created in Phase 1 with null due date)
5. **Updates Task 3 with due date** calculated from **completion time**

**Key Code:**
```javascript
// task-completion.js:350-352
// Calculate due date relative to completion time
const dueDate = calculateDueDate(template, new Date());  // Uses NOW (completion time)
const dueDateFormatted = formatForClio(dueDate);

// task-completion.js:354-366
if (existingTask) {
  // Update existing task (Task 3 exists from Phase 1)
  await ClioService.updateTask(existingTask.task_id, {
    due_at: dueDateFormatted,
  });
}
```

---

## Your Specific Example

### Scenario:
- **October 21:** Matter moved to "For Recording and Submission"

### What Happens:

**Stage Change (October 21):**
```
Task 2: Record Deed
  - Created: October 21
  - Due Date: October 23 (2 days after creation)
  - Status: Pending

Task 3: Mail Recorded Deed
  - Created: October 21
  - Due Date: NULL (waiting for Task 2)
  - Status: Pending
```

**Task 2 Completed (October 21):**
```
Task 2: Record Deed
  - Completed: October 21
  - Status: Complete

Task 3: Mail Recorded Deed
  - Due Date UPDATED: October 25 (4 days from October 21 completion)
  - Status: Pending
```

**Task 2 Completed (October 27, hypothetically):**
```
Task 3: Mail Recorded Deed
  - Due Date UPDATED: October 31 (4 days from October 27 completion)
  - Status: Pending
```

---

## Answer to Your Questions

### Q1: Do we generate task 3 instantly at 3+4 days after creation?
**A:** ❌ No

### Q2: Do we generate task 3 at 3+4 days when task 2 is completed?
**A:** ❌ No (the 3 days is irrelevant)

### Q3: Do we generate task 3 at 4 days when task 2 is completed?
**A:** ✅ **YES - This is correct**

---

## The Key Logic

**Reference date for "after task X" is ALWAYS the completion time of that task, NOT its due date.**

From `task-completion.js:351`:
```javascript
const dueDate = calculateDueDate(template, new Date());  // new Date() = NOW
```

This means:
- Task 2's due date is **irrelevant** to Task 3's calculation
- Task 3 is calculated from **when Task 2 is actually completed**
- If Task 2 is completed early or late, Task 3 adjusts accordingly

---

## Workflow Timeline

```
Day 0 (Oct 21): Stage Change
├─ Task 2 created, due Oct 23
└─ Task 3 created, due NULL

Day 0 (Oct 21): Task 2 Completed
└─ Task 3 due date set to Oct 25 (completion + 4 days)

Day 4 (Oct 25): Task 3 Due
└─ Task 3 should be completed

Alternative Timeline (Late Completion):
Day 0 (Oct 21): Stage Change
├─ Task 2 created, due Oct 23
└─ Task 3 created, due NULL

Day 6 (Oct 27): Task 2 Completed (late!)
└─ Task 3 due date set to Oct 31 (completion + 4 days)

Day 10 (Oct 31): Task 3 Due
└─ Task 3 should be completed
```

---

## Weekend Protection

Even for relational tasks, weekend protection applies:

If Task 2 is completed on **Friday**, and template says "4 days after":
- Raw calculation: Friday + 4 days = **Tuesday**
- Weekend check: Tuesday is not a weekend
- Final due date: **Tuesday** ✅

If Task 2 is completed on **Wednesday**, and template says "4 days after":
- Raw calculation: Wednesday + 4 days = **Sunday**
- Weekend check: Sunday IS a weekend
- Final due date: **Monday** (shifted from Sunday) ✅

---

## Code Files Involved

1. **matter-stage-change.js:489-490**
   - Creates Task 3 with NULL due date during stage change

2. **task-completion.js:312-406**
   - Updates Task 3 with due date when Task 2 completes

3. **date-helpers.js:45-80**
   - Calculates the due date using the reference date (completion time)

---

## Summary

**When does Task 3 (4 days after task 2) get its due date?**
- **Created:** Immediately during stage change (with NULL due date)
- **Due Date Set:** When Task 2 is completed (4 days from completion time)
- **Reference:** Completion time of Task 2, NOT its original due date

**Your example answer:**
If you complete Task 2 on October 21, Task 3 will be due on **October 25** ✅
