-- Add verification tracking columns to tasks table
-- This allows us to track when post-verification was attempted on tasks

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS verification_attempted BOOLEAN DEFAULT false;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS verification_attempted_at TIMESTAMPTZ;

-- Add comment to document purpose
COMMENT ON COLUMN tasks.verification_attempted IS 'Indicates if this task was created/regenerated during post-verification process';
COMMENT ON COLUMN tasks.verification_attempted_at IS 'Timestamp when verification process attempted to create/regenerate this task';
