import { ClioService } from './src/services/clio.js';
import { SupabaseService } from './src/services/supabase.js';
import { loginToClio, closeBrowser, takeScreenshot } from './utilities/playwright/index.js';

const matterId = 1675950832;

// Test with just one location and one event
const location = "Bonita Springs";
const attorneyId = 357520756;

let browserSession = null;

async function quickTest(){
    try {
        // Initialize async data
        const accessToken = await getAccessToken();

        // Configure ClioService with fresh token
        ClioService.client.defaults.headers['Authorization'] = `Bearer ${accessToken}`;
        ClioService.initializeInterceptors();
        console.log('ClioService configured with fresh access token');

        // Get just the first calendar event for quick test
        const calendarEvents = await getCalendarEvents();
        const testEvent = calendarEvents[0]; // Just test with first event

        console.log(`Testing with: ${testEvent.EventName} at ${location}`);

        // Login to Clio once
        console.log('Logging into Clio for screenshot automation...');
        browserSession = await loginToClio();

        // Update matter
        await updateMatterLocation(location);
        await updateMatterAttorney(attorneyId);

        // Clean and create test
        console.log('Cleaning data...');
        await cleanData();
        await sleep(3000);

        console.log('Creating calendar entry...');
        const calendarEntry = await createCalendarEntry(testEvent.EventId, testEvent.EventName);
        await sleep(30000); // Wait for automation to run

        // Take screenshot
        const locationNoSpaces = location.replace(/\s+/g, '');
        const eventTypeFormatted = testEvent.EventName.replace(/\s+/g, '-').toLowerCase();
        const screenshotName = `${calendarEntry.selectedDate}-${locationNoSpaces}-${eventTypeFormatted}`;

        console.log(`Taking screenshot: ${screenshotName}`);
        await playWrightScreenshot(screenshotName, location);

        // Close browser
        if (browserSession) {
            console.log('Closing browser session...');
            await closeBrowser(browserSession);
        }

        console.log('✅ Quick test completed successfully!');
    } catch (error) {
        console.error('Quick test failed:', error);

        if (browserSession) {
            await closeBrowser(browserSession);
        }

        throw error;
    }
}

async function updateMatterLocation(location){
    try {
        console.log(`Updating matter ${matterId} location to: ${location}`);
        const result = await ClioService.updateMatter(matterId, {
            location: location
        });
        console.log(`Successfully updated location to: ${result.location}`);
        return result;
    } catch (error) {
        console.error(`Failed to update matter location:`, error);
        throw error;
    }
}

async function updateMatterAttorney(attorneyID) {
    try {
        console.log(`Updating matter ${matterId} responsible attorney to: ${attorneyID}`);
        const result = await ClioService.updateMatter(matterId, {
            responsible_attorney: {
                id: attorneyID
            }
        });
        console.log(`Successfully updated responsible attorney to: ${result.responsible_attorney?.id}`);
        return result;
    } catch (error) {
        console.error(`Failed to update matter attorney:`, error);
        throw error;
    }
}

async function getCalendarEvents(){
    try {
        console.log('Fetching calendar events from Supabase...');

        const mappings = await SupabaseService.getAllCalendarEventMappings();

        if (!mappings || mappings.length === 0) {
            console.warn('No calendar event mappings found in database');
            return [];
        }

        const events = mappings.map(mapping => ({
            EventId: mapping.calendar_event_id,
            EventName: mapping.calendar_event_name,
            StageId: mapping.stage_id
        }));

        console.log(`Found ${events.length} calendar event mappings`);
        return events;
    } catch (error) {
        console.error('Failed to fetch calendar events:', error);
        throw error;
    }
}

async function getAccessToken(){
    try {
        console.log('Fetching access token from Supabase...');

        const { createClient } = await import('@supabase/supabase-js');
        const { config } = await import('./src/config/index.js');

        const supabase = createClient(config.supabase.url, config.supabase.key);

        const { data, error } = await supabase
            .from('clio_tokens')
            .select('access_token')
            .eq('id', 1)
            .single();

        if (error) {
            console.error('Failed to fetch access token from Supabase:', error);
            throw error;
        }

        if (!data || !data.access_token) {
            throw new Error('No access token found in database');
        }

        console.log('Successfully retrieved access token');
        return data.access_token;
    } catch (error) {
        console.error('Failed to get access token:', error);
        throw error;
    }
}

async function createCalendarEntry(EventId, EventName){
    try {
        // Force November 14 for this test
        const selectedDate = '2025-11-14';

        // Set times to 10 AM - 11 AM
        const startAt = `${selectedDate}T10:00:00-05:00`; // Eastern Time
        const endAt = `${selectedDate}T11:00:00-05:00`;

        const summary = `Test Meeting - ${EventName}`;

        console.log(`Creating calendar entry: ${summary} on ${selectedDate}`);

        const result = await ClioService.createCalendarEntry({
            summary: summary,
            eventTypeId: EventId,
            calendarOwnerId: 7077963,
            matterId: matterId,
            startAt: startAt,
            endAt: endAt
        });

        console.log(`Successfully created calendar entry: ${result.id}`);
        return { ...result, selectedDate };
    } catch (error) {
        console.error('Failed to create calendar entry:', error);
        throw error;
    }
}

