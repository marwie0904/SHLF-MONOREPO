#!/usr/bin/env node

/**
 * Add calendar_entry_id column to tasks table
 * This tracks which calendar entry created each task, allowing us to:
 * 1. Distinguish tasks created by calendar events vs stage changes
 * 2. Update only the correct tasks when a calendar event is updated
 */

console.log('='.repeat(80));
console.log('ADD calendar_entry_id COLUMN TO tasks TABLE');
console.log('='.repeat(80));
console.log('\nRun this SQL in Supabase SQL Editor:\n');
console.log('Dashboard → SQL Editor → New Query → Paste SQL below → Run\n');
console.log('='.repeat(80));

const sql = `
-- Add calendar_entry_id column (nullable - tasks from stage changes won't have this)
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS calendar_entry_id BIGINT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tasks_calendar_entry_id
ON tasks(calendar_entry_id);

-- Add comment
COMMENT ON COLUMN tasks.calendar_entry_id IS
'ID of the calendar entry that created this task (NULL for tasks created by stage changes)';
`;

console.log(sql);
console.log('='.repeat(80));
console.log('✅ After running the SQL, the migration will be complete');
console.log('='.repeat(80));
