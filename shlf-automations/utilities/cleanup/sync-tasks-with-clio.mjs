import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Fetch fresh access token from Supabase
const { data: tokenData } = await supabase
  .from('clio_tokens')
  .select('access_token')
  .eq('id', 1)
  .single();

if (!tokenData || !tokenData.access_token) {
  console.error('❌ Failed to fetch access token from Supabase');
  process.exit(1);
}

// Initialize Clio API client with fresh token
const clioClient = axios.create({
  baseURL: process.env.CLIO_API_BASE_URL,
  headers: {
    'Authorization': `Bearer ${tokenData.access_token}`,
    'Content-Type': 'application/json',
  },
});

// Rate limiting: 30 requests per minute = 1 request every 2 seconds
const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch task status from Clio
 * Returns { exists: boolean, status: string | null }
 */
async function getClioTaskStatus(taskId) {
  try {
    const response = await clioClient.get(`/api/v4/tasks/${taskId}`, {
      params: {
        fields: 'id,status',
      },
    });

    return {
      exists: true,
      status: response.data.data.status,
    };
  } catch (error) {
    // Check if task doesn't exist (404)
    if (error.response?.status === 404 || error.message?.includes('404')) {
      return {
        exists: false,
        status: null,
      };
    }

    // For other errors, throw to handle retries
    throw error;
  }
}

/**
 * Get all tasks from Supabase generated in the last 30 days
 */
async function getRecentSupabaseTasks() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Fetch all tasks (Supabase defaults to 1000 row limit, so we need to paginate)
  let allTasks = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('tasks')
      .select('task_id, status')
      .gte('task_date_generated', thirtyDaysAgo.toISOString())
      .order('task_date_generated', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      throw new Error(`Failed to fetch Supabase tasks: ${error.message}`);
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allTasks = allTasks.concat(data);
      hasMore = data.length === pageSize;
      page++;
    }
  }

  return allTasks;
}

/**
 * Delete task from Supabase
 */
async function deleteSupabaseTask(taskId) {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('task_id', taskId);

  if (error) {
    throw new Error(`Failed to delete task ${taskId}: ${error.message}`);
  }
}

/**
 * Update task status in Supabase
 */
async function updateSupabaseTaskStatus(taskId, status) {
  // Map Clio status values to Supabase status values
  const statusMap = {
    'complete': 'completed',
    'pending': 'pending',
    'deleted': 'deleted',
  };

  const mappedStatus = statusMap[status] || status;

  const { error } = await supabase
    .from('tasks')
    .update({ status: mappedStatus })
    .eq('task_id', taskId);

  if (error) {
    throw new Error(`Failed to update task ${taskId}: ${error.message}`);
  }
}

/**
 * Main sync function
 */
async function syncTasksWithClio() {
  console.log('🔄 Starting Clio-Supabase task sync...\n');
  console.log('📋 Fetching tasks from the last 30 days...');

  const supabaseTasks = await getRecentSupabaseTasks();
  console.log(`✅ Found ${supabaseTasks.length} tasks to verify\n`);

  const stats = {
    total: supabaseTasks.length,
    deleted: 0,
    updated: 0,
    matched: 0,
    errors: 0,
  };

  for (let i = 0; i < supabaseTasks.length; i++) {
    const task = supabaseTasks[i];
    const progress = `[${i + 1}/${supabaseTasks.length}]`;

    try {
      console.log(`${progress} Checking task ${task.task_id}...`);

      // Fetch status from Clio
      const clioTask = await getClioTaskStatus(task.task_id);

      // Case 1: Task doesn't exist in Clio (404)
      if (!clioTask.exists) {
        console.log(`  ❌ Task not found in Clio - DELETING from Supabase`);
        await deleteSupabaseTask(task.task_id);
        stats.deleted++;
      }
      // Case 2: Status mismatch
      else if (task.status !== clioTask.status) {
        console.log(`  🔄 Status mismatch: Supabase="${task.status}" → Clio="${clioTask.status}" - UPDATING`);
        await updateSupabaseTaskStatus(task.task_id, clioTask.status);
        stats.updated++;
      }
      // Case 3: Already in sync
      else {
        console.log(`  ✅ Status matches: "${task.status}"`);
        stats.matched++;
      }

    } catch (error) {
      console.error(`  ⚠️  ERROR: ${error.message}`);
      stats.errors++;
    }

    // Rate limiting delay (except for last item)
    if (i < supabaseTasks.length - 1) {
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 SYNC SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total tasks checked:    ${stats.total}`);
  console.log(`✅ Already in sync:     ${stats.matched}`);
  console.log(`🔄 Updated:             ${stats.updated}`);
  console.log(`❌ Deleted:             ${stats.deleted}`);
  console.log(`⚠️  Errors:              ${stats.errors}`);
  console.log('='.repeat(50));
}

// Run the sync
syncTasksWithClio()
  .then(() => {
    console.log('\n✅ Sync completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Sync failed:', error.message);
    process.exit(1);
  });
