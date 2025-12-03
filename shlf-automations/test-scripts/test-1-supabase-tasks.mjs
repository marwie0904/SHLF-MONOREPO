import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

console.log('🧪 TEST 1: Supabase Tasks Query\n');
console.log('Testing query for tasks from last 30 days...\n');

const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

// Fetch one task to verify structure
const { data, error } = await supabase
  .from('tasks')
  .select('task_id, status, assigned_user_id, assigned_user, task_number, stage_id, matter_id, calendar_entry_id')
  .gte('task_date_generated', thirtyDaysAgo.toISOString())
  .order('task_date_generated', { ascending: false })
  .limit(1);

if (error) {
  console.error('❌ Query failed:', error.message);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.log('⚠️  No tasks found in the last 30 days');
  process.exit(0);
}

console.log('✅ Query successful!\n');
console.log('📋 Sample task data:');
console.log(JSON.stringify(data[0], null, 2));
console.log('\n📊 Field verification:');
console.log(`  task_id: ${data[0].task_id} (${typeof data[0].task_id})`);
console.log(`  status: ${data[0].status} (${typeof data[0].status})`);
console.log(`  assigned_user_id: ${data[0].assigned_user_id} (${typeof data[0].assigned_user_id})`);
console.log(`  assigned_user: ${data[0].assigned_user} (${typeof data[0].assigned_user})`);
console.log(`  task_number: ${data[0].task_number} (${typeof data[0].task_number})`);
console.log(`  stage_id: ${data[0].stage_id} (${typeof data[0].stage_id})`);
console.log(`  matter_id: ${data[0].matter_id} (${typeof data[0].matter_id})`);
console.log(`  calendar_entry_id: ${data[0].calendar_entry_id} (${typeof data[0].calendar_entry_id})`);

console.log('\n✅ Test 1 passed - Supabase query structure is correct');
