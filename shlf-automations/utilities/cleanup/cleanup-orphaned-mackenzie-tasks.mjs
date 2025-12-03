#!/usr/bin/env node

/**
 * Cleanup Script: Remove orphaned Mackenzie McTevia tasks from Supabase
 *
 * This script deletes tasks from Supabase that no longer exist in Clio (404 errors).
 * These are old test data and archived matters that have been cleaned up in Clio.
 *
 * Only deletes tasks assigned to old Mackenzie ID (357378916)
 */

import { createClient } from '@supabase/supabase-js';
import { ClioService } from './src/services/clio.js';
import 'dotenv/config';

const OLD_USER_ID = 357378916; // Mackenzie McTevia

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get all tasks assigned to old user
 */
async function getTasks() {
  console.log(`\n🔍 Fetching tasks for user ${OLD_USER_ID}...`);

  const { data, error } = await supabase
    .from('tasks')
    .select('task_id, task_name, matter_id, completed')
    .eq('assigned_user_id', OLD_USER_ID)
    .order('task_id');

  if (error) {
    throw new Error(`Failed to fetch tasks: ${error.message}`);
  }

  console.log(`✅ Found ${data.length} tasks to check\n`);
  return data;
}

/**
 * Check if task exists in Clio
 */
async function taskExistsInClio(taskId) {
  try {
    await ClioService.getTask(taskId);
    return true; // Task exists
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return false; // Task doesn't exist (orphaned)
    }
    throw error; // Other error - rethrow
  }
}

/**
 * Delete task from Supabase
 */
async function deleteTaskFromSupabase(taskId) {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('task_id', taskId);

  if (error) {
    throw new Error(`Failed to delete task ${taskId}: ${error.message}`);
  }
}

/**
 * Main cleanup function
 */
async function cleanup() {
  console.log('=====================================');
  console.log('ORPHANED TASKS CLEANUP');
  console.log('=====================================');
  console.log(`User: Mackenzie McTevia (${OLD_USER_ID})`);
  console.log('Action: Delete tasks that no longer exist in Clio');
  console.log('=====================================\n');

  try {
    // Step 1: Get all tasks
    const tasks = await getTasks();

    if (tasks.length === 0) {
      console.log('✅ No tasks to clean up!');
      return;
    }

    // Step 2: Check each task in Clio
    let orphanedCount = 0;
    let existsCount = 0;
    let errorCount = 0;
    const orphanedTasks = [];

    console.log('🔄 Checking tasks in Clio...\n');

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const progress = `[${i + 1}/${tasks.length}]`;

      process.stdout.write(`${progress} Checking task ${task.task_id}... `);

      try {
        const exists = await taskExistsInClio(task.task_id);

        if (exists) {
          console.log(`✅ EXISTS in Clio`);
          existsCount++;
        } else {
          console.log(`❌ ORPHANED (404 in Clio)`);
          orphanedTasks.push(task);
          orphanedCount++;
        }

        // Rate limit: 1 second between checks
        if (i < tasks.length - 1) {
          await sleep(1000);
        }
      } catch (error) {
        console.log(`⚠️  ERROR: ${error.message}`);
        errorCount++;
      }
    }

    console.log('\n=====================================');
    console.log('CHECK SUMMARY');
    console.log('=====================================');
    console.log(`Total tasks:      ${tasks.length}`);
    console.log(`✅ Exists in Clio: ${existsCount}`);
    console.log(`❌ Orphaned:       ${orphanedCount}`);
    console.log(`⚠️  Errors:        ${errorCount}`);
    console.log('=====================================\n');

    if (orphanedTasks.length === 0) {
      console.log('✅ No orphaned tasks to delete!\n');
      return;
    }

    // Step 3: Delete orphaned tasks
    console.log(`🗑️  Deleting ${orphanedTasks.length} orphaned tasks from Supabase...\n`);

    let deletedCount = 0;
    let deleteErrors = 0;

    for (let i = 0; i < orphanedTasks.length; i++) {
      const task = orphanedTasks[i];
      const progress = `[${i + 1}/${orphanedTasks.length}]`;

      process.stdout.write(`${progress} Deleting task ${task.task_id}... `);

      try {
        await deleteTaskFromSupabase(task.task_id);
        console.log(`✅ DELETED`);
        deletedCount++;
      } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        deleteErrors++;
      }
    }

    console.log('\n=====================================');
    console.log('CLEANUP SUMMARY');
    console.log('=====================================');
    console.log(`Orphaned tasks:   ${orphanedTasks.length}`);
    console.log(`✅ Deleted:       ${deletedCount}`);
    console.log(`❌ Failed:        ${deleteErrors}`);
    console.log('=====================================\n');

    if (deletedCount === orphanedTasks.length) {
      console.log('🎉 Cleanup completed successfully!\n');
    } else {
      console.log('⚠️  Cleanup completed with errors.\n');
    }

  } catch (error) {
    console.error('\n❌ Cleanup failed with error:');
    console.error(error);
    process.exit(1);
  }
}

// Run cleanup
cleanup();
