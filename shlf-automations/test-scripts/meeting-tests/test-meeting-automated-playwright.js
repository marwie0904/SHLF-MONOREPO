/**
 * Fully Automated Meeting-Based Task Testing with Playwright
 *
 * This script implements isolated per-meeting tests with completion dependency handling.
 *
 * Flow:
 * 1. Full cleanup + browser launch + login verification
 * 2. For each location: Update matter location/attorney
 * 3. For each meeting: Create entry → screenshot → handle dependencies → cleanup
 * 4. Close browser + summary report
 *
 * Run with: node test-meeting-automated-playwright.js
 */

import { chromium } from 'playwright';
import { ClioService } from './src/services/clio.js';
import { TokenRefreshService } from './src/services/token-refresh.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';
import fs from 'fs';
import path from 'path';

const supabase = createClient(config.supabase.url, config.supabase.key);

// Test Configuration
const TEST_MATTER_ID = 1675950832;
const CLIO_EMAIL = 'gabby@safeharborlawfirm.com';
const CLIO_PASSWORD = 'Gabby@2025!SHLF';
const SCREENSHOT_BASE = '.playwright-screenshots/meeting-based-tasks';

// Meeting configurations
const MEETINGS = {
  initial: { name: 'Initial Meeting', calendarEventId: 334846, stageId: '828076' },
  vision: { name: 'Vision Meeting', calendarEventId: 334831, stageId: '828078' },
  design: { name: 'Design Meeting', calendarEventId: 334801, stageId: '828080' },
  signing: { name: 'Signing Meeting', calendarEventId: 334816, stageId: '828082' },
};

// Location configurations with attorney IDs
const LOCATIONS = {
  naples: {
    name: 'Naples',
    locationId: 334837,
    attorneyId: 357380836,
    attorney: 'kelly',
  },
  bonitaSprings: {
    name: 'Bonita Springs',
    locationId: 334835,
    attorneyId: 357292201,
    attorney: 'jacqui',
  },
  fortMyers: {
    name: 'Fort Myers',
    locationId: 334836,
    attorneyId: 357520756,
    attorney: 'jacqui',
  },
};

/**
 * Wait helper
 */
