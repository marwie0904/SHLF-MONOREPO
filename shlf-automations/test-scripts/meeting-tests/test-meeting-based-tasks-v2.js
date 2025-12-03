/**
 * Comprehensive Meeting-Based Task Automation Test V2
 *
 * Tests all 5 meeting types across 3 locations (15 total tests):
 * - Initial Meeting, Vision Meeting, Design Meeting, Signing Meeting, Maintenance Meeting
 * - Locations: Bonita Springs, Fort Myers, Naples
 *
 * CLEANUP ORDER (IMPORTANT):
 * 1. Fetch calendar_entry_ids from Supabase matters-meetings-booked
 * 2. Delete calendar entries from Clio using those IDs
 * 3. Delete tasks from Clio
 * 4. Delete from Supabase (tasks, matters-meetings-booked)
 *
 * This cleanup happens BEFORE EACH TEST
 */

import { ClioService } from './src/services/clio.js';
import { TokenRefreshService } from './src/services/token-refresh.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';
import fs from 'fs';

const supabase = createClient(config.supabase.url, config.supabase.key);

// Test Configuration
const TEST_MATTER_ID = 1675950832;
const CALENDAR_OWNER_ID = 7077963;

// Location + Attorney Combinations
const LOCATION_CONFIGS = [
  { location: 'Bonita Springs', attorneyId: 357292201, clioLocation: 'SHLF Bonita Springs' },
  { location: 'Fort Myers', attorneyId: 357520756, clioLocation: 'SHLF Fort Myers' },
  { location: 'Naples', attorneyId: 357380836, clioLocation: 'SHLF Naples' },
];

// Meeting Type Configurations
const MEETING_TYPES = [
  { name: 'Initial Meeting', eventTypeId: 334846, date: '2025-11-11', time: '10:00' },
  { name: 'Vision Meeting', eventTypeId: 334831, date: '2025-11-11', time: '14:00' },
  { name: 'Design Meeting', eventTypeId: 334801, date: '2025-11-12', time: '10:00' },
  { name: 'Signing Meeting', eventTypeId: 334816, date: '2025-11-13', time: '10:00', usesCalendarLocation: true },
  { name: 'Maintenance Meeting', eventTypeId: 372457, date: '2025-11-13', time: '14:00' },
];

