/**
 * Fort Myers Vision Meeting Retest
 *
 * Testing Vision Meeting (Event Type 334831) for Fort Myers location
 * to investigate why it generated 0 tasks in the comprehensive test.
 */

import { ClioService } from './src/services/clio.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

const TEST_MATTER_ID = 1675950832;
const CALENDAR_OWNER_ID = 7077963;
const FORT_MYERS_ATTORNEY_ID = 357520756; // Original Fort Myers attorney ID
const VISION_MEETING_EVENT_ID = 334831;

async function wait(ms, label = '') {
  if (label) {
    console.log(`   ⏳ Waiting ${ms / 1000} seconds ${label}...`);
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testFortMyersVisionMeeting() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  Fort Myers Vision Meeting Test - Final Verification  ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Set attorney to Fort Myers
    console.log('👤 STEP 1: Setting responsible attorney to Fort Myers...\n');
    await ClioService.updateMatter(TEST_MATTER_ID, {
      responsible_attorney: { id: FORT_MYERS_ATTORNEY_ID }
    });
    console.log(`   ✓ Attorney set to ID ${FORT_MYERS_ATTORNEY_ID}`);
    await wait(5000, 'for attorney update');

    // Step 2: Create Vision Meeting calendar entry
    console.log('\n📅 STEP 2: Creating Vision Meeting calendar entry...\n');

    const startAt = new Date('2025-11-11T14:00:00Z');
    const endAt = new Date('2025-11-11T15:00:00Z');

    const calendarEntry = await ClioService.createCalendarEntry({
      summary: 'Test Vision Meeting - Fort Myers FINAL TEST',
      eventTypeId: VISION_MEETING_EVENT_ID,
      calendarOwnerId: CALENDAR_OWNER_ID,
      matterId: TEST_MATTER_ID,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });

    console.log(`   ✓ Calendar entry created (ID: ${calendarEntry.id})`);
    console.log(`   Event Type: Vision Meeting (${VISION_MEETING_EVENT_ID})`);
    console.log(`   Meeting: ${startAt.toLocaleDateString()} at 2:00 PM`);

    // Step 3: Wait for webhook processing (increased to 30 seconds)
    console.log('\n⏳ STEP 3: Waiting for webhook processing...\n');
    await wait(30000, 'for webhook and task generation');

    // Step 4: Check for generated tasks
    console.log('\n📋 STEP 4: Checking for generated tasks...\n');

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
      console.log('   ⚠️  NO TASKS GENERATED');
      console.log('\n   Issue confirmed: Vision Meeting not generating tasks for Fort Myers');
      console.log('\n   Recommended next steps:');
      console.log('   1. Check webhook processing logs in Supabase');
      console.log('   2. Verify Vision Meeting task templates exist');
      console.log('   3. Check event type mapping configuration');
      return;
    }

    console.log(`   ✅ Found ${supabaseTasks.length} task(s) generated!\n`);

    // Step 5: Retrieve task details
    console.log('📋 STEP 5: Retrieving task details from Clio...\n');

    for (const task of supabaseTasks) {
      let assigneeName = task.assigned_user || 'Not assigned';

      if (task.task_id) {
        try {
          const clioTask = await ClioService.getTask(task.task_id);
          if (clioTask.assignee?.name) {
            assigneeName = clioTask.assignee.name;
          }
        } catch (err) {
          console.log(`   ⚠️  Could not fetch Clio task ${task.task_id}`);
        }
      }

      console.log(`   Task ${task.task_number}: ${task.task_name}`);
      console.log(`      👤 Assigned to: ${assigneeName}`);
      console.log(`      📅 Due date: ${task.due_date || 'No due date'}`);
      console.log(`      🆔 Clio ID: ${task.task_id}`);
      console.log('');
    }

    // Summary
    console.log('\n================================================================================');
    console.log('📊 TEST SUMMARY\n');
    console.log('   ✅ TEST PASSED');
    console.log(`   📋 Tasks generated: ${supabaseTasks.length}`);
    console.log(`   📅 Calendar entry ID: ${calendarEntry.id}`);
    console.log(`   👤 Attorney: Fort Myers (${FORT_MYERS_ATTORNEY_ID})`);
    console.log('\n   ⚠️  NO DELETION PERFORMED - Records left intact for manual verification');
    console.log('================================================================================\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run the test
testFortMyersVisionMeeting()
  .then(() => {
    console.log('✅ Test completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
