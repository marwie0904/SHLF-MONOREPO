import { ClioService } from '../src/services/clio.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config/index.js';

const TEST_MATTER_ID = 1675950832;

// Test calendar event data (using one of the events from our previous test)
const TEST_EVENTS = [
    { EventId: 334846, EventName: 'Initial Meeting', StageId: 828078 },
    { EventId: 334801, EventName: 'Design Meeting', StageId: 707058 }
];

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
 * Test creating a calendar entry
 */
async function testCreateCalendarEntry(EventId, EventName) {
    console.log(`\n=== Testing createCalendarEntry: ${EventName} ===\n`);

    try {
        // Randomly select date (50/50 between Nov 11 and Nov 13, 2025)
        const dateOptions = ['2025-11-11', '2025-11-13'];
        const selectedDate = dateOptions[Math.floor(Math.random() * 2)];

        // Set times to 10 AM - 11 AM
        const startAt = `${selectedDate}T10:00:00-05:00`; // Eastern Time
        const endAt = `${selectedDate}T11:00:00-05:00`;

        const summary = `Test Meeting - ${EventName}`;

        console.log(`Creating calendar entry...`);
        console.log(`   Summary: ${summary}`);
        console.log(`   Date: ${selectedDate}`);
        console.log(`   Time: 10:00 AM - 11:00 AM (EST)`);
        console.log(`   Event Type ID: ${EventId}`);
        console.log(`   Matter ID: ${TEST_MATTER_ID}`);

        const result = await ClioService.createCalendarEntry({
            summary: summary,
            eventTypeId: EventId,
            calendarOwnerId: 7077963,
            matterId: TEST_MATTER_ID,
            startAt: startAt,
            endAt: endAt
        });

        console.log(`\n✅ SUCCESS: Calendar entry created!`);
        console.log(`   Entry ID: ${result.id}`);
        console.log(`   Summary: ${result.summary || 'N/A'}`);
        console.log(`   Start: ${result.start_at || startAt}`);
        console.log(`   End: ${result.end_at || endAt}`);

        // Verify by fetching the calendar entry
        console.log(`\n   Verifying calendar entry exists...`);
        const verifyResult = await ClioService.getCalendarEntry(result.id);

        if (verifyResult && verifyResult.id === result.id) {
            console.log(`   ✅ VERIFIED: Calendar entry confirmed in Clio`);
            console.log(`      Summary: ${verifyResult.summary}`);
            console.log(`      Matter ID: ${verifyResult.matter?.id || 'N/A'}`);
        } else {
            console.log(`   ⚠️  WARNING: Could not verify calendar entry`);
        }

        return result;
    } catch (error) {
        console.error(`\n❌ FAILED to create calendar entry for ${EventName}:`, error.message);
        if (error.response?.data) {
            console.error('   Response data:', error.response.data);
        }
        throw error;
    }
}

/**
 * Clean up test calendar entries
 */
async function cleanupCalendarEntries() {
    console.log('\n=== Cleaning Up Test Calendar Entries ===\n');

    try {
        // Get all calendar entries for the test matter
        const entries = await ClioService.getCalendarEntriesByMatter(TEST_MATTER_ID);

        if (!entries || entries.length === 0) {
            console.log('No calendar entries to clean up');
            return;
        }

        console.log(`Found ${entries.length} calendar entries to delete`);

        for (const entry of entries) {
            try {
                await ClioService.client.delete(`/api/v4/calendar_entries/${entry.id}`);
                console.log(`   ✅ Deleted calendar entry: ${entry.id} - ${entry.summary}`);
            } catch (error) {
                console.error(`   ❌ Failed to delete entry ${entry.id}:`, error.message);
            }
        }

        console.log('\nCleanup completed');
    } catch (error) {
        console.error('Cleanup failed:', error.message);
    }
}

/**
 * Main test runner
 */
async function main() {
    console.log('=====================================');
    console.log('  Create Calendar Entry Test');
    console.log('=====================================');

    try {
        // Step 1: Get access token and configure ClioService
        console.log('\n📝 Setting up...');
        const accessToken = await getAccessToken();
        ClioService.client.defaults.headers['Authorization'] = `Bearer ${accessToken}`;
        ClioService.initializeInterceptors();
        console.log('✅ ClioService configured\n');

        // Step 2: Test creating calendar entries
        const createdEntries = [];

        for (const event of TEST_EVENTS) {
            const entry = await testCreateCalendarEntry(event.EventId, event.EventName);
            createdEntries.push(entry);

            // Wait between creations
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log(`\n\n📊 Summary: Created ${createdEntries.length} calendar entries`);

        // Step 3: Clean up
        await cleanupCalendarEntries();

        console.log('\n=====================================');
        console.log('  Test Completed Successfully! ✅');
        console.log('=====================================\n');

    } catch (error) {
        console.error('\n❌ Test execution failed:', error);

        // Try to clean up even if test failed
        try {
            await cleanupCalendarEntries();
        } catch (cleanupError) {
            console.error('Cleanup also failed:', cleanupError.message);
        }

        process.exit(1);
    }
}

// Run test
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
