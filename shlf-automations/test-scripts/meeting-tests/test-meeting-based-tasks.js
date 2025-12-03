/**
 * Comprehensive Meeting-Based Task Automation Test
 *
 * Tests all 5 meeting types across 3 locations (15 total tests):
 * - Initial Meeting
 * - Vision Meeting
 * - Design Meeting
 * - Signing Meeting (special: uses calendar location)
 * - Maintenance Meeting
 *
 * Locations: Bonita Springs, Fort Myers, Naples
 * Dates: November 11-13, 2025
 */

import { ClioService } from './src/services/clio.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';
import fs from 'fs';

const supabase = createClient(config.supabase.url, config.supabase.key);

// Test Configuration
const TEST_MATTER_ID = 1675950832;
const CALENDAR_OWNER_ID = 7077963; // Default calendar owner

// Location + Attorney Combinations
const LOCATION_CONFIGS = [
  { location: 'Bonita Springs', attorneyId: 357292201, clioLocation: 'SHLF Bonita Springs' },
  { location: 'Fort Myers', attorneyId: 357520756, clioLocation: 'SHLF Fort Myers' },
  { location: 'Naples', attorneyId: 357380836, clioLocation: 'SHLF Naples' },
];

// Meeting Type Configurations
const MEETING_TYPES = [
  { name: 'Initial Meeting', eventTypeId: 334846, stageName: 'I/V MEETING', date: '2025-11-11', time: '10:00' },
  { name: 'Vision Meeting', eventTypeId: 334831, stageName: 'I/V MEETING', date: '2025-11-11', time: '14:00' },
  { name: 'Design Meeting', eventTypeId: 334801, stageName: 'Design', date: '2025-11-12', time: '10:00' },
  { name: 'Signing Meeting', eventTypeId: 334816, stageName: 'Signing Meeting', date: '2025-11-13', time: '10:00', usesCalendarLocation: true },
  { name: 'Maintenance Meeting', eventTypeId: 372457, stageName: 'Maintenance', date: '2025-11-13', time: '14:00' },
];

