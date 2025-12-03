#!/usr/bin/env node

/**
 * Add uses_meeting_location column to calendar_event_mappings table
 *
 * This field indicates whether signing meetings should use the meeting location
 * instead of the matter location for assignee resolution.
 */

console.log('='.repeat(80));
console.log('ADD uses_meeting_location COLUMN TO calendar_event_mappings TABLE');
console.log('='.repeat(80));
console.log('\nRun this SQL in Supabase SQL Editor:\n');
console.log('Dashboard → SQL Editor → New Query → Paste SQL below → Run\n');
console.log('='.repeat(80));

const sql = `
-- Add uses_meeting_location column (default false for backwards compatibility)
ALTER TABLE calendar_event_mappings
ADD COLUMN IF NOT EXISTS uses_meeting_location BOOLEAN DEFAULT false;

-- Set Signing Meeting to use meeting location
UPDATE calendar_event_mappings
SET uses_meeting_location = true
WHERE stage_name = 'Signing Meeting';

-- Add comment
COMMENT ON COLUMN calendar_event_mappings.uses_meeting_location IS
'If true, use meeting location for assignee resolution instead of matter location (for signing meetings)';
`;

console.log(sql);
console.log('='.repeat(80));
console.log('✅ After running the SQL, signing meetings will use meeting location');
console.log('='.repeat(80));
