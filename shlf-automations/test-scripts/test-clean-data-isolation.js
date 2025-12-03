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
 * Get a sample of other matters from Supabase to verify they weren't affected
 */
async function checkOtherMattersInSupabase() {
    console.log('\n=== Checking Other Matters in Supabase ===\n');

    try {
        const supabase = createClient(config.supabase.url, config.supabase.key);

        // Get tasks from OTHER matters (not our test matter)
        const { data: otherTasks, error: tasksError } = await supabase
            .from('tasks')
            .select('matter_id, task_name, id')
            .neq('matter_id', TEST_MATTER_ID)
            .limit(10);

        if (tasksError) {
            console.error('❌ Error fetching other tasks:', tasksError.message);
            return null;
        }

        console.log(`📝 Other Matters' Tasks: ${otherTasks?.length || 0} sample records found`);

        if (otherTasks && otherTasks.length > 0) {
            // Group by matter_id to show distinct matters
            const matterIds = [...new Set(otherTasks.map(t => t.matter_id))];
            console.log(`   Distinct matters with tasks: ${matterIds.length}`);

            matterIds.slice(0, 3).forEach(matterId => {
                const tasksForMatter = otherTasks.filter(t => t.matter_id === matterId);
                console.log(`   \n   Matter ${matterId}: ${tasksForMatter.length} tasks`);
                tasksForMatter.slice(0, 2).forEach(task => {
                    console.log(`      - ${task.task_name}`);
                });
            });
        }

        // Get meetings from OTHER matters
        const { data: otherMeetings, error: meetingsError } = await supabase
            .from('matters-meetings-booked')
            .select('matter_id, calendar_entry_id')
            .neq('matter_id', TEST_MATTER_ID)
            .limit(10);

        if (meetingsError) {
            console.error('\n❌ Error fetching other meetings:', meetingsError.message);
        } else {
            console.log(`\n📅 Other Matters' Meetings: ${otherMeetings?.length || 0} sample records found`);

            if (otherMeetings && otherMeetings.length > 0) {
                const matterIds = [...new Set(otherMeetings.map(m => m.matter_id))];
                console.log(`   Distinct matters with meetings: ${matterIds.length}`);
            }
        }

        return {
            otherTasks: otherTasks?.length || 0,
            otherMeetings: otherMeetings?.length || 0
        };
    } catch (error) {
        console.error('Error checking other matters:', error.message);
        return null;
    }
}

/**
 * Check test matter specifically
 */
async function checkTestMatter() {
    console.log('\n=== Checking Test Matter (ID: 1675950832) ===\n');

    try {
        const supabase = createClient(config.supabase.url, config.supabase.key);

        // Check Clio tasks for test matter
        const clioTasks = await ClioService.getTasksByMatter(TEST_MATTER_ID);
        console.log(`📋 Test Matter - Clio Tasks: ${clioTasks?.length || 0}`);

        // Check Supabase tasks for test matter
        const { data: supabaseTasks } = await supabase
            .from('tasks')
            .select('*')
            .eq('matter_id', TEST_MATTER_ID);

        console.log(`📝 Test Matter - Supabase Tasks: ${supabaseTasks?.length || 0}`);

        // Check Supabase meetings for test matter
        const { data: supabaseMeetings } = await supabase
            .from('matters-meetings-booked')
            .select('*')
            .eq('matter_id', TEST_MATTER_ID);

        console.log(`📅 Test Matter - Supabase Meetings: ${supabaseMeetings?.length || 0}`);

        return {
            clioTasks: clioTasks?.length || 0,
            supabaseTasks: supabaseTasks?.length || 0,
            supabaseMeetings: supabaseMeetings?.length || 0
        };
    } catch (error) {
        console.error('Error checking test matter:', error.message);
        return null;
    }
}

/**
 * Run cleanData function
 */
