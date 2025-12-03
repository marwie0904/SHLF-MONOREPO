/**
 * Clean up all data for test matter 1675950832 from both Clio and Supabase
 * Includes: calendar entries, tasks, and meeting bookings
 */

import { ClioService } from './src/services/clio.js';
import { TokenRefreshService } from './src/services/token-refresh.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);
const TEST_MATTER_ID = 1675950832;

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cleanupTestMatter() {
  console.log('\n🧹 Cleaning up all data for test matter', TEST_MATTER_ID);
  console.log('='.repeat(60));

  try {
    // Initialize token service
    console.log('\n🔐 Initializing token service...');
    await TokenRefreshService.initialize();
    ClioService.initializeInterceptors();
    ClioService.client.defaults.headers['Authorization'] = `Bearer ${config.clio.accessToken}`;

    // Step 1: Get calendar entry IDs from Supabase
    console.log('\n📋 Step 1: Fetching calendar entries from Supabase...');
    const { data: meetingBookings, error: bookingsError } = await supabase
      .from('matters-meetings-booked')
      .select('calendar_entry_id')
      .eq('matter_id', TEST_MATTER_ID);

    if (bookingsError) {
      console.log('⚠️  Error:', bookingsError.message);
    } else {
      console.log(`   Found ${meetingBookings?.length || 0} calendar entries`);
    }

    // Step 2: Delete calendar entries from Clio
    let calendarDeleted = 0;
    if (meetingBookings && meetingBookings.length > 0) {
      console.log(`\n🗑️  Step 2: Deleting ${meetingBookings.length} calendar entries from Clio...`);
      for (const booking of meetingBookings) {
        if (booking.calendar_entry_id) {
          try {
            await ClioService.client.delete(`/api/v4/calendar_entries/${booking.calendar_entry_id}.json`);
            console.log(`   ✓ Deleted calendar entry ${booking.calendar_entry_id}`);
            calendarDeleted++;
            await wait(100);
          } catch (err) {
            if (err.response?.status !== 404) {
              console.log(`   ⚠️  Could not delete calendar entry ${booking.calendar_entry_id}: ${err.message}`);
            } else {
              console.log(`   ℹ️  Calendar entry ${booking.calendar_entry_id} already deleted`);
            }
          }
        }
      }
    } else {
      console.log('\n✓ No calendar entries to delete from Clio');
    }

    // Step 3: Get tasks from Supabase
    console.log('\n📋 Step 3: Fetching tasks from Supabase...');
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('matter_id', TEST_MATTER_ID);

    if (tasksError) {
      console.log('⚠️  Error:', tasksError.message);
    } else {
      console.log(`   Found ${tasks?.length || 0} tasks`);
    }

    // Step 4: Delete tasks from Clio
    let tasksDeleted = 0;
    if (tasks && tasks.length > 0) {
      console.log(`\n🗑️  Step 4: Deleting ${tasks.length} tasks from Clio...`);
      for (const task of tasks) {
        if (task.task_id) {
          try {
            await ClioService.deleteTask(task.task_id);
            console.log(`   ✓ Deleted task ${task.task_id} - "${task.task_name}"`);
            tasksDeleted++;
            await wait(100);
          } catch (err) {
            if (err.response?.status !== 404) {
              console.log(`   ⚠️  Could not delete task ${task.task_id}: ${err.message}`);
            } else {
              console.log(`   ℹ️  Task ${task.task_id} already deleted`);
            }
          }
        }
      }
    } else {
      console.log('\n✓ No tasks to delete from Clio');
    }

    // Step 5: Delete from Supabase matters-meetings-booked
    console.log('\n🗑️  Step 5: Deleting from Supabase matters-meetings-booked...');
    const { error: deleteMeetingsError } = await supabase
      .from('matters-meetings-booked')
      .delete()
      .eq('matter_id', TEST_MATTER_ID);

    if (deleteMeetingsError) {
      console.log('   ⚠️  Error:', deleteMeetingsError.message);
    } else {
      console.log('   ✓ Deleted all meeting bookings from Supabase');
    }

    // Step 6: Delete from Supabase tasks
    console.log('\n🗑️  Step 6: Deleting from Supabase tasks...');
    const { error: deleteTasksError } = await supabase
      .from('tasks')
      .delete()
      .eq('matter_id', TEST_MATTER_ID);

    if (deleteTasksError) {
      console.log('   ⚠️  Error:', deleteTasksError.message);
    } else {
      console.log('   ✓ Deleted all tasks from Supabase');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Cleanup completed successfully!');
    console.log(`   Calendar entries deleted from Clio: ${calendarDeleted}`);
    console.log(`   Tasks deleted from Clio: ${tasksDeleted}`);
    console.log(`   Meeting bookings deleted from Supabase: ${meetingBookings?.length || 0}`);
    console.log(`   Tasks deleted from Supabase: ${tasks?.length || 0}`);
    console.log('');

  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    console.error(error.stack);
  }
}

cleanupTestMatter()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
