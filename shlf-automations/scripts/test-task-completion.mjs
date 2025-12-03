#!/usr/bin/env node

import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL;
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;

// Test Matter ID
const TEST_MATTER_ID = 1675950832;

// Headers
const supabaseHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

const clioHeaders = {
  'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
};

// Stage configurations with task dependencies
const STAGES_TO_TEST = [
  {
    stage_id: 828768,
    stage_name: "Drafting",
    dependencies: [
      { task_number: 4, depends_on: 3, task_title: "Review Draft" },
      { task_number: 5, depends_on: 3, task_title: "Send out Videos and Draft Docs" }
    ]
  },
  {
    stage_id: 828783,
    stage_name: "Pending Engagement",
    dependencies: [
      { task_number: 3, depends_on: 2, task_title: "Attempt 2" },
      { task_number: 4, depends_on: 3, task_title: "Attempt 3" }
    ]
  },
  {
    stage_id: 833223,
    stage_name: "Cancelled/No Show IV Meeting",
    dependencies: [
      { task_number: 2, depends_on: 1, task_title: "Attempt 2 Follow Up" },
      { task_number: 3, depends_on: 2, task_title: "Attempt 3 Follow Up" },
      { task_number: 4, depends_on: 3, task_title: "No Response" }
    ]
  },
  {
    stage_id: 848343,
    stage_name: "Cancelled/No Show Signing",
    dependencies: [
      { task_number: 2, depends_on: 1, task_title: "Attempt 2" },
      { task_number: 3, depends_on: 2, task_title: "Attempt 3" },
      { task_number: 4, depends_on: 3, task_title: "No Response" }
    ]
  },
  {
    stage_id: 848358,
    stage_name: "For Recording and Submission",
    dependencies: [
      { task_number: 3, depends_on: 2, task_title: "Mail Recorded Deed" },
      { task_number: 4, depends_on: 3, task_title: "Send out Thank you letter" }
    ]
  },
  {
    stage_id: 986242,
    stage_name: "Cancelled/No Show Design",
    dependencies: [
      { task_number: 2, depends_on: 1, task_title: "Attempt 2" },
      { task_number: 3, depends_on: 2, task_title: "Attempt 3" },
      { task_number: 4, depends_on: 3, task_title: "No Response" }
    ]
  },
  {
    stage_id: 1038727,
    stage_name: "New D/S Meeting Booked / Drafting Parked",
    dependencies: [
      { task_number: 2, depends_on: 1, task_title: "Attempt 2" },
      { task_number: 3, depends_on: 2, task_title: "Attempt 3" },
      { task_number: 4, depends_on: 3, task_title: "No Response" }
    ]
  },
  {
    stage_id: 1053877,
    stage_name: "New D/S Meeting Booked / Drafting Parked",
    dependencies: [
      { task_number: 2, depends_on: 1, task_title: "Attempt 2" },
      { task_number: 3, depends_on: 2, task_title: "Attempt 3" },
      { task_number: 4, depends_on: 3, task_title: "No Response" }
    ]
  },
  {
    stage_id: 1110277,
    stage_name: "Funding in Progress",
    dependencies: [
      { task_number: 2, depends_on: 1, task_title: "Send Out Funding" }
    ]
  }
];

// Helper: Update matter stage
async function updateMatterStage(matterId, stageId) {
  const response = await axios.patch(
    `${CLIO_API_BASE_URL}/api/v4/matters/${matterId}`,
    {
      data: {
        matter_stage: { id: stageId }
      }
    },
    { headers: clioHeaders }
  );
  return response.data.data;
}

// Helper: Get tasks for matter
async function getClioTasks(matterId) {
  const response = await axios.get(
    `${CLIO_API_BASE_URL}/api/v4/tasks`,
    {
      params: {
        matter_id: matterId,
        fields: 'id,name,due_at,status'
      },
      headers: clioHeaders
    }
  );
  return response.data.data;
}

// Helper: Get single task
async function getClioTask(taskId) {
  const response = await axios.get(
    `${CLIO_API_BASE_URL}/api/v4/tasks/${taskId}`,
    {
      params: {
        fields: 'id,name,due_at,status'
      },
      headers: clioHeaders
    }
  );
  return response.data.data;
}

// Helper: Complete a task
async function completeTask(taskId) {
  const response = await axios.patch(
    `${CLIO_API_BASE_URL}/api/v4/tasks/${taskId}`,
    {
      data: {
        status: 'complete'
      }
    },
    { headers: clioHeaders }
  );
  return response.data.data;
}

// Helper: Delete all tasks for matter
async function deleteAllTasks(matterId) {
  // SAFETY CHECK: Only delete for TEST_MATTER_ID
  if (matterId !== TEST_MATTER_ID) {
    throw new Error(`SAFETY: Can only delete tasks for TEST_MATTER_ID (${TEST_MATTER_ID}), got ${matterId}`);
  }

  const tasks = await getClioTasks(matterId);

  for (const task of tasks) {
    try {
      await axios.delete(
        `${CLIO_API_BASE_URL}/api/v4/tasks/${task.id}`,
        { headers: clioHeaders }
      );
    } catch (error) {
      console.error(`   Failed to delete task ${task.id}: ${error.message}`);
    }
  }

  return tasks.length;
}

