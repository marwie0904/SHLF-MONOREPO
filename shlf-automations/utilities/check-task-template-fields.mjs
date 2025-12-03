/**
 * Check actual field names in task-list-meeting table
 */

import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

async function checkFields() {
  console.log('\n🔍 Checking task-list-meeting table fields...\n');

  // Get one sample row to see all fields
  const { data, error } = await supabase
    .from('task-list-meeting')
    .select('*')
    .limit(1);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️  No data found in task-list-meeting table');
    return;
  }

  const sample = data[0];

  console.log('📋 Available Fields:');
  console.log('='.repeat(60));

  const fieldNames = Object.keys(sample);
  fieldNames.forEach((field, index) => {
    const value = sample[field];
    const type = typeof value;
    console.log(`${index + 1}. ${field}`);
    console.log(`   Type: ${type}`);
    console.log(`   Sample Value: ${JSON.stringify(value)}`);
    console.log('');
  });

  console.log('='.repeat(60));
  console.log('\n✅ Field Check Complete\n');

  // Check specifically for assignee and due date fields
  console.log('🎯 Critical Fields Verification:');
  console.log('='.repeat(60));

  const hasAssignee = fieldNames.includes('assignee');
  const hasDueDateRelational = fieldNames.includes('due_date-relational');
  const hasDueDateRelation = fieldNames.includes('due_date_relation');
  const hasTaskTitle = fieldNames.includes('task_title');
  const hasTaskNumber = fieldNames.includes('task_number');

  console.log(`assignee field exists: ${hasAssignee ? '✅' : '❌'}`);
  if (hasAssignee) {
    console.log(`   Value: "${sample.assignee}"`);
  }

  console.log(`\ndue_date-relational field exists: ${hasDueDateRelational ? '✅' : '❌'}`);
  if (hasDueDateRelational) {
    console.log(`   Value: "${sample['due_date-relational']}"`);
  }

  console.log(`\ndue_date_relation field exists: ${hasDueDateRelation ? '✅' : '❌'}`);
  if (hasDueDateRelation) {
    console.log(`   Value: "${sample.due_date_relation}"`);
  }

  console.log(`\ntask_title field exists: ${hasTaskTitle ? '✅' : '❌'}`);
  if (hasTaskTitle) {
    console.log(`   Value: "${sample.task_title}"`);
  }

  console.log(`\ntask_number field exists: ${hasTaskNumber ? '✅' : '❌'}`);
  if (hasTaskNumber) {
    console.log(`   Value: ${sample.task_number}`);
  }

  console.log('\n' + '='.repeat(60));
}

checkFields()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
