import { SupabaseService } from '../src/services/supabase.js';

const calendarEventTypeId = '707073'; // Signing Meeting event type ID

try {
  // First get the mapping to find stage_id
  const mapping = await SupabaseService.getCalendarEventMapping(calendarEventTypeId);

  if (!mapping) {
    console.log('No mapping found for calendar event type', calendarEventTypeId);
    process.exit(1);
  }

  console.log(`Mapping: ${mapping.stage_name} (stage_id: ${mapping.stage_id})`);
  console.log(`Uses meeting location: ${mapping.uses_meeting_location}\n`);

  // Get templates by stage_id (not calendar_event_id)
  const templates = await SupabaseService.getTaskListStage(mapping.stage_id);

  console.log(`Found ${templates.length} templates for stage_id ${mapping.stage_id}`);
  console.log('\nSigning Meeting Task Templates:');
  templates
    .sort((a, b) => a.task_number - b.task_number)
    .forEach(t => {
      console.log(`\nTask ${t.task_number}: ${t.task_title}`);
      console.log(`  Assignee: ${t.assignee}`);
    });
} catch (error) {
  console.error('Error:', error.message);
  console.error(error);
}
