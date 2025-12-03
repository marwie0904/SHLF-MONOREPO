import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from '../services/supabase.js';
import { ClioService } from '../services/clio.js';
import { formatForClio, addBusinessDays } from '../utils/date-helpers.js';
import { config } from '../config/index.js';

dotenv.config();

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.key);

/**
 * Stale Matter Checker Job
 *
 * Automatically creates tasks for matters stuck in "Funding in Progress" stage:
 * 1. Initial task after 30 days (6-day due date)
 * 2. Recurring tasks every 30 days thereafter (7-day due date)
 *
 * Runs daily via cron.
 */
export class StaleMatterCheckerJob {
  // Constants
  static FUNDING_IN_PROGRESS_STAGE = 'Funding in Progress';
  static INITIAL_ALERT_DAYS = 30;
  static RECURRING_ALERT_DAYS = 30;
  static INITIAL_DUE_DAYS = 6;
  static RECURRING_DUE_DAYS = 7;
  static INITIAL_ASSIGNEE_ID = 357379471; // For initial no-progress task
  static RECURRING_ASSIGNEE_ID = 357378676; // For recurring 30-day tasks

  /**
   * Main entry point
   */
  static async run() {
    console.log('🔄 [STALE-MATTERS] Starting stale matter checker job...\n');

    const testMode = config.testing.testMode;
    const testMatterId = config.testing.testMatterId;

    if (testMode) {
      console.log(`⚠️  TEST MODE: Only checking matter ${testMatterId}\n`);
    }

    try {
      // Step 1: Get all matters with their current stages
      const allMatters = await this.getAllMattersWithStages();

      // Filter for test mode if enabled
      const mattersToCheck = testMode
        ? allMatters.filter(m => m.matter_id === testMatterId)
        : allMatters;

      console.log(`📊 [STALE-MATTERS] Found ${mattersToCheck.length} active matter(s) to check\n`);

      if (mattersToCheck.length === 0) {
        console.log('✅ [STALE-MATTERS] No matters to check\n');
        return { success: true, checked: 0, tasksCreated: 0 };
      }

      let tasksCreated = 0;

      // Step 2: Check each matter
      for (const matter of mattersToCheck) {
        const result = await this.checkMatter(matter);
        if (result.taskCreated) {
          tasksCreated++;
        }
      }

      console.log(`\n✨ [STALE-MATTERS] Job complete:`);
      console.log(`   📋 Checked: ${mattersToCheck.length} matter(s)`);
      console.log(`   ✅ Tasks created: ${tasksCreated}\n`);

      return {
        success: true,
        checked: mattersToCheck.length,
        tasksCreated,
      };

    } catch (error) {
      console.error(`❌ [STALE-MATTERS] Job failed: ${error.message}\n`);
      throw error;
    }
  }

  /**
   * Get all matters with their current stages
   */
  static async getAllMattersWithStages() {
    const { data, error } = await supabase
      .from('tasks')
      .select('matter_id, stage_name')
      .order('matter_id');

    if (error) throw error;

    // Get unique matters (one per matter, using the most recent stage)
    const uniqueMatters = [...new Map(data.map(item => [item.matter_id, item])).values()];
    return uniqueMatters;
  }

  /**
   * Check a single matter and create tasks if needed
   */
  static async checkMatter(matterRecord) {
    const matterId = matterRecord.matter_id;
    const stageName = matterRecord.stage_name; // Current stage of the matter

    console.log(`🔍 [STALE-MATTERS] Checking matter ${matterId} (Stage: ${stageName})...`);

    try {
      // Step 1: Check if matter is closed
      let matterDetails;
      try {
        matterDetails = await ClioService.getMatter(matterId);
      } catch (error) {
        console.log(`   ⚠️  Could not fetch matter from Clio: ${error.message}\n`);
        return { taskCreated: false, error: error.message };
      }

      if (matterDetails.status === 'Closed') {
        console.log(`   ⏭️  SKIPPED (matter is closed)\n`);
        return { taskCreated: false, skipped: true, reason: 'closed' };
      }

      // Get or create tracking record
      let tracking = await this.getTrackingRecord(matterId, stageName);

      if (!tracking) {
        // First time seeing this matter in this stage - create tracking record
        tracking = await this.createTrackingRecord(matterId, stageName);
        console.log(`   📝 Created tracking record (entered stage: ${tracking.stage_entered_at})`);
      }

      const now = new Date();
      const stageEnteredAt = new Date(tracking.stage_entered_at);
      const daysInStage = Math.floor((now - stageEnteredAt) / (1000 * 60 * 60 * 24));

      console.log(`   ⏱️  Days in stage: ${daysInStage}`);

      // TASK 1: Initial notification (applies to ALL stages)
      // Triggers when matter hasn't changed stages for 30+ days
      if (!tracking.initial_notification_sent && daysInStage >= this.INITIAL_ALERT_DAYS) {
        console.log(`   🚨 Initial alert needed (${daysInStage} days >= ${this.INITIAL_ALERT_DAYS} days)`);
        await this.createInitialAlertTask(matterId, tracking, stageName);
        return { taskCreated: true, type: 'initial' };
      }

      // TASK 2: Recurring notification (ONLY for "Funding in Progress" stage)
      // Triggers every 30 days while matter remains in Funding in Progress
      if (stageName === this.FUNDING_IN_PROGRESS_STAGE && tracking.initial_notification_sent) {
        const daysSinceLastNotification = tracking.last_recurring_notification_at
          ? Math.floor((now - new Date(tracking.last_recurring_notification_at)) / (1000 * 60 * 60 * 24))
          : Math.floor((now - new Date(tracking.initial_notification_sent_at)) / (1000 * 60 * 60 * 24));

        console.log(`   📅 Days since last notification: ${daysSinceLastNotification}`);

        if (daysSinceLastNotification >= this.RECURRING_ALERT_DAYS) {
          console.log(`   🔔 Recurring alert needed (${daysSinceLastNotification} days >= ${this.RECURRING_ALERT_DAYS} days)`);
          await this.createRecurringAlertTask(matterId, tracking, stageName);
          return { taskCreated: true, type: 'recurring' };
        }
      }

      console.log(`   ✅ No action needed\n`);
      return { taskCreated: false };

    } catch (error) {
      console.error(`   ❌ Error checking matter ${matterId}: ${error.message}\n`);
      return { taskCreated: false, error: error.message };
    }
  }

