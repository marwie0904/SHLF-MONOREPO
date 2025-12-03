/**
 * Vision Meeting Tests - All Locations
 *
 * Testing Vision Meeting (Event Type 334831) across three locations:
 * - Bonita Springs (Attorney: 357292201)
 * - Naples (Attorney: 357520756)
 * - Fort Myers (Attorney: 357380836)
 *
 * NO DELETION - Records left intact for manual verification
 */

import { ClioService } from './src/services/clio.js';
import { TokenRefreshService } from './src/services/token-refresh.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

const TEST_MATTER_ID = 1675950832;
const CALENDAR_OWNER_ID = 7077963;
const VISION_MEETING_EVENT_ID = 334831;

const LOCATIONS = [
  {
    name: 'Bonita Springs',
    attorneyId: 357292201,
    startTime: '2025-11-11T10:00:00Z',
    endTime: '2025-11-11T11:00:00Z'
  },
  {
    name: 'Naples',
    attorneyId: 357520756,
    startTime: '2025-11-11T14:00:00Z',
    endTime: '2025-11-11T15:00:00Z'
  },
  {
    name: 'Fort Myers',
    attorneyId: 357380836,
    startTime: '2025-11-11T18:00:00Z',
    endTime: '2025-11-11T19:00:00Z'
  }
];

async function wait(ms, label = '') {
  if (label) {
    console.log(`   ⏳ Waiting ${ms / 1000} seconds ${label}...`);
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testVisionMeeting(location, index, total) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST ${index}/${total}: ${location.name} Vision Meeting`);
  console.log('='.repeat(70));

  const results = {
    location: location.name,
    attorneyId: location.attorneyId,
    calendarEntryId: null,
    tasksGenerated: 0,
    tasks: [],
    success: false,
    error: null
  };

  try {
    // Step 1: Set attorney
    console.log(`\n👤 STEP 1: Setting attorney to ${location.name}...\n`);
    await ClioService.updateMatter(TEST_MATTER_ID, {
      responsible_attorney: { id: location.attorneyId }
    });
    console.log(`   ✓ Attorney set to ID ${location.attorneyId}`);
    await wait(5000, 'for attorney update');

    // Step 2: Create Vision Meeting calendar entry
    console.log(`\n📅 STEP 2: Creating Vision Meeting calendar entry...\n`);

    const startAt = new Date(location.startTime);
    const endAt = new Date(location.endTime);

    const calendarEntry = await ClioService.createCalendarEntry({
      summary: `Test Vision Meeting - ${location.name}`,
      eventTypeId: VISION_MEETING_EVENT_ID,
      calendarOwnerId: CALENDAR_OWNER_ID,
      matterId: TEST_MATTER_ID,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });

    results.calendarEntryId = calendarEntry.id;

    console.log(`   ✓ Calendar entry created (ID: ${calendarEntry.id})`);
    console.log(`   Event Type: Vision Meeting (${VISION_MEETING_EVENT_ID})`);
    console.log(`   Meeting: ${startAt.toLocaleString()}`);

    // Step 3: Wait for webhook processing (30 seconds)
    console.log(`\n⏳ STEP 3: Waiting for webhook processing...\n`);
    await wait(30000, 'for webhook and task generation');

    // Step 4: Check for generated tasks
    console.log(`\n📋 STEP 4: Checking for generated tasks...\n`);

    const { data: supabaseTasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('matter_id', TEST_MATTER_ID)
      .order('task_number', { ascending: true });

    if (tasksError) {
      console.error('   ❌ Error fetching tasks:', tasksError);
      results.error = tasksError.message;
      return results;
    }

    if (!supabaseTasks || supabaseTasks.length === 0) {
      console.log('   ⚠️  NO TASKS GENERATED');
      console.log(`\n   Issue: Vision Meeting not generating tasks for ${location.name}`);
      results.tasksGenerated = 0;
      results.success = false;
      return results;
    }

    console.log(`   ✅ Found ${supabaseTasks.length} task(s) generated!\n`);
    results.tasksGenerated = supabaseTasks.length;

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

      const taskInfo = {
        taskNumber: task.task_number,
        taskName: task.task_name,
        assignee: assigneeName,
        dueDate: task.due_date,
        clioId: task.task_id
      };

      results.tasks.push(taskInfo);

      console.log(`   Task ${task.task_number}: ${task.task_name}`);
      console.log(`      👤 Assigned to: ${assigneeName}`);
      console.log(`      📅 Due date: ${task.due_date || 'No due date'}`);
      console.log(`      🆔 Clio ID: ${task.task_id}`);
      console.log('');
    }

    results.success = true;

    // Summary
    console.log(`\n   ✅ TEST PASSED - ${location.name}`);
    console.log(`   📋 Tasks generated: ${results.tasksGenerated}`);
    console.log(`   📅 Calendar entry ID: ${results.calendarEntryId}`);
    console.log(`   👤 Attorney ID: ${location.attorneyId}`);

  } catch (error) {
    console.error(`\n❌ Test failed for ${location.name}:`, error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    results.error = error.message;
    results.success = false;
  }

  return results;
}

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║        Vision Meeting Tests - All Locations                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  // Initialize token service and load token from Supabase
  console.log('\n🔐 Initializing token service...');
  await TokenRefreshService.initialize();

  // Initialize ClioService interceptors for automatic token refresh
  ClioService.initializeInterceptors();

  // Update ClioService client with token from Supabase
  ClioService.client.defaults.headers['Authorization'] = `Bearer ${config.clio.accessToken}`;

  console.log('✅ Token service initialized\n');

  const allResults = [];

  for (let i = 0; i < LOCATIONS.length; i++) {
    const location = LOCATIONS[i];
    const results = await testVisionMeeting(location, i + 1, LOCATIONS.length);
    allResults.push(results);

    // Wait between tests (except after last test)
    if (i < LOCATIONS.length - 1) {
      console.log('\n⏸️  Waiting 10 seconds before next test...\n');
      await wait(10000);
    }
  }

  // Final Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 FINAL SUMMARY - VISION MEETING TESTS');
  console.log('='.repeat(80) + '\n');

  const passed = allResults.filter(r => r.success).length;
  const failed = allResults.filter(r => !r.success).length;

  console.log(`Total Tests: ${allResults.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');

  allResults.forEach((result, idx) => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`${idx + 1}. ${result.location}: ${status}`);
    console.log(`   Attorney ID: ${result.attorneyId}`);
    console.log(`   Calendar Entry ID: ${result.calendarEntryId || 'N/A'}`);
    console.log(`   Tasks Generated: ${result.tasksGenerated}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    console.log('');
  });

  console.log('⚠️  NO DELETION PERFORMED - All records left intact for manual verification');
  console.log('='.repeat(80) + '\n');

  // Save results to file
  const timestamp = Date.now();
  const resultsFile = `/tmp/vision-meeting-test-results-${timestamp}.json`;
  const fs = await import('fs');
  fs.writeFileSync(resultsFile, JSON.stringify(allResults, null, 2));
  console.log(`📁 Results saved to: ${resultsFile}\n`);

  return allResults;
}

// Run all tests
runAllTests()
  .then(() => {
    console.log('✅ All tests completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
