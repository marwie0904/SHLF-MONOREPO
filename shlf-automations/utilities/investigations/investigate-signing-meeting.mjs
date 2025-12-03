import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const MATTER_ID = '1730829713';

console.log(`Investigating signing meeting task issue for matter ${MATTER_ID}...`);
console.log('');

// 1. Check automation_logs for this matter
console.log('=== Checking automation_logs ===');
const { data: logs, error: logsError } = await supabase
  .from('automation_logs')
  .select('*')
  .eq('matter_id', MATTER_ID)
  .order('created_at', { ascending: false })
  .limit(50);

if (logsError) {
  console.error('Error fetching logs:', logsError);
} else {
  console.log(`Found ${logs.length} log entries for matter ${MATTER_ID}`);
  if (logs.length > 0) {
    console.log('\nRecent logs:');
    logs.forEach((log, idx) => {
      console.log(`\n[${idx + 1}] ${log.created_at}`);
      console.log(`  Event: ${log.event_type}`);
      console.log(`  Status: ${log.status}`);
      console.log(`  Message: ${log.message || 'N/A'}`);
      if (log.error_details) {
        console.log(`  Error: ${JSON.stringify(log.error_details, null, 2)}`);
      }
      if (log.metadata) {
        console.log(`  Metadata: ${JSON.stringify(log.metadata, null, 2)}`);
      }
    });
  }
}

// 2. Check calendar_event_tasks for signing meeting tasks
console.log('\n\n=== Checking calendar_event_tasks ===');
const { data: tasks, error: tasksError } = await supabase
  .from('calendar_event_tasks')
  .select('*')
  .eq('matter_id', MATTER_ID)
  .order('created_at', { ascending: false });

if (tasksError) {
  console.error('Error fetching tasks:', tasksError);
} else {
  console.log(`Found ${tasks.length} calendar event task entries for matter ${MATTER_ID}`);
  if (tasks.length > 0) {
    console.log('\nTasks:');
    tasks.forEach((task, idx) => {
      console.log(`\n[${idx + 1}] ${task.created_at}`);
      console.log(`  Calendar Event ID: ${task.calendar_event_id}`);
      console.log(`  Task Type ID: ${task.task_type_id}`);
      console.log(`  Clio Task ID: ${task.clio_task_id || 'N/A'}`);
      console.log(`  Status: ${task.status}`);
      if (task.error_message) {
        console.log(`  Error: ${task.error_message}`);
      }
    });
  }
}

// 3. Check for signing meeting calendar events
console.log('\n\n=== Checking for calendar events with "signing meeting" ===');
const { data: allLogs, error: allLogsError } = await supabase
  .from('automation_logs')
  .select('*')
  .eq('matter_id', MATTER_ID)
  .order('created_at', { ascending: false });

if (allLogsError) {
  console.error('Error fetching all logs:', allLogsError);
} else {
  const signingMeetingLogs = allLogs.filter(log => {
    const metadata = log.metadata || {};
    const message = log.message || '';
    const eventType = log.event_type || '';

    return (
      message.toLowerCase().includes('signing') ||
      JSON.stringify(metadata).toLowerCase().includes('signing') ||
      eventType.toLowerCase().includes('signing')
    );
  });

  console.log(`Found ${signingMeetingLogs.length} logs mentioning "signing"`);
  if (signingMeetingLogs.length > 0) {
    signingMeetingLogs.forEach((log, idx) => {
      console.log(`\n[${idx + 1}] ${log.created_at}`);
      console.log(`  Event: ${log.event_type}`);
      console.log(`  Status: ${log.status}`);
      console.log(`  Message: ${log.message || 'N/A'}`);
      if (log.metadata) {
        console.log(`  Metadata: ${JSON.stringify(log.metadata, null, 2)}`);
      }
      if (log.error_details) {
        console.log(`  Error: ${JSON.stringify(log.error_details, null, 2)}`);
      }
    });
  }
}

// 4. Check webhook_events for this matter
console.log('\n\n=== Checking webhook_events ===');
const { data: webhooks, error: webhooksError } = await supabase
  .from('webhook_events')
  .select('*')
  .ilike('payload', `%${MATTER_ID}%`)
  .order('created_at', { ascending: false })
  .limit(20);

if (webhooksError) {
  console.error('Error fetching webhooks:', webhooksError);
} else {
  console.log(`Found ${webhooks.length} webhook events for matter ${MATTER_ID}`);
  if (webhooks.length > 0) {
    console.log('\nRecent webhook events:');
    webhooks.forEach((webhook, idx) => {
      console.log(`\n[${idx + 1}] ${webhook.created_at}`);
      console.log(`  Event Type: ${webhook.event_type}`);
      console.log(`  Status: ${webhook.status}`);
      if (webhook.payload) {
        const payload = typeof webhook.payload === 'string'
          ? JSON.parse(webhook.payload)
          : webhook.payload;
        console.log(`  Payload: ${JSON.stringify(payload, null, 2)}`);
      }
    });
  }
}

console.log('\n\n=== Investigation Complete ===');
