-- Migration: Track when tasks are assigned to Sheila Condomina
-- Purpose: Monitor and audit task assignments to specific users
-- Created: 2025-01-19

-- Create table for tracking Sheila's task assignments
CREATE TABLE IF NOT EXISTS "sheila-temp-assignee-changes" (
  id BIGSERIAL PRIMARY KEY,

  -- Task information
  task_id BIGINT NOT NULL,
  task_name TEXT,
  task_desc TEXT,
  due_date TIMESTAMP,
  status TEXT,

  -- Assignee change details
  previous_assignee_id BIGINT,
  previous_assignee_name TEXT,
  new_assignee_id BIGINT NOT NULL,
  new_assignee_name TEXT NOT NULL,

  -- Original task creation info
  task_originally_created_at TIMESTAMP,
  task_originally_created_by TEXT,

  -- Change tracking
  changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Metadata
  matter_id BIGINT,
  stage_name TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sheila_assignee_task_id ON "sheila-temp-assignee-changes"(task_id);
CREATE INDEX IF NOT EXISTS idx_sheila_assignee_changed_at ON "sheila-temp-assignee-changes"(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sheila_assignee_new_assignee ON "sheila-temp-assignee-changes"(new_assignee_id);

-- Add comment
COMMENT ON TABLE "sheila-temp-assignee-changes" IS 'Tracks when tasks are assigned to Sheila Condomina (IDs: 357896692, 358412483) for auditing purposes';
