-- Migration 008: CLIO OAuth Tokens Storage
-- Purpose: Store and manage CLIO access tokens for automatic refresh
-- Created: 2025-11-06

-- Create tokens table
CREATE TABLE IF NOT EXISTS clio_tokens (
  id INTEGER PRIMARY KEY DEFAULT 1,
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure only one row exists (singleton pattern)
  CONSTRAINT single_row_check CHECK (id = 1)
);

-- Add comment
COMMENT ON TABLE clio_tokens IS 'Stores CLIO OAuth access tokens for automatic refresh system';
COMMENT ON COLUMN clio_tokens.access_token IS 'Current CLIO API access token (expires every 7 days)';
COMMENT ON COLUMN clio_tokens.expires_at IS 'When the current access token expires';
COMMENT ON COLUMN clio_tokens.last_refreshed_at IS 'When the token was last refreshed';

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_clio_tokens_updated_at ON clio_tokens;
CREATE TRIGGER update_clio_tokens_updated_at
  BEFORE UPDATE ON clio_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert initial row (will be updated by the application)
-- The application will populate this with the current token on first startup
INSERT INTO clio_tokens (id, access_token, expires_at)
VALUES (1, 'initial_token_will_be_replaced', NOW() + INTERVAL '7 days')
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE clio_tokens ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service role full access
CREATE POLICY "Service role can manage tokens"
  ON clio_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create policy to allow anon key read access (for startup token fetch)
CREATE POLICY "Anon can read tokens"
  ON clio_tokens
  FOR SELECT
  TO anon
  USING (true);

-- Create policy to allow anon key update access (for token refresh)
CREATE POLICY "Anon can update tokens"
  ON clio_tokens
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Create index for faster queries (though we only have 1 row)
CREATE INDEX IF NOT EXISTS idx_clio_tokens_expires_at ON clio_tokens(expires_at);

-- Grant permissions
GRANT SELECT, UPDATE ON clio_tokens TO anon;
GRANT ALL ON clio_tokens TO service_role;