// Utility Functions
async function wait(ms, label = '') {
  if (label) {
    console.log(`   ⏳ Waiting ${ms / 1000} seconds ${label}...`);
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

function getWeekendAdjustment(originalDate, meetingDate, isBeforeMeeting) {
  if (!isWeekend(originalDate)) {
    return null;
  }

  const day = originalDate.getDay();
  let adjustedDate = new Date(originalDate);

  if (isBeforeMeeting) {
    // Move to previous Friday
    if (day === 0) { // Sunday
      adjustedDate.setDate(adjustedDate.getDate() - 2);
    } else { // Saturday
      adjustedDate.setDate(adjustedDate.getDate() - 1);
    }
    return {
      original: originalDate.toISOString().split('T')[0],
      adjusted: adjustedDate.toISOString().split('T')[0],
      reason: `${day === 0 ? 'Sunday' : 'Saturday'} → Friday (before meeting)`,
    };
  } else {
    // Move to next Monday
    if (day === 0) { // Sunday
      adjustedDate.setDate(adjustedDate.getDate() + 1);
    } else { // Saturday
      adjustedDate.setDate(adjustedDate.getDate() + 2);
    }
    return {
      original: originalDate.toISOString().split('T')[0],
      adjusted: adjustedDate.toISOString().split('T')[0],
      reason: `${day === 0 ? 'Sunday' : 'Saturday'} → Monday (after meeting/creation)`,
    };
  }
}

async function cleanupTestMatter() {
  console.log('   🧹 Cleaning up test matter data...');

  // Delete from Supabase
  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('matter_id', TEST_MATTER_ID);

  if (existingTasks && existingTasks.length > 0) {
    // Delete from Clio first
    for (const task of existingTasks) {
      if (task.task_id) {
        try {
          await ClioService.deleteTask(task.task_id);
        } catch (err) {
          if (err.response?.status !== 404) {
            console.log(`   ⚠️  Could not delete task ${task.task_id} from Clio`);
          }
        }
      }
    }

    // Delete from Supabase
    await supabase
      .from('tasks')
      .delete()
      .eq('matter_id', TEST_MATTER_ID);

    console.log(`   ✓ Cleaned up ${existingTasks.length} task(s)`);
  } else {
    console.log('   ✓ No tasks to clean up');
  }
}

async function testMeetingType(locationConfig, meetingType, testNumber, totalTests) {
  const { location, attorneyId, clioLocation } = locationConfig;
  const { name: meetingName, eventTypeId, date, time, usesCalendarLocation } = meetingType;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📅 TEST ${testNumber}/${totalTests}: ${location} - ${meetingName}`);
  console.log(`${'='.repeat(80)}\n`);

  const result = {
    testNumber,
    location,
    attorneyId,
    meetingType: meetingName,
    eventTypeId,
    meetingDate: `${date}T${time}:00Z`,
    success: false,
    tasksGenerated: 0,
    tasks: [],
    weekendAdjustments: [],
    errors: [],
  };

  try {
    // Step 1: Clean up existing data
    console.log('📋 STEP 1: Cleaning up test data...\n');
    await cleanupTestMatter();
    await wait(2000);

    // Step 2: Update responsible attorney
    console.log(`\n👤 STEP 2: Setting responsible attorney to ${location}...\n`);
    await ClioService.updateMatter(TEST_MATTER_ID, {
      responsible_attorney: { id: attorneyId }
    });
    console.log(`   ✓ Attorney set to ID ${attorneyId}`);
    await wait(5000, 'for attorney update');

    // Step 3: Create calendar event
    console.log(`\n📅 STEP 3: Creating ${meetingName} calendar entry...\n`);

    const startAt = new Date(`${date}T${time}:00Z`);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000); // +1 hour

    const calendarEntry = await ClioService.createCalendarEntry({
      summary: `Test ${meetingName} - ${location}`,
      eventTypeId,
      calendarOwnerId: CALENDAR_OWNER_ID,
      matterId: TEST_MATTER_ID,
      location: usesCalendarLocation ? clioLocation : undefined,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });

    console.log(`   ✓ Calendar entry created (ID: ${calendarEntry.id})`);
    console.log(`   Meeting: ${startAt.toLocaleDateString()} at ${time}`);
    if (usesCalendarLocation) {
      console.log(`   Location: ${clioLocation} (in calendar)`);
    }

    result.calendarEntryId = calendarEntry.id;
    result.meetingStartAt = startAt.toISOString();

    // Step 4: Wait for webhook processing
    await wait(25000, 'for webhook processing');

    // Step 5: Fetch generated tasks
    console.log(`\n📋 STEP 5: Checking for generated tasks...\n`);

    const { data: supabaseTasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('matter_id', TEST_MATTER_ID)
      .order('task_number', { ascending: true });

    if (tasksError) {
      console.error('   ❌ Error fetching tasks:', tasksError);
      result.errors.push(`Supabase error: ${tasksError.message}`);
      return result;
    }

    if (!supabaseTasks || supabaseTasks.length === 0) {
      console.log('   ⚠️  No tasks generated');
      result.success = false;
      result.tasksGenerated = 0;
      return result;
    }

    console.log(`   ✓ Found ${supabaseTasks.length} task(s) generated\n`);
    result.tasksGenerated = supabaseTasks.length;

    // Step 6: Fetch assignee names and analyze weekend adjustments
    for (const task of supabaseTasks) {
      let assigneeName = task.assigned_user || 'Not assigned';

      // Fetch actual assignee name from Clio
      if (task.task_id) {
        try {
          const clioTask = await ClioService.getTask(task.task_id);
          if (clioTask.assignee?.name) {
            assigneeName = clioTask.assignee.name;
          }

          // Check for weekend adjustments
          if (clioTask.due_at) {
            const actualDueDate = new Date(clioTask.due_at);

            // Try to determine what the original due date would have been
            // This is a simplified check - in reality, we'd need to know the template logic
            const potentialOriginalDate = new Date(actualDueDate);

            // Check if the actual due date was moved from a weekend
            const weekendAdj = task.weekend_adjusted ? {
              taskName: task.task_name,
              taskNumber: task.task_number,
              originalDate: task.original_due_date,
              adjustedDate: actualDueDate.toISOString().split('T')[0],
              reason: task.adjustment_reason || 'Weekend adjustment',
            } : null;

            if (weekendAdj) {
              result.weekendAdjustments.push(weekendAdj);
            }
          }
        } catch (err) {
          console.log(`   ⚠️  Could not fetch Clio task ${task.task_id}`);
        }
      }

      const taskInfo = {
        taskNumber: task.task_number,
        taskName: task.task_name,
        assignee: assigneeName,
        dueDate: task.due_date || 'No due date',
        taskId: task.task_id,
        isParent: task.is_parent_task || false,
        parentTaskId: task.parent_task_id || null,
      };

      result.tasks.push(taskInfo);

      console.log(`   Task ${task.task_number}: ${task.task_name}`);
      console.log(`      👤 ${assigneeName}`);
      console.log(`      📅 ${task.due_date || 'No due date'}`);
      if (task.is_parent_task) {
        console.log(`      🔗 PARENT TASK`);
      }
      if (task.parent_task_id) {
        console.log(`      🔗 Depends on Task ${task.parent_task_id}`);
      }
      console.log('');
    }

    result.success = true;

    // Step 7: Test dependencies if parent tasks exist
    const parentTasks = supabaseTasks.filter(t => t.is_parent_task);
    if (parentTasks.length > 0) {
      console.log(`\n🔗 STEP 7: Testing task completion dependencies...\n`);

      for (const parentTask of parentTasks) {
        console.log(`   Testing parent task: ${parentTask.task_name}`);

        try {
          // Complete the parent task
          await ClioService.updateTask(parentTask.task_id, {
            status: 'complete'
          });
          console.log(`   ✓ Marked as complete`);

          // Wait for webhook to process
          await wait(15000, 'for dependency processing');

          // Check for newly created dependent tasks
          const { data: afterTasks } = await supabase
            .from('tasks')
            .select('*')
            .eq('matter_id', TEST_MATTER_ID)
            .eq('parent_task_id', parentTask.task_number)
            .order('task_number', { ascending: true });

          if (afterTasks && afterTasks.length > 0) {
            console.log(`   ✓ ${afterTasks.length} dependent task(s) created`);

            for (const depTask of afterTasks) {
              console.log(`      - Task ${depTask.task_number}: ${depTask.task_name}`);
              console.log(`        Due: ${depTask.due_date || 'No date'}`);
            }
          }
        } catch (err) {
          console.log(`   ⚠️  Error testing dependency: ${err.message}`);
        }
      }
    }

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    result.success = false;
    result.errors.push(error.message);
  }

  return result;
}

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  Meeting-Based Task Automation Test Suite             ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  console.log(`📅 Testing 5 meeting types across 3 locations (15 tests total)`);
  console.log(`📅 Meeting dates: November 11-13, 2025\n`);

  const allResults = [];
  let testNumber = 1;
  const totalTests = LOCATION_CONFIGS.length * MEETING_TYPES.length;

  for (const locationConfig of LOCATION_CONFIGS) {
    for (const meetingType of MEETING_TYPES) {
      const result = await testMeetingType(locationConfig, meetingType, testNumber, totalTests);
      allResults.push(result);
      testNumber++;

      // Delay between tests
      if (testNumber <= totalTests) {
        await wait(3000, 'before next test');
      }
    }
  }

  // Generate summary
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('📊 TEST SUMMARY');
  console.log(`${'='.repeat(80)}\n`);

  const passed = allResults.filter(r => r.success).length;
  const failed = allResults.filter(r => !r.success).length;
  const totalTasks = allResults.reduce((sum, r) => sum + r.tasksGenerated, 0);
  const totalWeekendAdj = allResults.reduce((sum, r) => sum + r.weekendAdjustments.length, 0);

  console.log(`✅ Passed: ${passed}/${totalTests}`);
  console.log(`❌ Failed: ${failed}/${totalTests}`);
  console.log(`📋 Total tasks generated: ${totalTasks}`);
  console.log(`📅 Weekend adjustments: ${totalWeekendAdj}\n`);

  // Save results
  const timestamp = Date.now();
  const resultsFile = `/tmp/meeting-based-test-results-${timestamp}.json`;

  fs.writeFileSync(resultsFile, JSON.stringify({
    timestamp,
    testDate: new Date().toISOString(),
    summary: {
      totalTests,
      passed,
      failed,
      totalTasksGenerated: totalTasks,
      totalWeekendAdjustments: totalWeekendAdj,
    },
    results: allResults,
  }, null, 2));

  console.log(`📄 Results saved to: ${resultsFile}\n`);

  return allResults;
}

// Run the test suite
runAllTests()
  .then(() => {
    console.log('✅ All tests completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
