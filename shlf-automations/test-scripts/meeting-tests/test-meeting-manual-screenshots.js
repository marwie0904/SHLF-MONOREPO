/**
 * Manual Screenshot Test for Meeting-Based Tasks
 *
 * This script creates ONE calendar entry at a time and waits for manual screenshot
 * Run with: node test-meeting-manual-screenshots.js <location> <meeting>
 *
 * Examples:
 *   node test-meeting-manual-screenshots.js naples initial
 *   node test-meeting-manual-screenshots.js bonita-springs vision
 *   node test-meeting-manual-screenshots.js fort-myers signing
 */

import { ClioService } from './src/services/clio.js';
import { TokenRefreshService } from './src/services/token-refresh.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';
import fs from 'fs';
import path from 'path';

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
  'bonita-springs': { name: 'Bonita Springs', locationId: 334835, attorney: 'jacqui' },
  'fort-myers': { name: 'Fort Myers', locationId: 334836, attorney: 'jacqui' },
};

async function wait(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function cleanup() {
  console.log('\n🧹 Cleaning up...');

  const { data: meetingBookings } = await supabase
    .from('matters-meetings-booked')
    .select('calendar_entry_id')
    .eq('matter_id', TEST_MATTER_ID);

  if (meetingBookings && meetingBookings.length > 0) {
    for (const booking of meetingBookings) {
      if (booking.calendar_entry_id) {
        try {
          await ClioService.client.delete(`/api/v4/calendar_entries/${booking.calendar_entry_id}.json`);
          await wait(0.1);
        } catch (err) {
          if (err.response?.status !== 404) {
            console.error(`Error deleting calendar entry:`, err.message);
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
    for (const task of existingTasks) {
      if (task.task_id) {
        try {
          await ClioService.deleteTask(task.task_id);
          await wait(0.1);
        } catch (err) {
          if (err.response?.status !== 404) {
            console.error(`Error deleting task:`, err.message);
          }
        }
      }
    }
  }

  await supabase.from('matters-meetings-booked').delete().eq('matter_id', TEST_MATTER_ID);
  await supabase.from('tasks').delete().eq('matter_id', TEST_MATTER_ID);

  console.log('✅ Cleanup complete');
}

async function createTest(locationKey, meetingKey) {
  const location = LOCATIONS[locationKey];
  const meeting = MEETINGS[meetingKey];

  if (!location) {
    console.error(`Invalid location: ${locationKey}`);
    console.log('Valid locations:', Object.keys(LOCATIONS).join(', '));
    process.exit(1);
  }

  if (!meeting) {
    console.error(`Invalid meeting: ${meetingKey}`);
    console.log('Valid meetings:', Object.keys(MEETINGS).join(', '));
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`Testing: ${location.name} - ${meeting.name}`);
  console.log('='.repeat(80));

  // Initialize
  await TokenRefreshService.initialize();
  ClioService.initializeInterceptors();
  ClioService.client.defaults.headers['Authorization'] = `Bearer ${config.clio.accessToken}`;

  // Cleanup first
  await cleanup();

  // Create calendar entry
  console.log(`\n📅 Creating ${meeting.name} calendar event for ${location.name}...`);
  const now = new Date();
  const startAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

  const calendarData = {
    summary: `${meeting.name} - Test`,
    eventTypeId: meeting.calendarEventId,
    calendarOwnerId: 7077963,
    matterId: TEST_MATTER_ID,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  };

  const calendarEntry = await ClioService.createCalendarEntry(calendarData);
  console.log(`✅ Calendar entry created: ${calendarEntry.id}`);

  // Wait for automation
  console.log('\n⏳ Waiting 30 seconds for automation to trigger...');
  await wait(30);

  // Generate paths
  const locationFolder = location.name;
  const meetingFolder = meeting.name.split(' ')[0];
  const filename = `${TEST_MATTER_ID}-${location.name.toLowerCase().replace(' ', '-')}-${location.attorney}-${meeting.name.split(' ')[0].toLowerCase()}-tasks.png`;
  const screenshotPath = `.playwright-screenshots/meeting-based-tasks/${locationFolder}/${meetingFolder}/${filename}`;

  // Create directory
  const dir = path.dirname(screenshotPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log('\n' + '='.repeat(80));
  console.log('📸 READY FOR SCREENSHOT');
  console.log('='.repeat(80));
  console.log(`\n1. Navigate to: https://app.clio.com/nc/#/matters/${TEST_MATTER_ID}/tasks`);
  console.log(`2. Wait for page to load`);
  console.log(`3. Take screenshot with filename: ${screenshotPath}`);
  console.log(`\n4. Press Enter when screenshot is complete...`);
  console.log('='.repeat(80));
}

// Get command line args
const locationKey = process.argv[2];
const meetingKey = process.argv[3];

if (!locationKey || !meetingKey) {
  console.error('\nUsage: node test-meeting-manual-screenshots.js <location> <meeting>');
  console.log('\nLocations:', Object.keys(LOCATIONS).join(', '));
  console.log('Meetings:', Object.keys(MEETINGS).join(', '));
  console.log('\nExample: node test-meeting-manual-screenshots.js naples initial');
  process.exit(1);
}

createTest(locationKey, meetingKey);