  /**
   * Get tracking record for a matter/stage
   */
  static async getTrackingRecord(matterId, stageName) {
    const { data, error} = await supabase
      .from('matter_stage_tracking')
      .select('*')
      .eq('matter_id', matterId)
      .eq('stage_name', stageName)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // Ignore "not found" error
    return data;
  }

  /**
   * Create tracking record when matter enters stage
   */
  static async createTrackingRecord(matterId, stageName) {
    // Try to get matter_stage_updated_at from Clio
    let stageEnteredAt = new Date();

    try {
      const matter = await ClioService.getMatter(matterId);
      if (matter.matter_stage_updated_at) {
        stageEnteredAt = new Date(matter.matter_stage_updated_at);
      }
    } catch (error) {
      console.log(`   ⚠️  Could not fetch matter from Clio, using current time: ${error.message}`);
    }

    const { data, error } = await supabase
      .from('matter_stage_tracking')
      .insert({
        matter_id: matterId,
        stage_name: stageName,
        stage_entered_at: stageEnteredAt.toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Create initial 30-day no progress alert task
   */
  static async createInitialAlertTask(matterId, tracking, stageName) {
    const taskName = 'Action Required: MATTER HAS NO PROGRESS - PLEASE REVIEW';
    const taskDescription = 'This is an automated task. Matter stage has not changed for more than a month. Please close or move to the correct stage.';

    // Calculate due date (6 business days from now)
    const dueDate = addBusinessDays(new Date(), this.INITIAL_DUE_DAYS);
    const dueDateFormatted = formatForClio(dueDate);

    console.log(`   📝 Creating initial alert task (due: ${dueDateFormatted})...`);

    // Create task in Clio
    const newTask = await ClioService.createTask({
      name: taskName,
      description: taskDescription,
      matter: { id: matterId },
      assignee: { id: this.INITIAL_ASSIGNEE_ID, type: 'User' },
      due_at: dueDateFormatted,
    });

    console.log(`   ✅ Task created: ${newTask.id}`);

    // Record in Supabase tasks table
    await SupabaseService.insertTask({
      task_id: newTask.id,
      task_name: newTask.name,
      task_desc: newTask.description,
      matter_id: matterId,
      assigned_user_id: this.INITIAL_ASSIGNEE_ID,
      assigned_user: 'Auto-assigned',
      due_date: dueDateFormatted,
      stage_id: null,
      stage_name: stageName, // Use the actual current stage
      task_number: null,
      completed: false,
      task_date_generated: new Date().toISOString(),
      due_date_generated: new Date().toISOString(),
    });

    // Update tracking record
    await supabase
      .from('matter_stage_tracking')
      .update({
        initial_notification_sent: true,
        initial_notification_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tracking.id);

    console.log(`   ✅ Initial alert task created\n`);
  }

  /**
   * Create recurring 30-day notification task
   */
  static async createRecurringAlertTask(matterId, tracking, stageName) {
    const taskName = '30 Day Notification';
    const taskDescription = 'This is an auto-generated task triggered every 30 days while the matter remains in the "Funding in Progress" stage. Please review and either progress the matter or close it out if appropriate.';

    // Calculate due date (7 business days from now)
    const dueDate = addBusinessDays(new Date(), this.RECURRING_DUE_DAYS);
    const dueDateFormatted = formatForClio(dueDate);

    console.log(`   📝 Creating recurring alert task (due: ${dueDateFormatted})...`);

    // Create task in Clio
    const newTask = await ClioService.createTask({
      name: taskName,
      description: taskDescription,
      matter: { id: matterId },
      assignee: { id: this.RECURRING_ASSIGNEE_ID, type: 'User' },
      due_at: dueDateFormatted,
    });

    console.log(`   ✅ Task created: ${newTask.id}`);

    // Record in Supabase tasks table
    await SupabaseService.insertTask({
      task_id: newTask.id,
      task_name: newTask.name,
      task_desc: newTask.description,
      matter_id: matterId,
      assigned_user_id: this.RECURRING_ASSIGNEE_ID,
      assigned_user: 'Auto-assigned',
      due_date: dueDateFormatted,
      stage_id: null,
      stage_name: stageName, // Should always be "Funding in Progress" for recurring tasks
      task_number: null,
      completed: false,
      task_date_generated: new Date().toISOString(),
      due_date_generated: new Date().toISOString(),
    });

    // Update tracking record
    const newCount = (tracking.recurring_notification_count || 0) + 1;
    await supabase
      .from('matter_stage_tracking')
      .update({
        last_recurring_notification_at: new Date().toISOString(),
        recurring_notification_count: newCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tracking.id);

    console.log(`   ✅ Recurring alert task created (notification #${newCount})\n`);
  }
}

// Run immediately if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  StaleMatterCheckerJob.run()
    .then(result => {
      console.log('Job result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
