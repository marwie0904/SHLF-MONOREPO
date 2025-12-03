/**
 * Create ALL Meeting Calendar Entries (No Screenshots)
 *
 * This script creates calendar entries for all 12 test combinations WITHOUT cleanup
 * Then you can manually take screenshots for each using Playwright
 */

import { ClioService } from './src/services/clio.js';
import { TokenRefreshService } from './src/services/token-refresh.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

const TEST_MATTER_ID = 1675950832;

const MEETINGS = {
  initial: { name: 'Initial Meeting', calendarEventId: 334846, stageId: '828076' },
  vision: { name: 'Vision Meeting', calendarEventId: 334831, stageId: '828078' },
  design: { name: 'Design Meeting', calendarEventId: 334801, stageId: '828080' },
  signing: { name: 'Signing Meeting', calendarEventId: 334816, stageId: '828082' },
};

const LOCATIONS = {
  naples: { name: 'Naples', locationId: 334837, attorney: 'kelly' },
  bonitaSprings: { name: 'Bonita Springs', locationId: 334835, attorney: 'jacqui' },
  fortMyers: { name: 'Fort Myers', locationId: 334836, attorney: 'jacqui' },
};

async function wait(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function cleanup() {
  console.log('\n🧹 Cleaning up ALL test data...');

  const { data: meetingBookings } = await supabase
    .from('matters-meetings-booked')
    .select('calendar_entry_id')
    .eq('matter_id', TEST_MATTER_ID);

  if (meetingBookings && meetingBookings.length > 0) {
    console.log(`   Deleting ${meetingBookings.length} calendar entries...`);
    for (const booking of meetingBookings) {
      if (booking.calendar_entry_id) {
        try {
          await ClioService.client.delete(`/api/v4/calendar_entries/${booking.calendar_entry_id}.json`);
          await wait(0.1);
        } catch (err) {
          if (err.response?.status !== 404) {
            console.error(`Error:`, err.message);
          }
        }
      }
    }
  }

  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('task_id')
    .eq('matter_id', TEST_MATTER_ID);

  if (existingTasks && existingTasks.length > 0) {
    console.log(`   Deleting ${existingTasks.length} tasks...`);
    for (const task of existingTasks) {
      if (task.task_id) {
        try {
          await ClioService.deleteTask(task.task_id);
          await wait(0.1);
        } catch (err) {
          if (err.response?.status !== 404) {
            console.error(`Error:`, err.message);
          }
        }
      }
    }
  }

  await supabase.from('matters-meetings-booked').delete().eq('matter_id', TEST_MATTER_ID);
  await supabase.from('tasks').delete().eq('matter_id', TEST_MATTER_ID);

  console.log('✅ Cleanup complete\n');
}

async function createAllMeetings() {
  console.log('\n🚀 Creating All Meeting Calendar Entries');
  console.log('='.repeat(80));

  // Initialize
  await TokenRefreshService.initialize();
  ClioService.initializeInterceptors();
  ClioService.client.defaults.headers['Authorization'] = `Bearer ${config.clio.accessToken}`;

  // Cleanup first
  await cleanup();

  const createdEntries = [];
  let count = 0;

  // Create ALL calendar entries (skipping Maintenance which has invalid ID)
  for (const [locationKey, location] of Object.entries(LOCATIONS)) {
    for (const [meetingKey, meeting] of Object.entries(MEETINGS)) {
      count++;
      console.log(`\n[${count}/12] Creating: ${location.name} - ${meeting.name}`);

      const now = new Date();
      const startAt = new Date(now.getTime() + (7 + count) * 24 * 60 * 60 * 1000); // Offset dates
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

      try {
        const calendarData = {
          summary: `${meeting.name} - Test`,
          eventTypeId: meeting.calendarEventId,
          calendarOwnerId: 7077963,
          matterId: TEST_MATTER_ID,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
        };

        const entry = await ClioService.createCalendarEntry(calendarData);
        console.log(`   ✅ Created: ${entry.id}`);

        createdEntries.push({
          location: location.name,
          meeting: meeting.name,
          entryId: entry.id,
          attorney: location.attorney,
        });

        await wait(0.5); // Small delay between creates
      } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
      }
    }
  }

  // Wait for automation to trigger
  console.log('\n⏳ Waiting 45 seconds for automation to process all entries...');
  await wait(45);

  // Print screenshot instructions
  console.log('\n' + '='.repeat(80));
  console.log('📸 READY FOR SCREENSHOTS');
  console.log('='.repeat(80));
  console.log(`\nAll calendar entries created. Tasks should be generated.`);
  console.log(`Navigate to: https://app.clio.com/nc/#/matters/${TEST_MATTER_ID}/tasks\n`);
  console.log('Screenshot paths:\n');

  for (const entry of createdEntries) {
    const locationFolder = entry.location;
    const meetingFolder = entry.meeting.split(' ')[0];
    const filename = `${TEST_MATTER_ID}-${entry.location.toLowerCase().replace(' ', '-')}-${entry.attorney}-${entry.meeting.split(' ')[0].toLowerCase()}-tasks.png`;
    const path = `.playwright-screenshots/meeting-based-tasks/${locationFolder}/${meetingFolder}/${filename}`;
    console.log(`${entry.location} - ${entry.meeting}:`);
    console.log(`   ${path}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n⚠️  Note: All tasks are currently in the matter. Take screenshots now!');
  console.log('After screenshots are complete, run cleanup with:');
  console.log('   node cleanup-test-matter.js\n');
}

createAllMeetings()
  .then(() => console.log('✅ Done!'))
  .catch(err => {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
