# Due Date Corrections

This document tracks incorrect due dates found in the task-list-meeting table.

## Format
- **Stage Name**: The calendar event name
- **Stage ID**: The stage_id (if applicable)
- **Task Number**: The task number in sequence
- **Task Title**: The name of the task
- **Incorrect Due Date**: Current incorrect value in database
- **Corrected Due Date**: What it should be based on documentation

---

## Initial Meeting

### Task 2
- **Stage Name**: Initial Meeting
- **Stage ID**: N/A (calendar event)
- **Task Number**: 2
- **Task Title**: Call Client to confirm I/V Meeting
- **Incorrect Due Date**: 24 hours after creation
- **Corrected Due Date**: 2 days before meeting

---

## Pending Engagement

### Task 3
- **Stage Name**: Pending Engagement
- **Stage ID**: 828783
- **Task Number**: 3
- **Task Title**: Attempt 2
- **Incorrect Due Date**: 7 Days after task 2 (inconsistent with due_date_value of 4)
- **Corrected Due Date**: 4 days after task 2 is completed

### Task 4
- **Stage Name**: Pending Engagement
- **Stage ID**: 828783
- **Task Number**: 4
- **Task Title**: Attempt 3
- **Incorrect Due Date**: 7 Days after task 3 (also due_date_relation shows "after task 3")
- **Corrected Due Date**: 3 days after task 2 is completed

---

## Drafting

### Task 4
- **Stage Name**: Drafting
- **Stage ID**: 828768
- **Task Number**: 4
- **Task Title**: Review Draft
- **Incorrect Due Date**: 2 days after task 3 (inconsistent with due_date_value of 1 day)
- **Corrected Due Date**: 24 hours (1 day) after draft and assemble task is complete

---

## Funding in Progress

### Task 3
- **Stage Name**: Funding in Progress
- **Stage ID**: 1110277
- **Task Number**: 3
- **Task Title**: Check Funding Status
- **Incorrect Due Date**: 5 days after creation
- **Corrected Due Date**: Every 15 days

---

## Maintenance Meeting

### Task 1
- **Stage Name**: Maintenance
- **Stage ID**: N/A (calendar event)
- **Task Number**: 1
- **Task Title**: Print Maintenance Agreement
- **Incorrect Due Date**: 24 hours after meeting
- **Corrected Due Date**: 2 days before the meeting

### Task 2
- **Stage Name**: Maintenance
- **Stage ID**: N/A (calendar event)
- **Task Number**: 2
- **Task Title**: Meeting Confirmation (Call Client)
- **Incorrect Assignee**: VA
- **Corrected Assignee**: Office CSC
- **Due Date**: 2 days before meeting (correct)

### Task 3
- **Stage Name**: Maintenance
- **Stage ID**: N/A (calendar event)
- **Task Number**: 3
- **Task Title**: Confirmation Email
- **Incorrect Assignee**: CSC
- **Corrected Assignee**: VA
- **Due Date**: 2 days before meeting (correct)

### Task 4
- **Stage Name**: Maintenance
- **Stage ID**: N/A (calendar event)
- **Task Number**: 4
- **Task Title**: Update Matter
- **Incorrect Due Date**: 2 days before meeting
- **Corrected Due Date**: 24 hours after the meeting

---

## Notes
- Both Initial Meeting and Vision Meeting have the same issue with Task 2
- Task descriptions differ slightly but the due date issue is the same
- Pending Engagement has inconsistent data in due_date_full vs due_date_value fields
- Pending Engagement Task 4 has wrong task relation (should be after task 2, not task 3)
- Drafting Task 4 has inconsistent data between due_date_value (1 day) and due_date_full (2 days)
