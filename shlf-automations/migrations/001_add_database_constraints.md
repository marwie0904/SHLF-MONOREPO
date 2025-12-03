# Migration 001: Add Database Constraints

**Created:** 2025-10-03
**Status:** Ready for execution
**Risk Level:** MEDIUM (requires data cleanup)

---

## Problem Statement

Current database has:
- **929 duplicate task groups** (same matter_id + stage_id + task_number)
- No unique constraints preventing duplicates
- No foreign keys enforcing referential integrity
- Race conditions causing duplicate task creation

---

## Analysis Results

### Duplicate Tasks Found

```sql
-- Duplicates by combination
SELECT COUNT(*) as duplicate_groups
FROM (
  SELECT matter_id, stage_id, task_number
  FROM tasks
  WHERE matter_id IS NOT NULL
    AND stage_id IS NOT NULL
    AND task_number IS NOT NULL
  GROUP BY matter_id, stage_id, task_number
  HAVING COUNT(*) > 1
) duplicates;

-- Result: 929 duplicate groups
```

**Worst offenders:**
- Matter 1689145418, Stage 707073, Task #1: **10 duplicates**
- Matter 1707839843, Stage 707073, Task #4: **10 duplicates**
- Matter 1707839843, Stage 707073, Task #3: **10 duplicates**

**Pattern:** Most duplicates are in stage 707073 (Signing Meeting)

---

## Migration Strategy

### Phase 1: Data Cleanup (Deduplication)

**Goal:** Keep the most recent task, delete older duplicates

**Strategy:**
```sql
-- For each duplicate group, keep only the task with the latest task_date_generated
-- Delete all others
```

**Safety:**
- Use a transaction
- Create backup before deletion
- Test on a single matter first

### Phase 2: Add Constraints

After cleanup, add:
1. Unique constraint on tasks (matter_id, stage_id, task_number)
2. Foreign keys for referential integrity
3. Indexes for performance

---

## Step-by-Step Execution Plan

### Step 1: Create Backup

```sql
-- Create backup table
CREATE TABLE tasks_backup_20251003 AS
SELECT * FROM tasks;

-- Verify backup
SELECT COUNT(*) FROM tasks_backup_20251003;
```

### Step 2: Deduplicate Tasks

```sql
-- Strategy: Keep the LATEST task (by task_date_generated) for each duplicate group
-- Delete older ones

-- Create a temp table with tasks to KEEP
CREATE TEMP TABLE tasks_to_keep AS
SELECT DISTINCT ON (matter_id, stage_id, task_number) task_id
FROM tasks
WHERE matter_id IS NOT NULL
  AND stage_id IS NOT NULL
  AND task_number IS NOT NULL
ORDER BY matter_id, stage_id, task_number,
         task_date_generated DESC NULLS LAST,
         task_id DESC; -- If dates are same, keep higher ID

-- Count tasks to delete
SELECT COUNT(*) as tasks_to_delete
FROM tasks
WHERE matter_id IS NOT NULL
  AND stage_id IS NOT NULL
  AND task_number IS NOT NULL
  AND task_id NOT IN (SELECT task_id FROM tasks_to_keep);

-- DELETE duplicates (keeping latest)
DELETE FROM tasks
WHERE matter_id IS NOT NULL
  AND stage_id IS NOT NULL
  AND task_number IS NOT NULL
  AND task_id NOT IN (SELECT task_id FROM tasks_to_keep);

-- Verify no more duplicates
SELECT matter_id, stage_id, task_number, COUNT(*) as count
FROM tasks
WHERE matter_id IS NOT NULL
  AND stage_id IS NOT NULL
  AND task_number IS NOT NULL
GROUP BY matter_id, stage_id, task_number
HAVING COUNT(*) > 1;
-- Should return 0 rows
```

### Step 3: Add Unique Constraint

```sql
-- Add unique constraint on tasks table
ALTER TABLE tasks
ADD CONSTRAINT unique_task_per_stage
UNIQUE (matter_id, stage_id, task_number);

-- This will now prevent:
-- - Duplicate task creation from race conditions
-- - Same task being created multiple times
```

### Step 4: Add Foreign Keys (Optional but Recommended)

```sql
-- Add foreign key from tasks to matter-info
-- Note: matter-info already has PRIMARY KEY on matter_id

ALTER TABLE tasks
ADD CONSTRAINT fk_tasks_matter
FOREIGN KEY (matter_id)
REFERENCES "matter-info"(matter_id)
ON DELETE CASCADE; -- If matter deleted, delete its tasks

-- Note: Cannot add FK to stages table as it doesn't exist in Supabase
-- Stage data lives in Clio, we only reference it
```

### Step 5: Add Indexes for Performance

```sql
-- Add index on matter_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_tasks_matter_id
ON tasks(matter_id);

-- Add index on stage_id for faster filtering
CREATE INDEX IF NOT EXISTS idx_tasks_stage_id
ON tasks(stage_id);

-- Add index on completed for filtering active tasks
CREATE INDEX IF NOT EXISTS idx_tasks_completed
ON tasks(completed);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_matter_stage_number
ON tasks(matter_id, stage_id, task_number);
-- This index is automatically created by the UNIQUE constraint
```

---

## Rollback Plan

