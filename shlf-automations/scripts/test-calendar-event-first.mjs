/**
 * Calendar Event Test - Scenario 1
 *
 * Test Flow:
 * 1. Create new calendar event -> check if tasks were created
 * 2. Move stage to calendar event it is related to -> check if tasks duplicate (should NOT)
 *
 * Expected Behavior:
 * - Calendar event creation should create tasks with due dates
 * - Moving to same stage should NOT duplicate tasks
 */

import { ClioAPI } from '../tests/utils/clio-api.js';
import { SupabaseAPI } from '../tests/utils/state-capture.js';
import { log, logError, sleep, requireEnv } from '../tests/test-config.js';
import fs from 'fs';

const TEST_MATTER_ID = 1675950832;
const WEBHOOK_URL = 'https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks';

// Meeting stages to test (calendar_event_id -> stage_id mapping)
const MEETING_STAGES = [
  {
    name: 'IV Meeting',
    calendar_event_id: 334846,
    stage_id: 828078,
  },
  {
    name: 'Design Meeting',
    calendar_event_id: 334801,
    stage_id: 707058,
  },
  {
    name: 'Signing Meeting',
    calendar_event_id: 334816,
    stage_id: 707073,
  },
];

const clio = new ClioAPI();
const supabase = new SupabaseAPI();

/**
 * Trigger webhook manually
 */
async function triggerWebhook(eventType, data) {
  const webhookPayload = {
    id: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: eventType,
    data: data,
  };

  const response = await fetch(`${WEBHOOK_URL}/${eventType.split('.')[0]}s`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookPayload),
  });

  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
  }

  return webhookPayload;
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
  log('🧹 Cleaning up test matter data...');

  // Delete all tasks for test matter from Clio
  const clioTasks = await clio.getTasksForMatter(TEST_MATTER_ID);
  for (const task of clioTasks) {
    await clio.deleteTask(task.id);
  }
  log(`Deleted ${clioTasks.length} tasks from Clio`);

  // Delete from Supabase
  await supabase.deleteMatterTasks(TEST_MATTER_ID);
  log('Deleted tasks from Supabase');

  // Delete calendar entries
  const calendarEntries = await clio.getCalendarEntriesForMatter(TEST_MATTER_ID);
  for (const entry of calendarEntries) {
    await clio.deleteCalendarEntry(entry.id);
  }
  log(`Deleted ${calendarEntries.length} calendar entries`);

  // Delete meeting bookings from Supabase
  await supabase.deleteMeetingBookings(TEST_MATTER_ID);
  log('Deleted meeting bookings from Supabase');
}

/**
 * Test one meeting stage
 */
