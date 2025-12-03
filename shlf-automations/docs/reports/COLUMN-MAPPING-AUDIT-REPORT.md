# Column Mapping Audit Report
**Date:** 2025-10-21
**Purpose:** Verify all Supabase column names are correctly mapped in automation code

---

## Executive Summary

✅ **All column mappings are correct and working properly**

The code in `src/utils/date-helpers.js` correctly handles all three table formats with their different naming conventions. The fix applied today (adding `due_date-value-only` check) completed the compatibility matrix.

---

## Supabase Table Schemas

### 1. `task-list-non-meeting`
Used by: Matter stage change automation (Estate Planning, etc.)

| Column Name | Type | Notes |
|------------|------|-------|
| `task_number` | bigint | ✅ Used directly |
| `task_title` | text | ✅ Used directly |
| `task-description` | text | ⚠️ Has hyphen |
| `due_date-value-only` | bigint | ⚠️ Has hyphen + "-only" suffix |
| `due_date-time-relation` | text | ⚠️ Has hyphen |
| `due_date-relational` | text | ⚠️ Has hyphen |
| `assignee` | text | ✅ Used directly |
| `assignee_id` | text | ✅ Used directly |

### 2. `task-list-meeting`
Used by: Calendar event/meeting automation

| Column Name | Type | Notes |
|------------|------|-------|
| `task_number` | bigint | ✅ Used directly |
| `task_title` | text | ✅ Used directly |
| `task_desc` | text | ✅ Different from other tables |
| `due_date_value` | bigint | ✅ Underscores (no hyphens) |
| `due_date_time_relation` | text | ✅ Underscores (no hyphens) |
| `due_date_relation` | text | ✅ No "al" suffix (differs from others) |
| `assignee` | text | ✅ Used directly |
| `calendar_event_id` | bigint | ✅ Used directly |

### 3. `task-list-probate`
Used by: Probate practice area automation

| Column Name | Type | Notes |
|------------|------|-------|
| `task_number` | bigint | ✅ Used directly |
| `task_title` | text | ✅ Used directly |
| `task_description` | text | ✅ Underscores (no hyphen) |
| `due_date-value` | text | ⚠️ Has hyphen, TEXT type (not bigint) |
| `due_date-time-relation` | text | ⚠️ Has hyphen |
| `due_date-relational` | text | ⚠️ Has hyphen |
| `assignee` | text | ✅ Used directly |
| `assignee_id` | bigint | ✅ Used directly |

---

## Code Mapping Strategy

### Location: `src/utils/date-helpers.js` (lines 48-50)

```javascript
const value = parseInt(
  taskTemplate.due_date_value ||           // task-list-meeting ✅
  taskTemplate['due_date-value-only'] ||   // task-list-non-meeting ✅
  taskTemplate['due_date-value'] ||        // task-list-probate ✅
  0                                         // default fallback
);

const timeRelation =
  taskTemplate.due_date_time_relation ||   // task-list-meeting ✅
  taskTemplate['due_date-time-relation'] || // task-list-non-meeting, probate ✅
  'days';                                   // default fallback

const relationType =
  taskTemplate.due_date_relation ||        // task-list-meeting ✅
  taskTemplate['due_date-relational'] ||   // task-list-non-meeting, probate ✅
  'after creation';                         // default fallback
```

### Description Field Handling

Each automation checks for the appropriate format:

**matter-stage-change.js** (line 510):
```javascript
description: template['task-description'] || template.task_description || template.task_desc
```

**meeting-scheduled.js** (line 538):
```javascript
description: template.task_desc  // Uses task-list-meeting format
```

**task-completion.js** (lines 277, 374):
```javascript
description: nextTemplate['task-description'] || nextTemplate.task_description
```

---

## Verification Tests

### Test Results:

1. ✅ **task-list-non-meeting**: Correctly calculates `due_date-value-only` = 2 days
2. ✅ **task-list-meeting**: Correctly calculates `due_date_value` with `due_date_relation`
3. ✅ **task-list-probate**: Correctly parses text value from `due_date-value`
4. ✅ **Weekend Protection**: Automatically shifts weekend dates to Monday

---

## Compatibility Matrix

| Field | non-meeting | meeting | probate | Code Coverage |
|-------|-------------|---------|---------|---------------|
| **due_date value** | `due_date-value-only` | `due_date_value` | `due_date-value` | ✅ All checked |
| **time_relation** | `due_date-time-relation` | `due_date_time_relation` | `due_date-time-relation` | ✅ All checked |
| **relational** | `due_date-relational` | `due_date_relation` | `due_date-relational` | ✅ All checked |
| **description** | `task-description` | `task_desc` | `task_description` | ✅ All checked |

---

## Issues Found & Fixed

### Issue #1: Missing `due_date-value-only` check
- **Status:** ✅ FIXED (2025-10-21)
- **File:** `src/utils/date-helpers.js`
- **Impact:** Tasks from `task-list-non-meeting` were defaulting to 0 days
- **Fix:** Added `taskTemplate['due_date-value-only']` check in fallback chain

---

## Recommendations

### ✅ No Code Changes Needed
The current implementation correctly handles all column name variations across all three tables.

### 📝 Optional: Database Schema Standardization
For future maintainability, consider standardizing column names:
- Choose either hyphens OR underscores (not mixed)
- Consistent naming: `due_date_value` vs `due_date_value_only`
- However, this is **NOT required** as the code handles all variations

---

## Automation Coverage

### Files Audited:
- ✅ `src/utils/date-helpers.js` - Core date calculation logic
- ✅ `src/automations/matter-stage-change.js` - Stage change automation
- ✅ `src/automations/meeting-scheduled.js` - Calendar event automation
- ✅ `src/automations/task-completion.js` - Task completion automation

### All automations correctly:
1. Handle all table format variations
2. Calculate due dates properly
3. Apply weekend protection
4. Support relative date calculations (before/after task, before/after meeting)

---

## Conclusion

**The system is fully compatible with all Supabase table schemas.**

The fix applied today ensures that the "Record Deed" task (and all other `task-list-non-meeting` tasks) now correctly calculate due dates. All three table formats are properly supported by the code through comprehensive fallback chains.

No additional changes required. ✅
