-- Create stage_status_mappings table
-- Maps matter stages to their corresponding matter statuses

CREATE TABLE IF NOT EXISTS stage_status_mappings (
  id BIGSERIAL PRIMARY KEY,
  stage_name TEXT NOT NULL UNIQUE,
  matter_status TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_stage_status_mappings_stage_name
  ON stage_status_mappings(stage_name) WHERE active = true;

-- Add comment
COMMENT ON TABLE stage_status_mappings IS 'Maps matter stages to their corresponding matter statuses in Clio';

-- Insert initial mappings based on user requirements
INSERT INTO stage_status_mappings (stage_name, matter_status, active) VALUES
  ('I/V MEETING', 'Pending', true),
  ('Did Not Engage', 'Closed', true),
  ('Drafting', 'Open', true),
  ('Signing Meeting', 'Open', true)
ON CONFLICT (stage_name) DO UPDATE SET
  matter_status = EXCLUDED.matter_status,
  updated_at = NOW();
