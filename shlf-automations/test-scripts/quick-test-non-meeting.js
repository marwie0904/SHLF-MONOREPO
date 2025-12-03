import { ClioService } from '../src/services/clio.js';
import { SupabaseService } from '../src/services/supabase.js';
import { loginToClio, closeBrowser, takeScreenshot } from '../utilities/playwright/index.js';

const matterId = 1675950832;
const testStages = [
    { StageId: 986242, StageName: 'Cancelled-No Show Design' },
    { StageId: 828768, StageName: 'Drafting' }
];
const testLocation = "Bonita Springs";
const testAttorney = 357520756;

let browserSession = null;

async function main() {
    try {
        console.log('=== Quick Test: Non-Meeting Task Automation ===\n');

        // Initialize
        const accessToken = await getAccessToken();
        ClioService.client.defaults.headers['Authorization'] = `Bearer ${accessToken}`;
        ClioService.initializeInterceptors();
        console.log('✓ ClioService configured\n');

        // Login to Clio
        console.log('Logging into Clio...');
        browserSession = await loginToClio();
        console.log('✓ Browser session ready\n');

        // Set matter location and attorney
        await updateMatterLocation(testLocation);
        await updateMatterAttorney(testAttorney);
        console.log('');

        // Test each stage
        for (const stage of testStages) {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`Testing Stage: ${stage.StageId} (${stage.StageName})`);
            console.log('='.repeat(60));

            await sleep(5000);
            await cleanData();
            await sleep(3000);

            // Update matter stage
            await updateMatterStage(stage.StageId);
            await sleep(30000);

            // Take initial screenshot
            const screenshotName = `${testAttorney}-${stage.StageName.replace(/\s+/g, '-')}-initial`;
            await playWrightScreenshot(screenshotName, testLocation, stage.StageName);

            // Get dependency chain (returns task numbers for sequential stages, task objects for others)
            const dependencyArray = await getDependencyChain(stage.StageId);

            // Check if this is a sequential stage
            const sequentialStages = [986242, 833223, 848343, 1053877, 1038727, 828783];
            const isSequential = sequentialStages.includes(stage.StageId);

            if (dependencyArray && dependencyArray.length > 0) {
                console.log(`\n📋 Found ${dependencyArray.length} dependencies to complete\n`);

                if (isSequential) {
                    // Sequential processing: retrieve and complete tasks one at a time
                    for (let i = 0; i < dependencyArray.length; i++) {
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
                        const depScreenshotName = `${testAttorney}-completed-task-${taskNumber}`;
                        await playWrightScreenshot(depScreenshotName, testLocation, stage.StageName);
                    }
                } else {
                    // Non-sequential processing: all tasks retrieved upfront (original behavior)
                    for (let i = 0; i < dependencyArray.length; i++) {
                        const dependency = dependencyArray[i];
                        console.log(`\nProcessing ${i + 1}/${dependencyArray.length}: Task #${dependency.taskNumber} (ID: ${dependency.taskId})`);

                        // Complete task
                        await completeTask(dependency.taskId);

                        // Wait 40 seconds
                        await sleep(40000);

                        // Take screenshot
                        const depScreenshotName = `${testAttorney}-completed-task-${dependency.taskNumber}`;
                        await playWrightScreenshot(depScreenshotName, testLocation, stage.StageName);
                    }
                }
            } else {
                console.log('\n✓ No dependencies to complete for this stage\n');
            }

            console.log(`✓ Successfully processed stage: ${stage.StageId}\n`);
        }

        // Close browser
        if (browserSession) {
            console.log('\nClosing browser session...');
            await closeBrowser(browserSession);
        }

        console.log('\n' + '='.repeat(60));
        console.log('✅ TEST COMPLETED SUCCESSFULLY');
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        if (browserSession) {
            await closeBrowser(browserSession);
        }
        throw error;
    }
}

async function getAccessToken() {
    const { createClient } = await import('@supabase/supabase-js');
    const { config } = await import('../src/config/index.js');
    const supabase = createClient(config.supabase.url, config.supabase.key);

    const { data, error } = await supabase
        .from('clio_tokens')
        .select('access_token')
        .eq('id', 1)
        .single();

    if (error || !data?.access_token) {
        throw new Error('Failed to get access token');
    }

    return data.access_token;
}

async function updateMatterLocation(location) {
    console.log(`Updating matter ${matterId} location to: ${location}`);
    const result = await ClioService.updateMatter(matterId, { location });
    console.log(`✓ Location updated to: ${result.location}`);
    return result;
}

async function updateMatterAttorney(attorneyID) {
    console.log(`Updating matter ${matterId} responsible attorney to: ${attorneyID}`);
    const result = await ClioService.updateMatter(matterId, {
        responsible_attorney: { id: attorneyID }
    });
    console.log(`✓ Attorney updated to: ${result.responsible_attorney?.id}`);
    return result;
}

