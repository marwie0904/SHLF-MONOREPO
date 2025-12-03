#!/usr/bin/env node

import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL;
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;
const TEST_MATTER_ID = 1675950832;
const PRODUCTION_WEBHOOK_URL = 'https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/matters';

const supabaseHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

const clioHeaders = {
  'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
};

// Stages to test
const STAGES_TO_TEST = [
  { stage_id: 828768, stage_name: "Drafting" },
  { stage_id: 828783, stage_name: "Pending Engagement" },
  { stage_id: 986242, stage_name: "Cancelled/No Show Design" },
  { stage_id: 1053877, stage_name: "New D/S Meeting Booked / Drafting Parked" }
];

async function triggerWebhook(stageId, stageName) {
  const webhookPayload = {
    id: "webhook-test-" + Date.now(),
    type: "matter.updated",
    data: {
      id: TEST_MATTER_ID,
      matter_stage: {
        id: stageId,
        name: stageName
      },
      matter_stage_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  };

  const response = await axios.post(PRODUCTION_WEBHOOK_URL, webhookPayload, {
    headers: { 'Content-Type': 'application/json' }
  });

  return response.data;
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

async function testStageComprehensive(stageId, stageName) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`Testing: ${stageName} (ID: ${stageId})`);
  console.log(`${'═'.repeat(80)}\n`);

  const result = {
    stage_id: stageId,
    stage_name: stageName,
    initial_tasks: [],
    task_chain: [],
    success: true,
    error: null
  };

  try {
    // Trigger webhook
    console.log(`🚀 Triggering webhook for stage ${stageId}...`);
    const webhookResponse = await triggerWebhook(stageId, stageName);
    console.log(`✅ Webhook response:`, webhookResponse);

    // Wait for processing
    console.log('⏳ Waiting 10 seconds for webhook processing...');
    await sleep(10000);

    // Get initial tasks
    let allTasks = await getClioTasks(TEST_MATTER_ID);
    console.log(`\n📋 Initial tasks created: ${allTasks.length}`);

    if (allTasks.length === 0) {
      console.log('⚠️  No tasks found');
      result.error = 'No tasks created';
      result.success = false;
      return result;
    }

    allTasks.forEach((task, idx) => {
      const dueDate = task.due_at || 'TBD';
      console.log(`   ${idx + 1}. ${task.name} (ID: ${task.id}) - Due: ${dueDate}`);
      result.initial_tasks.push({
        task_id: task.id,
        task_name: task.name,
        due_at: task.due_at
      });
    });

    // Find tasks with "Attempt" in the name
    const attemptTasks = allTasks.filter(t =>
      t.name.toLowerCase().includes('attempt') ||
      t.name.toLowerCase().includes('follow up')
    ).sort((a, b) => {
      const aNum = a.name.match(/\d+/)?.[0] || '0';
      const bNum = b.name.match(/\d+/)?.[0] || '0';
      return parseInt(aNum) - parseInt(bNum);
    });

    if (attemptTasks.length === 0) {
      console.log('\n⚠️  No Attempt tasks found to test completion chain');
      result.error = 'No Attempt tasks found';
      result.success = false;
      return result;
    }

    console.log(`\n🔗 Found ${attemptTasks.length} Attempt task(s) to process`);

    // Process each attempt task in sequence
    for (let i = 0; i < attemptTasks.length; i++) {
      const currentTask = attemptTasks[i];
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`Step ${i + 1}: Processing "${currentTask.name}" (ID: ${currentTask.id})`);
      console.log(`${'─'.repeat(80)}`);

      const beforeTasks = await getClioTasks(TEST_MATTER_ID);
      console.log(`Tasks before completion: ${beforeTasks.length}`);

      // Complete the task
      console.log(`\n✓ Completing task ${currentTask.id}...`);
      await completeTask(currentTask.id);
      console.log('✅ Task marked as complete');

      // Wait for next task to be created and get due date
      console.log('⏳ Waiting 15 seconds for next task creation/due date update...');
      await sleep(15000);

      const afterTasks = await getClioTasks(TEST_MATTER_ID);
      console.log(`\nTasks after completion: ${afterTasks.length}`);

      // Check what changed
      const newTasks = afterTasks.filter(t =>
        !beforeTasks.some(bt => bt.id === t.id)
      );

      const updatedTasks = afterTasks.filter(t => {
        const before = beforeTasks.find(bt => bt.id === t.id);
        return before && before.due_at !== t.due_at;
      });

      if (newTasks.length > 0) {
        console.log(`\n✅ New tasks created: ${newTasks.length}`);
        newTasks.forEach(nt => {
          console.log(`   • ${nt.name} (ID: ${nt.id}) - Due: ${nt.due_at || 'TBD'}`);
        });
      }

      if (updatedTasks.length > 0) {
        console.log(`\n✅ Tasks with updated due dates: ${updatedTasks.length}`);
        updatedTasks.forEach(ut => {
          const before = beforeTasks.find(bt => bt.id === ut.id);
          console.log(`   • ${ut.name} (ID: ${ut.id})`);
          console.log(`     Before: ${before.due_at || 'None'} → After: ${ut.due_at || 'None'}`);
        });
      }

      result.task_chain.push({
        completed_task: currentTask.name,
        completed_task_id: currentTask.id,
        new_tasks_created: newTasks.map(t => ({ id: t.id, name: t.name, due_at: t.due_at })),
        tasks_updated: updatedTasks.map(t => ({
          id: t.id,
          name: t.name,
          due_at_before: beforeTasks.find(bt => bt.id === t.id)?.due_at,
          due_at_after: t.due_at
        }))
      });

      if (newTasks.length === 0 && updatedTasks.length === 0) {
        console.log('\n⚠️  No new tasks created or due dates updated');
      }
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    result.error = error.message;
    result.success = false;
  } finally {
    // Cleanup
    console.log(`\n${'─'.repeat(80)}`);
    console.log('🗑️  Cleaning up...');
    const deleted = await deleteAllTasks(TEST_MATTER_ID);
    console.log(`✅ Deleted ${deleted} tasks from Clio`);
    await deleteSupabaseRecords(TEST_MATTER_ID);
    console.log('✅ Deleted Supabase records');
  }

  return result;
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  COMPREHENSIVE TASK COMPLETION TEST - REMAINING STAGES');
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
    const stage = STAGES_TO_TEST[i];
    const result = await testStageComprehensive(stage.stage_id, stage.stage_name);
    report.results.push(result);

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
    total_task_completions: report.results.reduce((sum, r) => sum + r.task_chain.length, 0)
  };

  // Save report
  const reportPath = join(__dirname, '..', 'tests', 'reports', `task-completion-remaining-${Date.now()}.json`);
  await fs.mkdir(join(__dirname, '..', 'tests', 'reports'), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  // Print summary
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total Stages Tested: ${report.summary.total_stages}`);
  console.log(`Stages Passed: ${report.summary.stages_passed} ✅`);
  console.log(`Stages Failed: ${report.summary.stages_failed} ❌`);
  console.log(`Total Task Completions: ${report.summary.total_task_completions}`);

  console.log('\n\nResults by Stage:');
  report.results.forEach((r, idx) => {
    console.log(`\n${idx + 1}. ${r.stage_name} (${r.stage_id}):`);
    console.log(`   Result: ${r.success ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Initial Tasks: ${r.initial_tasks.length}`);
    console.log(`   Task Chain Steps: ${r.task_chain.length}`);
    if (r.error) console.log(`   Error: ${r.error}`);
  });

  console.log(`\n\nReport saved to: ${reportPath}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  return report;
}

runTests()
  .then(() => {
    console.log('✅ All tests complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
