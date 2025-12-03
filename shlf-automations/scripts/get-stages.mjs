import axios from 'axios';

const headers = {
  'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yYmdraWJidnZxZW5kd2xraXJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzNTg2ODEsImV4cCI6MjA2NTkzNDY4MX0.27P-uAihOprHnZ09y2kzmrlw9EAXNcZk6tzkvHZj2GI',
  'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yYmdraWJidnZxZW5kd2xraXJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzNTg2ODEsImV4cCI6MjA2NTkzNDY4MX0.27P-uAihOprHnZ09y2kzmrlw9EAXNcZk6tzkvHZj2GI'
};

try {
  // Get all unique stages from task-list-meeting
  const meetingRes = await axios.get(
    'https://orbgkibbvvqendwlkirb.supabase.co/rest/v1/task-list-meeting',
    { params: { select: 'stage_id,stage_name,calendar_event_id,calendar_name' }, headers }
  );

  // Get all unique stages from task-list-non-meeting
  const nonMeetingRes = await axios.get(
    'https://orbgkibbvvqendwlkirb.supabase.co/rest/v1/task-list-non-meeting',
    { params: { select: 'stage_id,stage_name' }, headers }
  );

  // Group meeting stages
  const meetingStages = {};
  meetingRes.data.forEach(row => {
    const key = row.stage_id;
    if (!meetingStages[key]) {
      meetingStages[key] = {
        stage_id: row.stage_id,
        stage_name: row.stage_name,
        calendar_event_id: row.calendar_event_id,
        calendar_name: row.calendar_name,
        count: 0
      };
    }
    meetingStages[key].count++;
  });

  // Group non-meeting stages
  const nonMeetingStages = {};
  nonMeetingRes.data.forEach(row => {
    const key = row.stage_id;
    if (!nonMeetingStages[key]) {
      nonMeetingStages[key] = {
        stage_id: row.stage_id,
        stage_name: row.stage_name,
        count: 0
      };
    }
    nonMeetingStages[key].count++;
  });

  console.log('TASK-LIST-MEETING STAGES:');
  console.log('='.repeat(80));
  Object.values(meetingStages).forEach(s => {
    console.log(`${s.stage_id} | ${s.stage_name} | Event: ${s.calendar_event_id} (${s.calendar_name}) | ${s.count} templates`);
  });

  console.log('\nTASK-LIST-NON-MEETING STAGES:');
  console.log('='.repeat(80));
  Object.values(nonMeetingStages).forEach(s => {
    console.log(`${s.stage_id} | ${s.stage_name} | ${s.count} templates`);
  });

  console.log('\nSUMMARY:');
  console.log('='.repeat(80));
  console.log('Meeting-based stages:', Object.keys(meetingStages).length);
  console.log('Non-meeting stages:', Object.keys(nonMeetingStages).length);
  console.log('Total templates (meeting):', meetingRes.data.length);
  console.log('Total templates (non-meeting):', nonMeetingRes.data.length);
} catch (error) {
  console.error('Error:', error.message);
}
