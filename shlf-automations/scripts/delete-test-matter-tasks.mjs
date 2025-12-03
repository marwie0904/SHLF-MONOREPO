#!/usr/bin/env node

/**
 * Delete ALL tasks from test matter 1675950832
 * 
 * SAFETY: This script ONLY works for matter ID 1675950832
 * Any other matter ID will be rejected
 */

import { clioAPI } from '../tests/utils/clio-api.js';
import { sleep } from '../tests/test-config.js';

const TEST_MATTER_ID = 1675950832;
const CONFIRM_MATTER_ID = process.argv[2];

// SAFETY CHECK #1: Require matter ID as argument
if (!CONFIRM_MATTER_ID) {
  console.error('❌ SAFETY: You must provide the matter ID to confirm deletion');
  console.error('Usage: node delete-test-matter-tasks.mjs 1675950832');
  process.exit(1);
}

// SAFETY CHECK #2: Must match test matter ID exactly
if (CONFIRM_MATTER_ID !== TEST_MATTER_ID.toString()) {
  console.error(`❌ SAFETY: Can only delete tasks from test matter ${TEST_MATTER_ID}`);
  console.error(`   You provided: ${CONFIRM_MATTER_ID}`);
  process.exit(1);
}

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║  DELETE ALL TASKS FROM TEST MATTER                     ║');
console.log('╚════════════════════════════════════════════════════════╝\n');
console.log(`Matter ID: ${TEST_MATTER_ID}`);
console.log('');

try {
  // Get all tasks for this matter
  // SAFETY: getTasksForMatter() filters by matter_id, so all returned tasks belong to TEST_MATTER_ID
  console.log('🔍 Fetching all tasks...');
  const tasks = await clioAPI.getTasksForMatter(TEST_MATTER_ID);
  
  console.log(`📊 Found ${tasks.length} tasks to delete`);
  console.log('🔒 Safety: All tasks pre-filtered by Clio API for matter ' + TEST_MATTER_ID + '\n');
  
  if (tasks.length === 0) {
    console.log('✅ No tasks to delete. Matter is already clean.');
    process.exit(0);
  }
  
  // Delete tasks in batches
  console.log('🗑️  Starting deletion...\n');
  
  let deleted = 0;
  let failed = 0;
  
  for (const task of tasks) {
    try {
      await clioAPI.deleteTask(task.id);
      deleted++;
      
      if (deleted % 10 === 0) {
        console.log(`   Deleted ${deleted}/${tasks.length} tasks...`);
      }
      
      // Rate limiting: wait 100ms between deletions
      await sleep(100);
      
    } catch (error) {
      console.error(`   Failed to delete task ${task.id}: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  DELETION COMPLETE                                     ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  console.log(`✅ Successfully deleted: ${deleted} tasks`);
  if (failed > 0) {
    console.log(`❌ Failed to delete: ${failed} tasks`);
  }
  console.log('');
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
}
