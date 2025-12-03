import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Try to query webhook_events
const { data, error } = await supabase
  .from('webhook_events')
  .select('*')
  .limit(1);

if (error) {
  console.log('Error:', error.message);
  console.log('Details:', error);
} else {
  console.log('Sample webhook_event record:');
  console.log(JSON.stringify(data, null, 2));
}
