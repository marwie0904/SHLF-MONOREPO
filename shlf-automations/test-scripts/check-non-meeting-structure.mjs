import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

console.log('🔍 Checking task-list-non-meeting structure...\n');

const { data, error } = await supabase
  .from('task-list-non-meeting')
  .select('*')
  .eq('stage_id', 707058)
  .eq('task_number', 1);

if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

console.log(`Found ${data.length} templates for stage 707058, task #1:`);
data.forEach((template, i) => {
  console.log(`\n${i + 1}. ${template.task_title}`);
  console.log(`   Assignee: ${template.assignee}`);
  console.log(`   Assignee ID: ${template.assignee_id}`);
  console.log(`   UUID: ${template.uuid}`);
});
