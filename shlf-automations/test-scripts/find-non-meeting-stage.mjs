import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Get a task that doesn't have calendar_entry_id
const { data: tasks, error } = await supabase
  .from('tasks')
  .select('task_id, task_number, stage_id, calendar_entry_id')
  .is('calendar_entry_id', null)
  .gte('task_date_generated', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
  .limit(5);

if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

console.log('Tasks without calendar_entry_id:');
tasks.forEach(t => {
  console.log(`  Task ${t.task_id}: Stage ${t.stage_id}, Task# ${t.task_number}`);
});

// Pick the first one and check if template exists
const testTask = tasks[0];
console.log(`\nChecking templates for stage ${testTask.stage_id}, task# ${testTask.task_number}...`);

const { data: template, error: tError } = await supabase
  .from('task-list-non-meeting')
  .select('*')
  .eq('stage_id', testTask.stage_id)
  .eq('task_number', testTask.task_number)
  .limit(1);

if (tError) {
  console.error('Error:', tError.message);
} else {
  console.log(`Found ${template.length} templates`);
  if (template.length > 0) {
    console.log(JSON.stringify(template[0], null, 2));
  }
}