// Helper: Delete Supabase records for matter
async function deleteSupabaseRecords(matterId) {
  // SAFETY CHECK: Only delete for TEST_MATTER_ID
  if (matterId !== TEST_MATTER_ID) {
    throw new Error(`SAFETY: Can only delete records for TEST_MATTER_ID (${TEST_MATTER_ID}), got ${matterId}`);
  }

  // Delete from tasks table
  await axios.delete(
    `${SUPABASE_URL}/rest/v1/tasks`,
    {
      params: { matter_id: `eq.${matterId}` },
      headers: supabaseHeaders
    }
  );

  // Delete from matters table
  await axios.delete(
    `${SUPABASE_URL}/rest/v1/matters`,
    {
      params: { matter_id: `eq.${matterId}` },
      headers: supabaseHeaders
    }
  );

  // Delete from matter-info table
  await axios.delete(
    `${SUPABASE_URL}/rest/v1/matter-info`,
    {
      params: { matter_id: `eq.${matterId}` },
      headers: supabaseHeaders
    }
  );
}

// Helper: Wait/sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main test function for a single stage
async function testStage(stageConfig) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`Testing: ${stageConfig.stage_name} (ID: ${stageConfig.stage_id})`);
  console.log(`${'═'.repeat(80)}\n`);

  const result = {
    stage_id: stageConfig.stage_id,
    stage_name: stageConfig.stage_name,
    dependencies_tested: [],
    success: true,
    error: null
  };

  try {
    // Step 1: Move matter to stage
    console.log(`🔄 Moving matter ${TEST_MATTER_ID} to stage ${stageConfig.stage_id}...`);
    await updateMatterStage(TEST_MATTER_ID, stageConfig.stage_id);
    console.log('✅ Stage updated');

    // Step 2: Wait 15 seconds for tasks to be created
    console.log('⏳ Waiting 15 seconds for webhook processing...');
    await sleep(15000);

    // Step 3: List all tasks
    let allTasks = await getClioTasks(TEST_MATTER_ID);
    console.log(`\n📋 Tasks created: ${allTasks.length}`);

    if (allTasks.length === 0) {
      console.log('⚠️  No tasks found, waiting 10 more seconds...');
      await sleep(10000);
      allTasks = await getClioTasks(TEST_MATTER_ID);
      console.log(`📋 Tasks after retry: ${allTasks.length}`);
    }

    // Create a map of task names to task objects
    const taskMap = new Map();
    allTasks.forEach(task => {
      taskMap.set(task.name.trim(), task);
    });

    console.log('\nAll Tasks:');
    allTasks.forEach((task, idx) => {
      console.log(`   ${idx + 1}. ${task.name} (ID: ${task.id}) - Due: ${task.due_at || 'TBD'}`);
    });

    // Step 4: Process each dependency chain
    for (const dep of stageConfig.dependencies) {
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`Testing Dependency: Task ${dep.task_number} depends on Task ${dep.depends_on}`);
      console.log(`Dependent Task: "${dep.task_title}"`);
      console.log(`${'─'.repeat(80)}`);

      const depResult = {
        task_number: dep.task_number,
        task_title: dep.task_title,
        depends_on_task: dep.depends_on,
        prerequisite_task_id: null,
        dependent_task_id: null,
        due_date_before: null,
        due_date_after: null,
        success: false,
        error: null
      };

      try {
        // Find the prerequisite task
        const prerequisiteTaskTitle = stageConfig.dependencies
          .find(d => d.task_number === dep.depends_on)?.task_title
          || allTasks.find(t => t.name.includes(`${dep.depends_on}.`) || t.name.startsWith(`Task ${dep.depends_on}`))?.name;

        // Try multiple approaches to find tasks
        let prerequisiteTask = null;
        let dependentTask = null;

        // Try to find by exact title match
        for (const [name, task] of taskMap) {
          if (name.includes(dep.task_title)) {
            dependentTask = task;
          }
          if (prerequisiteTaskTitle && name.includes(prerequisiteTaskTitle)) {
            prerequisiteTask = task;
          }
        }

        // If not found, try by pattern matching
        if (!prerequisiteTask) {
          prerequisiteTask = allTasks.find(t => {
            const name = t.name.toLowerCase();
            return name.includes('attempt 1') && dep.depends_on === 1 ||
                   name.includes('attempt 2') && dep.depends_on === 2;
          });
        }

        if (!prerequisiteTask) {
          // Just get by order if we have that many tasks
          prerequisiteTask = allTasks[dep.depends_on - 1];
        }

        if (!prerequisiteTask) {
          depResult.error = `Could not find prerequisite task ${dep.depends_on}`;
          console.error(`❌ ${depResult.error}`);
          result.success = false;
          result.dependencies_tested.push(depResult);
          continue;
        }

        if (!dependentTask) {
          depResult.error = `Could not find dependent task "${dep.task_title}"`;
          console.error(`❌ ${depResult.error}`);
          result.success = false;
          result.dependencies_tested.push(depResult);
          continue;
        }

        depResult.prerequisite_task_id = prerequisiteTask.id;
        depResult.dependent_task_id = dependentTask.id;
        depResult.due_date_before = dependentTask.due_at;

        console.log(`\n📍 Prerequisite Task: "${prerequisiteTask.name}" (ID: ${prerequisiteTask.id})`);
        console.log(`📍 Dependent Task: "${dependentTask.name}" (ID: ${dependentTask.id})`);
        console.log(`📅 Dependent Task Due Date (before): ${dependentTask.due_at || 'None'}`);

        // Complete the prerequisite task
        console.log(`\n✓ Completing prerequisite task ${prerequisiteTask.id}...`);
        await completeTask(prerequisiteTask.id);
        console.log('✅ Task marked as complete');

        // Wait 15 seconds for due date generation
        console.log('⏳ Waiting 15 seconds for due date generation...');
        await sleep(15000);

        // Retrieve the dependent task to check if due date was generated
        const updatedDependentTask = await getClioTask(dependentTask.id);
        depResult.due_date_after = updatedDependentTask.due_at;

        console.log(`\n📅 Dependent Task Due Date (after): ${updatedDependentTask.due_at || 'None'}`);

        if (updatedDependentTask.due_at && !dependentTask.due_at) {
          console.log('✅ SUCCESS: Due date was generated!');
          depResult.success = true;
        } else if (updatedDependentTask.due_at === dependentTask.due_at) {
          console.log('❌ FAILURE: Due date was not updated');
          depResult.error = 'Due date was not generated after task completion';
          result.success = false;
        } else {
          console.log('⚠️  Due date changed but was already set');
          depResult.success = true;
        }

      } catch (error) {
        console.error(`❌ Error testing dependency: ${error.message}`);
        depResult.error = error.message;
        result.success = false;
      }

      result.dependencies_tested.push(depResult);
    }

    // Step 5: Cleanup
    console.log(`\n${'─'.repeat(80)}`);
    console.log('🗑️  Cleaning up...');

    const deletedCount = await deleteAllTasks(TEST_MATTER_ID);
    console.log(`✅ Deleted ${deletedCount} tasks from Clio`);

    await deleteSupabaseRecords(TEST_MATTER_ID);
    console.log('✅ Deleted Supabase records');

  } catch (error) {
    console.error(`\n❌ Stage test failed: ${error.message}`);
    result.error = error.message;
    result.success = false;
  }

  return result;
}

