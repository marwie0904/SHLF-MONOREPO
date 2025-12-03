#!/usr/bin/env node

/**
 * Test ONE Stage at a Time
 *
 * Usage: node test-one-stage.mjs <stage_id>
 * Example: node test-one-stage.mjs 707058
 */

import { clioAPI } from './tests/utils/clio-api.js';
import { webhookGenerator } from './tests/utils/webhook-generator.js';
import { supabaseAPI } from './tests/utils/state-capture.js';
import { TestCleanup } from './tests/utils/test-cleanup.js';
import { TEST_CONFIG, sleep, log, logError, logSuccess } from './tests/test-config.js';

const MATTER_ID = TEST_CONFIG.MATTER_ID;
const stageId = process.argv[2];

if (!stageId) {
  console.error('Usage: node test-one-stage.mjs <stage_id>');
  console.error('Example: node test-one-stage.mjs 707058');
  process.exit(1);
}

async function testOneStage(stageId) {
  console.log('\n' + '='.repeat(80));
  console.log(`Testing Stage: ${stageId} on Matter: ${MATTER_ID}`);
  console.log('='.repeat(80) + '\n');

  try {
    // Step 1: Cleanup
    log('Step 1: Cleaning test environment...');
    await TestCleanup.cleanAll(MATTER_ID);
    await sleep(2000);

    // Step 2: Change stage
    log(`Step 2: Changing matter to stage ${stageId}...`);
    const updatedMatter = await clioAPI.changeMatterStage(MATTER_ID, stageId);
    logSuccess(`Matter stage updated to: ${updatedMatter.matter_stage?.name || 'Unknown'}`);

    await clioAPI.delayBetweenCalls();

    // Step 3: Send webhook
    log('Step 3: Sending webhook to Digital Ocean...');
    const webhookEvent = await webhookGenerator.sendAndWaitForMatterWebhook(updatedMatter);

    // Step 4: Check results
    log('\nStep 4: Checking results...');

    if (webhookEvent.success === true) {
      logSuccess(`✅ Webhook processed successfully!`);
      log(`   Action: ${webhookEvent.action}`);

      // Check tasks
      await sleep(2000);
      const tasks = await supabaseAPI.getTasksForMatter(MATTER_ID);
      logSuccess(`✅ ${tasks.length} tasks created`);

      if (tasks.length > 0) {
        log('\nTasks Created:');
        tasks.forEach((task, i) => {
          log(`  ${i + 1}. ${task.task_name}`);
          log(`     - Due Date: ${task.due_date || 'N/A'}`);
          log(`     - Task ID: ${task.task_id}`);
        });
      }

      // Check for errors
      const errors = await supabaseAPI.getErrorLogs(MATTER_ID, 5);
      if (errors.length > 0) {
        log('\n⚠️  Recent Errors:');
        errors.forEach((err, i) => {
          log(`  ${i + 1}. [${err.error_code}] ${err.error_message}`);
        });
      } else {
        logSuccess('✅ No errors logged');
      }

      console.log('\n' + '='.repeat(80));
      logSuccess('TEST PASSED ✅');
      console.log('='.repeat(80) + '\n');

    } else {
      logError(`❌ Webhook processing failed!`);
      log(`   Action: ${webhookEvent.action}`);
      log(`   Success: ${webhookEvent.success}`);

      // Check error logs
      await sleep(1000);
      const errors = await supabaseAPI.getErrorLogs(MATTER_ID, 5);
      if (errors.length > 0) {
        log('\nError Logs:');
        errors.forEach((err, i) => {
          logError(`  ${i + 1}. [${err.error_code}] ${err.error_message}`);
        });
      }

      console.log('\n' + '='.repeat(80));
      logError('TEST FAILED ❌');
      console.log('='.repeat(80) + '\n');
    }

    // Cleanup
    log('\nCleaning up...');
    await TestCleanup.cleanAll(MATTER_ID);

  } catch (error) {
    logError(`\n❌ TEST EXCEPTION: ${error.message}`);
    console.log('\n' + '='.repeat(80));
    logError('TEST FAILED ❌');
    console.log('='.repeat(80) + '\n');

    // Cleanup even on error
    try {
      await TestCleanup.cleanAll(MATTER_ID);
    } catch (cleanupError) {
      logError(`Cleanup failed: ${cleanupError.message}`);
    }
  }
}

// Run test
testOneStage(stageId);
