import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

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

// Error tracking
const errorLog = [];

/**
 * Fetch full task details from Clio including assignee
 */
async function getClioTaskFull(taskId) {
  try {
    const response = await clioClient.get(`/api/v4/tasks/${taskId}`, {
      params: {
        fields: 'id,name,status,assignee{id,name}',
      },
    });

    return {
      exists: true,
      task: response.data.data,
    };
  } catch (error) {
    // Check if task doesn't exist (404)
    if (error.response?.status === 404 || error.message?.includes('404')) {
      return {
        exists: false,
        task: null,
      };
    }

    // For other errors, throw to handle retries
    throw error;
  }
}

/**
 * Fetch matter details from Clio
 */
async function getClioMatter(matterId) {
  try {
    const response = await clioClient.get(`/api/v4/matters/${matterId}`, {
      params: {
        fields: 'id,display_number,location,practice_area,originating_attorney{id,name},responsible_attorney{id,name}',
      },
    });

    return response.data.data;
  } catch (error) {
    console.error(`  ⚠️  Failed to fetch matter ${matterId}: ${error.message}`);
    errorLog.push({
      type: 'MATTER_FETCH_FAILED',
      matter_id: matterId,
      error: error.message,
      status: error.response?.status,
    });
    return null;
  }
}

/**
 * Get all tasks from Supabase generated in the last 30 days
 */