async function updateMatterStage(stageID) {
    console.log(`\nUpdating matter ${matterId} stage to: ${stageID}`);
    const result = await ClioService.updateMatter(matterId, {
        matter_stage: { id: stageID }
    });
    console.log(`✓ Stage updated to: ${result.matter_stage?.id} (${result.matter_stage?.name})`);
    return result;
}

async function completeTask(taskId) {
    console.log(`  Completing task: ${taskId}`);
    const result = await ClioService.updateTask(taskId, { status: 'complete' });
    console.log(`  ✓ Task completed: ${taskId}`);
    return result;
}

async function getDependencyChain(stageID) {
    console.log(`\nRetrieving dependency chain for stage: ${stageID}`);

    // Stages with sequential task creation (tasks created only after previous task completes)
    const sequentialStages = [986242, 833223, 848343, 1053877, 1038727, 828783];
    const isSequential = sequentialStages.includes(stageID);

    // Step 1: Query Supabase task-list-non-meeting for current stage ID
    const taskTemplates = await SupabaseService.getTaskListNonMeeting(stageID);

    if (!taskTemplates || taskTemplates.length === 0) {
        console.log('No task templates found for stage');
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
    const { config } = await import('../src/config/index.js');
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
            console.log(`  Warning: Could not find Task #${taskNumber}: ${error.message}`);
            continue;
        }

        if (taskData) {
            dependencyChain.push({
                taskId: taskData.task_id,
                taskNumber: taskData.task_number,
                taskName: taskData.task_name
            });
            console.log(`  Found Task #${taskData.task_number} (ID: ${taskData.task_id})`);
        }
    }

    console.log(`\nTotal dependencies to complete: ${dependencyChain.length}`);
    return dependencyChain;
}

function extractParentTaskNumber(relationType) {
    if (!relationType) return null;
    const match = relationType.match(/after\s+task\s+(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
}

async function retrieveTaskByNumber(stageID, taskNumber) {
    console.log(`  Retrieving Task #${taskNumber} from Supabase...`);

    const { createClient } = await import('@supabase/supabase-js');
    const { config } = await import('../src/config/index.js');
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

async function playWrightScreenshot(screenshotName, locationFolder, stageFolder) {
    if (!browserSession || !browserSession.page) {
        throw new Error('Browser session not initialized');
    }

    const { page } = browserSession;
    const tasksUrl = `https://app.clio.com/nc/#/matters/${matterId}/tasks`;

    if (page.url().includes(`matters/${matterId}/tasks`)) {
        await page.reload({ waitUntil: 'load', timeout: 60000 });
    } else {
        await page.goto(tasksUrl, { waitUntil: 'load', timeout: 60000 });
    }

    await page.waitForTimeout(5000);

    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');

    const desktopPath = path.join(os.homedir(), 'Desktop');
    const mainTestFolder = path.join(desktopPath, 'SHLF non-meeting Tests');
    const locationFolderPath = path.join(mainTestFolder, locationFolder);
    const stageFolderPath = path.join(locationFolderPath, stageFolder);

    if (!fs.existsSync(mainTestFolder)) {
        fs.mkdirSync(mainTestFolder, { recursive: true });
    }
    if (!fs.existsSync(locationFolderPath)) {
        fs.mkdirSync(locationFolderPath, { recursive: true });
    }
    if (!fs.existsSync(stageFolderPath)) {
        fs.mkdirSync(stageFolderPath, { recursive: true });
    }

    await takeScreenshot(page, screenshotName, stageFolderPath);
    console.log(`  ✓ Screenshot saved: ${screenshotName}`);
}

async function cleanData() {
    console.log('Cleaning up test data...');

    const { createClient } = await import('@supabase/supabase-js');
    const { config } = await import('../src/config/index.js');
    const supabase = createClient(config.supabase.url, config.supabase.key);

    // Delete calendar entries
    const { data: meetingRecords } = await supabase
        .from('matters-meetings-booked')
        .select('calendar_entry_id')
        .eq('matter_id', matterId);

    if (meetingRecords && meetingRecords.length > 0) {
        for (const record of meetingRecords) {
            try {
                await ClioService.client.delete(`/api/v4/calendar_entries/${record.calendar_entry_id}`);
            } catch (error) {
                // Continue on error
            }
        }
    }

    // Delete tasks from Clio
    try {
        const tasks = await ClioService.getTasksByMatter(matterId);
        if (tasks && tasks.length > 0) {
            for (const task of tasks) {
                try {
                    await ClioService.deleteTask(task.id);
                } catch (error) {
                    // Continue on error
                }
            }
        }
    } catch (error) {
        // Continue on error
    }

    // Delete from Supabase
    await supabase.from('tasks').delete().eq('matter_id', matterId);
    await supabase.from('matters-meetings-booked').delete().eq('matter_id', matterId);

    console.log('✓ Cleanup completed');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run test
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
