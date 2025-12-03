import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function executeMigration() {
  console.log('🚀 Executing stage_status_mappings migration...\n');

  try {
    // Step 1: Create the table using raw SQL through a function or direct insert attempt
    console.log('Step 1: Creating table structure...');

    // We'll try to insert a test record, which will create the table if auto-schema is enabled
    // Otherwise, we'll handle the error and provide instructions

    const testMapping = {
      stage_name: 'I/V MEETING',
      matter_status: 'Pending',
      active: true,
    };

    const { data: testData, error: testError } = await supabase
      .from('stage_status_mappings')
      .insert(testMapping)
      .select();

    if (testError) {
      if (testError.message.includes('relation') && testError.message.includes('does not exist')) {
        console.log('❌ Table does not exist. Creating via direct SQL execution...\n');

        // Use the REST API to execute raw SQL
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `
              CREATE TABLE IF NOT EXISTS stage_status_mappings (
                id BIGSERIAL PRIMARY KEY,
                stage_name TEXT NOT NULL UNIQUE,
                matter_status TEXT NOT NULL,
                active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
              );

              CREATE INDEX IF NOT EXISTS idx_stage_status_mappings_stage_name
                ON stage_status_mappings(stage_name) WHERE active = true;
            `
          })
        });

        if (!response.ok) {
          throw new Error(`Failed to execute SQL: ${response.status} ${response.statusText}`);
        }

        console.log('✅ Table created successfully\n');
      } else {
        throw testError;
      }
    } else {
      console.log('✅ Table already exists or test insert successful\n');
    }

    // Step 2: Insert all mappings
    console.log('Step 2: Inserting stage-status mappings...\n');

    const mappings = [
      { stage_name: 'I/V MEETING', matter_status: 'Pending', active: true },
      { stage_name: 'Did Not Engage', matter_status: 'Closed', active: true },
      { stage_name: 'Drafting', matter_status: 'Open', active: true },
      { stage_name: 'Signing Meeting', matter_status: 'Open', active: true },
    ];

    for (const mapping of mappings) {
      // First, try to check if it exists
      const { data: existing } = await supabase
        .from('stage_status_mappings')
        .select('*')
        .eq('stage_name', mapping.stage_name)
        .single();

      if (existing) {
        // Update existing
        const { error: updateError } = await supabase
          .from('stage_status_mappings')
          .update({
            matter_status: mapping.matter_status,
            active: mapping.active,
            updated_at: new Date().toISOString()
          })
          .eq('stage_name', mapping.stage_name);

        if (updateError) {
          console.error(`❌ Failed to update ${mapping.stage_name}:`, updateError.message);
        } else {
          console.log(`✅ Updated: ${mapping.stage_name} → ${mapping.matter_status}`);
        }
      } else {
        // Insert new
        const { error: insertError } = await supabase
          .from('stage_status_mappings')
          .insert(mapping);

        if (insertError) {
          console.error(`❌ Failed to insert ${mapping.stage_name}:`, insertError.message);
        } else {
          console.log(`✅ Inserted: ${mapping.stage_name} → ${mapping.matter_status}`);
        }
      }
    }

    console.log('\n✨ Migration completed successfully!\n');

    // Step 3: Verify the data
    console.log('Step 3: Verifying inserted data...\n');
    const { data: allMappings, error: selectError } = await supabase
      .from('stage_status_mappings')
      .select('*')
      .order('stage_name');

    if (selectError) {
      console.error('❌ Failed to verify data:', selectError.message);
    } else {
      console.log('Current mappings in database:');
      console.table(allMappings.map(m => ({
        'Stage Name': m.stage_name,
        'Matter Status': m.matter_status,
        'Active': m.active ? 'Yes' : 'No',
      })));
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nPlease run this SQL manually in Supabase Dashboard → SQL Editor:\n');
    console.log(`
-- Create stage_status_mappings table
CREATE TABLE IF NOT EXISTS stage_status_mappings (
  id BIGSERIAL PRIMARY KEY,
  stage_name TEXT NOT NULL UNIQUE,
  matter_status TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add index
CREATE INDEX IF NOT EXISTS idx_stage_status_mappings_stage_name
  ON stage_status_mappings(stage_name) WHERE active = true;

-- Insert mappings
INSERT INTO stage_status_mappings (stage_name, matter_status, active) VALUES
  ('I/V MEETING', 'Pending', true),
  ('Did Not Engage', 'Closed', true),
  ('Drafting', 'Open', true),
  ('Signing Meeting', 'Open', true)
ON CONFLICT (stage_name) DO UPDATE SET
  matter_status = EXCLUDED.matter_status,
  updated_at = NOW();
    `);
    process.exit(1);
  }
}

executeMigration();