If something goes wrong:

```sql
-- Step 1: Drop constraints
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS unique_task_per_stage;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS fk_tasks_matter;

-- Step 2: Restore from backup
TRUNCATE TABLE tasks;
INSERT INTO tasks SELECT * FROM tasks_backup_20251003;

-- Step 3: Verify restore
SELECT COUNT(*) FROM tasks;
```

---

## Code Changes Required

### Update Error Handling

The code already handles constraint violations gracefully in the Clio/Supabase sync section:

```javascript
// In matter-stage-change.js and meeting-scheduled.js
try {
  await SupabaseService.insertTask({...});
} catch (supabaseError) {
  // Log orphaned task
  await SupabaseService.logError(
    ERROR_CODES.SUPABASE_SYNC_FAILED,
    `Task created in Clio but failed to record in Supabase: ${supabaseError.message}`,
    {...}
  );
}
```

**However**, we should handle the specific constraint violation:

```javascript
try {
  await SupabaseService.insertTask({...});
} catch (supabaseError) {
  // Check if it's a duplicate key violation
  if (supabaseError.code === '23505') { // PostgreSQL unique violation
    console.log(`[MATTER] ${matterId} Task already exists (duplicate prevented by constraint)`);
    // This is actually a SUCCESS - constraint prevented duplicate
    return;
  }

  // Other errors - log as before
  await SupabaseService.logError(
    ERROR_CODES.SUPABASE_SYNC_FAILED,
    `Task created in Clio but failed to record in Supabase: ${supabaseError.message}`,
    {...}
  );
}
```

---

## Testing Plan

### Test 1: Verify Constraint Works

```sql
-- Try to insert duplicate task (should fail)
INSERT INTO tasks (task_id, task_name, matter_id, stage_id, task_number)
VALUES (99999, 'Test Task', 1675950832, 707058, 1);

-- Try again (should fail with constraint violation)
INSERT INTO tasks (task_id, task_name, matter_id, stage_id, task_number)
VALUES (99998, 'Test Task 2', 1675950832, 707058, 1);

-- Expected error: duplicate key value violates unique constraint "unique_task_per_stage"

-- Cleanup
DELETE FROM tasks WHERE task_id IN (99999, 99998);
```

### Test 2: Test Automation End-to-End

1. Trigger matter stage change webhook
2. Verify task created
3. Trigger same webhook again (simulating race condition)
4. Verify only ONE task exists
5. Check error_logs for constraint violation (if any)

### Test 3: Test Foreign Key Cascade

```sql
-- Create test matter
INSERT INTO "matter-info" (matter_id, matter_name, stage_id, stage_name)
VALUES (99999, 'Test Matter', 707058, 'Test Stage');

-- Create test task
INSERT INTO tasks (task_id, task_name, matter_id, stage_id, task_number)
VALUES (99999, 'Test Task', 99999, 707058, 1);

-- Delete matter (should cascade delete task)
DELETE FROM "matter-info" WHERE matter_id = 99999;

-- Verify task deleted
SELECT COUNT(*) FROM tasks WHERE matter_id = 99999;
-- Expected: 0

-- Cleanup (if needed)
DELETE FROM tasks WHERE matter_id = 99999;
```

---

## Execution Checklist

- [ ] Create backup table
- [ ] Verify backup row count matches
- [ ] Run deduplication query (DRY RUN - count only)
- [ ] Verify deduplication count is reasonable
- [ ] Execute deduplication DELETE
- [ ] Verify no duplicates remain
- [ ] Add unique constraint
- [ ] Test constraint with manual insert
- [ ] Add foreign keys
- [ ] Test foreign key cascade
- [ ] Add indexes
- [ ] Update code to handle constraint violations
- [ ] Test automations end-to-end
- [ ] Monitor error_logs for constraint violations
- [ ] Document in CHANGELOG

---

## Expected Impact

### Before Migration
- 929 duplicate task groups
- ~2000+ total duplicate tasks
- No protection against future duplicates

### After Migration
- 0 duplicate tasks
- Database prevents future duplicates
- Foreign keys ensure data integrity
- Indexes improve query performance
- Constraint violations logged in error_logs

---

## Monitoring After Deployment

Watch for:
```sql
-- Check for constraint violation errors
SELECT * FROM error_logs
WHERE error_message LIKE '%unique constraint%'
  AND created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;

-- Check for orphaned Clio tasks (created but not in Supabase due to constraint)
SELECT * FROM error_logs
WHERE error_code = 'ERR_SUPABASE_SYNC_FAILED'
  AND error_message LIKE '%unique%'
  AND created_at > NOW() - INTERVAL '1 day';
```

---

## Risk Assessment

**LOW RISK:**
- Backup created before changes
- Can rollback easily
- Code already handles sync failures
- Only affects internal tracking (Clio is source of truth)

**MEDIUM RISK:**
- Deleting ~2000 duplicate records
- Need to ensure we keep the "right" duplicates

**MITIGATION:**
- Keep latest task (by task_date_generated)
- Create backup before deletion
- Test on non-production data first
- Monitor error_logs after deployment

---

**Ready for execution:** YES
**Requires downtime:** NO
**Estimated time:** 30 minutes
**Best time to run:** During low activity (evening/weekend)
