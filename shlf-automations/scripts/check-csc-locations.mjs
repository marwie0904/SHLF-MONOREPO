import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const { data, error } = await supabase
  .from('assigned_user_reference')
  .select('*')
  .order('name');

if (error) {
  console.error('Error:', error);
} else {
  console.log('\n=== CSC Location Mappings ===\n');
  data.forEach(row => {
    console.log(`${row.name} (ID: ${row.id})`);
    console.log(`  Locations: ${JSON.stringify(row.location)}`);
    console.log(`  Type: ${row.type}\n`);
  });
}
