-- Add mapping for Maintenance Meeting
-- This is a meeting-only event with no associated matter stage
-- Uses placeholder stage_id 000001

INSERT INTO calendar_event_mappings
  (calendar_event_id, calendar_event_name, stage_id, stage_name, uses_meeting_location, active)
VALUES
  (372457, 'Maintenance Meeting', '000001', 'Maintenance Meeting', false, true)
ON CONFLICT (calendar_event_id) DO UPDATE SET
  stage_id = EXCLUDED.stage_id,
  stage_name = EXCLUDED.stage_name,
  uses_meeting_location = EXCLUDED.uses_meeting_location,
  active = EXCLUDED.active,
  updated_at = NOW();
