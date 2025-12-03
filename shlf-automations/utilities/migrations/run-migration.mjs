import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function runMigration() {
  console.log('🚀 Running migration: create-stage-status-mappings.sql\n');

  try {
    // Create table
    console.log('Creating stage_status_mappings table...');
    const { error: createError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS stage_status_mappings (
          id BIGSERIAL PRIMARY KEY,
          stage_name TEXT NOT NULL UNIQUE,
          matter_status TEXT NOT NULL,
          active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `
    });

    if (createError) {
      console.error('❌ Failed to create table:', createError.message);
      console.log('\n⚠️  Attempting direct insert instead...\n');
    } else {
      console.log('✅ Table created successfully');
    }

    // Insert mappings using direct client
    console.log('\nInserting stage-status mappings...');

    const mappings = [
      { stage_name: 'I/V MEETING', matter_status: 'Pending' },
      { stage_name: 'Did Not Engage', matter_status: 'Closed' },
      { stage_name: 'Drafting', matter_status: 'Open' },
      { stage_name: 'Signing Meeting', matter_status: 'Open' },
    ];

    for (const mapping of mappings) {
      const { data, error } = await supabase
        .from('stage_status_mappings')
        .upsert(mapping, { onConflict: 'stage_name' })
        .select();

      if (error) {
        console.error(`❌ Failed to insert ${mapping.stage_name}:`, error.message);
      } else {
        console.log(`✅ Inserted/Updated: ${mapping.stage_name} → ${mapping.matter_status}`);
      }
    }

    console.log('\n✨ Migration complete!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
