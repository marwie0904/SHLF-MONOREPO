-- Migration: Add failure_details column to webhook_events table
-- Created: 2025-11-01
-- Purpose: Track individual task failures in webhook processing

-- Add failure_details column
ALTER TABLE webhook_events
ADD COLUMN IF NOT EXISTS failure_details JSONB;

-- Add comment for documentation
COMMENT ON COLUMN webhook_events.failure_details IS 'Details of failed tasks (for partial failures)';

-- Verify column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'webhook_events'
  AND column_name = 'failure_details';
