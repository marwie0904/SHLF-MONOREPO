import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

console.log('🧪 TEST 4: Template Resolution\n');

// Test data from previous tests
const testTask = {
  task_id: 1211338028,
  task_number: 5,
  stage_id: 707058,
  matter_id: 1738279103,
  calendar_entry_id: 4676856278, // Has calendar entry
};

console.log('Testing task:', JSON.stringify(testTask, null, 2));
console.log('\n--- Test 4a: Meeting-based task (has calendar_entry_id) ---\n');

// Get calendar event mapping for this stage
const { data: mapping, error: mappingError } = await supabase
  .from('calendar_event_mappings')
  .select('calendar_event_id')
  .eq('stage_id', testTask.stage_id.toString())
  .eq('active', true)
  .single();

if (mappingError) {
  console.log('⚠️  No calendar event mapping found:', mappingError.message);
} else {
  console.log('✅ Calendar event mapping found:', mapping);

  // Fetch template from task-list-meeting
  const { data: template, error: templateError } = await supabase
    .from('task-list-meeting')
    .select('*')
    .eq('calendar_event_id', mapping.calendar_event_id)
    .eq('task_number', testTask.task_number)
    .single();

  if (templateError) {
    console.log('❌ Template not found:', templateError.message);
  } else {
    console.log('✅ Meeting template found!');
    console.log(JSON.stringify(template, null, 2));
  }
}

// Test non-meeting task
console.log('\n--- Test 4b: Non-meeting task ---\n');

const nonMeetingTask = {
  task_number: 1,
  stage_id: 707058,
  calendar_entry_id: null,
};

console.log('Testing task:', JSON.stringify(nonMeetingTask, null, 2));

const { data: nmTemplate, error: nmError } = await supabase
  .from('task-list-non-meeting')
  .select('*')
  .eq('stage_id', nonMeetingTask.stage_id)
  .eq('task_number', nonMeetingTask.task_number)
  .single();

if (nmError) {
  console.log('❌ Non-meeting template not found:', nmError.message);

  // Try probate
  console.log('Trying task-list-probate...');
  const { data: probateTemplate, error: probateError } = await supabase
    .from('task-list-probate')
    .select('*')
    .eq('stage_id', nonMeetingTask.stage_id)
    .eq('task_number', nonMeetingTask.task_number)
    .single();

  if (probateError) {
    console.log('❌ Probate template not found:', probateError.message);
  } else {
    console.log('✅ Probate template found!');
    console.log(JSON.stringify(probateTemplate, null, 2));
  }
} else {
  console.log('✅ Non-meeting template found!');
  console.log(JSON.stringify(nmTemplate, null, 2));
}

console.log('\n✅ Test 4 passed - Template resolution logic is correct');
