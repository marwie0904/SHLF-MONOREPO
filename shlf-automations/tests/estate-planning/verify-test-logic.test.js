/**
 * Verification Test - Simple Estate Planning Automation Test
 *
 * Quick verification of test logic with just 3 stages
 * Tests location/attorney changes and basic automation flow
 *
 * Total: 3 test scenarios (1 variation × 3 stages)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../.env') });

// Import services
import { ClioService } from '../../src/services/clio.js';
import { SupabaseService } from '../../src/services/supabase.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../src/config/index.js';

// Initialize Supabase client for direct queries
const supabase = createClient(config.supabase.url, config.supabase.key);

// =============================================================================
// CONFIGURATION
// =============================================================================

const TEST_MATTER_ID = 1675950832;

// Just one variation for quick verification
const TEST_VARIATION = {
  location: 'Naples',
  attorneyId: 357380836,
  name: 'Naples - Attorney 1'
};

// Just 3 stages for quick verification
const TEST_STAGES = [
  828768,   // Drafting
  828783,   // Pending Engagement
  1110277   // Funding in Progress
];

// Timing configuration (in milliseconds)
const TIMING = {
  CLEANUP_WAIT: 3000,        // Wait after cleanup
  AUTOMATION_WAIT: 25000,    // Wait for automation to process
  TASK_COMPLETION_WAIT: 20000, // Wait after completing a task
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Wait for specified milliseconds
 */
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clean all test data for the matter from both Clio and Supabase
 */
