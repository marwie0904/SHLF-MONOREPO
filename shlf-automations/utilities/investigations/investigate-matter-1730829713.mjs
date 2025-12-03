import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const MATTER_ID = '1730829713';

console.log(`=== Investigating Matter ${MATTER_ID} - Signing Meeting Task Issue ===\n`);

// 1. Check tasks table for this matter
console.log('1. Checking tasks table for matter', MATTER_ID);
const { data: tasks, error: tasksError } = await supabase
  .from('tasks')
  .select('*')
  .eq('matter_id', MATTER_ID);

if (tasksError) {
  console.error('Error fetching tasks:', tasksError);
} else {
  console.log(`\nFound ${tasks.length} tasks for matter ${MATTER_ID}`);

  if (tasks.length > 0) {
    console.log('\nAll tasks:');
    tasks.forEach((task, idx) => {
      console.log(`\n[${idx + 1}] Task: ${task.task_name}`);
      console.log(`  Task ID: ${task.task_id}`);
      console.log(`  Description: ${task.task_desc || 'N/A'}`);
      console.log(`  Assigned User: ${task.assigned_user || 'N/A'}`);
      console.log(`  Due Date: ${task.due_date || 'N/A'}`);
      console.log(`  Calendar Entry ID: ${task.calendar_entry_id || 'N/A'}`);
      console.log(`  Stage: ${task.stage_name || 'N/A'} (ID: ${task.stage_id || 'N/A'})`);
      console.log(`  Completed: ${task.completed}`);
      console.log(`  Last Updated: ${task.last_updated || 'N/A'}`);
    });

    // Check specifically for signing meeting tasks
    const signingTasks = tasks.filter(t =>
      t.task_name?.toLowerCase().includes('signing') ||
      t.task_desc?.toLowerCase().includes('signing')
    );

    console.log(`\n\nSigning-related tasks found: ${signingTasks.length}`);
    if (signingTasks.length > 0) {
      signingTasks.forEach((task, idx) => {
        console.log(`\n  [${idx + 1}] ${task.task_name}`);
        console.log(`    Calendar Entry ID: ${task.calendar_entry_id || 'NONE - THIS IS THE ISSUE!'}`);
        console.log(`    Due Date: ${task.due_date || 'N/A'}`);
      });
    } else {
      console.log('  ⚠️  NO SIGNING MEETING TASKS FOUND - This is the issue!');
    }
  } else {
    console.log('  ⚠️  NO TASKS FOUND for this matter');
  }
}

// 2. Check webhook_events for calendar entry creation/updates
console.log('\n\n2. Checking webhook_events for matter', MATTER_ID);
const { data: webhooks, error: webhooksError } = await supabase
  .from('webhook_events')
  .select('*')
  .limit(100);

let matterWebhooks = [];

if (webhooksError) {
  console.error('Error fetching webhooks:', webhooksError);
} else {
  // Filter webhooks that contain this matter ID
  matterWebhooks = webhooks.filter(w => {
    const payload = w.webhook_payload;
    if (!payload) return false;
    const payloadStr = JSON.stringify(payload);
    return payloadStr.includes(MATTER_ID);
  });

  console.log(`\nFound ${matterWebhooks.length} webhook events for matter ${MATTER_ID}`);

  if (matterWebhooks.length > 0) {
    console.log('\nWebhook events:');
    matterWebhooks.forEach((webhook, idx) => {
      console.log(`\n[${idx + 1}] ${webhook.created_at}`);
      console.log(`  Event Type: ${webhook.event_type}`);
      console.log(`  Resource Type: ${webhook.resource_type}`);
      console.log(`  Resource ID: ${webhook.resource_id}`);
      console.log(`  Action: ${webhook.action}`);
      console.log(`  Success: ${webhook.success}`);
      console.log(`  Tasks Created: ${webhook.tasks_created || 0}`);
      console.log(`  Tasks Updated: ${webhook.tasks_updated || 0}`);
      console.log(`  Processed At: ${webhook.processed_at || 'Not processed'}`);

      if (webhook.webhook_payload) {
        const payload = webhook.webhook_payload;

        // Extract calendar entry details if present
        if (payload.data) {
          const data = payload.data;
          if (data.summary) {
            console.log(`  Calendar Summary: ${data.summary}`);
          }
          if (data.start_at) {
            console.log(`  Start Time: ${data.start_at}`);
          }
          if (data.matter) {
            console.log(`  Matter ID: ${data.matter.id}`);
          }
        }
      }
    });

    // Check specifically for calendar entry events
    const calendarEvents = matterWebhooks.filter(w =>
      w.resource_type === 'CalendarEntry' ||
      w.event_type?.includes('calendar')
    );

    console.log(`\n\nCalendar-related webhook events: ${calendarEvents.length}`);
    if (calendarEvents.length > 0) {
      calendarEvents.forEach((webhook, idx) => {
        const payload = webhook.webhook_payload?.data;
        const summary = payload?.summary || 'N/A';
        console.log(`\n  [${idx + 1}] ${webhook.action} - ${summary}`);
        console.log(`    Created: ${webhook.created_at}`);
        console.log(`    Tasks Created: ${webhook.tasks_created || 0}`);
        console.log(`    Success: ${webhook.success}`);

        // Check if it's a signing meeting
        if (summary.toLowerCase().includes('signing')) {
          console.log(`    ⚠️  THIS IS A SIGNING MEETING EVENT!`);
          console.log(`    Tasks Created: ${webhook.tasks_created || 0} (Expected > 0)`);
          if (!webhook.tasks_created || webhook.tasks_created === 0) {
            console.log(`    ❌ NO TASKS WERE CREATED FOR THIS SIGNING MEETING!`);
          }
        }
      });
    }
  } else {
    console.log('  ⚠️  NO WEBHOOK EVENTS FOUND for this matter');
  }
}

console.log('\n\n=== Investigation Summary ===');
console.log(`Matter ID: ${MATTER_ID}`);
console.log(`Total Tasks: ${tasks?.length || 0}`);
console.log(`Signing Tasks: ${tasks?.filter(t => t.task_name?.toLowerCase().includes('signing')).length || 0}`);
console.log(`Webhook Events: ${matterWebhooks?.length || 0}`);
console.log(`\nNext Steps:`);
console.log(`1. Check if signing meeting calendar entry exists for this matter`);
console.log(`2. Check task mapping configuration for signing meeting events`);
console.log(`3. Review webhook processing logs for any errors`);
