import { ClioService } from './src/services/clio.js';
import { SupabaseService } from './src/services/supabase.js';
import { loginToClio, closeBrowser, takeScreenshot } from './utilities/playwright/index.js';

const matterId = 1675950832;
//this is the matter id that will be used for the test

const location = ["Bonita Springs", "Fort Myers", "Naples"]
const attorneyIds = [357520756,357292201,357380836]

// Global browser session to maintain login across screenshots
let browserSession = null;

async function main(){
    try {
        // Initialize async data
        const accessToken = await getAccessToken();

        // Configure ClioService with fresh token
        ClioService.client.defaults.headers['Authorization'] = `Bearer ${accessToken}`;
        ClioService.initializeInterceptors();
        console.log('ClioService configured with fresh access token');

        const calendarEvents = await getCalendarEvents();

        console.log(`Loaded ${calendarEvents.length} calendar events for testing`);

        // Login to Clio once at the start
        console.log('Logging into Clio for screenshot automation...');
        browserSession = await loginToClio();

        for (let i = 0; i < location.length; i++){
            const currentLocation = location[i];
            const currentAttorney = attorneyIds[i];

            console.log(`Testing with location: ${currentLocation}, attorney: ${currentAttorney}`);

            await updateMatterLocation(currentLocation);
            await updateMatterAttorney(currentAttorney);

            await loopCalendarEvents(currentLocation, currentAttorney, calendarEvents);
        }

        // Close browser session when done
        if (browserSession) {
            console.log('Closing browser session...');
            await closeBrowser(browserSession);
        }
    } catch (error) {
        console.error('Main test flow failed:', error);

        // Ensure browser is closed on error
        if (browserSession) {
            await closeBrowser(browserSession);
        }

        throw error;
    }
}

