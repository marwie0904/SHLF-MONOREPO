/**
 * Calendar Event Test - Scenario 2
 *
 * Test Flow:
 * 1. Move matter to stage -> check if tasks were generated
 * 2. Check tasks that are related to meetings if it generated due dates (should NOT)
 * 3. Create new calendar event -> check if tasks generated due dates for tasks that did not have due date (unless it is task completion)
 *
 * Expected Behavior:
 * - Stage change should create tasks with NULL due dates for meeting-related tasks
 * - Calendar event creation should update those NULL due dates
 * - Task completion dependencies should remain NULL until task is completed
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
 * Get task template info from Supabase
 */
async function getTaskTemplate(stageId, taskNumber) {
  const { data, error } = await supabase.client
    .from('task-list-meeting')
    .select('*')
    .eq('stage_id', stageId)
    .eq('task_number', taskNumber)
    .single();

  if (error) throw error;
  return data;
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

    // Step 1: Move matter to stage
    log('Step 1: Moving matter to stage...');
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

    // Step 2: Check tasks created
    log('\nStep 2: Checking tasks created by stage change...');
    const tasksAfterStage = await clio.getTasksForMatter(TEST_MATTER_ID);

    result.steps.push({
      step: 'stage_changed',
      tasks_count: tasksAfterStage.length,
      tasks: tasksAfterStage.map(t => ({
        id: t.id,
        name: t.name,
        due_at: t.due_at,
        assignee: t.assignee?.name,
      })),
    });

    log(`✅ ${tasksAfterStage.length} tasks created from stage change`);

    // Step 3: Check meeting-related tasks have NULL due dates
    log('\nStep 3: Checking meeting-related tasks due dates...');
    const meetingRelatedTasks = [];
    const taskCompletionTasks = [];

    for (const task of tasksAfterStage) {
      // Get task from Supabase to find task_number
      const supabaseTask = await supabase.getTaskById(task.id);
      if (!supabaseTask) continue;

      // Get template to check relation type
      try {
        const template = await getTaskTemplate(config.stage_id, supabaseTask.task_number);
        const relationType = template['due_date-relational'] || template.due_date_relational || '';

        if (relationType.toLowerCase().includes('meeting')) {
          meetingRelatedTasks.push({
            ...task,
            relation_type: relationType,
            has_due_date: !!task.due_at,
          });
        } else if (relationType.toLowerCase().includes('task')) {
          taskCompletionTasks.push({
            ...task,
            relation_type: relationType,
            has_due_date: !!task.due_at,
          });
        }
      } catch (err) {
        log(`Warning: Could not get template for task ${task.name}: ${err.message}`);
      }
    }

    log(`Found ${meetingRelatedTasks.length} meeting-related tasks:`);
    meetingRelatedTasks.forEach(t => {
      const status = t.has_due_date ? '❌ HAS due date' : '✅ NULL due date';
      log(`   - ${t.name}: ${status} (${t.relation_type})`);
    });

    log(`Found ${taskCompletionTasks.length} task completion tasks:`);
    taskCompletionTasks.forEach(t => {
      const status = t.has_due_date ? '❌ HAS due date' : '✅ NULL due date';
      log(`   - ${t.name}: ${status} (${t.relation_type})`);
    });

    // Verify meeting-related tasks have NULL due dates
    const meetingTasksWithDates = meetingRelatedTasks.filter(t => t.has_due_date);
    if (meetingTasksWithDates.length > 0) {
      logError(`❌ ${meetingTasksWithDates.length} meeting-related tasks have due dates (should be NULL):`);
      meetingTasksWithDates.forEach(t => logError(`   - ${t.name}`));
      result.meeting_null_check = 'FAIL';
    } else {
      log(`✅ All meeting-related tasks have NULL due dates`);
      result.meeting_null_check = 'PASS';
    }

    result.steps.push({
      step: 'meeting_null_check',
      meeting_related_count: meetingRelatedTasks.length,
      meeting_tasks_with_dates: meetingTasksWithDates.length,
      task_completion_count: taskCompletionTasks.length,
    });

    // Step 4: Create calendar event
    log('\nStep 4: Creating calendar event...');
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

    // Step 5: Check if meeting-related tasks got due dates
    log('\nStep 5: Checking if meeting-related tasks got due dates...');
    const tasksAfterEvent = await clio.getTasksForMatter(TEST_MATTER_ID);

    const updatedMeetingTasks = [];
    for (const taskBefore of meetingRelatedTasks) {
      const taskAfter = tasksAfterEvent.find(t => t.id === taskBefore.id);
      if (taskAfter) {
        updatedMeetingTasks.push({
          name: taskAfter.name,
          had_due_date: taskBefore.has_due_date,
          has_due_date: !!taskAfter.due_at,
          due_date: taskAfter.due_at,
        });
      }
    }

    log(`Updated meeting-related tasks:`);
    updatedMeetingTasks.forEach(t => {
      const status = t.has_due_date ? '✅ NOW has due date' : '❌ STILL NULL';
      log(`   - ${t.name}: ${status} (${t.due_date || 'NULL'})`);
    });

    // Verify meeting tasks got due dates
    const meetingTasksStillNull = updatedMeetingTasks.filter(t => !t.has_due_date);
    if (meetingTasksStillNull.length > 0) {
      logError(`❌ ${meetingTasksStillNull.length} meeting-related tasks still have NULL due dates:`);
      meetingTasksStillNull.forEach(t => logError(`   - ${t.name}`));
      result.due_date_update_check = 'FAIL';
    } else {
      log(`✅ All meeting-related tasks got due dates`);
      result.due_date_update_check = 'PASS';
    }

    // Step 6: Verify task completion tasks remain NULL
    log('\nStep 6: Verifying task completion tasks remain NULL...');
    const updatedTaskCompletionTasks = [];
    for (const taskBefore of taskCompletionTasks) {
      const taskAfter = tasksAfterEvent.find(t => t.id === taskBefore.id);
      if (taskAfter) {
        updatedTaskCompletionTasks.push({
          name: taskAfter.name,
          had_due_date: taskBefore.has_due_date,
          has_due_date: !!taskAfter.due_at,
          due_date: taskAfter.due_at,
        });
      }
    }

    if (taskCompletionTasks.length > 0) {
      log(`Task completion tasks:`);
      updatedTaskCompletionTasks.forEach(t => {
        const status = t.has_due_date ? '❌ Got due date (should be NULL)' : '✅ Still NULL';
        log(`   - ${t.name}: ${status}`);
      });

      const taskCompletionWithDates = updatedTaskCompletionTasks.filter(t => t.has_due_date);
      if (taskCompletionWithDates.length > 0) {
        logError(`❌ ${taskCompletionWithDates.length} task completion tasks got due dates (should remain NULL):`);
        taskCompletionWithDates.forEach(t => logError(`   - ${t.name}`));
        result.task_completion_null_check = 'FAIL';
      } else {
        log(`✅ All task completion tasks remain NULL`);
        result.task_completion_null_check = 'PASS';
      }
    } else {
      log('No task completion tasks to check');
      result.task_completion_null_check = 'PASS';
    }

    result.steps.push({
      step: 'calendar_event_created',
      meeting_tasks_updated: updatedMeetingTasks.length,
      meeting_tasks_still_null: meetingTasksStillNull.length,
      task_completion_tasks: updatedTaskCompletionTasks.length,
    });

    // Overall success check
    result.success =
      result.meeting_null_check === 'PASS' &&
      result.due_date_update_check === 'PASS' &&
      result.task_completion_null_check === 'PASS';

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
    test_type: 'calendar_stage_first',
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
    const reportPath = `tests/reports/calendar-stage-first-${timestamp}.json`;
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
