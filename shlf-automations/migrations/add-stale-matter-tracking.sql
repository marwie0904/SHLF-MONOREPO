-- Table to track matter stage duration and notification history
CREATE TABLE IF NOT EXISTS matter_stage_tracking (
  id BIGSERIAL PRIMARY KEY,
  matter_id BIGINT NOT NULL,
  stage_name TEXT NOT NULL,
  stage_entered_at TIMESTAMP WITH TIME ZONE NOT NULL,
  initial_notification_sent BOOLEAN DEFAULT false,
  initial_notification_sent_at TIMESTAMP WITH TIME ZONE,
  last_recurring_notification_at TIMESTAMP WITH TIME ZONE,
  recurring_notification_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(matter_id, stage_name)
);

CREATE INDEX IF NOT EXISTS idx_matter_stage_tracking_matter_id
ON matter_stage_tracking(matter_id);

CREATE INDEX IF NOT EXISTS idx_matter_stage_tracking_stage_name
ON matter_stage_tracking(stage_name);

CREATE INDEX IF NOT EXISTS idx_matter_stage_tracking_stage_entered_at
ON matter_stage_tracking(stage_entered_at);

COMMENT ON TABLE matter_stage_tracking IS
'Tracks when matters enter stages and notification history for stale matter alerts';

COMMENT ON COLUMN matter_stage_tracking.stage_entered_at IS
'When the matter first entered this stage';

COMMENT ON COLUMN matter_stage_tracking.initial_notification_sent IS
'Whether the initial 30-day no progress task has been created';

COMMENT ON COLUMN matter_stage_tracking.initial_notification_sent_at IS
'When the initial 30-day no progress task was created';

COMMENT ON COLUMN matter_stage_tracking.last_recurring_notification_at IS
'When the last recurring 30-day notification task was created';

COMMENT ON COLUMN matter_stage_tracking.recurring_notification_count IS
'Number of recurring 30-day notifications sent';
