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

// Test Matter ID (from matter-stage-change.js)
const TEST_MATTER_ID = 1675950832;

// Test configurations - run 3 times with different location/attorney combos
const TEST_CONFIGS = [
  {
    name: 'SHLF Naples',
    location_id: 351530396, // SHLF Naples
    attorney_id: 357380836
  },
  {
    name: 'SHLF Fort Myers',
    location_id: 346993996, // SHLF Fort Myers
    attorney_id: 357292201
  },
  {
    name: 'SHLF Bonita Springs',
    location_id: 351530397, // SHLF Bonita Springs
    attorney_id: 357520756
  }
];

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

// Helper: Update matter configuration (location and attorney)
async function updateMatterConfig(matterId, locationId, attorneyId) {
  console.log(`\n🔧 Updating matter configuration...`);
  console.log(`   Location ID: ${locationId}`);
  console.log(`   Attorney ID: ${attorneyId}`);

  const response = await axios.patch(
    `${CLIO_API_BASE_URL}/api/v4/matters/${matterId}`,
    {
      data: {
        location: { id: locationId },
        originating_attorney: { id: attorneyId }
      }
    },
    { headers: clioHeaders }
  );

  return response.data.data;
}

// Helper: Update matter stage
async function updateMatterStage(matterId, stageId) {
  console.log(`\n🔄 Updating matter ${matterId} to stage ${stageId}...`);

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
        fields: 'id,name,due_at,assignee,status'
      },
      headers: clioHeaders
    }
  );

  return response.data.data;
}

// Helper: Delete tasks
async function deleteClioTasks(taskIds) {
  console.log(`🗑️  Deleting ${taskIds.length} tasks...`);

  for (const taskId of taskIds) {
    try {
      await axios.delete(
        `${CLIO_API_BASE_URL}/api/v4/tasks/${taskId}`,
        { headers: clioHeaders }
      );
    } catch (error) {
      console.error(`   ❌ Failed to delete task ${taskId}: ${error.message}`);
    }
  }
}

// Helper: Get all stages from Supabase
async function getAllStages() {
  const stages = new Map();

  // Get stages from task-list-meeting
  const meetingRes = await axios.get(
    `${SUPABASE_URL}/rest/v1/task-list-meeting`,
    {
      params: { select: 'stage_id,stage_name,calendar_event_id,calendar_name' },
      headers: supabaseHeaders
    }
  );

  meetingRes.data.forEach(row => {
    if (!stages.has(row.stage_id)) {
      stages.set(row.stage_id, {
        stage_id: row.stage_id,
        stage_name: row.stage_name,
        type: 'meeting',
        calendar_event_id: row.calendar_event_id,
        calendar_name: row.calendar_name
      });
    }
  });

  // Get stages from task-list-non-meeting
  const nonMeetingRes = await axios.get(
    `${SUPABASE_URL}/rest/v1/task-list-non-meeting`,
    {
      params: { select: 'stage_id,stage_name' },
      headers: supabaseHeaders
    }
  );

  nonMeetingRes.data.forEach(row => {
    if (!stages.has(row.stage_id)) {
      stages.set(row.stage_id, {
        stage_id: row.stage_id,
        stage_name: row.stage_name,
        type: 'non-meeting'
      });
    }
  });

  // Get stages from task-list-probate
  const probateRes = await axios.get(
    `${SUPABASE_URL}/rest/v1/task-list-probate`,
    {
      params: { select: 'stage_id,stage_name' },
      headers: supabaseHeaders
    }
  );

  probateRes.data.forEach(row => {
    if (!stages.has(row.stage_id)) {
      stages.set(row.stage_id, {
        stage_id: row.stage_id,
        stage_name: row.stage_name,
        type: 'probate'
      });
    }
  });

  return Array.from(stages.values()).sort((a, b) => a.stage_id - b.stage_id);
}

