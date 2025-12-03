import { SupabaseService } from '../src/services/supabase.js';

/**
 * Test getting calendar events from Supabase
 */
async function testGetCalendarEvents() {
    console.log('\n=== Testing getCalendarEvents ===\n');

    try {
        console.log('Fetching calendar events from Supabase...');

        const mappings = await SupabaseService.getAllCalendarEventMappings();

        if (!mappings || mappings.length === 0) {
            console.warn('⚠️  No calendar event mappings found in database');
            return [];
        }

        console.log(`✅ SUCCESS: Found ${mappings.length} calendar event mappings\n`);

        // Transform to the expected format (same as TestFlow.js)
        const events = mappings.map(mapping => ({
            EventId: mapping.calendar_event_id,
            EventName: mapping.calendar_event_name,
            StageId: mapping.stage_id,
            StartDate: null, // Will be set when creating test calendar entries
            EndDate: null    // Will be set when creating test calendar entries
        }));

        // Display each event
        console.log('Calendar Events:');
        console.log('================');
        events.forEach((event, index) => {
            console.log(`\n${index + 1}. ${event.EventName}`);
            console.log(`   Event ID: ${event.EventId}`);
            console.log(`   Stage ID: ${event.StageId}`);
            console.log(`   Start Date: ${event.StartDate || 'Not set'}`);
            console.log(`   End Date: ${event.EndDate || 'Not set'}`);
        });

        console.log(`\n================`);
        console.log(`Total: ${events.length} events`);

        return events;
    } catch (error) {
        console.error('❌ Failed to fetch calendar events:', error.message);
        if (error.details) {
            console.error('   Details:', error.details);
        }
        throw error;
    }
}

/**
 * Main test runner
 */
async function main() {
    console.log('=====================================');
    console.log('  Calendar Events Test');
    console.log('=====================================');

    try {
        const events = await testGetCalendarEvents();

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