async function testMeetingStage(config) {
  const result = {
    name: config.name,
    calendar_event_id: config.calendar_event_id,
    stage_id: config.stage_id,
    steps: [],
  };

  try {
    log(`\n${'='.repeat(80)}`);
    log(`📅 Testing: ${config.name}`);
    log(`${'='.repeat(80)}\n`);

    // Step 1: Create calendar event
    log('Step 1: Creating calendar event...');
    const meetingDate = new Date();
    meetingDate.setDate(meetingDate.getDate() + 7); // 7 days from now

    const calendarEntry = await clio.createMeeting(
      TEST_MATTER_ID,
      config.calendar_event_id,
      meetingDate.toISOString(),
      'SHLF Naples',
      `Test ${config.name}`
    );

    result.calendar_entry_id = calendarEntry.id;
    log(`✅ Calendar entry created: ${calendarEntry.id}`);

    // Trigger calendar webhook
    await triggerWebhook('calendar_entry.created', {
      id: calendarEntry.id,
      calendar_entry_event_type: { id: config.calendar_event_id },
      matter: { id: TEST_MATTER_ID },
      location: 'SHLF Naples',
      start_at: meetingDate.toISOString(),
      created_at: new Date().toISOString(),
    });

    // Wait for webhook processing
    log('Waiting 15 seconds for webhook processing...');
    await sleep(15000);

    // Step 2: Check tasks created
    log('\nStep 2: Checking tasks created by calendar event...');
    const tasksAfterEvent = await clio.getTasksForMatter(TEST_MATTER_ID);

    result.steps.push({
      step: 'calendar_event_created',
      tasks_count: tasksAfterEvent.length,
      tasks: tasksAfterEvent.map(t => ({
        id: t.id,
        name: t.name,
        due_at: t.due_at,
        assignee: t.assignee?.name,
      })),
    });

    log(`✅ ${tasksAfterEvent.length} tasks created from calendar event`);
    tasksAfterEvent.forEach(t => {
      log(`   - ${t.name} (Due: ${t.due_at || 'No date'}, Assignee: ${t.assignee?.name || 'None'})`);
    });

    // Step 3: Move matter to the same stage
    log('\nStep 3: Moving matter to same stage...');
    await clio.changeMatterStage(TEST_MATTER_ID, config.stage_id);

    // Trigger matter webhook
    await triggerWebhook('matter.updated', {
      id: TEST_MATTER_ID,
      matter_stage: { id: config.stage_id, name: config.name },
      matter_stage_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Wait for webhook processing
    log('Waiting 15 seconds for webhook processing...');
    await sleep(15000);

    // Step 4: Check for duplicate tasks
    log('\nStep 4: Checking for duplicate tasks...');
    const tasksAfterStageChange = await clio.getTasksForMatter(TEST_MATTER_ID);

    result.steps.push({
      step: 'stage_changed',
      tasks_count: tasksAfterStageChange.length,
      tasks: tasksAfterStageChange.map(t => ({
        id: t.id,
        name: t.name,
        due_at: t.due_at,
        assignee: t.assignee?.name,
      })),
    });

    const taskCountDiff = tasksAfterStageChange.length - tasksAfterEvent.length;

    if (taskCountDiff === 0) {
      log(`✅ No duplicate tasks created (${tasksAfterStageChange.length} tasks total)`);
      result.duplicate_check = 'PASS';
    } else {
      logError(`❌ Task count changed by ${taskCountDiff} (${tasksAfterEvent.length} -> ${tasksAfterStageChange.length})`);
      result.duplicate_check = 'FAIL';
      result.duplicate_count = taskCountDiff;
    }

    // Check if due dates are present
    const tasksWithoutDueDate = tasksAfterStageChange.filter(t => !t.due_at);
    if (tasksWithoutDueDate.length > 0) {
      logError(`❌ ${tasksWithoutDueDate.length} tasks missing due dates:`);
      tasksWithoutDueDate.forEach(t => logError(`   - ${t.name}`));
      result.due_date_check = 'FAIL';
    } else {
      log(`✅ All tasks have due dates`);
      result.due_date_check = 'PASS';
    }

    result.success = result.duplicate_check === 'PASS' && result.due_date_check === 'PASS';

  } catch (error) {
    logError(`❌ Test failed: ${error.message}`);
    result.success = false;
    result.error = error.message;
  }

  return result;
}

/**
 * Main test runner
 */
async function runTests() {
  const timestamp = Date.now();
  const results = {
    test_type: 'calendar_event_first',
    test_matter_id: TEST_MATTER_ID,
    timestamp,
    stages_tested: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
    },
  };

  try {
    // Clean up before starting
    await cleanupTestData();
    log('✅ Cleanup complete\n');

    // Test each meeting stage
    for (const stage of MEETING_STAGES) {
      const result = await testMeetingStage(stage);
      results.stages_tested.push(result);

      if (result.success) {
        results.summary.passed++;
      } else {
        results.summary.failed++;
      }
      results.summary.total++;

      // Clean up between tests
      await cleanupTestData();
      await sleep(2000);
    }

    // Save report
    const reportPath = `tests/reports/calendar-event-first-${timestamp}.json`;
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    log(`\n📊 Report saved to: ${reportPath}`);

    // Print summary
    log(`\n${'='.repeat(80)}`);
    log('📊 TEST SUMMARY');
    log(`${'='.repeat(80)}`);
    log(`Total Stages Tested: ${results.summary.total}`);
    log(`Passed: ${results.summary.passed} ✅`);
    log(`Failed: ${results.summary.failed} ❌`);
    log(`${'='.repeat(80)}\n`);

  } catch (error) {
    logError(`❌ Test runner failed: ${error.message}`);
    results.error = error.message;
  }

  return results;
}

// Run tests
runTests().catch(console.error);
