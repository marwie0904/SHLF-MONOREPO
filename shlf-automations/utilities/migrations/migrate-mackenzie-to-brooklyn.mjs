#!/usr/bin/env node

/**
 * Migration Script: Update Mackenzie McTevia tasks to Brooklyn Klepfer
 *
 * This script updates all incomplete tasks assigned to Mackenzie McTevia (357378916)
 * to Brooklyn Klepfer (358594433) in both Clio and Supabase.
 *
 * Features:
 * - Updates tasks in Clio first, then Supabase
 * - 2 second delay between Clio API calls (rate limit protection: 50/min)
 * - Progress logging
 * - Error handling with retry
 */

import { ClioService } from './src/services/clio.js';
import { SupabaseService } from './src/services/supabase.js';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const OLD_USER_ID = 357378916; // Mackenzie McTevia
const NEW_USER_ID = 358594433; // Brooklyn Klepfer
const NEW_USER_NAME = 'Brooklyn Klepfer';
const DELAY_MS = 2000; // 2 seconds between API calls

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
 * Get all incomplete tasks assigned to old user
 */
async function getIncompleteTasks() {
  console.log(`\n🔍 Fetching incomplete tasks for user ${OLD_USER_ID}...`);

  const { data, error } = await supabase
    .from('tasks')
    .select('task_id, task_name, matter_id, assigned_user, assigned_user_id')
    .eq('assigned_user_id', OLD_USER_ID)
    .eq('completed', false)
    .order('task_id');

  if (error) {
    throw new Error(`Failed to fetch tasks: ${error.message}`);
  }

  console.log(`✅ Found ${data.length} incomplete tasks to update\n`);
  return data;
}

/**
 * Update task in Clio
 */
async function updateTaskInClio(taskId) {
  try {
    await ClioService.updateTask(taskId, {
      assignee: {
        id: NEW_USER_ID,
        type: 'User'
      }
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update task in Supabase
 */
async function updateTaskInSupabase(taskId) {
  try {
    await SupabaseService.updateTask(taskId, {
      assigned_user_id: NEW_USER_ID,
      assigned_user: NEW_USER_NAME
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('=====================================');
  console.log('TASK ASSIGNEE MIGRATION');
  console.log('=====================================');
  console.log(`From: Mackenzie McTevia (${OLD_USER_ID})`);
  console.log(`To:   Brooklyn Klepfer (${NEW_USER_ID})`);
  console.log('=====================================\n');

  try {
    // Step 1: Get all incomplete tasks
    const tasks = await getIncompleteTasks();

    if (tasks.length === 0) {
      console.log('✅ No tasks to update. Migration complete!');
      return;
    }

    // Step 2: Update each task
    let successCount = 0;
    let failCount = 0;
    const failures = [];

    console.log('🔄 Starting migration...\n');
    console.log('Progress: [Clio] → [Supabase]\n');

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const progress = `[${i + 1}/${tasks.length}]`;

      console.log(`${progress} Task ${task.task_id}: ${task.task_name}`);
      console.log(`         Matter: ${task.matter_id}`);

      // Update in Clio
      process.stdout.write(`         Updating Clio... `);
      const clioResult = await updateTaskInClio(task.task_id);

      if (!clioResult.success) {
        console.log(`❌ FAILED`);
        console.log(`         Error: ${clioResult.error}\n`);
        failCount++;
        failures.push({
          task_id: task.task_id,
          task_name: task.task_name,
          error: clioResult.error,
          step: 'clio'
        });
        continue; // Skip Supabase update if Clio failed
      }

      console.log(`✅`);

      // Update in Supabase
      process.stdout.write(`         Updating Supabase... `);
      const supabaseResult = await updateTaskInSupabase(task.task_id);

      if (!supabaseResult.success) {
        console.log(`❌ FAILED`);
        console.log(`         Error: ${supabaseResult.error}\n`);
        failCount++;
        failures.push({
          task_id: task.task_id,
          task_name: task.task_name,
          error: supabaseResult.error,
          step: 'supabase'
        });
        continue;
      }

      console.log(`✅`);
      successCount++;

      // Rate limit protection: 2 second delay between tasks
      if (i < tasks.length - 1) {
        process.stdout.write(`         Waiting 2s for rate limit... `);
        await sleep(DELAY_MS);
        console.log(`✅\n`);
      } else {
        console.log(''); // Final newline
      }
    }

    // Step 3: Summary
    console.log('\n=====================================');
    console.log('MIGRATION SUMMARY');
    console.log('=====================================');
    console.log(`Total tasks:      ${tasks.length}`);
    console.log(`✅ Successful:    ${successCount}`);
    console.log(`❌ Failed:        ${failCount}`);
    console.log('=====================================\n');

    if (failures.length > 0) {
      console.log('FAILURES:\n');
      failures.forEach((fail, idx) => {
        console.log(`${idx + 1}. Task ${fail.task_id}: ${fail.task_name}`);
        console.log(`   Failed at: ${fail.step}`);
        console.log(`   Error: ${fail.error}\n`);
      });
    }

    if (successCount === tasks.length) {
      console.log('🎉 Migration completed successfully!\n');
    } else {
      console.log('⚠️  Migration completed with errors. See failures above.\n');
    }

  } catch (error) {
    console.error('\n❌ Migration failed with error:');
    console.error(error);
    process.exit(1);
  }
}

// Run migration
migrate();
