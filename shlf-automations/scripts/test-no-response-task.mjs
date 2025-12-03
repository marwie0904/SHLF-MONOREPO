#!/usr/bin/env node

import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL;
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;
const TEST_MATTER_ID = 1675950832;

const supabaseHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

const clioHeaders = {
  'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
};

async function updateMatterStage(matterId, stageId) {
  const response = await axios.patch(
    `${CLIO_API_BASE_URL}/api/v4/matters/${matterId}`,
    { data: { matter_stage: { id: stageId } } },
    { headers: clioHeaders }
  );
  return response.data.data;
}

async function getClioTasks(matterId) {
  const response = await axios.get(
    `${CLIO_API_BASE_URL}/api/v4/tasks`,
    {
      params: { matter_id: matterId, fields: 'id,name,due_at,status' },
      headers: clioHeaders
    }
  );
  return response.data.data;
}

async function getClioTask(taskId) {
  const response = await axios.get(
    `${CLIO_API_BASE_URL}/api/v4/tasks/${taskId}`,
    { params: { fields: 'id,name,due_at,status' }, headers: clioHeaders }
  );
  return response.data.data;
}

async function completeTask(taskId) {
  const response = await axios.patch(
    `${CLIO_API_BASE_URL}/api/v4/tasks/${taskId}`,
    { data: { status: 'complete' } },
    { headers: clioHeaders }
  );
  return response.data.data;
}

async function deleteAllTasks(matterId) {
  // SAFETY CHECK: Only delete for TEST_MATTER_ID
  if (matterId !== TEST_MATTER_ID) {
    throw new Error(`SAFETY: Can only delete tasks for TEST_MATTER_ID (${TEST_MATTER_ID}), got ${matterId}`);
  }

  const tasks = await getClioTasks(matterId);
  for (const task of tasks) {
    await axios.delete(`${CLIO_API_BASE_URL}/api/v4/tasks/${task.id}`, { headers: clioHeaders });
  }
  return tasks.length;
}