async function playWrightScreenshot(screenshotName, locationFolder){
    try {
        if (!browserSession || !browserSession.page) {
            throw new Error('Browser session not initialized. Make sure to call loginToClio() first.');
        }

        const { page } = browserSession;
        const currentUrl = page.url();
        const tasksUrl = `https://app.clio.com/nc/#/matters/${matterId}/tasks`;

        if (currentUrl.includes(`matters/${matterId}/tasks`)) {
            console.log('Already on tasks page, refreshing...');
            await page.reload({
                waitUntil: 'load',
                timeout: 60000
            });
        } else {
            console.log(`Navigating to tasks page: ${tasksUrl}`);
            await page.goto(tasksUrl, {
                waitUntil: 'load',
                timeout: 60000
            });
        }

        console.log('Waiting for tasks to load...');
        await page.waitForTimeout(5000);

        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');

        const desktopPath = path.join(os.homedir(), 'Desktop');
        const mainTestFolder = path.join(desktopPath, 'SHLF meeting tests');
        const locationFolderPath = path.join(mainTestFolder, locationFolder);

        if (!fs.existsSync(mainTestFolder)) {
            fs.mkdirSync(mainTestFolder, { recursive: true });
        }
        if (!fs.existsSync(locationFolderPath)) {
            fs.mkdirSync(locationFolderPath, { recursive: true });
        }

        await takeScreenshot(page, screenshotName, locationFolderPath);

        console.log(`Screenshot completed: ${screenshotName} in ${locationFolder}`);
    } catch (error) {
        console.error(`Failed to take screenshot ${screenshotName}:`, error.message);
        throw error;
    }
}

async function cleanData() {
    try {
        console.log(`Starting cleanup for test matter ${matterId}...`);

        const { createClient } = await import('@supabase/supabase-js');
        const { config } = await import('./src/config/index.js');
        const supabase = createClient(config.supabase.url, config.supabase.key);

        // Fetch calendar entry IDs from matters-meetings-booked
        const { data: meetingRecords, error: meetingError } = await supabase
            .from('matters-meetings-booked')
            .select('calendar_entry_id')
            .eq('matter_id', matterId);

        if (meetingError) {
            console.error('Failed to fetch meeting records:', meetingError);
        } else if (meetingRecords && meetingRecords.length > 0) {
            console.log(`Found ${meetingRecords.length} calendar entries to delete from Clio`);

            for (const record of meetingRecords) {
                try {
                    await ClioService.client.delete(`/api/v4/calendar_entries/${record.calendar_entry_id}`);
                    console.log(`Deleted calendar entry: ${record.calendar_entry_id}`);
                } catch (error) {
                    console.error(`Failed to delete calendar entry ${record.calendar_entry_id}:`, error.message);
                }
            }
        }

        // Delete all tasks for this matter from Clio
        try {
            const tasks = await ClioService.getTasksByMatter(matterId);
            if (tasks && tasks.length > 0) {
                console.log(`Found ${tasks.length} tasks to delete from Clio`);

                for (const task of tasks) {
                    try {
                        await ClioService.deleteTask(task.id);
                        console.log(`Deleted task: ${task.id}`);
                    } catch (error) {
                        console.error(`Failed to delete task ${task.id}:`, error.message);
                    }
                }
            } else {
                console.log('No tasks found in Clio');
            }
        } catch (error) {
            console.error('Failed to fetch/delete tasks from Clio:', error.message);
        }

        // Delete records from Supabase - tasks table
        const { error: tasksDeleteError } = await supabase
            .from('tasks')
            .delete()
            .eq('matter_id', matterId);

        if (tasksDeleteError) {
            console.error('Failed to delete tasks from Supabase:', tasksDeleteError);
        } else {
            console.log('Successfully deleted tasks from Supabase');
        }

        // Delete records from Supabase - matters-meetings-booked
        const { error: meetingsDeleteError } = await supabase
            .from('matters-meetings-booked')
            .delete()
            .eq('matter_id', matterId);

        if (meetingsDeleteError) {
            console.error('Failed to delete meeting bookings from Supabase:', meetingsDeleteError);
        } else {
            console.log('Successfully deleted meeting bookings from Supabase');
        }

        console.log(`Cleanup completed for matter ${matterId}`);
    } catch (error) {
        console.error('Data cleanup failed:', error);
        throw error;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the quick test
quickTest().catch(error => {
    console.error('Quick test execution failed:', error);
    process.exit(1);
});
