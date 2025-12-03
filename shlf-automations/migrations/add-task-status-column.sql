-- Migration: Add status column to tasks table for tracking task lifecycle
-- Status values: 'pending', 'completed', 'deleted'
-- Created: 2025-11-12

-- Add status column with default value 'pending'
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';

-- Backfill existing records: set status='completed' where completed=true
UPDATE tasks SET status = 'completed' WHERE completed = true;

-- Add check constraint to ensure only valid status values
ALTER TABLE tasks ADD CONSTRAINT check_task_status
  CHECK (status IN ('pending', 'completed', 'deleted'));

-- Create index for status filtering (optional but recommended for performance)
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Add comment to document the column
COMMENT ON COLUMN tasks.status IS 'Task lifecycle status: pending (newly created), completed (marked complete), deleted (soft deleted)';
