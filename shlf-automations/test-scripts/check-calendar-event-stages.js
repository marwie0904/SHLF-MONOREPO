import { SupabaseService } from '../src/services/supabase.js';

async function checkCalendarEventStages() {
    try {
        console.log('Checking calendar event to stage mappings...\n');

        // Get all calendar event mappings
        const mappings = await SupabaseService.getAllCalendarEventMappings();

        if (!mappings || mappings.length === 0) {
            console.log('No calendar event mappings found');
            return;
        }

        console.log(`Found ${mappings.length} calendar event mappings:\n`);

        for (const mapping of mappings) {
            console.log(`Calendar Event: ${mapping.calendar_event_name}`);
            console.log(`  Event ID: ${mapping.calendar_event_id}`);
            console.log(`  Stage ID: ${mapping.stage_id}`);

            // Get tasks for this calendar event
            const tasks = await SupabaseService.getTaskListMeeting(mapping.calendar_event_id);

            if (tasks && tasks.length > 0) {
                console.log(`  Tasks: ${tasks.length} total`);

                // Find dependent tasks
                const dependentTasks = tasks.filter(t => {
                    const rel = t['due_date-relational'] || t.due_date_relational || '';
                    return rel.toLowerCase().includes('after task');
                });

                if (dependentTasks.length > 0) {
                    console.log(`  Dependencies: ${dependentTasks.length} found`);
                    dependentTasks.forEach(t => {
                        const rel = t['due_date-relational'] || t.due_date_relational || '';
                        console.log(`    - ${t.task_name}: ${rel}`);
                    });
                } else {
                    console.log(`  Dependencies: None`);
                }
            } else {
                console.log(`  Tasks: None found`);
            }

            console.log('');
        }

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    }
}

checkCalendarEventStages();