async function loopCalendarEvents(currentLocation, currentAttorney, calendarEvents){
    //this will loop through the calendar events and create a calendar entry for each event
    for(const event of calendarEvents){
        try {
            console.log(`Processing event: ${event.EventId}, Stage: ${event.StageId}`);

            await sleep(5000);
            await cleanData();
            await sleep(3000);

            const calendarEntry = await createCalendarEntry(event.StartDate, event.EndDate, event.EventId, event.EventName);
            await sleep(30000);

            // Take initial screenshot with format: yyyy-mm-dd-Location-event-type-meeting.png
            // Remove spaces from location name (e.g., "Bonita Springs" -> "BonitaSprings")
            const locationNoSpaces = currentLocation.replace(/\s+/g, '');
            const eventTypeFormatted = event.EventName.replace(/\s+/g, '-').toLowerCase();
            const screenshotName = `${calendarEntry.selectedDate}-${locationNoSpaces}-${eventTypeFormatted}`;

            await playWrightScreenshot(screenshotName, currentLocation);

            // Note: Meeting-based tasks do not have dependencies
            // Dependency chain logic (getDependencyChain, completeTask) kept for future use but not executed

            console.log(`Successfully processed event: ${event.EventId}`);
        } catch (error) {
            console.error(`Error processing event ${event.EventId}:`, error);
            // Continue with next event instead of stopping entire test
            continue;
        }
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


async function getCalendarEvents(){ //retrieves calendar event in supabase
    try {
        console.log('Fetching calendar events from Supabase...');

        const mappings = await SupabaseService.getAllCalendarEventMappings();

        if (!mappings || mappings.length === 0) {
            console.warn('No calendar event mappings found in database');
            return [];
        }

        // Transform to the expected format
        const events = mappings.map(mapping => ({
            EventId: mapping.calendar_event_id,
            EventName: mapping.calendar_event_name,
            StageId: mapping.stage_id,
            StartDate: null, // Will be set when creating test calendar entries
            EndDate: null    // Will be set when creating test calendar entries
        }));

        console.log(`Found ${events.length} calendar event mappings`);
        return events;
    } catch (error) {
        console.error('Failed to fetch calendar events:', error);
        throw error;
    }
}

async function getAccessToken(){ //retrieves access token in supabase
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


async function moveMatterToStage(stageId) {
    try {
        console.log(`Moving matter ${matterId} to stage: ${stageId}`);
        const result = await ClioService.updateMatter(matterId, {
            matter_stage: {
                id: stageId
            }
        });
        console.log(`Successfully moved matter to stage: ${result.matter_stage?.id}`);
        return result;
    } catch (error) {
        console.error(`Failed to move matter to stage:`, error);
        throw error;
    }
}

async function createCalendarEntry(StartDate, EndDate, EventId, EventName){
    try {
        // Randomly select date (50/50 between Nov 12 and Nov 14, 2025)
        const dateOptions = ['2025-11-12', '2025-11-14'];
        const selectedDate = dateOptions[Math.floor(Math.random() * 2)];

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
        // Return both result and selectedDate for screenshot naming
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

        // Check if we're already on the tasks page
        if (currentUrl.includes(`matters/${matterId}/tasks`)) {
            console.log('Already on tasks page, refreshing...');
            await page.reload({
                waitUntil: 'load',
                timeout: 60000
            });
        } else {
            // Navigate to the tasks page if not already there
            console.log(`Navigating to tasks page: ${tasksUrl}`);
            await page.goto(tasksUrl, {
                waitUntil: 'load',
                timeout: 60000
            });
        }

        // Wait for tasks to load
        console.log('Waiting for tasks to load...');
        await page.waitForTimeout(5000);

        // Create organized screenshot directory structure on Desktop
        // Desktop -> SHLF meeting tests -> [Location] -> screenshot.png
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');

        const desktopPath = path.join(os.homedir(), 'Desktop');
        const mainTestFolder = path.join(desktopPath, 'SHLF meeting tests');
        const locationFolderPath = path.join(mainTestFolder, locationFolder);

        // Create directories if they don't exist
        if (!fs.existsSync(mainTestFolder)) {
            fs.mkdirSync(mainTestFolder, { recursive: true });
        }
        if (!fs.existsSync(locationFolderPath)) {
            fs.mkdirSync(locationFolderPath, { recursive: true });
        }

        // Take the screenshot with organized path
        await takeScreenshot(page, screenshotName, locationFolderPath);

        console.log(`Screenshot completed: ${screenshotName} in ${locationFolder}`);
    } catch (error) {
        console.error(`Failed to take screenshot ${screenshotName}:`, error.message);
        throw error;
    }
}

async function completeTask(taskId){
    try {
        console.log(`Completing task: ${taskId}`);

        // Update task status to "complete" using Clio API
        const result = await ClioService.updateTask(taskId, {
            status: 'complete'
        });

        console.log(`Successfully completed task: ${taskId}`);
        return result;
    } catch (error) {
        console.error(`Failed to complete task ${taskId}:`, error);
        throw error;
    }
}

async function getDependencyChain(stageID){
    try {
        console.log(`Retrieving dependency chain for stage: ${stageID}`);

        // Get task templates for this stage from task-list-meeting table
        const taskTemplates = await SupabaseService.getTaskListMeeting(stageID);

        if (!taskTemplates || taskTemplates.length === 0) {
            console.log(`No task templates found for stage ${stageID}`);
            return [];
        }

        // Find all tasks that have "after task X" in their relational due date field
        const dependentTasks = taskTemplates.filter(template => {
            const relationType = template['due_date-relational'] || template.due_date_relational || '';
            return relationType.toLowerCase().includes('after task');
        });

        if (dependentTasks.length === 0) {
            console.log(`No dependent tasks found for stage ${stageID}`);
            return [];
        }

        // Extract the parent task numbers and get the corresponding task IDs from Clio
        const dependencyChain = [];
        for (const task of dependentTasks) {
            const relationType = task['due_date-relational'] || task.due_date_relational || '';
            const parentTaskNumber = extractParentTaskNumber(relationType);

            if (parentTaskNumber) {
                // Get the actual task ID from Clio for this matter and task number
                const tasks = await ClioService.getTasksByMatter(matterId);
                const parentTask = tasks.find(t => {
                    // Match by task number in the task name or description
                    const taskName = t.name || '';
                    return taskName.includes(`Task ${parentTaskNumber}`) ||
                           taskName.includes(`#${parentTaskNumber}`);
                });

                if (parentTask) {
                    dependencyChain.push(parentTask.id);
                    console.log(`Found dependency: Task #${parentTaskNumber} (ID: ${parentTask.id})`);
                }
            }
        }

        console.log(`Dependency chain for stage ${stageID}: ${dependencyChain.length} tasks`);
        return dependencyChain;
    } catch (error) {
        console.error('Failed to get dependency chain:', error);
        return []; // Return empty array on error to allow test to continue
    }
}

/**
 * Extract parent task number from relational string
 * Examples: "after task 1" → 1, "3 days after task 5" → 5
 */
function extractParentTaskNumber(relationType) {
    if (!relationType) return null;

    const match = relationType.match(/after\s+task\s+(\d+)/i);
    if (match && match[1]) {
        return parseInt(match[1], 10);
    }

    return null;
}

async function cleanData() {
    try {
        console.log(`Starting cleanup for test matter ${matterId}...`);

        // 1. Get and delete all calendar entries for this matter from Clio
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

            // Delete each calendar entry from Clio
            for (const record of meetingRecords) {
                try {
                    await ClioService.client.delete(`/api/v4/calendar_entries/${record.calendar_entry_id}`);
                    console.log(`Deleted calendar entry: ${record.calendar_entry_id}`);
                } catch (error) {
                    console.error(`Failed to delete calendar entry ${record.calendar_entry_id}:`, error.message);
                }
            }
        }

        // 2. Delete all tasks for this matter from Clio
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

        // 3. Delete records from Supabase - tasks table
        const { error: tasksDeleteError } = await supabase
            .from('tasks')
            .delete()
            .eq('matter_id', matterId);

        if (tasksDeleteError) {
            console.error('Failed to delete tasks from Supabase:', tasksDeleteError);
        } else {
            console.log('Successfully deleted tasks from Supabase');
        }

        // 4. Delete records from Supabase - matters-meetings-booked
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

async function validateTasksCreated(stageId) {
    //Validates that tasks were created for the given stageId
    //Query Clio API to check if tasks exist for the matter
    //Return true if tasks found, false otherwise
    return true; //placeholder
}

async function validateTaskCompleted(taskId) {
    //Validates that a specific task was marked as completed
    //Query Clio API to check task status
    //Return true if completed, false otherwise
    return true; //placeholder
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test flow
main().catch(error => {
    console.error('Test flow execution failed:', error);
    process.exit(1);
});