async function deleteSupabaseRecords(matterId) {
  // SAFETY CHECK: Only delete for TEST_MATTER_ID
  if (matterId !== TEST_MATTER_ID) {
    throw new Error(`SAFETY: Can only delete records for TEST_MATTER_ID (${TEST_MATTER_ID}), got ${matterId}`);
  }

  await axios.delete(`${SUPABASE_URL}/rest/v1/tasks`, {
    params: { matter_id: `eq.${matterId}` },
    headers: supabaseHeaders
  });
  await axios.delete(`${SUPABASE_URL}/rest/v1/matters`, {
    params: { matter_id: `eq.${matterId}` },
    headers: supabaseHeaders
  });
  await axios.delete(`${SUPABASE_URL}/rest/v1/matter-info`, {
    params: { matter_id: `eq.${matterId}` },
    headers: supabaseHeaders
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testStage(stageId, stageName, taskToFind) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`Testing: ${stageName} (ID: ${stageId})`);
  console.log(`Looking for: "${taskToFind}"`);
  console.log(`${'═'.repeat(80)}\n`);

  try {
    // Move to stage
    console.log(`🔄 Moving matter to stage ${stageId}...`);
    await updateMatterStage(TEST_MATTER_ID, stageId);
    console.log('✅ Stage updated');

    // Wait for tasks
    console.log('⏳ Waiting 15 seconds for webhook processing...');
    await sleep(15000);

    let allTasks = await getClioTasks(TEST_MATTER_ID);
    console.log(`\n📋 Tasks created: ${allTasks.length}`);

    if (allTasks.length === 0) {
      console.log('⚠️  No tasks found, waiting 10 more seconds...');
      await sleep(10000);
      allTasks = await getClioTasks(TEST_MATTER_ID);
    }

    console.log('\nAll Tasks:');
    allTasks.forEach((task, idx) => {
      console.log(`   ${idx + 1}. ${task.name} (ID: ${task.id}) - Due: ${task.due_at || 'TBD'}`);
    });

    // Find the task we're looking for (should NOT exist initially)
    const targetTask = allTasks.find(t => t.name.includes(taskToFind));

    if (targetTask) {
      console.log(`\n⚠️  WARNING: "${taskToFind}" already exists! This shouldn't happen.`);
      console.log(`   Task ID: ${targetTask.id}`);
      console.log(`   Due Date: ${targetTask.due_at || 'None'}`);
      return { success: false, error: 'Task exists before prerequisite completion' };
    }

    console.log(`\n✅ Confirmed: "${taskToFind}" does NOT exist yet (expected)`);

    // Find "Attempt 1" task (or first task with "Attempt")
    const attempt1Task = allTasks.find(t =>
      t.name.toLowerCase().includes('attempt 1') ||
      t.name.toLowerCase().includes('attempt')
    );

    if (!attempt1Task) {
      console.log('\n❌ Could not find Attempt 1 task');
      return { success: false, error: 'Could not find Attempt 1 task' };
    }

    console.log(`\n📍 Found Attempt 1 Task: "${attempt1Task.name}" (ID: ${attempt1Task.id})`);

    // Complete Attempt 1
    console.log('\n✓ Completing Attempt 1 task...');
    await completeTask(attempt1Task.id);
    console.log('✅ Task marked as complete');

    // Wait for Attempt 2 to be created
    console.log('⏳ Waiting 15 seconds for Attempt 2 creation...');
    await sleep(15000);

    let updatedTasks = await getClioTasks(TEST_MATTER_ID);
    const attempt2Task = updatedTasks.find(t =>
      t.name.toLowerCase().includes('attempt 2') &&
      !t.name.toLowerCase().includes('attempt 1')
    );

    if (!attempt2Task) {
      console.log('\n❌ Attempt 2 was not created after completing Attempt 1');
      return { success: false, error: 'Attempt 2 not created' };
    }

    console.log(`\n✅ Attempt 2 created: "${attempt2Task.name}" (ID: ${attempt2Task.id})`);

    // Complete Attempt 2
    console.log('\n✓ Completing Attempt 2 task...');
    await completeTask(attempt2Task.id);
    console.log('✅ Task marked as complete');

    // Wait for Attempt 3 to be created
    console.log('⏳ Waiting 15 seconds for Attempt 3 creation...');
    await sleep(15000);

    updatedTasks = await getClioTasks(TEST_MATTER_ID);
    const attempt3Task = updatedTasks.find(t =>
      t.name.toLowerCase().includes('attempt 3') &&
      !t.name.toLowerCase().includes('attempt 1') &&
      !t.name.toLowerCase().includes('attempt 2')
    );

    if (!attempt3Task) {
      console.log('\n❌ Attempt 3 was not created after completing Attempt 2');
      return { success: false, error: 'Attempt 3 not created' };
    }

    console.log(`\n✅ Attempt 3 created: "${attempt3Task.name}" (ID: ${attempt3Task.id})`);

    // Check if "No Response" exists before completing Attempt 3
    updatedTasks = await getClioTasks(TEST_MATTER_ID);
    const noResponseBefore = updatedTasks.find(t => t.name.includes(taskToFind));

    console.log(`\n📋 Before completing Attempt 3:`);
    console.log(`   "${taskToFind}" exists: ${noResponseBefore ? 'YES' : 'NO'}`);
    if (noResponseBefore) {
      console.log(`   Due Date: ${noResponseBefore.due_at || 'None'}`);
    }

    // Complete Attempt 3
    console.log(`\n✓ Completing Attempt 3 task (ID: ${attempt3Task.id})...`);
    await completeTask(attempt3Task.id);
    console.log('✅ Task marked as complete');

    // Wait for "No Response" to get due date
    console.log(`\n⏳ Waiting 15 seconds for "${taskToFind}" due date generation...`);
    await sleep(15000);

    // Check if "No Response" now has a due date
    updatedTasks = await getClioTasks(TEST_MATTER_ID);
    const noResponseAfter = updatedTasks.find(t => t.name.includes(taskToFind));

    console.log(`\n📋 After completing Attempt 3:`);
    console.log(`   "${taskToFind}" exists: ${noResponseAfter ? 'YES' : 'NO'}`);

    if (noResponseAfter) {
      console.log(`   Task ID: ${noResponseAfter.id}`);
      console.log(`   Due Date Before: ${noResponseBefore?.due_at || 'None'}`);
      console.log(`   Due Date After: ${noResponseAfter.due_at || 'None'}`);

      if (noResponseAfter.due_at && !noResponseBefore?.due_at) {
        console.log('\n✅ SUCCESS: Due date was generated!');
        return { success: true, taskId: noResponseAfter.id, dueDate: noResponseAfter.due_at };
      } else if (!noResponseAfter.due_at) {
        console.log('\n❌ FAILURE: Due date was NOT generated');
        return { success: false, error: 'Due date not generated', taskId: noResponseAfter.id };
      }
    } else {
      console.log(`\n❌ FAILURE: "${taskToFind}" task was not found after completion`);
      return { success: false, error: 'Task not found after prerequisite completion' };
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    // Cleanup
    console.log(`\n${'─'.repeat(80)}`);
    console.log('🗑️  Cleaning up...');
    const deleted = await deleteAllTasks(TEST_MATTER_ID);
    console.log(`✅ Deleted ${deleted} tasks from Clio`);
    await deleteSupabaseRecords(TEST_MATTER_ID);
    console.log('✅ Deleted Supabase records');
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  NO RESPONSE TASK - DUE DATE GENERATION TEST');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Test Matter ID: ${TEST_MATTER_ID}`);
  console.log(`Start Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results = [];

  // Test stage 1
  const result1 = await testStage(833223, 'Cancelled/No Show IV Meeting', 'No Response');
  results.push({ stage_id: 833223, stage_name: 'Cancelled/No Show IV Meeting', ...result1 });

  console.log('\n⏳ Waiting 3 seconds before next stage...\n');
  await sleep(3000);

  // Test stage 2
  const result2 = await testStage(848343, 'Cancelled/No Show Signing', 'No Response');
  results.push({ stage_id: 848343, stage_name: 'Cancelled/No Show Signing', ...result2 });

  // Summary
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  results.forEach(r => {
    console.log(`\n${r.stage_name} (${r.stage_id}):`);
    console.log(`  Result: ${r.success ? '✅ PASS' : '❌ FAIL'}`);
    if (r.error) console.log(`  Error: ${r.error}`);
    if (r.dueDate) console.log(`  Due Date Generated: ${r.dueDate}`);
  });
  console.log('\n═══════════════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);
}

runTests()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