// Utility Functions
async function wait(ms, label = '') {
  if (label) {
    console.log(`   ⏳ Waiting ${ms / 1000} seconds ${label}...`);
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * UPDATED CLEANUP FUNCTION
 * Order: Clio calendar entries → Clio tasks → Supabase
 */
async function cleanupTestMatter() {
  console.log('   🧹 Cleaning up test matter data...');

  try {
    // Step 1: Get calendar entry IDs from Supabase matters-meetings-booked
    const { data: meetingBookings, error: bookingsError } = await supabase
      .from('matters-meetings-booked')
      .select('calendar_entry_id')
      .eq('matter_id', TEST_MATTER_ID);

    if (bookingsError) {
      console.log(`   ⚠️  Error fetching meeting bookings: ${bookingsError.message}`);
    }

    // Step 2: Delete calendar entries from Clio FIRST (using IDs from Supabase)
    if (meetingBookings && meetingBookings.length > 0) {
      console.log(`   🗑️  Deleting ${meetingBookings.length} calendar entries from Clio...`);
      for (const booking of meetingBookings) {
        if (booking.calendar_entry_id) {
          try {
            await ClioService.client.delete(`/api/v4/calendar_entries/${booking.calendar_entry_id}.json`);
            console.log(`      ✓ Deleted calendar entry ${booking.calendar_entry_id}`);
            await wait(100); // Small delay between deletions
          } catch (err) {
            if (err.response?.status !== 404) {
              console.log(`      ⚠️  Could not delete calendar entry ${booking.calendar_entry_id}`);
            }
          }
        }
      }
    }

    // Step 3: Get tasks from Supabase to delete from Clio
    const { data: existingTasks, error: tasksError } = await supabase
      .from('tasks')
      .select('task_id')
      .eq('matter_id', TEST_MATTER_ID);

    if (tasksError) {
      console.log(`   ⚠️  Error fetching tasks: ${tasksError.message}`);
    }

    // Step 4: Delete tasks from Clio
    if (existingTasks && existingTasks.length > 0) {
      console.log(`   🗑️  Deleting ${existingTasks.length} tasks from Clio...`);
      for (const task of existingTasks) {
        if (task.task_id) {
          try {
            await ClioService.deleteTask(task.task_id);
            await wait(100); // Small delay between deletions
          } catch (err) {
            if (err.response?.status !== 404) {
              console.log(`      ⚠️  Could not delete task ${task.task_id}`);
            }
          }
        }
      }
    }

    // Step 5: Delete from Supabase matters-meetings-booked
    const { error: deleteMeetingsError } = await supabase
      .from('matters-meetings-booked')
      .delete()
      .eq('matter_id', TEST_MATTER_ID);

    if (deleteMeetingsError) {
      console.log(`   ⚠️  Error deleting from matters-meetings-booked: ${deleteMeetingsError.message}`);
    }

    // Step 6: Delete from Supabase tasks
    const { error: deleteTasksError } = await supabase
      .from('tasks')
      .delete()
      .eq('matter_id', TEST_MATTER_ID);

    if (deleteTasksError) {
      console.log(`   ⚠️  Error deleting tasks from Supabase: ${deleteTasksError.message}`);
    }

    console.log('   ✓ Cleanup completed');
  } catch (error) {
    console.log(`   ⚠️  Cleanup error: ${error.message}`);
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
    calendarEntryId: null,
    errors: [],
  };

  try {
    // Step 1: Clean up existing data (BEFORE EVERY TEST)
    console.log('📋 STEP 1: Cleaning up test data...\n');
    await cleanupTestMatter();
    await wait(3000, 'for cleanup to settle');

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

    const calendarEntryPayload = {
      summary: `Test ${meetingName} - ${location}`,
      eventTypeId,
      calendarOwnerId: CALENDAR_OWNER_ID,
      matterId: TEST_MATTER_ID,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    };

    // Special handling for Signing Meeting - add location to calendar
    if (usesCalendarLocation) {
      calendarEntryPayload.location = clioLocation;
      console.log(`   ℹ️  Using calendar location: ${clioLocation} (Signing Meeting)`);
    }

    const calendarEntry = await ClioService.createCalendarEntry(calendarEntryPayload);
    result.calendarEntryId = calendarEntry.id;

    console.log(`   ✓ Calendar entry created (ID: ${calendarEntry.id})`);
    console.log(`   Event Type: ${meetingName} (${eventTypeId})`);
    console.log(`   Meeting: ${startAt.toLocaleString()}`);

    // Step 4: Wait for webhook processing (INCREASED TO 30 SECONDS)
    console.log(`\n⏳ STEP 4: Waiting for webhook processing...\n`);
    await wait(30000, 'for webhook and task generation');

    // Step 5: Check for generated tasks
    console.log(`\n📋 STEP 5: Checking for generated tasks...\n`);

    const { data: supabaseTasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('matter_id', TEST_MATTER_ID)
      .order('task_number', { ascending: true });

    if (tasksError) {
      result.errors.push(`Error fetching tasks: ${tasksError.message}`);
      console.log(`   ❌ ${tasksError.message}`);
      return result;
    }

    if (!supabaseTasks || supabaseTasks.length === 0) {
      console.log('   ⚠️  NO TASKS GENERATED');
      result.success = false;
      result.tasksGenerated = 0;
      return result;
    }

    console.log(`   ✅ Found ${supabaseTasks.length} task(s) generated!\n`);
    result.tasksGenerated = supabaseTasks.length;

    // Step 6: Retrieve task details
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
          console.log(`   ⚠️  Could not fetch Clio task ${task.task_id}`);
        }
      }

      const taskInfo = {
        taskNumber: task.task_number,
        taskName: task.task_name,
        assignee: assigneeName,
        dueDate: task.due_date,
        clioId: task.task_id,
      };

      result.tasks.push(taskInfo);

      console.log(`   Task ${task.task_number}: ${task.task_name}`);
      console.log(`      👤 Assigned to: ${assigneeName}`);
      console.log(`      📅 Due date: ${task.due_date || 'No due date'}`);
      console.log(`      🆔 Clio ID: ${task.task_id}`);
      console.log('');
    }

    result.success = true;

    console.log(`\n   ✅ TEST PASSED - ${location} ${meetingName}`);
    console.log(`   📋 Tasks generated: ${result.tasksGenerated}`);
    console.log(`   📅 Calendar entry ID: ${result.calendarEntryId}`);

  } catch (error) {
    console.error(`\n❌ Test failed for ${location} ${meetingName}:`, error.message);
    result.errors.push(error.message);
    result.success = false;
  }

  return result;
}

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║     Meeting-Based Task Automation - Comprehensive Test Suite V2           ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  // Initialize token service
  console.log('\n🔐 Initializing token service...');
  await TokenRefreshService.initialize();
  ClioService.initializeInterceptors();
  ClioService.client.defaults.headers['Authorization'] = `Bearer ${config.clio.accessToken}`;
  console.log('✅ Token service initialized\n');

  const allResults = [];
  let testNumber = 0;
  const totalTests = LOCATION_CONFIGS.length * MEETING_TYPES.length;

  // Test all meeting types for each location
  for (const locationConfig of LOCATION_CONFIGS) {
    for (const meetingType of MEETING_TYPES) {
      testNumber++;
      const result = await testMeetingType(locationConfig, meetingType, testNumber, totalTests);
      allResults.push(result);

      // Wait between tests (except last one)
      if (testNumber < totalTests) {
        console.log('\n⏸️  Waiting 10 seconds before next test...\n');
        await wait(10000);
      }
    }
  }

  // Final Summary
  console.log('\n\n' + '='.repeat(90));
  console.log('📊 FINAL SUMMARY - MEETING-BASED TASK AUTOMATION TESTS');
  console.log('='.repeat(90) + '\n');

  const passed = allResults.filter(r => r.success).length;
  const failed = allResults.filter(r => !r.success).length;

  console.log(`Total Tests: ${allResults.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Success Rate: ${((passed / allResults.length) * 100).toFixed(1)}%`);
  console.log('');

  // Group by location
  for (const locationConfig of LOCATION_CONFIGS) {
    const locationResults = allResults.filter(r => r.location === locationConfig.location);
    const locationPassed = locationResults.filter(r => r.success).length;

    console.log(`\n📍 ${locationConfig.location} (${locationPassed}/${locationResults.length} passed):`);

    for (const result of locationResults) {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      console.log(`   ${status} - ${result.meetingType}: ${result.tasksGenerated} tasks`);
      if (result.errors.length > 0) {
        console.log(`      Errors: ${result.errors.join(', ')}`);
      }
    }
  }

  console.log('\n' + '='.repeat(90) + '\n');

  // Save results
  const timestamp = Date.now();
  const resultsFile = `/tmp/meeting-based-test-results-v2-${timestamp}.json`;
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