function wait(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Get screenshot path
 */
function getScreenshotPath(location, meetingType, suffix = 'tasks') {
  const locationFolder = location.name;
  const meetingFolder = meetingType.name.split(' ')[0];
  const filename = `${TEST_MATTER_ID}-${location.name.toLowerCase().replace(/ /g, '-')}-${location.attorney}-${meetingType.name.split(' ')[0].toLowerCase()}-${suffix}.png`;

  return path.join(SCREENSHOT_BASE, locationFolder, meetingFolder, filename);
}

/**
 * Clean up test matter data from Clio and Supabase
 */
async function cleanupTestMatter() {
  console.log('\n🧹 Cleaning up test matter data...');

  // Delete calendar entries from Clio
  const { data: meetingBookings } = await supabase
    .from('matters-meetings-booked')
    .select('calendar_entry_id')
    .eq('matter_id', TEST_MATTER_ID);

  if (meetingBookings && meetingBookings.length > 0) {
    console.log(`   Deleting ${meetingBookings.length} calendar entries from Clio...`);
    for (const booking of meetingBookings) {
      if (booking.calendar_entry_id) {
        try {
          await ClioService.client.delete(`/api/v4/calendar_entries/${booking.calendar_entry_id}.json`);
          await wait(0.1);
        } catch (err) {
          if (err.response?.status !== 404) {
            console.error(`   Error:`, err.message);
          }
        }
      }
    }
  }

  // Delete tasks from Clio
  const { data: existingTasks} = await supabase
    .from('tasks')
    .select('task_id')
    .eq('matter_id', TEST_MATTER_ID);

  if (existingTasks && existingTasks.length > 0) {
    console.log(`   Deleting ${existingTasks.length} tasks from Clio...`);
    for (const task of existingTasks) {
      if (task.task_id) {
        try {
          await ClioService.deleteTask(task.task_id);
          await wait(0.1);
        } catch (err) {
          if (err.response?.status !== 404) {
            console.error(`   Error:`, err.message);
          }
        }
      }
    }
  }

  // Delete from Supabase
  await supabase.from('matters-meetings-booked').delete().eq('matter_id', TEST_MATTER_ID);
  await supabase.from('tasks').delete().eq('matter_id', TEST_MATTER_ID);

  console.log('✅ Cleanup complete\n');
}

/**
 * Update matter location and attorney in Clio
 */
async function updateMatterLocationAndAttorney(location) {
  console.log(`\n📍 Updating matter to ${location.name} with ${location.attorney}...`);

  await ClioService.updateMatter(TEST_MATTER_ID, {
    location: { id: location.locationId },
    responsible_attorney: { id: location.attorneyId },
  });

  console.log(`✅ Matter updated: location=${location.name}, attorney=${location.attorney}\n`);
}

/**
 * Create calendar event
 */
async function createCalendarEvent(location, meetingType) {
  console.log(`\n📅 Creating ${meetingType.name} calendar event...`);

  const now = new Date();
  const startAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

  const calendarData = {
    summary: `${meetingType.name} - Test`,
    eventTypeId: meetingType.calendarEventId,
    calendarOwnerId: 7077963,
    matterId: TEST_MATTER_ID,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  };

  const calendarEntry = await ClioService.createCalendarEntry(calendarData);
  console.log(`✅ Calendar entry created: ${calendarEntry.id}`);

  return calendarEntry;
}

/**
 * Login to Clio (2-step process)
 */
async function loginToClio(page) {
  console.log('\n🔐 Logging into Clio...');

  await page.goto('https://app.clio.com/nc/#/login', { waitUntil: 'domcontentloaded', timeout: 10000 });
  await wait(3);

  // Check if already logged in
  const currentUrl = page.url();
  if (!currentUrl.includes('/login')) {
    console.log('✅ Already logged in');
    return;
  }

  console.log('🔑 Not logged in, attempting login...');

  try {
    // Step 1: Enter email and click "Next: Password"
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.fill('input[type="email"]', CLIO_EMAIL);
    console.log('   📧 Email entered, clicking "Next: Password"...');
    await page.click('button#next');
    await wait(3);

    // Step 2: Enter password and click "Sign In"
    await page.waitForSelector('input[type="password"]', { timeout: 5000 });
    await page.fill('input[type="password"]', CLIO_PASSWORD);
    console.log('   🔑 Password entered, clicking "Sign In"...');
    await page.click('button#signin');
    await wait(5);

    console.log('✅ Logged in successfully');
  } catch (error) {
    console.error('❌ Login failed:', error.message);
    console.log('⚠️  Manual login required. Please log in and press Enter...');
    await wait(30);
  }
}

/**
 * Take screenshot of tasks page
 */
async function takeScreenshot(context, screenshotPath) {
  const page = await context.newPage();

  try {
    // Navigate to tasks page
    await page.goto(`https://app.clio.com/nc/#/matters/${TEST_MATTER_ID}/tasks`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await wait(3);

    // Refresh to ensure latest data
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(3);

    // Create directory if needed
    const dir = path.dirname(screenshotPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Take full-page screenshot
    await page.screenshot({
      path: screenshotPath,
      fullPage: true
    });

    console.log(`✅ Screenshot saved: ${screenshotPath}`);
  } finally {
    await page.close();
  }
}

/**
 * Parse completion dependency from due_date_relation
 */
function parseCompletionDependency(relation) {
  if (!relation) return null;

  const match = relation.match(/after\s+task\s+(\d+)/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }

  return null;
}

/**
 * Get tasks with completion dependencies
 */
async function getDependentTasks(stageId) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('task_id, task_number, task_name, due_date_relation')
    .eq('matter_id', TEST_MATTER_ID)
    .eq('stage_id', stageId);

  if (!tasks || tasks.length === 0) {
    return [];
  }

  // Find tasks that depend on completion of other tasks
  const dependentTasks = [];
  const parentTaskNumbers = new Set();

  for (const task of tasks) {
    const dependsOn = parseCompletionDependency(task.due_date_relation);
    if (dependsOn) {
      dependentTasks.push({
        taskId: task.task_id,
        taskNumber: task.task_number,
        taskName: task.task_name,
        dependsOn: dependsOn,
      });
      parentTaskNumbers.add(dependsOn);
    }
  }

  if (dependentTasks.length === 0) {
    return [];
  }

  // Get the parent tasks (tasks that need to be completed)
  const parentTasks = tasks
    .filter(t => parentTaskNumbers.has(t.task_number))
    .sort((a, b) => a.task_number - b.task_number);

  return parentTasks.map(t => ({
    taskId: t.task_id,
    taskNumber: t.task_number,
    taskName: t.task_name,
  }));
}

/**
 * Handle completion-dependent tasks
 */
async function handleCompletionDependencies(context, location, meetingType) {
  console.log('\n🔗 Checking for completion-dependent tasks...');

  const parentTasks = await getDependentTasks(meetingType.stageId);

  if (parentTasks.length === 0) {
    console.log('   ℹ️  No completion dependencies found');
    return [];
  }

  console.log(`   Found ${parentTasks.length} parent tasks that trigger dependencies`);
  const screenshots = [];

  for (const parentTask of parentTasks) {
    console.log(`\n   ✅ Completing Task ${parentTask.taskNumber}: ${parentTask.taskName}...`);

    // Complete the parent task
    await ClioService.updateTask(parentTask.taskId, {
      status: 'complete'
    });

    console.log(`   ⏳ Waiting 20 seconds for automation to process dependencies...`);
    await wait(20);

    // Take screenshot showing updated tasks
    const screenshotPath = getScreenshotPath(
      location,
      meetingType,
      `completed-task-${parentTask.taskNumber}`
    );

    await takeScreenshot(context, screenshotPath);

    screenshots.push({
      completedTask: parentTask.taskNumber,
      screenshot: screenshotPath,
    });
  }

  return screenshots;
}

/**
 * Test one meeting type
 */
async function testMeeting(context, location, meetingType) {
  console.log('\n' + '='.repeat(80));
  console.log(`🧪 Testing: ${location.name} - ${meetingType.name}`);
  console.log('='.repeat(80));

  // 1. Clean up before creating new calendar event
  await cleanupTestMatter();

  // 2. Create calendar event
  const calendarEntry = await createCalendarEvent(location, meetingType);

  // 3. Wait for automation
  console.log('\n⏳ Waiting 30 seconds for automation to generate tasks...');
  await wait(30);

  // 4. Take initial screenshot
  const screenshotPath = getScreenshotPath(location, meetingType);
  console.log('\n📸 Taking initial screenshot...');
  await takeScreenshot(context, screenshotPath);

  // 5. Handle completion dependencies
  const dependencyScreenshots = await handleCompletionDependencies(context, location, meetingType);

  return {
    location: location.name,
    meeting: meetingType.name,
    screenshot: screenshotPath,
    dependencies: dependencyScreenshots,
  };
}

/**
 * Main test runner
 */
async function runTest() {
  console.log('\n🚀 Automated Meeting-Based Task Testing (Playwright)');
  console.log('='.repeat(80));
  console.log('Running 12 tests: 3 locations × 4 meeting types');
  console.log('Each test is isolated with cleanup between tests');
  console.log('='.repeat(80));

  let context;

  try {
    // Initialize services
    console.log('\n🔧 Initializing services...');
    await TokenRefreshService.initialize();
    ClioService.initializeInterceptors();
    ClioService.client.defaults.headers['Authorization'] = `Bearer ${config.clio.accessToken}`;

    // Full cleanup before starting
    await cleanupTestMatter();

    // Launch browser
    console.log('🌐 Launching browser with persistent session...');
    context = await chromium.launchPersistentContext('./playwright-user-data', {
      headless: false,
      viewport: { width: 1920, height: 1080 },
    });

    // Verify login once
    console.log('\n🔐 Verifying login...');
    const loginPage = await context.newPage();
    await loginToClio(loginPage);
    await loginPage.close();

    const allResults = [];
    let testNumber = 0;

    // Run all combinations: For each location → For each meeting
    for (const [locationKey, location] of Object.entries(LOCATIONS)) {
      // Update matter location and attorney for this location
      await updateMatterLocationAndAttorney(location);

      for (const [meetingKey, meetingType] of Object.entries(MEETINGS)) {
        testNumber++;
        console.log(`\n\n${'='.repeat(80)}`);
        console.log(`Test ${testNumber}/12: ${location.name} - ${meetingType.name}`);
        console.log('='.repeat(80));

        try {
          const result = await testMeeting(context, location, meetingType);
          allResults.push(result);
          console.log(`\n✅ Test ${testNumber}/12 complete`);
        } catch (error) {
          console.error(`\n❌ Test ${testNumber}/12 failed:`, error.message);
          console.error(error.stack);
          allResults.push({
            location: location.name,
            meeting: meetingType.name,
            error: error.message,
          });
        }
      }
    }

    // Summary
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total tests: ${allResults.length}`);
    console.log(`Successful: ${allResults.filter(r => !r.error).length}`);
    console.log(`Failed: ${allResults.filter(r => r.error).length}`);
    console.log('\n' + '='.repeat(80));
    console.log('Screenshots by Location:');
    console.log('='.repeat(80));

    // Group by location
    for (const [locationKey, location] of Object.entries(LOCATIONS)) {
      console.log(`\n📍 ${location.name}:`);
      const locationResults = allResults.filter(r => r.location === location.name);
      locationResults.forEach(r => {
        if (r.error) {
          console.log(`   ❌ ${r.meeting}: ${r.error}`);
        } else {
          console.log(`   ✅ ${r.meeting}`);
          console.log(`      ${r.screenshot}`);
          if (r.dependencies && r.dependencies.length > 0) {
            r.dependencies.forEach(dep => {
              console.log(`      ${dep.screenshot} (after completing task ${dep.completedTask})`);
            });
          }
        }
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ All tests complete!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (context) {
      await context.close();
    }
  }
}

// Run the test
runTest()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
