import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

console.log('🔍 Finding an active task...\n');

const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const { data, error } = await supabase
  .from('tasks')
  .select('task_id, status, assigned_user_id, task_number, stage_id, matter_id')
  .gte('task_date_generated', thirtyDaysAgo.toISOString())
  .eq('status', 'pending')
  .order('task_date_generated', { ascending: false })
  .limit(5);

if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

console.log(`✅ Found ${data.length} pending tasks:\n`);
data.forEach((task, i) => {
  console.log(`${i + 1}. Task ID: ${task.task_id}`);
  console.log(`   Status: ${task.status}`);
  console.log(`   Matter: ${task.matter_id}`);
  console.log(`   Stage: ${task.stage_id}`);
  console.log(`   Task#: ${task.task_number}`);
  console.log(`   Assignee: ${task.assigned_user_id}\n`);
});

console.log(`Using task ${data[0].task_id} for testing`);
