import { ClioService } from '../src/services/clio.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config/index.js';

const TEST_MATTER_ID = 1675950832;

/**
 * Get access token from Supabase
 */
async function getAccessToken() {
    const supabase = createClient(config.supabase.url, config.supabase.key);
    const { data, error } = await supabase
        .from('clio_tokens')
        .select('access_token')
        .eq('id', 1)
        .single();

    if (error || !data?.access_token) {
        throw new Error('Failed to get access token');
    }

    return data.access_token;
}

/**
 * Check current data before cleanup
 */
async function checkDataBeforeCleanup() {
    console.log('\n=== Checking Data Before Cleanup ===\n');

    try {
        const supabase = createClient(config.supabase.url, config.supabase.key);

        // Check Clio tasks
        const clioTasks = await ClioService.getTasksByMatter(TEST_MATTER_ID);
        console.log(`📋 Clio Tasks: ${clioTasks?.length || 0} tasks found`);
        if (clioTasks && clioTasks.length > 0) {
            clioTasks.forEach((task, i) => {
                console.log(`   ${i + 1}. ${task.name} (ID: ${task.id})`);
            });
        }

        // Check Supabase meetings
        const { data: meetingRecords, error: meetingError } = await supabase
            .from('matters-meetings-booked')
            .select('calendar_entry_id, created_at')
            .eq('matter_id', TEST_MATTER_ID);

        if (meetingError) {
            console.error('❌ Failed to fetch meeting records:', meetingError);
        } else {
            console.log(`\n📅 Supabase Meeting Records: ${meetingRecords?.length || 0} records found`);
            if (meetingRecords && meetingRecords.length > 0) {
                meetingRecords.forEach((record, i) => {
                    console.log(`   ${i + 1}. Calendar Entry ID: ${record.calendar_entry_id}`);
                });
            }
        }

        // Check Supabase tasks
        const { data: supabaseTasks, error: tasksError } = await supabase
            .from('tasks')
            .select('id, task_name')
            .eq('matter_id', TEST_MATTER_ID);

        if (tasksError) {
            console.error('❌ Failed to fetch Supabase tasks:', tasksError);
        } else {
            console.log(`\n📝 Supabase Task Records: ${supabaseTasks?.length || 0} records found`);
            if (supabaseTasks && supabaseTasks.length > 0) {
                supabaseTasks.forEach((task, i) => {
                    console.log(`   ${i + 1}. ${task.task_name} (ID: ${task.id})`);
                });
            }
        }

        return {
            clioTasks: clioTasks?.length || 0,
            meetingRecords: meetingRecords?.length || 0,
            supabaseTasks: supabaseTasks?.length || 0
        };
    } catch (error) {
        console.error('Error checking data:', error.message);
        return null;
    }
}

/**
 * Clean data function (from TestFlow.js)
 */
async function cleanData() {
    try {
        console.log('\n=== Running cleanData() ===\n');
        console.log(`Starting cleanup for test matter ${TEST_MATTER_ID}...`);

        const supabase = createClient(config.supabase.url, config.supabase.key);

        // 1. Get and delete all calendar entries for this matter from Clio
        const { data: meetingRecords, error: meetingError } = await supabase
            .from('matters-meetings-booked')
            .select('calendar_entry_id')
            .eq('matter_id', TEST_MATTER_ID);

        if (meetingError) {
            console.error('Failed to fetch meeting records:', meetingError);
        } else if (meetingRecords && meetingRecords.length > 0) {
            console.log(`Found ${meetingRecords.length} calendar entries to delete from Clio`);

            // Delete each calendar entry from Clio
            for (const record of meetingRecords) {
                try {
                    await ClioService.client.delete(`/api/v4/calendar_entries/${record.calendar_entry_id}`);
                    console.log(`✅ Deleted calendar entry: ${record.calendar_entry_id}`);
                } catch (error) {
                    console.error(`❌ Failed to delete calendar entry ${record.calendar_entry_id}:`, error.message);
                }
            }
        } else {
            console.log('No calendar entries found in Supabase');
        }

        // 2. Delete all tasks for this matter from Clio
        try {
            const tasks = await ClioService.getTasksByMatter(TEST_MATTER_ID);
            if (tasks && tasks.length > 0) {
                console.log(`\nFound ${tasks.length} tasks to delete from Clio`);

                for (const task of tasks) {
                    try {
                        await ClioService.deleteTask(task.id);
                        console.log(`✅ Deleted task: ${task.id} - ${task.name}`);
                    } catch (error) {
                        console.error(`❌ Failed to delete task ${task.id}:`, error.message);
                    }
                }
            } else {
                console.log('\nNo tasks found in Clio');
            }
        } catch (error) {
            console.error('Failed to fetch/delete tasks from Clio:', error.message);
        }

        // 3. Delete records from Supabase - tasks table
        console.log('\nDeleting tasks from Supabase...');
        const { error: tasksDeleteError } = await supabase
            .from('tasks')
            .delete()
            .eq('matter_id', TEST_MATTER_ID);

        if (tasksDeleteError) {
            console.error('❌ Failed to delete tasks from Supabase:', tasksDeleteError);
        } else {
            console.log('✅ Successfully deleted tasks from Supabase');
        }

        // 4. Delete records from Supabase - matters-meetings-booked
        console.log('Deleting meeting bookings from Supabase...');
        const { error: meetingsDeleteError } = await supabase
            .from('matters-meetings-booked')
            .delete()
            .eq('matter_id', TEST_MATTER_ID);

        if (meetingsDeleteError) {
            console.error('❌ Failed to delete meeting bookings from Supabase:', meetingsDeleteError);
        } else {
            console.log('✅ Successfully deleted meeting bookings from Supabase');
        }

        console.log(`\n✅ Cleanup completed for matter ${TEST_MATTER_ID}`);
    } catch (error) {
        console.error('❌ Data cleanup failed:', error);
        throw error;
    }
}