async function cleanupTestData(matterId) {
  console.log(`\n🧹 Cleaning up test data for matter ${matterId}...`);

  try {
    // Get all tasks from Supabase for this matter
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('task_id')
      .eq('matter_id', matterId);

    if (error) {
      console.error('Error fetching tasks from Supabase:', error);
      return;
    }

    if (!tasks || tasks.length === 0) {
      console.log('No tasks found to clean up');
      return;
    }

    console.log(`Found ${tasks.length} tasks to delete`);

    // Delete from Clio first
    let clioDeletedCount = 0;
    let clioErrorCount = 0;

    for (const task of tasks) {
      try {
        await ClioService.deleteTask(task.task_id);
        clioDeletedCount++;
      } catch (error) {
        clioErrorCount++;
        // Continue even if delete fails (task might already be deleted)
      }
    }

    console.log(`Deleted ${clioDeletedCount} tasks from Clio (${clioErrorCount} errors)`);

    // Delete from Supabase
    const taskIds = tasks.map(t => t.task_id);
    const { error: deleteError } = await supabase
      .from('tasks')
      .delete()
      .in('task_id', taskIds);

    if (deleteError) {
      console.error('Error deleting from Supabase:', deleteError);
    } else {
      console.log(`Deleted ${taskIds.length} tasks from Supabase`);
    }

  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

/**
 * Update matter location and attorney
 */
async function updateMatterDetails(matterId, location, attorneyId) {
  console.log(`\n📝 Updating matter ${matterId}: location="${location}", attorney=${attorneyId}`);

  try {
    await ClioService.updateMatter(matterId, {
      location: location,
      responsible_attorney: { id: attorneyId }
    });
    console.log('✓ Matter updated successfully');
  } catch (error) {
    console.error('✗ Error updating matter:', error.message);
    throw error;
  }
}

/**
 * Update matter stage
 */
async function updateMatterStage(matterId, stageId) {
  console.log(`\n🔄 Moving matter ${matterId} to stage ${stageId}...`);

  try {
    await ClioService.updateMatter(matterId, {
      matter_stage: { id: stageId }
    });
    console.log('✓ Stage updated successfully');
  } catch (error) {
    console.error('✗ Error updating stage:', error.message);
    throw error;
  }
}

/**
 * Retrieve all tasks generated for a specific matter directly from Clio API
 * Then map task data to match the expected format with Supabase field names
 */
async function getGeneratedTasks(matterId, stageId) {
  console.log(`\n📋 Retrieving tasks for matter ${matterId} from Clio API...`);

  try {
    // Fetch all tasks for this matter directly from Clio
    const clioTasks = await ClioService.getTasksByMatter(matterId);

    console.log(`✓ Found ${clioTasks?.length || 0} total tasks from Clio`);

    // Filter by stage_id if needed (by checking task names or fetching from Supabase for mapping)
    // For now, we'll get task numbers from Supabase to map Clio tasks correctly
    const { data: supabaseTasks, error } = await supabase
      .from('tasks')
      .select('task_id, task_number, task_name, stage_id')
      .eq('matter_id', matterId)
      .eq('stage_id', stageId);

    if (error) {
      console.error('Error fetching task mapping from Supabase:', error);
      return [];
    }

    // Create mapping of task_id to task details
    const taskMapping = new Map();
    supabaseTasks?.forEach(t => {
      taskMapping.set(t.task_id, t);
    });

    // Map Clio tasks to our expected format, filtering by stage
    const tasks = clioTasks
      .filter(clioTask => taskMapping.has(clioTask.id))
      .map(clioTask => {
        const supabaseTask = taskMapping.get(clioTask.id);
        return {
          task_id: clioTask.id,
          task_number: supabaseTask.task_number,
          task_name: clioTask.name,
          description: clioTask.description,
          status: clioTask.status,
          assigned_user: clioTask.assignee?.name || 'Unassigned',
          assignee_id: clioTask.assignee?.id || null,
          due_date: clioTask.due_at || null,
          matter_id: matterId,
          stage_id: stageId,
        };
      })
      .sort((a, b) => a.task_number - b.task_number);

    console.log(`✓ Filtered to ${tasks.length} tasks for stage ${stageId}`);

    // Display task summary
    if (tasks && tasks.length > 0) {
      console.log('\n  Tasks generated:');
      tasks.forEach(t => {
        const dueDateStatus = t.due_date ? `📅 ${t.due_date}` : '⏳ No due date';
        console.log(`    ${t.task_number}. ${t.task_name} - ${dueDateStatus}`);
        console.log(`       Assigned to: ${t.assigned_user}`);
      });
    }

    return tasks || [];
  } catch (error) {
    console.error('Error in getGeneratedTasks:', error);
    return [];
  }
}

/**
 * Parse completion dependency from due_date relation
 * Returns parent task number or null
 */
function parseCompletionDependency(relation) {
  if (!relation) return null;

  // Match patterns like "after task 1", "after task 2", etc.
  const match = relation.match(/after\s+task\s+(\d+)/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }

  return null;
}

/**
 * Complete a task via Clio API
 */
async function completeTask(taskId) {
  console.log(`  ⏳ Completing task ${taskId}...`);

  try {
    await ClioService.updateTask(taskId, {
      status: 'complete'
    });
    console.log(`  ✓ Task ${taskId} marked as complete`);
  } catch (error) {
    console.error(`  ✗ Error completing task ${taskId}:`, error.message);
    throw error;
  }
}

/**
 * Get task template from task-list-non-meeting to check for dependencies
 */
async function getTaskTemplate(stageId, taskNumber) {
  try {
    const { data, error } = await supabase
      .from('task-list-non-meeting')
      .select('*')
      .eq('stage_id', stageId)
      .eq('task_number', taskNumber)
      .single();

    if (error) {
      console.error(`Error fetching template for stage ${stageId}, task ${taskNumber}:`, error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getTaskTemplate:', error);
    return null;
  }
}

/**
 * Handle completion dependencies for a stage
 * Completes prerequisite tasks so dependent tasks can get due dates
 * Records task snapshots at each step
 */
async function handleCompletionDependencies(matterId, stageId, tasks) {
  console.log(`\n🔗 Checking for completion dependencies...`);

  const dependentTasks = [];
  const snapshots = [];

  // Check each task for dependencies
  for (const task of tasks) {
    const template = await getTaskTemplate(stageId, task.task_number);
    if (!template) continue;

    // Check various field name variations
    const relation = template['due_date-relational'] ||
                    template['due_date_relational'] ||
                    template['due_date-relation'] ||
                    template['due_date_relation'];

    const parentTaskNumber = parseCompletionDependency(relation);

    if (parentTaskNumber) {
      dependentTasks.push({
        taskNumber: task.task_number,
        taskName: task.task_name,
        parentTaskNumber,
        relation
      });
    }
  }

  if (dependentTasks.length === 0) {
    console.log('  No completion dependencies found');
    return { completed: [], dependenciesResolved: [], snapshots: [] };
  }

  console.log(`  Found ${dependentTasks.length} dependent task(s):`);
  dependentTasks.forEach(dt => {
    console.log(`    - Task ${dt.taskNumber} "${dt.taskName}" depends on Task ${dt.parentTaskNumber}`);
  });

  const completed = [];
  const dependenciesResolved = [];

  // Complete parent tasks
  const uniqueParents = [...new Set(dependentTasks.map(dt => dt.parentTaskNumber))];

  for (const parentTaskNumber of uniqueParents) {
    console.log(`\n  Processing parent task ${parentTaskNumber}...`);

    // Find parent task in Supabase
    const { data: parentTask, error } = await supabase
      .from('tasks')
      .select('task_id, task_name, due_date')
      .eq('matter_id', matterId)
      .eq('stage_id', stageId)
      .eq('task_number', parentTaskNumber)
      .single();

    if (error || !parentTask) {
      console.log(`  ⚠️  Parent task ${parentTaskNumber} not found in database`);
      continue;
    }

    console.log(`    Found parent: "${parentTask.task_name}"`);

    // Complete the parent task
    try {
      await completeTask(parentTask.task_id);
      completed.push({
        taskNumber: parentTaskNumber,
        taskId: parentTask.task_id,
        taskName: parentTask.task_name
      });

      // Wait for automation to process
      console.log(`  ⏳ Waiting ${TIMING.TASK_COMPLETION_WAIT / 1000}s for dependent tasks to get due dates...`);
      await wait(TIMING.TASK_COMPLETION_WAIT);

      // Capture snapshot of ALL tasks after completing this parent
      const allTasksAfterCompletion = await getGeneratedTasks(matterId, stageId);
      snapshots.push({
        step: `After completing Task ${parentTaskNumber}: "${parentTask.task_name}"`,
        timestamp: new Date().toISOString(),
        completedTaskNumber: parentTaskNumber,
        completedTaskName: parentTask.task_name,
        tasks: allTasksAfterCompletion.map(t => ({
          taskNumber: t.task_number,
          taskName: t.task_name,
          assignedUser: t.assigned_user,
          dueDate: t.due_date,
          hasDueDate: !!t.due_date,
          status: t.status || 'unknown'
        }))
      });

      // Check if dependent tasks now have due dates
      const childTasks = dependentTasks.filter(dt => dt.parentTaskNumber === parentTaskNumber);

      for (const childTask of childTasks) {
        const updatedChild = allTasksAfterCompletion.find(t => t.task_number === childTask.taskNumber);

        if (updatedChild) {
          const hasDueDate = !!updatedChild.due_date;
          console.log(`    ${hasDueDate ? '✓' : '✗'} Task ${childTask.taskNumber} "${childTask.taskName}" ${hasDueDate ? `now has due date: ${updatedChild.due_date}` : 'still missing due date'}`);

          if (hasDueDate) {
            dependenciesResolved.push({
              taskNumber: childTask.taskNumber,
              taskName: childTask.taskName,
              dueDate: updatedChild.due_date,
              parentTaskNumber
            });
          }
        }
      }

    } catch (error) {
      console.error(`  Error processing parent task ${parentTaskNumber}:`, error.message);
    }
  }

  return { completed, dependenciesResolved, snapshots };
}

/**
 * Get stage name from Supabase
 */
async function getStageName(stageId) {
  try {
    const { data, error } = await supabase
      .from('task-list-non-meeting')
      .select('stage_name')
      .eq('stage_id', stageId)
      .limit(1)
      .single();

    if (error || !data) return `Stage ${stageId}`;
    return data.stage_name;
  } catch (error) {
    return `Stage ${stageId}`;
  }
}

// =============================================================================
// TEST EXECUTION
// =============================================================================

/**
 * Test a single stage
 */
async function testStage(variation, stageId, stageIndex, totalStages) {
  const stageName = await getStageName(stageId);

  console.log('\n' + '='.repeat(80));
  console.log(`🧪 TEST ${stageIndex + 1}/${totalStages}: ${variation.name} - ${stageName} (${stageId})`);
  console.log('='.repeat(80));

  const testResult = {
    variation: variation.name,
    location: variation.location,
    attorneyId: variation.attorneyId,
    stageId,
    stageName,
    timestamp: new Date().toISOString(),
    success: false,
    tasksGenerated: 0,
    completionDependencies: {
      found: 0,
      parentsCompleted: 0,
      dependenciesResolved: 0
    },
    tasks: [],
    errors: []
  };

  try {
    // Step 1: Cleanup
    await cleanupTestData(TEST_MATTER_ID);
    await wait(TIMING.CLEANUP_WAIT);

    // Step 2: Update matter details
    await updateMatterDetails(TEST_MATTER_ID, variation.location, variation.attorneyId);

    // Step 3: Update stage
    await updateMatterStage(TEST_MATTER_ID, stageId);

    // Step 4: Wait for automation
    console.log(`\n⏳ Waiting ${TIMING.AUTOMATION_WAIT / 1000}s for automation to process...`);
    await wait(TIMING.AUTOMATION_WAIT);

    // Step 5: Retrieve generated tasks
    const tasks = await getGeneratedTasks(TEST_MATTER_ID, stageId);
    testResult.tasksGenerated = tasks.length;
    testResult.tasks = tasks.map(t => ({
      taskNumber: t.task_number,
      taskName: t.task_name,
      assignedUser: t.assigned_user,
      dueDate: t.due_date,
      hasDueDate: !!t.due_date
    }));

    // Capture initial snapshot
    testResult.taskSnapshots = [{
      step: "Initial - After stage change",
      timestamp: new Date().toISOString(),
      tasks: tasks.map(t => ({
        taskNumber: t.task_number,
        taskName: t.task_name,
        assignedUser: t.assigned_user,
        dueDate: t.due_date,
        hasDueDate: !!t.due_date,
        status: t.status || 'pending'
      }))
    }];

    // Step 6: Handle completion dependencies
    if (tasks.length > 0) {
      const { completed, dependenciesResolved, snapshots } = await handleCompletionDependencies(
        TEST_MATTER_ID,
        stageId,
        tasks
      );

      testResult.completionDependencies.found = completed.length > 0 ? 1 : 0;
      testResult.completionDependencies.parentsCompleted = completed.length;
      testResult.completionDependencies.dependenciesResolved = dependenciesResolved.length;

      // Append completion snapshots to initial snapshot
      testResult.taskSnapshots = [...testResult.taskSnapshots, ...snapshots];
    }

    testResult.success = true;
    console.log(`\n✅ TEST PASSED: ${stageName}`);
    console.log(`   Tasks generated: ${testResult.tasksGenerated}`);
    console.log(`   Dependencies resolved: ${testResult.completionDependencies.dependenciesResolved}`);

  } catch (error) {
    testResult.success = false;
    testResult.errors.push(error.message);
    console.error(`\n❌ TEST FAILED: ${stageName}`, error);
  }

  return testResult;
}

/**
 * Run verification tests
 */
async function runVerificationTests() {
  const startTime = Date.now();
  const allResults = [];

  console.log('\n' + '█'.repeat(80));
  console.log('🔬 VERIFICATION TEST - Estate Planning Automation');
  console.log('█'.repeat(80));
  console.log(`\n📊 Test Configuration:`);
  console.log(`   Matter ID: ${TEST_MATTER_ID}`);
  console.log(`   Location: ${TEST_VARIATION.location}`);
  console.log(`   Attorney ID: ${TEST_VARIATION.attorneyId}`);
  console.log(`   Stages to test: ${TEST_STAGES.length}`);
  console.log(`   Estimated duration: ~${Math.ceil((TEST_STAGES.length * (TIMING.AUTOMATION_WAIT + TIMING.CLEANUP_WAIT)) / 60000)} minutes\n`);

  // Test each stage
  for (let s = 0; s < TEST_STAGES.length; s++) {
    const stageId = TEST_STAGES[s];
    const result = await testStage(TEST_VARIATION, stageId, s, TEST_STAGES.length);
    allResults.push(result);
  }

  // Generate summary
  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);

  const summary = {
    testSuite: 'Estate Planning Automation - Verification Test',
    timestamp: new Date().toISOString(),
    duration: `${Math.floor(duration / 60)}m ${duration % 60}s`,
    configuration: {
      matterId: TEST_MATTER_ID,
      location: TEST_VARIATION.location,
      attorneyId: TEST_VARIATION.attorneyId,
      totalTests: allResults.length
    },
    results: {
      total: allResults.length,
      passed: allResults.filter(r => r.success).length,
      failed: allResults.filter(r => !r.success).length,
      totalTasksGenerated: allResults.reduce((sum, r) => sum + r.tasksGenerated, 0),
      totalDependenciesResolved: allResults.reduce((sum, r) => sum + r.completionDependencies.dependenciesResolved, 0)
    },
    details: allResults
  };

  // Save results to JSON file
  const resultsDir = join(__dirname, '../results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const resultsFile = join(resultsDir, `verification-test-${Date.now()}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify(summary, null, 2));

  // Print summary
  console.log('\n' + '█'.repeat(80));
  console.log('📊 VERIFICATION TEST SUMMARY');
  console.log('█'.repeat(80));
  console.log(`\n✅ Passed: ${summary.results.passed}/${summary.results.total}`);
  console.log(`❌ Failed: ${summary.results.failed}/${summary.results.total}`);
  console.log(`📋 Total tasks generated: ${summary.results.totalTasksGenerated}`);
  console.log(`🔗 Total dependencies resolved: ${summary.results.totalDependenciesResolved}`);
  console.log(`⏱️  Duration: ${summary.duration}`);
  console.log(`\n💾 Results saved to: ${resultsFile}\n`);

  // Print detailed results
  console.log('\n📋 Detailed Results:');
  allResults.forEach((result, idx) => {
    const status = result.success ? '✅' : '❌';
    console.log(`\n${status} Test ${idx + 1}: ${result.stageName} (${result.stageId})`);
    console.log(`   Tasks generated: ${result.tasksGenerated}`);
    console.log(`   Dependencies resolved: ${result.completionDependencies.dependenciesResolved}`);
    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.join(', ')}`);
    }
  });

  return summary;
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

runVerificationTests()
  .then(summary => {
    const exitCode = summary.results.failed > 0 ? 1 : 0;
    console.log(`\n${summary.results.failed === 0 ? '✅ All tests passed!' : '⚠️  Some tests failed'}`);
    console.log('\nTest logic verified. Ready to run full test suite if needed.');
    process.exit(exitCode);
  })
  .catch(error => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  });