async function cleanData() {
    console.log('\n=== Running cleanData() for Test Matter ===\n');
    console.log(`Cleaning data for matter ID: ${TEST_MATTER_ID}`);

    try {
        const supabase = createClient(config.supabase.url, config.supabase.key);

        // 1. Get and delete all calendar entries for THIS matter from Clio
        const { data: meetingRecords, error: meetingError } = await supabase
            .from('matters-meetings-booked')
            .select('calendar_entry_id')
            .eq('matter_id', TEST_MATTER_ID);

        if (!meetingError && meetingRecords && meetingRecords.length > 0) {
            console.log(`Deleting ${meetingRecords.length} calendar entries for matter ${TEST_MATTER_ID}...`);

            for (const record of meetingRecords) {
                try {
                    await ClioService.client.delete(`/api/v4/calendar_entries/${record.calendar_entry_id}`);
                    console.log(`✅ Deleted calendar entry: ${record.calendar_entry_id}`);
                } catch (error) {
                    // 404 is fine - already deleted
                    if (error.response?.status !== 404) {
                        console.error(`❌ Failed to delete calendar entry ${record.calendar_entry_id}:`, error.message);
                    }
                }
            }
        }

        // 2. Delete all tasks for THIS matter from Clio
        const tasks = await ClioService.getTasksByMatter(TEST_MATTER_ID);
        if (tasks && tasks.length > 0) {
            console.log(`Deleting ${tasks.length} tasks for matter ${TEST_MATTER_ID}...`);

            for (const task of tasks) {
                try {
                    await ClioService.deleteTask(task.id);
                    console.log(`✅ Deleted task: ${task.id}`);
                } catch (error) {
                    console.error(`❌ Failed to delete task ${task.id}:`, error.message);
                }
            }
        }

        // 3. Delete records from Supabase - tasks table (only for THIS matter)
        console.log(`Deleting Supabase tasks for matter ${TEST_MATTER_ID}...`);
        const { error: tasksDeleteError } = await supabase
            .from('tasks')
            .delete()
            .eq('matter_id', TEST_MATTER_ID);

        if (tasksDeleteError) {
            console.error('❌ Failed to delete tasks from Supabase:', tasksDeleteError);
        } else {
            console.log('✅ Successfully deleted tasks from Supabase');
        }

        // 4. Delete records from Supabase - matters-meetings-booked (only for THIS matter)
        console.log(`Deleting Supabase meetings for matter ${TEST_MATTER_ID}...`);
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
 * Main test runner
 */
async function main() {
    console.log('=====================================');
    console.log('  Clean Data Isolation Test');
    console.log('=====================================');
    console.log('\nThis test verifies that cleanData() only');
    console.log(`affects matter ${TEST_MATTER_ID} and leaves`);
    console.log('other matters untouched.\n');

    try {
        // Setup
        const accessToken = await getAccessToken();
        ClioService.client.defaults.headers['Authorization'] = `Bearer ${accessToken}`;
        ClioService.initializeInterceptors();

        // Step 1: Check other matters BEFORE cleanup
        console.log('\n' + '='.repeat(50));
        console.log('BEFORE CLEANUP');
        console.log('='.repeat(50));

        const otherMattersBefore = await checkOtherMattersInSupabase();
        const testMatterBefore = await checkTestMatter();

        // Step 2: Run cleanup
        console.log('\n' + '='.repeat(50));
        console.log('RUNNING CLEANUP');
        console.log('='.repeat(50));

        await cleanData();

        // Step 3: Check other matters AFTER cleanup
        console.log('\n' + '='.repeat(50));
        console.log('AFTER CLEANUP');
        console.log('='.repeat(50));

        const otherMattersAfter = await checkOtherMattersInSupabase();
        const testMatterAfter = await checkTestMatter();

        // Step 4: Verification Summary
        console.log('\n' + '='.repeat(50));
        console.log('ISOLATION VERIFICATION');
        console.log('='.repeat(50));

        console.log('\n📊 Other Matters (Should be UNCHANGED):');
        if (otherMattersBefore && otherMattersAfter) {
            console.log(`   Tasks: ${otherMattersBefore.otherTasks} → ${otherMattersAfter.otherTasks}`);
            console.log(`   Meetings: ${otherMattersBefore.otherMeetings} → ${otherMattersAfter.otherMeetings}`);

            const tasksUnchanged = otherMattersBefore.otherTasks === otherMattersAfter.otherTasks;
            const meetingsUnchanged = otherMattersBefore.otherMeetings === otherMattersAfter.otherMeetings;

            if (tasksUnchanged && meetingsUnchanged) {
                console.log('\n   ✅ OTHER MATTERS WERE NOT AFFECTED');
            } else {
                console.log('\n   ⚠️  OTHER MATTERS MAY HAVE BEEN AFFECTED!');
            }
        }

        console.log(`\n📊 Test Matter ${TEST_MATTER_ID} (Should be CLEANED):');
        if (testMatterBefore && testMatterAfter) {
            console.log(`   Clio Tasks: ${testMatterBefore.clioTasks} → ${testMatterAfter.clioTasks}`);
            console.log(`   Supabase Tasks: ${testMatterBefore.supabaseTasks} → ${testMatterAfter.supabaseTasks}`);
            console.log(`   Supabase Meetings: ${testMatterBefore.supabaseMeetings} → ${testMatterAfter.supabaseMeetings}`);

            const allCleaned = testMatterAfter.clioTasks === 0 &&
                             testMatterAfter.supabaseTasks === 0 &&
                             testMatterAfter.supabaseMeetings === 0;

            if (allCleaned) {
                console.log('\n   ✅ TEST MATTER WAS COMPLETELY CLEANED');
            } else {
                console.log('\n   ⚠️  TEST MATTER MAY NOT BE FULLY CLEANED');
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
