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

        const stages = await getStages();

        console.log(`Loaded ${stages.length} stages for testing`);

        // Login to Clio once at the start
        console.log('Logging into Clio for screenshot automation...');
        browserSession = await loginToClio();

        for (let i = 0; i < location.length; i++){
            const currentLocation = location[i];
            const currentAttorney = attorneyIds[i];

            console.log(`Testing with location: ${currentLocation}, attorney: ${currentAttorney}`);

            await updateMatterLocation(currentLocation);
            await updateMatterAttorney(currentAttorney);

            await loopStages(currentLocation, currentAttorney, stages);
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

async function loopStages(currentLocation, currentAttorney, stages){
    //this will loop through the stages and update the matter stage for each
    for(const stage of stages){
        try {
            console.log(`Processing Stage: ${stage.StageId} (${stage.StageName})`);

            await sleep(5000);
            await cleanData();
            await sleep(3000);

            // Update matter stage instead of creating calendar entry
            await updateMatterStage(stage.StageId);
            await sleep(30000);

            // Take initial screenshot
            const screenshotName = `${currentAttorney}-${stage.StageName.replace(/\s+/g, '-')}-initial`;
            await playWrightScreenshot(screenshotName, currentLocation, stage.StageName);

            // Validate tasks were created
            const tasksCreated = await validateTasksCreated(stage.StageId);
            if (!tasksCreated) {
                console.error(`Validation failed: Tasks not created for stage ${stage.StageId}`);
                continue;
            }

            const dependencyArray = await getDependencyChain(stage.StageId);

            // Check if this is a sequential stage
            const sequentialStages = [986242, 833223, 848343, 1053877, 1038727, 828783];
            const isSequential = sequentialStages.includes(stage.StageId);

            if (dependencyArray && dependencyArray.length > 0){
                console.log(`\n📋 Found ${dependencyArray.length} dependencies to complete\n`);

                if (isSequential) {
                    // Sequential processing: retrieve and complete tasks one at a time
                    for (let i = 0; i < dependencyArray.length; i++){
                        const taskNumber = dependencyArray[i]; // This is a number, not an object
                        console.log(`\nProcessing ${i + 1}/${dependencyArray.length}: Task #${taskNumber}`);

                        // Retrieve the task from Supabase (it should exist now)
                        const taskData = await retrieveTaskByNumber(stage.StageId, taskNumber);

                        if (!taskData) {
                            console.log(`  ⚠️  Skipping Task #${taskNumber} - not found in database`);
                            continue;
                        }

                        console.log(`  Task ID: ${taskData.taskId}`);

                        // Complete task
                        await completeTask(taskData.taskId);

                        // Wait 40 seconds
                        await sleep(40000);

                        // Take screenshot
                        const depScreenshotName = `${currentAttorney}-completed-task-${taskNumber}`;
                        await playWrightScreenshot(depScreenshotName, currentLocation, stage.StageName);
                    }
                } else {
                    // Non-sequential processing: all tasks retrieved upfront (original behavior)
                    for (let i = 0; i < dependencyArray.length; i++){
                        const dependency = dependencyArray[i];
                        console.log(`\nProcessing ${i + 1}/${dependencyArray.length}: Task #${dependency.taskNumber} (ID: ${dependency.taskId})`);

                        // Complete task
                        await completeTask(dependency.taskId);

                        // Wait 40 seconds
                        await sleep(40000);

                        // Take screenshot
                        const depScreenshotName = `${currentAttorney}-completed-task-${dependency.taskNumber}`;
                        await playWrightScreenshot(depScreenshotName, currentLocation, stage.StageName);
                    }
                }
            }

            console.log(`Successfully processed stage: ${stage.StageId}`);
        } catch (error) {
            console.error(`Error processing stage ${stage.StageId}:`, error);
            // Continue with next stage instead of stopping entire test
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
} // tested

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
}  // tested

async function getStages(){ //retrieves stages from supabase
    try {
        console.log('Fetching stages from Supabase...');

        const { createClient } = await import('@supabase/supabase-js');
        const { config } = await import('./src/config/index.js');
        const supabase = createClient(config.supabase.url, config.supabase.key);

        // Get unique stages from task-list-non-meeting table
        const { data, error } = await supabase
            .from('task-list-non-meeting')
            .select('stage_id, stage_name')
            .order('stage_id');

        if (error) {
            console.error('Failed to fetch stages from Supabase:', error);
            throw error;
        }

        if (!data || data.length === 0) {
            console.warn('No stages found in database');
            return [];
        }

        // Get unique stages (remove duplicates)
        const uniqueStages = [];
        const seenStageIds = new Set();

        for (const row of data) {
            if (!seenStageIds.has(row.stage_id)) {
                seenStageIds.add(row.stage_id);
                uniqueStages.push({
                    StageId: row.stage_id,
                    StageName: row.stage_name
                });
            }
        }

        console.log(`Found ${uniqueStages.length} unique stages`);
        return uniqueStages;
    } catch (error) {
        console.error('Failed to fetch stages:', error);
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
}  // tested


async function playWrightScreenshot(screenshotName, locationFolder, stageFolder){
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
        // Desktop -> SHLF non-meeting Tests -> [Location] -> [Stage Name] -> screenshot.png
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');

        const desktopPath = path.join(os.homedir(), 'Desktop');
        const mainTestFolder = path.join(desktopPath, 'SHLF non-meeting Tests');
        const locationFolderPath = path.join(mainTestFolder, locationFolder);
        const stageFolderPath = path.join(locationFolderPath, stageFolder);

        // Create directories if they don't exist
        if (!fs.existsSync(mainTestFolder)) {
            fs.mkdirSync(mainTestFolder, { recursive: true });
        }
        if (!fs.existsSync(locationFolderPath)) {
            fs.mkdirSync(locationFolderPath, { recursive: true });
        }
        if (!fs.existsSync(stageFolderPath)) {
            fs.mkdirSync(stageFolderPath, { recursive: true });
        }

        // Take the screenshot with organized path
        await takeScreenshot(page, screenshotName, stageFolderPath);

        console.log(`Screenshot completed: ${screenshotName} in ${locationFolder}/${stageFolder}`);
    } catch (error) {
        console.error(`Failed to take screenshot ${screenshotName}:`, error.message);
        throw error;
    }
} // tested

async function updateMatterStage(stageID){
    try {
        console.log(`Updating matter ${matterId} stage to: ${stageID}`);
        const result = await ClioService.updateMatter(matterId, {
            matter_stage: {
                id: stageID
            }
        });
        console.log(`Successfully updated matter stage to: ${result.matter_stage?.id} (${result.matter_stage?.name})`);
        return result;
    } catch (error) {
        console.error(`Failed to update matter stage:`, error);
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

        // Stages with sequential task creation (tasks created only after previous task completes)
        const sequentialStages = [986242, 833223, 848343, 1053877, 1038727, 828783];
        const isSequential = sequentialStages.includes(stageID);

        // Step 1: Query Supabase task-list-non-meeting for current stage ID
        const taskTemplates = await SupabaseService.getTaskListNonMeeting(stageID);

        if (!taskTemplates || taskTemplates.length === 0) {
            console.log(`No task templates found for stage ${stageID}`);
            return [];
        }

        // Step 2: Query column due_date-relational if it contains "after task"
        const dependentTemplates = taskTemplates.filter(template => {
            const relationType = template['due_date-relational'] || template.due_date_relational || '';
            return relationType.toLowerCase().includes('after task');
        });

        if (dependentTemplates.length === 0) {
            console.log('No dependent tasks found in templates');
            return [];
        }

        console.log(`Found ${dependentTemplates.length} tasks with dependencies`);

        // Step 3: Extract task numbers from these
        const taskNumbers = [];
        const seenTaskNumbers = new Set();

        for (const template of dependentTemplates) {
            const relationType = template['due_date-relational'] || template.due_date_relational || '';
            const parentTaskNumber = extractParentTaskNumber(relationType);

            if (parentTaskNumber && !seenTaskNumbers.has(parentTaskNumber)) {
                taskNumbers.push(parentTaskNumber);
                seenTaskNumbers.add(parentTaskNumber);
            }
        }

        // Step 4: Sort task numbers low to high
        taskNumbers.sort((a, b) => a - b);

        console.log(`Extracted task numbers: [${taskNumbers.join(', ')}]`);

        // For sequential stages, return just the sorted task numbers
        // The main loop will retrieve and complete them one at a time
        if (isSequential) {
            console.log(`\n⚠️  Sequential stage detected - tasks will be retrieved one at a time`);
            console.log(`Total task numbers to process: ${taskNumbers.length}`);
            return taskNumbers; // Return array of numbers, not objects
        }

        // For non-sequential stages, retrieve all tasks upfront (original behavior)
        const { createClient } = await import('@supabase/supabase-js');
        const { config } = await import('./src/config/index.js');
        const supabase = createClient(config.supabase.url, config.supabase.key);

        const dependencyChain = [];

        for (const taskNumber of taskNumbers) {
            const { data: taskData, error } = await supabase
                .from('tasks')
                .select('task_id, task_number, task_name')
                .eq('matter_id', matterId)
                .eq('stage_id', stageID)
                .eq('task_number', taskNumber)
                .single();

            if (error) {
                console.log(`Warning: Could not find Task #${taskNumber}: ${error.message}`);
                continue;
            }

            if (taskData) {
                dependencyChain.push({
                    taskId: taskData.task_id,
                    taskNumber: taskData.task_number,
                    taskName: taskData.task_name
                });
                console.log(`Found Task #${taskData.task_number} (ID: ${taskData.task_id})`);
            }
        }

        console.log(`Dependency chain for stage ${stageID}: ${dependencyChain.length} tasks to complete`);
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

async function retrieveTaskByNumber(stageID, taskNumber) {
    console.log(`  Retrieving Task #${taskNumber} from Supabase...`);

    const { createClient } = await import('@supabase/supabase-js');
    const { config } = await import('./src/config/index.js');
    const supabase = createClient(config.supabase.url, config.supabase.key);

    const { data: taskData, error } = await supabase
        .from('tasks')
        .select('task_id, task_number, task_name')
        .eq('matter_id', matterId)
        .eq('stage_id', stageID)
        .eq('task_number', taskNumber)
        .single();

    if (error) {
        console.log(`  ⚠️  Could not find Task #${taskNumber}: ${error.message}`);
        return null;
    }

    if (taskData) {
        console.log(`  ✓ Found Task #${taskData.task_number} (ID: ${taskData.task_id})`);
        return {
            taskId: taskData.task_id,
            taskNumber: taskData.task_number,
            taskName: taskData.task_name
        };
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
} // tested

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