/**
 * Check data after cleanup
 */
async function checkDataAfterCleanup() {
    console.log('\n=== Checking Data After Cleanup ===\n');

    try {
        const supabase = createClient(config.supabase.url, config.supabase.key);

        // Check Clio tasks
        const clioTasks = await ClioService.getTasksByMatter(TEST_MATTER_ID);
        console.log(`📋 Clio Tasks: ${clioTasks?.length || 0} tasks remaining`);

        // Check Supabase meetings
        const { data: meetingRecords } = await supabase
            .from('matters-meetings-booked')
            .select('calendar_entry_id')
            .eq('matter_id', TEST_MATTER_ID);

        console.log(`📅 Supabase Meeting Records: ${meetingRecords?.length || 0} records remaining`);

        // Check Supabase tasks
        const { data: supabaseTasks } = await supabase
            .from('tasks')
            .select('id')
            .eq('matter_id', TEST_MATTER_ID);

        console.log(`📝 Supabase Task Records: ${supabaseTasks?.length || 0} records remaining`);

        return {
            clioTasks: clioTasks?.length || 0,
            meetingRecords: meetingRecords?.length || 0,
            supabaseTasks: supabaseTasks?.length || 0
        };
    } catch (error) {
        console.error('Error checking data after cleanup:', error.message);
        return null;
    }
}

/**
 * Main test runner
 */
async function main() {
    console.log('=====================================');
    console.log('  Clean Data Function Test');
    console.log('=====================================');

    try {
        // Step 1: Get access token and configure ClioService
        console.log('\n📝 Setting up...');
        const accessToken = await getAccessToken();
        ClioService.client.defaults.headers['Authorization'] = `Bearer ${accessToken}`;
        ClioService.initializeInterceptors();
        console.log('✅ ClioService configured');

        // Step 2: Check data before cleanup
        const beforeCounts = await checkDataBeforeCleanup();

        // Step 3: Run cleanData
        await cleanData();

        // Step 4: Check data after cleanup
        const afterCounts = await checkDataAfterCleanup();

        // Step 5: Summary
        console.log('\n=====================================');
        console.log('  Cleanup Summary');
        console.log('=====================================\n');

        if (beforeCounts && afterCounts) {
            console.log('Before → After:');
            console.log(`  Clio Tasks: ${beforeCounts.clioTasks} → ${afterCounts.clioTasks}`);
            console.log(`  Supabase Meetings: ${beforeCounts.meetingRecords} → ${afterCounts.meetingRecords}`);
            console.log(`  Supabase Tasks: ${beforeCounts.supabaseTasks} → ${afterCounts.supabaseTasks}`);

            const allCleaned = afterCounts.clioTasks === 0 &&
                             afterCounts.meetingRecords === 0 &&
                             afterCounts.supabaseTasks === 0;

            if (allCleaned) {
                console.log('\n✅ All data successfully cleaned!');
            } else {
                console.log('\n⚠️  Some data may still remain');
            }
        }

        console.log('\n=====================================');
        console.log('  Test Completed Successfully! ✅');
        console.log('=====================================\n');

    } catch (error) {
        console.error('\n❌ Test execution failed:', error);
        process.exit(1);
    }
}

// Run test
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