// Main execution
async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TASK COMPLETION DEPENDENCY TESTING');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Test Matter ID: ${TEST_MATTER_ID}`);
  console.log(`Start Time: ${new Date().toISOString()}`);
  console.log(`Total Stages to Test: ${STAGES_TO_TEST.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const report = {
    test_matter_id: TEST_MATTER_ID,
    start_time: new Date().toISOString(),
    total_stages: STAGES_TO_TEST.length,
    results: []
  };

  for (let i = 0; i < STAGES_TO_TEST.length; i++) {
    const stageConfig = STAGES_TO_TEST[i];
    const result = await testStage(stageConfig);
    report.results.push(result);

    // Small delay between stages
    if (i < STAGES_TO_TEST.length - 1) {
      console.log('\n⏳ Waiting 3 seconds before next stage...\n');
      await sleep(3000);
    }
  }

  // Generate summary
  report.end_time = new Date().toISOString();
  report.summary = {
    total_stages: STAGES_TO_TEST.length,
    stages_passed: report.results.filter(r => r.success).length,
    stages_failed: report.results.filter(r => !r.success).length,
    total_dependencies: report.results.reduce((sum, r) => sum + r.dependencies_tested.length, 0),
    dependencies_passed: report.results.reduce((sum, r) =>
      sum + r.dependencies_tested.filter(d => d.success).length, 0),
    dependencies_failed: report.results.reduce((sum, r) =>
      sum + r.dependencies_tested.filter(d => !d.success).length, 0)
  };

  // Save report
  const reportPath = join(__dirname, '..', 'tests', 'reports', `task-completion-test-${Date.now()}.json`);
  await fs.mkdir(join(__dirname, '..', 'tests', 'reports'), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  // Print summary
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total Stages Tested: ${report.summary.total_stages}`);
  console.log(`Stages Passed: ${report.summary.stages_passed} ✅`);
  console.log(`Stages Failed: ${report.summary.stages_failed} ❌`);
  console.log(`\nTotal Dependencies Tested: ${report.summary.total_dependencies}`);
  console.log(`Dependencies Passed: ${report.summary.dependencies_passed} ✅`);
  console.log(`Dependencies Failed: ${report.summary.dependencies_failed} ❌`);
  console.log(`\nReport saved to: ${reportPath}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  return report;
}

// Run tests
runTests()
  .then(() => {
    console.log('✅ All tests complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