async function getRecentSupabaseTasks() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from('tasks')
    .select('task_id, status, assigned_user_id, assigned_user, task_number, stage_id, matter_id, calendar_entry_id')
    .gte('task_date_generated', thirtyDaysAgo.toISOString())
    .order('task_date_generated', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch Supabase tasks: ${error.message}`);
  }

  return data || [];
}

/**
 * Get task template from appropriate table
 */
async function getTaskTemplate(task) {
  // If calendar_entry_id exists, need to first get calendar_event_id
  if (task.calendar_entry_id) {
    // Get calendar event mapping for this stage
    const { data: mapping, error: mappingError } = await supabase
      .from('calendar_event_mappings')
      .select('calendar_event_id')
      .eq('stage_id', task.stage_id.toString())
      .eq('active', true)
      .single();

    if (mappingError || !mapping) {
      console.warn(`  ⚠️  No calendar event mapping found for stage ${task.stage_id}`);
      return null;
    }

    const { data, error } = await supabase
      .from('task-list-meeting')
      .select('*')
      .eq('calendar_event_id', mapping.calendar_event_id)
      .eq('task_number', task.task_number)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.warn(`  ⚠️  Error fetching meeting template: ${error.message}`);
    }

    return data || null;
  }

  // Try task-list-non-meeting first
  let { data, error } = await supabase
    .from('task-list-non-meeting')
    .select('*')
    .eq('stage_id', task.stage_id)
    .eq('task_number', task.task_number)
    .single();

  if (!error && data) return data;

  // Fallback to task-list-probate
  ({ data, error } = await supabase
    .from('task-list-probate')
    .select('*')
    .eq('stage_id', task.stage_id)
    .eq('task_number', task.task_number)
    .single());

  if (error && error.code !== 'PGRST116') {
    console.warn(`  ⚠️  Error fetching probate template: ${error.message}`);
  }

  return data || null;
}

/**
 * Get assignee by location from assigned_user_reference
 */
async function getAssigneeByLocation(location) {
  if (!location) return null;

  // First try exact match
  let { data, error } = await supabase
    .from('assigned_user_reference')
    .select('*')
    .contains('location', [location]);

  if (error) {
    console.warn(`  ⚠️  Error fetching assignee by location: ${error.message}`);
    return null;
  }

  if (data && data.length > 0) return data[0];

  // Get valid location keywords
  const { data: keywords, error: keyError } = await supabase
    .from('location_keywords')
    .select('keyword')
    .eq('active', true);

  if (keyError) return null;

  const keywordsLower = (keywords || []).map(k => k.keyword.toLowerCase());
  if (keywordsLower.includes(location.toLowerCase())) {
    const { data: allData, error: allError } = await supabase
      .from('assigned_user_reference')
      .select('*');

    if (allError) return null;

    const match = allData?.find(user =>
      user.location?.some(loc =>
        loc.toLowerCase().includes(location.toLowerCase())
      )
    );

    return match || null;
  }

  return null;
}

/**
 * Get assignee by attorney ID from assigned_user_reference
 */
async function getAssigneeByAttorneyId(attorneyId) {
  if (!attorneyId) return null;

  const { data, error } = await supabase
    .from('assigned_user_reference')
    .select('*')
    .contains('attorney_id', [attorneyId]);

  if (error) {
    console.warn(`  ⚠️  Error fetching assignee by attorney_id: ${error.message}`);
    return null;
  }

  return data?.[0] || null;
}

/**
 * Get assignee by fund_table lookup
 */
async function getAssigneeByFundTable(attorneyId) {
  if (!attorneyId) return null;

  const { data, error } = await supabase
    .from('assigned_user_reference')
    .select('*')
    .contains('fund_table', [attorneyId]);

  if (error) {
    console.warn(`  ⚠️  Error fetching assignee by fund_table: ${error.message}`);
    return null;
  }

  return data?.[0] || null;
}

/**
 * Resolve expected assignee based on template and matter
 */
async function getExpectedAssignee(template, matter) {
  if (!template) return null;

  const assigneeType = template.assignee?.toString().toUpperCase().trim();
  const lookupRef = template.assignee_id;

  // Static numeric ID in assignee field
  if (!isNaN(assigneeType) && assigneeType) {
    return parseInt(assigneeType);
  }

  // FUNDING_COOR uses assignee_id directly
  if (assigneeType === 'FUNDING_COOR') {
    return lookupRef ? parseInt(lookupRef) : null;
  }

  // Static numeric assignee_id
  if (!isNaN(lookupRef) && lookupRef && !['location', 'attorney', 'attorney_id'].includes(lookupRef)) {
    return parseInt(lookupRef);
  }

  // VA hardcoded
  if (assigneeType === 'VA') {
    return 357379471;
  }

  // Location-based (CSC or lookupRef = "location")
  if (assigneeType === 'CSC' || lookupRef === 'location') {
    // Location can be either a string or an object {id, name}
    const location = typeof matter?.location === 'string'
      ? matter.location
      : matter?.location?.id || null;
    if (!location) return null;

    const assignee = await getAssigneeByLocation(location);
    return assignee?.id || null;
  }

  // Attorney-based (direct assignment to attorney)
  if (assigneeType === 'ATTORNEY' || lookupRef === 'attorney' || lookupRef === 'attorney_id') {
    const attorneyId = matter?.responsible_attorney?.id || matter?.originating_attorney?.id;
    return attorneyId || null;
  }

  // Paralegal (via attorney_id lookup)
  if (assigneeType === 'PARALEGAL') {
    const attorneyId = matter?.responsible_attorney?.id || matter?.originating_attorney?.id;
    if (!attorneyId) return null;

    const assignee = await getAssigneeByAttorneyId(attorneyId);
    return assignee?.id || null;
  }

  // Fund Table (via fund_table lookup)
  if (assigneeType === 'FUND_TABLE' || assigneeType === 'FUND TABLE') {
    const attorneyId = matter?.responsible_attorney?.id || matter?.originating_attorney?.id;
    if (!attorneyId) return null;

    const assignee = await getAssigneeByFundTable(attorneyId);
    return assignee?.id || null;
  }

  return null;
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
  const { error } = await supabase
    .from('tasks')
    .update({ status: status })
    .eq('task_id', taskId);

  if (error) {
    throw new Error(`Failed to update task ${taskId}: ${error.message}`);
  }
}

/**
 * Generate CSV report
 */
function generateCSVReport(mismatches, filePath) {
  const headers = [
    'Task ID',
    'Task Name',
    'Matter ID',
    'Stage ID',
    'Task Number',
    'Clio Assignee ID',
    'Clio Assignee Name',
    'Supabase Assignee ID',
    'Supabase Assignee Name',
    'Expected Assignee ID',
  ];

  const rows = mismatches.map(m => [
    m.task_id,
    `"${m.task_name?.replace(/"/g, '""') || ''}"`, // Escape quotes
    m.matter_id,
    m.stage_id,
    m.task_number,
    m.clio_assignee_id || '',
    `"${m.clio_assignee_name?.replace(/"/g, '""') || ''}"`,
    m.supabase_assignee_id || '',
    `"${m.supabase_assignee_name?.replace(/"/g, '""') || ''}"`,
    m.expected_assignee_id || '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ].join('\n');

  fs.writeFileSync(filePath, csvContent, 'utf8');
}

