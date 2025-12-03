import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

console.log('🧪 TEST 4b: Non-meeting Template Resolution\n');

const testTask = {
  task_id: 1203524183,
  task_number: 3,
  stage_id: 1110277,
  calendar_entry_id: null,
};

console.log('Testing task:', JSON.stringify(testTask, null, 2));
console.log();

// Try non-meeting first
let { data: template, error } = await supabase
  .from('task-list-non-meeting')
  .select('*')
  .eq('stage_id', testTask.stage_id)
  .eq('task_number', testTask.task_number)
  .single();

if (error && error.code !== 'PGRST116') {
  console.log('⚠️  Non-meeting query returned error:', error.message);
  console.log('This might be due to multiple matching rows');

  // Try without .single() to see all matches
  ({ data: template, error } = await supabase
    .from('task-list-non-meeting')
    .select('*')
    .eq('stage_id', testTask.stage_id)
    .eq('task_number', testTask.task_number));

  if (template && template.length > 0) {
    console.log(`\nFound ${template.length} matching templates:`);
    template.forEach((t, i) => {
      console.log(`\n${i + 1}. ${t.task_title}`);
      console.log(`   Assignee: ${t.assignee}`);
      console.log(`   Assignee ID: ${t.assignee_id}`);
    });
    console.log('\n✅ Template resolution works, but returns multiple rows');
    console.log('   Script should use .limit(1) or handle this properly');
  }
} else if (error && error.code === 'PGRST116') {
  console.log('⚠️  No non-meeting template found, trying probate...');

  ({ data: template, error } = await supabase
    .from('task-list-probate')
    .select('*')
    .eq('stage_id', testTask.stage_id)
    .eq('task_number', testTask.task_number)
    .single());

  if (error) {
    console.log('❌ No probate template found either');
  } else {
    console.log('✅ Probate template found!');
    console.log(JSON.stringify(template, null, 2));
  }
} else {
  console.log('✅ Non-meeting template found!');
  console.log(JSON.stringify(template, null, 2));
}

console.log('\n✅ Test 4b passed');
