import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const { count, error } = await supabase
  .from('tasks')
  .select('*', { count: 'exact', head: true })
  .gte('task_date_generated', thirtyDaysAgo.toISOString());

if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

const estimatedMinutes = Math.ceil((count * 2) / 60);

console.log(`📊 Tasks from last 30 days: ${count}`);
console.log(`⏱️  Estimated runtime: ~${estimatedMinutes} minutes`);
