-- Create excluded_folders table for document automation filtering
CREATE TABLE IF NOT EXISTS excluded_folders (
  id BIGSERIAL PRIMARY KEY,
  folder_name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_excluded_folders_active
  ON excluded_folders(folder_name) WHERE active = true;

-- Insert common excluded folders
-- Note: Matching is done case-insensitive in the code
INSERT INTO excluded_folders (folder_name, active) VALUES
  ('Emails', true),
  ('Email', true),
  ('Original Emails', true),
  ('Original Email', true),
  ('Email Attachments', true),
  ('Email Attachment', true)
ON CONFLICT (folder_name) DO NOTHING;

-- Add comment
COMMENT ON TABLE excluded_folders IS 'Folder names that should not trigger document creation tasks';
