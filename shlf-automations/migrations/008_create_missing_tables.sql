-- Migration 008: Create Missing Tables for Test Suite
-- Date: 2025-10-04
-- Description: Creates calendar_event_mappings, attempt_sequences, and location_keywords tables

-- ============================================================================
-- Table: calendar_event_mappings
-- Purpose: Maps Clio calendar event types to task templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS calendar_event_mappings (
  id BIGSERIAL PRIMARY KEY,
  calendar_event_id TEXT NOT NULL,
  calendar_event_name TEXT NOT NULL,
  stage_id TEXT,
  stage_name TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure unique mapping per calendar event
  CONSTRAINT unique_calendar_event_mapping UNIQUE (calendar_event_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_calendar_event_mappings_event_id
  ON calendar_event_mappings(calendar_event_id)
  WHERE active = true;

-- Add comments
COMMENT ON TABLE calendar_event_mappings IS 'Maps Clio calendar event types to task templates for meeting automations';
COMMENT ON COLUMN calendar_event_mappings.calendar_event_id IS 'Clio calendar event type ID';
COMMENT ON COLUMN calendar_event_mappings.calendar_event_name IS 'Display name of the calendar event type';
COMMENT ON COLUMN calendar_event_mappings.stage_id IS 'Optional: Associated stage ID if event is stage-specific';
COMMENT ON COLUMN calendar_event_mappings.active IS 'Whether this mapping is currently active';

-- ============================================================================
-- Table: attempt_sequences
-- Purpose: Defines task attempt progression (Attempt 1 → 2 → 3 → No Response)
-- ============================================================================

CREATE TABLE IF NOT EXISTS attempt_sequences (
  id BIGSERIAL PRIMARY KEY,
  current_attempt TEXT NOT NULL,
  next_attempt TEXT NOT NULL,
  days_until_next INTEGER NOT NULL,
  sequence_order INTEGER NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure unique current attempt
  CONSTRAINT unique_current_attempt UNIQUE (current_attempt)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_attempt_sequences_current
  ON attempt_sequences(current_attempt)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_attempt_sequences_order
  ON attempt_sequences(sequence_order);

-- Add comments
COMMENT ON TABLE attempt_sequences IS 'Defines the progression of attempt tasks (e.g., Attempt 1 → Attempt 2)';
COMMENT ON COLUMN attempt_sequences.current_attempt IS 'Name of current attempt (e.g., "attempt 1")';
COMMENT ON COLUMN attempt_sequences.next_attempt IS 'Name of next attempt to create (e.g., "attempt 2")';
COMMENT ON COLUMN attempt_sequences.days_until_next IS 'Number of days after current task completion to schedule next task';
COMMENT ON COLUMN attempt_sequences.sequence_order IS 'Order in the sequence (1, 2, 3, etc.)';

-- ============================================================================
-- Table: location_keywords
-- Purpose: Valid location keywords for assignee resolution
-- ============================================================================

CREATE TABLE IF NOT EXISTS location_keywords (
  id BIGSERIAL PRIMARY KEY,
  keyword TEXT NOT NULL,
  description TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure unique keywords
  CONSTRAINT unique_location_keyword UNIQUE (keyword)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_location_keywords_keyword
  ON location_keywords(keyword)
  WHERE active = true;

-- Add comments
COMMENT ON TABLE location_keywords IS 'Valid location keywords used for assignee resolution in signing meetings';
COMMENT ON COLUMN location_keywords.keyword IS 'Location keyword (e.g., "Fort Myers", "Naples")';
COMMENT ON COLUMN location_keywords.description IS 'Optional description of the location';
COMMENT ON COLUMN location_keywords.active IS 'Whether this keyword is currently valid';

-- ============================================================================
-- Insert Default Data
-- ============================================================================

-- Insert default attempt sequences
INSERT INTO attempt_sequences (current_attempt, next_attempt, days_until_next, sequence_order, active)
VALUES
  ('attempt 1', 'attempt 2', 7, 1, true),
  ('attempt 2', 'attempt 3', 7, 2, true),
  ('attempt 3', 'no response', 7, 3, true)
ON CONFLICT (current_attempt) DO NOTHING;

-- Insert common location keywords (these should be customized based on your offices)
INSERT INTO location_keywords (keyword, description, active)
VALUES
  ('Fort Myers Office', 'Main Fort Myers office location', true),
  ('Fort Myers', 'Fort Myers location', true),
  ('Naples Office', 'Naples office location', true),
  ('Naples', 'Naples location', true),
  ('Cape Coral Office', 'Cape Coral office location', true),
  ('Cape Coral', 'Cape Coral location', true)
ON CONFLICT (keyword) DO NOTHING;

-- Insert sample calendar event mappings (Initial Consultation)
-- Note: You'll need to get the actual calendar_event_id from Clio
INSERT INTO calendar_event_mappings (calendar_event_id, calendar_event_name, active)
VALUES
  ('334801', 'Initial Consultation', true)
ON CONFLICT (calendar_event_id) DO NOTHING;

-- ============================================================================
-- Grant Permissions
-- ============================================================================

-- Grant appropriate permissions (adjust role as needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_event_mappings TO authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON attempt_sequences TO authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON location_keywords TO authenticated;

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Verify tables were created
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('calendar_event_mappings', 'attempt_sequences', 'location_keywords')
ORDER BY table_name;

-- Verify default data
SELECT 'attempt_sequences' as table_name, COUNT(*) as row_count FROM attempt_sequences
UNION ALL
SELECT 'location_keywords', COUNT(*) FROM location_keywords
UNION ALL
SELECT 'calendar_event_mappings', COUNT(*) FROM calendar_event_mappings;
