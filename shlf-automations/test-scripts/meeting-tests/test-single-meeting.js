/**
 * Simple single meeting test to verify logic
 * Tests: Bonita Springs - Initial Meeting
 */

import { ClioService } from './src/services/clio.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

const TEST_MATTER_ID = 1675950832;
const CALENDAR_OWNER_ID = 7077963;
const BONITA_ATTORNEY_ID = 357292201;
const INITIAL_MEETING_EVENT_ID = 334846;

async function wait(ms, label = '') {
  if (label) {
    console.log(`   ⏳ Waiting ${ms / 1000} seconds ${label}...`);
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cleanupTestMatter() {
  console.log('   🧹 Cleaning up test matter data...');

  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('matter_id', TEST_MATTER_ID);

  if (existingTasks && existingTasks.length > 0) {
    for (const task of existingTasks) {
      if (task.task_id) {
        try {
          await ClioService.deleteTask(task.task_id);
        } catch (err) {
          if (err.response?.status !== 404) {
            console.log(`   ⚠️  Could not delete task ${task.task_id}`);
          }
        }
      }
    }

    await supabase
      .from('tasks')
      .delete()
      .eq('matter_id', TEST_MATTER_ID);

    console.log(`   ✓ Cleaned up ${existingTasks.length} task(s)`);
  } else {
    console.log('   ✓ No tasks to clean up');
  }
}

async function testSingleMeeting() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Single Meeting Test - Bonita Springs     ║');
  console.log('╚════════════════════════════════════════════╝\n');

  try {
    // Step 1: Clean up
    console.log('📋 STEP 1: Cleaning up test data...\n');
    await cleanupTestMatter();
    await wait(2000);

    // Step 2: Set attorney
    console.log('\n👤 STEP 2: Setting responsible attorney to Bonita Springs...\n');
    await ClioService.updateMatter(TEST_MATTER_ID, {
      responsible_attorney: { id: BONITA_ATTORNEY_ID }
    });
    console.log(`   ✓ Attorney set to ID ${BONITA_ATTORNEY_ID}`);
    await wait(5000, 'for attorney update');

    // Step 3: Create calendar event
    console.log('\n📅 STEP 3: Creating Initial Meeting calendar entry...\n');

    const startAt = new Date('2025-11-11T10:00:00Z');
    const endAt = new Date('2025-11-11T11:00:00Z');

    const calendarEntry = await ClioService.createCalendarEntry({
      summary: 'Test Initial Meeting - Bonita Springs',
      eventTypeId: INITIAL_MEETING_EVENT_ID,
      calendarOwnerId: CALENDAR_OWNER_ID,
      matterId: TEST_MATTER_ID,
      location: undefined, // Initial meeting doesn't use calendar location
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });

    console.log(`   ✓ Calendar entry created (ID: ${calendarEntry.id})`);
    console.log(`   Meeting: ${startAt.toLocaleDateString()} at 10:00 AM`);

    // Step 4: Wait for webhook processing
    console.log('\n⏳ STEP 4: Waiting for webhook processing...\n');
    await wait(25000, 'for webhook and task generation');

    // Step 5: Check for generated tasks
    console.log('\n📋 STEP 5: Checking for generated tasks...\n');

    const { data: supabaseTasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('matter_id', TEST_MATTER_ID)
      .order('task_number', { ascending: true });

    if (tasksError) {
      console.error('   ❌ Error fetching tasks:', tasksError);
      return;
    }

    if (!supabaseTasks || supabaseTasks.length === 0) {
      console.log('   ⚠️  No tasks generated');
      console.log('\n❌ TEST FAILED: Expected tasks but none were generated\n');
      return;
    }

    console.log(`   ✅ Found ${supabaseTasks.length} task(s) generated!\n`);

    // Step 6: Fetch assignee names from Clio
    console.log('📋 STEP 6: Retrieving task details from Clio...\n');

    for (const task of supabaseTasks) {
      let assigneeName = task.assigned_user || 'Not assigned';

      if (task.task_id) {
        try {
          const clioTask = await ClioService.getTask(task.task_id);
          if (clioTask.assignee?.name) {
            assigneeName = clioTask.assignee.name;
          }
        } catch (err) {
          console.log(`   ⚠️  Could not fetch task ${task.task_id} from Clio`);
        }
      }

      console.log(`   Task ${task.task_number}: ${task.task_name}`);
      console.log(`      👤 Assigned to: ${assigneeName}`);
      console.log(`      📅 Due date: ${task.due_date || 'No due date'}`);
      console.log(`      🆔 Clio ID: ${task.task_id || 'N/A'}`);
      if (task.is_parent_task) {
        console.log(`      🔗 PARENT TASK`);
      }
      console.log('');
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST SUMMARY\n');
    console.log(`   ✅ TEST PASSED`);
    console.log(`   📋 Tasks generated: ${supabaseTasks.length}`);
    console.log(`   📅 Calendar entry ID: ${calendarEntry.id}`);
    console.log(`   👤 Attorney: Bonita Springs (${BONITA_ATTORNEY_ID})`);
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
  }
}

testSingleMeeting();
