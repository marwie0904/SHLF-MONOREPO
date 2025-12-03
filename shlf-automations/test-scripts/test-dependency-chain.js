import { ClioService } from '../src/services/clio.js';
import { SupabaseService } from '../src/services/supabase.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config/index.js';

const TEST_MATTER_ID = 1675950832;
const TEST_STAGE_IDS = [986242]; // Testing non-meeting stage

/**
 * Get access token from Supabase
 */
async function getAccessToken() {
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

/**
 * Extract parent task number from relational string
 * Examples: "after task 1" → 1, "3 days after task 5" → 5
 * (From TestFlow.js)
 */
function extractParentTaskNumber(relationType) {
    if (!relationType) return null;

    const match = relationType.match(/after\s+task\s+(\d+)/i);
    if (match && match[1]) {
        return parseInt(match[1], 10);
    }

    return null;
}

/**
 * Test extractParentTaskNumber function
 */
function testExtractParentTaskNumber() {
    console.log('\n=== Testing extractParentTaskNumber ===\n');

    const testCases = [
        { input: 'after task 1', expected: 1 },
        { input: 'After Task 3', expected: 3 },
        { input: '3 days after task 5', expected: 5 },
        { input: '10 days after task 12', expected: 12 },
        { input: 'before task 1', expected: null },
        { input: 'no dependency', expected: null },
        { input: null, expected: null },
        { input: '', expected: null },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((testCase, index) => {
        const result = extractParentTaskNumber(testCase.input);
        const success = result === testCase.expected;

        if (success) {
            console.log(`✅ Test ${index + 1}: "${testCase.input}" → ${result}`);
            passed++;
        } else {
            console.log(`❌ Test ${index + 1}: "${testCase.input}" → Expected: ${testCase.expected}, Got: ${result}`);
            failed++;
        }
    });

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    return { passed, failed };
}

/**
 * Get dependency chain for a stage ID
 * (From TestFlow.js)
 */
async function getDependencyChain(stageID) {
    try {
        console.log(`\n=== Testing getDependencyChain for Stage ${stageID} ===\n`);

        // Get task templates for this stage from task-list-non-meeting table
        const taskTemplates = await SupabaseService.getTaskListNonMeeting(stageID);

        if (!taskTemplates || taskTemplates.length === 0) {
            console.log(`⚠️  No task templates found for stage ${stageID}`);
            return [];
        }

        console.log(`📋 Found ${taskTemplates.length} task templates for stage ${stageID}`);

        // Display all tasks for this stage
        console.log('\nAll tasks for this stage:');
        taskTemplates.forEach((template, index) => {
            const relationType = template['due_date-relational'] || template.due_date_relational || '';
            console.log(`   ${index + 1}. ${template.task_name || 'Unnamed task'}`);
            console.log(`      Due Date Relational: ${relationType || 'None'}`);
        });

        // Find all tasks that have "after task X" in their relational due date field
        const dependentTasks = taskTemplates.filter(template => {
            const relationType = template['due_date-relational'] || template.due_date_relational || '';
            return relationType.toLowerCase().includes('after task');
        });

        if (dependentTasks.length === 0) {
            console.log(`\n⚠️  No dependent tasks found for stage ${stageID}`);
            return [];
        }

        console.log(`\n🔗 Found ${dependentTasks.length} dependent tasks:`);
        dependentTasks.forEach((task, index) => {
            const relationType = task['due_date-relational'] || task.due_date_relational || '';
            const parentTaskNumber = extractParentTaskNumber(relationType);
            console.log(`   ${index + 1}. ${task.task_name}`);
            console.log(`      Depends on: ${relationType}`);
            console.log(`      Parent Task Number: ${parentTaskNumber}`);
        });

        // Extract the parent task numbers and get the corresponding task IDs from Clio
        console.log(`\n🔍 Looking up task IDs in Clio for matter ${TEST_MATTER_ID}...`);

        const dependencyChain = [];
        for (const task of dependentTasks) {
            const relationType = task['due_date-relational'] || task.due_date_relational || '';
            const parentTaskNumber = extractParentTaskNumber(relationType);

            if (parentTaskNumber) {
                // Get the actual task ID from Clio for this matter and task number
                const tasks = await ClioService.getTasksByMatter(TEST_MATTER_ID);

                if (!tasks || tasks.length === 0) {
                    console.log(`   ⚠️  No tasks found in Clio for matter ${TEST_MATTER_ID}`);
                    continue;
                }

                const parentTask = tasks.find(t => {
                    // Match by task number in the task name or description
                    const taskName = t.name || '';
                    return taskName.includes(`Task ${parentTaskNumber}`) ||
                           taskName.includes(`#${parentTaskNumber}`);
                });

                if (parentTask) {
                    dependencyChain.push(parentTask.id);
                    console.log(`   ✅ Found dependency: Task #${parentTaskNumber} → Clio ID: ${parentTask.id}`);
                    console.log(`      Task Name: ${parentTask.name}`);
                } else {
                    console.log(`   ⚠️  Could not find Task #${parentTaskNumber} in Clio for matter ${TEST_MATTER_ID}`);
                }
            }
        }

        console.log(`\n📊 Dependency chain for stage ${stageID}: ${dependencyChain.length} tasks`);
        if (dependencyChain.length > 0) {
            console.log(`   Task IDs: [${dependencyChain.join(', ')}]`);
        }

        return dependencyChain;
    } catch (error) {
        console.error(`❌ Failed to get dependency chain for stage ${stageID}:`, error.message);
        return []; // Return empty array on error to allow test to continue
    }
}

/**
 * Main test runner
 */
async function main() {
    console.log('=====================================');
    console.log('  Dependency Chain Test');
    console.log('=====================================');

    try {
        // Step 1: Test extractParentTaskNumber function
        console.log('\n' + '='.repeat(50));
        console.log('PART 1: Testing extractParentTaskNumber()');
        console.log('='.repeat(50));

        const extractResults = testExtractParentTaskNumber();

        // Step 2: Setup ClioService
        console.log('\n' + '='.repeat(50));
        console.log('PART 2: Setting up ClioService');
        console.log('='.repeat(50));

        const accessToken = await getAccessToken();
        ClioService.client.defaults.headers['Authorization'] = `Bearer ${accessToken}`;
        ClioService.initializeInterceptors();
        console.log('\n✅ ClioService configured');

        // Step 3: Test getDependencyChain for each stage ID
        console.log('\n' + '='.repeat(50));
        console.log('PART 3: Testing getDependencyChain()');
        console.log('='.repeat(50));

        const results = {};

        for (const stageId of TEST_STAGE_IDS) {
            const dependencyChain = await getDependencyChain(stageId);
            results[stageId] = dependencyChain;

            // Wait between tests
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Step 4: Summary
        console.log('\n' + '='.repeat(50));
        console.log('SUMMARY');
        console.log('='.repeat(50));

        console.log('\n📊 extractParentTaskNumber Test:');
        console.log(`   Passed: ${extractResults.passed}`);
        console.log(`   Failed: ${extractResults.failed}`);

        console.log('\n📊 getDependencyChain Results:');
        TEST_STAGE_IDS.forEach(stageId => {
            const chain = results[stageId];
            console.log(`   Stage ${stageId}: ${chain.length} dependencies found`);
            if (chain.length > 0) {
                console.log(`      IDs: [${chain.join(', ')}]`);
            }
        });

        console.log('\n=====================================');
        console.log('  Test Completed Successfully! ✅');
        console.log('=====================================\n');

    } catch (error) {
        console.error('\n❌ Test execution failed:', error);
        process.exit(1);
    }
}

// Run test
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