/**
 * Main sync function
 */
async function syncTasksWithClio() {
  console.log('🔄 Starting Enhanced Clio-Supabase Task Sync (VERBOSE MODE)...\n');
  console.log('📋 Fetching tasks from the last 30 days...');

  const supabaseTasks = await getRecentSupabaseTasks();
  console.log(`✅ Found ${supabaseTasks.length} tasks to verify\n`);

  const stats = {
    total: supabaseTasks.length,
    deleted: 0,
    statusUpdated: 0,
    statusMatched: 0,
    assigneeMismatches: 0,
    templateNotFound: 0,
    errors: 0,
  };

  const assigneeMismatchReport = [];

  for (let i = 0; i < supabaseTasks.length; i++) {
    const task = supabaseTasks[i];
    const progress = `[${i + 1}/${supabaseTasks.length}]`;

    try {
      console.log(`${progress} Checking task ${task.task_id}...`);

      // STEP 1: Fetch full task from Clio
      const clioTaskResult = await getClioTaskFull(task.task_id);

      // Task doesn't exist in Clio (404)
      if (!clioTaskResult.exists) {
        console.log(`  ❌ Task not found in Clio - DELETING from Supabase`);
        await deleteSupabaseTask(task.task_id);
        stats.deleted++;

        // Delay before next iteration
        if (i < supabaseTasks.length - 1) {
          await delay(DELAY_BETWEEN_REQUESTS);
        }
        continue;
      }

      const clioTask = clioTaskResult.task;

      // STEP 2: Check status
      if (task.status !== clioTask.status) {
        console.log(`  🔄 Status mismatch: Supabase="${task.status}" → Clio="${clioTask.status}" - UPDATING`);
        await updateSupabaseTaskStatus(task.task_id, clioTask.status);
        stats.statusUpdated++;
      } else {
        console.log(`  ✅ Status matches: "${task.status}"`);
        stats.statusMatched++;
      }

      // Delay before fetching matter
      await delay(DELAY_BETWEEN_REQUESTS);

      // STEP 3: Fetch matter details
      const matter = await getClioMatter(task.matter_id);

      if (!matter) {
        console.log(`  ⚠️  Could not fetch matter - skipping assignee check`);
        stats.errors++;
        continue;
      }

      // STEP 4: Get task template
      const template = await getTaskTemplate(task);

      if (!template) {
        console.log(`  ⚠️  Template not found - skipping assignee check`);
        stats.templateNotFound++;
        continue;
      }

      // STEP 5: Resolve expected assignee
      const expectedAssigneeId = await getExpectedAssignee(template, matter);

      // STEP 6: Compare assignees
      const clioAssigneeId = clioTask.assignee?.id || null;
      const supabaseAssigneeId = task.assigned_user_id || null;

      if (clioAssigneeId !== supabaseAssigneeId) {
        console.log(`  ⚠️  ASSIGNEE MISMATCH: Clio=${clioAssigneeId} vs Supabase=${supabaseAssigneeId} (Expected=${expectedAssigneeId})`);

        assigneeMismatchReport.push({
          task_id: task.task_id,
          task_name: clioTask.name,
          matter_id: task.matter_id,
          stage_id: task.stage_id,
          task_number: task.task_number,
          clio_assignee_id: clioAssigneeId,
          clio_assignee_name: clioTask.assignee?.name || 'Unassigned',
          supabase_assignee_id: supabaseAssigneeId,
          supabase_assignee_name: task.assigned_user || 'Unassigned',
          expected_assignee_id: expectedAssigneeId,
        });

        stats.assigneeMismatches++;
      } else {
        console.log(`  ✅ Assignee matches: ${clioAssigneeId}`);
      }

    } catch (error) {
      console.error(`  ⚠️  ERROR: ${error.message}`);
      console.error(`     Status: ${error.response?.status}`);
      console.error(`     Type: ${error.constructor.name}`);

      errorLog.push({
        type: 'GENERAL_ERROR',
        task_id: task.task_id,
        error: error.message,
        status: error.response?.status,
        stack: error.stack,
      });

      stats.errors++;
    }

    // Rate limiting delay (except for last item)
    if (i < supabaseTasks.length - 1) {
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SYNC SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total tasks checked:       ${stats.total}`);
  console.log(`✅ Status matched:          ${stats.statusMatched}`);
  console.log(`🔄 Status updated:          ${stats.statusUpdated}`);
  console.log(`❌ Deleted (404):           ${stats.deleted}`);
  console.log(`⚠️  Assignee mismatches:    ${stats.assigneeMismatches}`);
  console.log(`❓ Template not found:     ${stats.templateNotFound}`);
  console.log(`⚠️  Errors:                 ${stats.errors}`);
  console.log('='.repeat(60));

  // Generate reports if there are mismatches
  if (assigneeMismatchReport.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('⚠️  ASSIGNEE MISMATCH REPORT');
    console.log('='.repeat(60));

    for (const mismatch of assigneeMismatchReport) {
      console.log(`\nTask ID: ${mismatch.task_id}`);
      console.log(`  Name: ${mismatch.task_name}`);
      console.log(`  Matter: ${mismatch.matter_id}`);
      console.log(`  Stage: ${mismatch.stage_id} | Task #: ${mismatch.task_number}`);
      console.log(`  Clio:     ${mismatch.clio_assignee_id} (${mismatch.clio_assignee_name})`);
      console.log(`  Supabase: ${mismatch.supabase_assignee_id} (${mismatch.supabase_assignee_name})`);
      console.log(`  Expected: ${mismatch.expected_assignee_id}`);
    }

    // Ensure reports directory exists
    const reportsDir = './docs/reports';
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Save JSON report
    const timestamp = Date.now();
    const jsonPath = path.join(reportsDir, `assignee-mismatch-report-${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(assigneeMismatchReport, null, 2), 'utf8');
    console.log(`\n📄 JSON report saved to: ${jsonPath}`);

    // Save CSV report
    const csvPath = path.join(reportsDir, `assignee-mismatch-report-${timestamp}.csv`);
    generateCSVReport(assigneeMismatchReport, csvPath);
    console.log(`📄 CSV report saved to: ${csvPath}`);
  }

  // Save error log
  if (errorLog.length > 0) {
    const reportsDir = './docs/reports';
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const errorLogPath = path.join(reportsDir, `error-log-${Date.now()}.json`);
    fs.writeFileSync(errorLogPath, JSON.stringify(errorLog, null, 2), 'utf8');
    console.log(`\n📄 Error log saved to: ${errorLogPath}`);
  }
}

// Run the sync
syncTasksWithClio()
  .then(() => {
    console.log('\n✅ Sync completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Sync failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
