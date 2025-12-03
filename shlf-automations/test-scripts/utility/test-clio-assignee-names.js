/**
 * Quick test to verify fetching actual assignee names from Clio API
 */

import { ClioService } from './src/services/clio.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

const TEST_MATTER_ID = 1675950832;

async function testAssigneeNameFetch() {
  console.log('\n🧪 Testing Assignee Name Fetch from Clio API\n');
  console.log('='.repeat(60));

  try {
    // Get tasks from our test matter
    let { data: tasks, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('matter_id', TEST_MATTER_ID)
      .not('task_id', 'is', null)
      .order('task_number', { ascending: true });

    if (error) {
      console.error('❌ Error fetching tasks from Supabase:', error);
      return;
    }

    if (!tasks || tasks.length === 0) {
      console.log(`⚠️  No tasks found for matter ${TEST_MATTER_ID}`);
      console.log('   This is expected if no automation has run recently');
      return;
    }

    console.log(`\n✅ Found ${tasks.length} tasks to test from matter ${TEST_MATTER_ID}\n`);

    // Test each task
    for (const task of tasks) {
      console.log('-'.repeat(60));
      console.log(`Task ${task.task_number}: "${task.task_name}"`);
      console.log(`  Task ID: ${task.task_id}`);
      console.log(`  Supabase assigned_user: "${task.assigned_user}"`);
      console.log(`  Supabase assigned_user_id: ${task.assigned_user_id}`);

      if (task.task_id) {
        try {
          // Fetch from Clio
          const clioTask = await ClioService.getTask(task.task_id);

          if (clioTask.assignee && clioTask.assignee.name) {
            console.log(`  ✅ Clio assignee.name: "${clioTask.assignee.name}"`);
            console.log(`  ✅ Clio assignee.id: ${clioTask.assignee.id}`);

            // Compare
            if (task.assigned_user === clioTask.assignee.name) {
              console.log(`  ✅ MATCH: Names are the same`);
            } else {
              console.log(`  🔄 DIFFERENT: Supabase has "${task.assigned_user}", Clio has "${clioTask.assignee.name}"`);
            }
          } else {
            console.log(`  ⚠️  No assignee in Clio response`);
          }
        } catch (clioError) {
          console.log(`  ❌ Error fetching from Clio: ${clioError.message}`);
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Test completed\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  }
}

testAssigneeNameFetch();