// Run validation for a specific configuration
async function runValidationForConfig(config, configIndex, stages) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  RUN ${configIndex + 1}/3: ${config.name}`);
  console.log(`  Location ID: ${config.location_id}`);
  console.log(`  Attorney ID: ${config.attorney_id}`);
  console.log(`${'═'.repeat(80)}\n`);

  // Update matter configuration
  await updateMatterConfig(TEST_MATTER_ID, config.location_id, config.attorney_id);
  console.log('✅ Matter configuration updated');
  console.log('⏳ Waiting 3 seconds for changes to propagate...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  const configResults = [];

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`[${i + 1}/${stages.length}] Testing Stage: ${stage.stage_name} (ID: ${stage.stage_id})`);
    console.log(`Type: ${stage.type}`);
    if (stage.calendar_event_id) {
      console.log(`Calendar Event: ${stage.calendar_name} (ID: ${stage.calendar_event_id})`);
    }
    console.log(`${'─'.repeat(80)}`);

    const stageResult = {
      stage_id: stage.stage_id,
      stage_name: stage.stage_name,
      stage_type: stage.type,
      calendar_event_id: stage.calendar_event_id || null,
      calendar_name: stage.calendar_name || null,
      tasks_generated: [],
      error: null
    };

    try {
      // Step 1: Update matter to this stage
      await updateMatterStage(TEST_MATTER_ID, stage.stage_id);
      console.log('✅ Matter stage updated');

      // Step 2: Wait 5 seconds
      console.log('⏳ Waiting 5 seconds for webhook processing...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Step 3: Retrieve tasks
      let tasks = await getClioTasks(TEST_MATTER_ID);
      console.log(`📥 Retrieved ${tasks.length} tasks`);

      // Step 3.5: If no tasks, wait 10 more seconds and try again
      if (tasks.length === 0) {
        console.log('⏳ No tasks found, waiting 10 more seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        tasks = await getClioTasks(TEST_MATTER_ID);
        console.log(`📥 Retrieved ${tasks.length} tasks (retry)`);
      }

      // Step 4: List out tasks
      if (tasks.length > 0) {
        console.log(`\n📝 Tasks Generated for ${stage.stage_name}:`);
        tasks.forEach((task, idx) => {
          const assignee = task.assignee ? `${task.assignee.name} (${task.assignee.id})` : 'Unassigned';
          const dueDate = task.due_at || 'No due date';
          console.log(`   ${idx + 1}. ${task.name}`);
          console.log(`      • ID: ${task.id}`);
          console.log(`      • Assignee: ${assignee}`);
          console.log(`      • Due: ${dueDate}`);
          console.log(`      • Status: ${task.status || 'none'}`);

          stageResult.tasks_generated.push({
            task_id: task.id,
            task_name: task.name,
            assignee_id: task.assignee?.id || null,
            assignee_name: task.assignee?.name || 'Unassigned',
            due_at: task.due_at || null,
            status: task.status || 'none'
          });
        });
      } else {
        console.log(`\n⚠️  No tasks generated for ${stage.stage_name}`);
      }

      // Step 5: Delete tasks
      if (tasks.length > 0) {
        const taskIds = tasks.map(t => t.id);
        await deleteClioTasks(taskIds);
        console.log(`✅ Deleted ${taskIds.length} tasks`);
      }

    } catch (error) {
      console.error(`\n❌ Error testing stage ${stage.stage_name}:`, error.message);
      stageResult.error = error.message;
    }

    configResults.push(stageResult);

    // Small delay between stages
    console.log('⏳ Waiting 2 seconds before next stage...');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return configResults;
}

// Main test function
async function runValidation() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TASK GENERATION VALIDATION - 3 CONFIGURATION RUNS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Test Matter ID: ${TEST_MATTER_ID}`);
  console.log(`Start Time: ${new Date().toISOString()}`);
  console.log(`Total Configurations: ${TEST_CONFIGS.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const stages = await getAllStages();
  console.log(`📋 Found ${stages.length} stages to test\n`);

  const masterReport = {
    test_matter_id: TEST_MATTER_ID,
    start_time: new Date().toISOString(),
    total_configs: TEST_CONFIGS.length,
    stages_tested: stages.length,
    configurations: []
  };

  // Run validation for each configuration
  for (let i = 0; i < TEST_CONFIGS.length; i++) {
    const config = TEST_CONFIGS[i];
    const results = await runValidationForConfig(config, i, stages);

    const configReport = {
      config_name: config.name,
      location_id: config.location_id,
      attorney_id: config.attorney_id,
      results: results,
      summary: {
        total_stages: stages.length,
        stages_with_tasks: results.filter(r => r.tasks_generated.length > 0).length,
        stages_without_tasks: results.filter(r => r.tasks_generated.length === 0 && !r.error).length,
        stages_with_errors: results.filter(r => r.error).length,
        total_tasks_generated: results.reduce((sum, r) => sum + r.tasks_generated.length, 0)
      }
    };

    masterReport.configurations.push(configReport);

    // Print config summary
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`  RUN ${i + 1}/3 SUMMARY: ${config.name}`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`Stages with Tasks: ${configReport.summary.stages_with_tasks}`);
    console.log(`Stages without Tasks: ${configReport.summary.stages_without_tasks}`);
    console.log(`Stages with Errors: ${configReport.summary.stages_with_errors}`);
    console.log(`Total Tasks Generated: ${configReport.summary.total_tasks_generated}`);
    console.log(`${'═'.repeat(80)}\n`);

    // Wait before next config
    if (i < TEST_CONFIGS.length - 1) {
      console.log('⏳ Waiting 5 seconds before next configuration...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Generate final report
  masterReport.end_time = new Date().toISOString();
  masterReport.overall_summary = {
    total_configs: TEST_CONFIGS.length,
    total_stages_per_config: stages.length,
    total_test_runs: TEST_CONFIGS.length * stages.length,
    configs: TEST_CONFIGS.map((cfg, idx) => ({
      name: cfg.name,
      stages_with_tasks: masterReport.configurations[idx].summary.stages_with_tasks,
      total_tasks: masterReport.configurations[idx].summary.total_tasks_generated
    }))
  };

  // Save report
  const reportPath = join(__dirname, '..', 'tests', 'reports', `task-validation-${Date.now()}.json`);
  await fs.mkdir(join(__dirname, '..', 'tests', 'reports'), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(masterReport, null, 2));

  // Print final summary
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  FINAL VALIDATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total Configurations Tested: ${TEST_CONFIGS.length}`);
  console.log(`Total Stages per Config: ${stages.length}`);
  console.log(`Total Test Runs: ${masterReport.overall_summary.total_test_runs}`);
  console.log('\nResults by Configuration:');
  masterReport.configurations.forEach((cfg, idx) => {
    console.log(`  ${idx + 1}. ${cfg.config_name}:`);
    console.log(`     - Stages with Tasks: ${cfg.summary.stages_with_tasks}`);
    console.log(`     - Total Tasks Generated: ${cfg.summary.total_tasks_generated}`);
  });
  console.log(`\nReport saved to: ${reportPath}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  return masterReport;
}

// Run
runValidation()
  .then(() => {
    console.log('✅ Validation complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  });
