import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function runMigration() {
  console.log('🔧 Running stale matter tracking migration...\n');

  const sql = fs.readFileSync('migrations/add-stale-matter-tracking.sql', 'utf8');

  // Split by semicolon and execute each statement
  const statements = sql.split(';').filter(s => s.trim());

  for (const statement of statements) {
    const trimmed = statement.trim();
    if (!trimmed) continue;

    console.log(`Executing: ${trimmed.substring(0, 50)}...`);

    const { error } = await supabase.rpc('exec_sql', { sql: trimmed });

    if (error) {
      console.error('❌ Error:', error);
      console.log('\n⚠️  Migration may have partially succeeded. Check database manually.');
      process.exit(1);
    }
  }

  console.log('\n✅ Migration completed successfully!');
}

runMigration();
