import { ClioService } from '../services/clio.js';
import { SupabaseService } from '../services/supabase.js';
import { calculateDueDate, formatForClio } from '../utils/date-helpers.js';
import { resolveAssignee } from '../utils/assignee-resolver.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { config } from '../config/index.js';
import { EventTracker } from '../services/event-tracker.js';

/**
 * AUTOMATION #2: Due Date After Task Completion
 *
 * Triggers: When a task is marked as complete
 *
 * Process:
 * 1. Get completed task details from Supabase
 * 2. Check for attempt sequence (Attempt 1, 2, 3, No Response)
 * 3. Check for dependent tasks (due_date_relation: "after task X")
 * 4. Create next task or update due dates
 */
export class TaskCompletionAutomation {
  /**
   * Main entry point for task completion automation
   *
   * @param {Object} webhookData - The webhook payload from Clio
   * @param {string} [traceId] - Optional trace ID for event tracking
   */
  static async process(webhookData, traceId = null) {
    const taskId = webhookData.data.id;
    const timestamp = webhookData.data.completed_at || webhookData.data.updated_at;

    console.log(`[TASK] ${taskId} UPDATED`);
    console.log(`[TASK] ${taskId} Webhook data:`, JSON.stringify(webhookData.data, null, 2));

    // Step: Validation
    const validationStepId = await EventTracker.startStep(traceId, {
      layerName: 'automation',
      stepName: 'validation',
      metadata: { taskId },
    });
    const validationCtx = EventTracker.createContext(traceId, validationStepId);

    // Validate timestamp exists (required for idempotency)
    if (!timestamp) {
      const error = `Webhook missing required timestamp fields (completed_at, updated_at)`;
      console.error(`[TASK] ${taskId} ${error}`);

      validationCtx.logValidation('validate_timestamp', { taskId }, { valid: false }, 'error', error);

      await SupabaseService.logError(
        ERROR_CODES.CLIO_API_FAILED,
        error,
        {
          task_id: taskId,
          webhook_id: webhookData.id,
          webhook_data: webhookData.data,
        }
      );

      await EventTracker.endStep(validationStepId, { status: 'error', errorMessage: error });
      throw new Error(error);
    }

    validationCtx.logValidation('validate_timestamp', { taskId, timestamp }, { valid: true }, 'success');
    await EventTracker.endStep(validationStepId, { status: 'success' });

    // Step: Idempotency check
    const idempotencyStepId = await EventTracker.startStep(traceId, {
      layerName: 'processing',
      stepName: 'idempotency_check',
      metadata: { taskId },
    });
    const idempotencyCtx = EventTracker.createContext(traceId, idempotencyStepId);
    const idempotencyKey = SupabaseService.generateIdempotencyKey(
      'task.completed',
      taskId,
      timestamp
    );

    const existing = await SupabaseService.checkWebhookProcessed(idempotencyKey, idempotencyCtx);
    if (existing) {
      // Check if webhook is still processing
      if (existing.success === null) {
        console.log(`[TASK] ${taskId} Still processing (concurrent request)`);
        await EventTracker.endStep(idempotencyStepId, { status: 'skipped', metadata: { reason: 'still_processing' } });
        return {
          success: null,
          action: 'still_processing',
          processing_started_at: existing.created_at,
        };
      }

      console.log(`[TASK] ${taskId} Already processed (idempotency) at ${existing.processed_at}`);
      await EventTracker.endStep(idempotencyStepId, { status: 'skipped', metadata: { reason: 'already_processed' } });
      return {
        success: existing.success,
        action: existing.action,
        processed_at: existing.processed_at,
        cached: true,
      };
    }

    await EventTracker.endStep(idempotencyStepId, {
      status: 'success',
      output: {
        isDuplicate: false,
        isNewRequest: true,
        idempotencyKey,
      },
    });

    // Step 0.5: Reserve webhook immediately (prevents duplicate processing)
    await SupabaseService.recordWebhookProcessed({
      idempotency_key: idempotencyKey,
      webhook_id: webhookData.id,
      event_type: 'task.completed',
      resource_type: 'task',
      resource_id: taskId,
      success: null, // NULL = processing
      action: 'processing',
      webhook_payload: webhookData,
    });

    const startTime = Date.now();

    try {
      // Step 1: Fetch task details from Clio
      const fetchTaskStepId = await EventTracker.startStep(traceId, {
        layerName: 'automation',
        stepName: 'fetch_task',
        metadata: { taskId },
      });
      const fetchTaskCtx = EventTracker.createContext(traceId, fetchTaskStepId);

      let clioTask;
      try {
        clioTask = await ClioService.getTask(taskId, fetchTaskCtx);
      } catch (fetchError) {
        // If we get a 404, the task was deleted in Clio
        if (fetchError.response?.status === 404 || fetchError.message?.includes('404')) {
          console.log(`[TASK] ${taskId} Not found in Clio (404) - task was deleted`);
          await EventTracker.endStep(fetchTaskStepId, { status: 'skipped', metadata: { reason: 'task_deleted_in_clio' } });

          // Get task from Supabase to mark it as deleted
          const taskRecord = await SupabaseService.getTaskById(taskId);

          if (taskRecord) {
            console.log(`[TASK] ${taskId} Marking as deleted: ${taskRecord.task_name}`);

            // Update task status to deleted
            await SupabaseService.updateTask(taskId, {
              status: 'deleted',
              last_updated: new Date().toISOString(),
            });

            await SupabaseService.updateWebhookProcessed(idempotencyKey, {
              processing_duration_ms: Date.now() - startTime,
              success: true,
              action: 'task_deleted',
            });

            console.log(`[TASK] ${taskId} COMPLETED (marked as deleted)\n`);
            return { success: true, action: 'task_deleted' };
          } else {
            console.log(`[TASK] ${taskId} Not found in Supabase either - skipping`);

            await SupabaseService.updateWebhookProcessed(idempotencyKey, {
              processing_duration_ms: Date.now() - startTime,
              success: true,
              action: 'not_found',
            });

            return { success: true, action: 'not_found' };
          }
        }

        // If it's not a 404, re-throw the error
        await EventTracker.endStep(fetchTaskStepId, { status: 'error', errorMessage: fetchError.message });
        throw fetchError;
      }

      await EventTracker.endStep(fetchTaskStepId, { status: 'success', metadata: { taskName: clioTask.name, matterId: clioTask.matter?.id } });

      // Step 1.5: Validate task has matter
      const taskMatterId = clioTask.matter?.id;
      if (!taskMatterId) {
        const error = `Task missing required matter association`;
        console.error(`[TASK] ${taskId} ${error}`);

        await SupabaseService.logError(
          ERROR_CODES.VALIDATION_MISSING_MATTER,
          error,
          {
            task_id: taskId,
            task_data: {
              id: clioTask.id,
              name: clioTask.name,
              matter: clioTask.matter,
            },
          }
        );

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: false,
          action: 'missing_matter',
        });

        console.log(`[TASK] ${taskId} COMPLETED (missing matter)\n`);
        return { success: false, action: 'missing_matter' };
      }

      // TEMPORARY: Test mode filter - only process tasks from specific matter
      if (config.testing.testMode && taskMatterId !== config.testing.testMatterId) {
        console.log(`[TASK] ${taskId} SKIPPED (test mode - matter ${taskMatterId} !== ${config.testing.testMatterId})`);

        // Update webhook to success (skipped)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_test_mode',
        });

        return { success: true, action: 'skipped_test_mode' };
      }

      // Step 2: Get task record from Supabase first
      const checkSupabaseStepId = await EventTracker.startStep(traceId, {
        layerName: 'service',
        stepName: 'check_task_in_supabase',
        input: {
          taskId,
          operation: 'lookup_task_in_supabase',
        },
      });

      const taskRecord = await SupabaseService.getTaskById(taskId);

      if (!taskRecord) {
        console.log(`[TASK] ${taskId} Not found in database`);

        await EventTracker.endStep(checkSupabaseStepId, {
          status: 'skipped',
          output: {
            found: false,
            reason: 'task_not_in_database',
          },
        });

        // Update webhook to success (not found)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'not_found',
        });

        return { success: true, action: 'not_found' };
      }

      // Task found in Supabase
      await EventTracker.endStep(checkSupabaseStepId, {
        status: 'success',
        output: {
          found: true,
          taskId: taskRecord.task_id,
          taskName: taskRecord.task_name,
          matterId: taskRecord.matter_id,
          stageName: taskRecord.stage_name,
          taskNumber: taskRecord.task_number,
          currentStatus: taskRecord.status,
        },
      });

      // Step 1.75: Check for Sheila Condomina assignee changes
      // Target IDs: 357896692, 358412483
      const SHEILA_IDS = [357896692, 358412483];
      const currentAssigneeId = clioTask.assignee?.id;
      const previousAssigneeId = taskRecord.assigned_user_id;

      // If assignee changed TO Sheila, track it
      if (currentAssigneeId && SHEILA_IDS.includes(currentAssigneeId) &&
          currentAssigneeId !== previousAssigneeId) {
        console.log(`[TASK] ${taskId} SHEILA ASSIGNEE CHANGE DETECTED`);
        console.log(`[TASK] ${taskId}   Previous: ${taskRecord.assigned_user || 'Unassigned'} (${previousAssigneeId})`);
        console.log(`[TASK] ${taskId}   New: ${clioTask.assignee?.name || 'Unknown'} (${currentAssigneeId})`);

        try {
          await SupabaseService.trackSheilaAssigneeChange({
            task_id: taskId,
            task_name: clioTask.name,
            task_desc: clioTask.description,
            due_date: clioTask.due_at,
            status: clioTask.status,
            previous_assignee_id: previousAssigneeId,
            previous_assignee_name: taskRecord.assigned_user,
            new_assignee_id: currentAssigneeId,
            new_assignee_name: clioTask.assignee?.name,
            task_originally_created_at: taskRecord.task_date_generated,
            task_originally_created_by: 'Automation', // Tasks are created by automation
            changed_at: webhookData.data.updated_at || new Date().toISOString(),
            matter_id: taskMatterId,
            stage_name: taskRecord.stage_name,
          });
          console.log(`[TASK] ${taskId} Sheila assignee change tracked successfully`);
        } catch (trackError) {
          console.error(`[TASK] ${taskId} Failed to track Sheila assignee change: ${trackError.message}`);
          // Don't fail the entire webhook - just log and continue
        }
      }

      // Check if task is completed in Clio
      const isCompletedInClio = clioTask.status && clioTask.status === 'complete';

      // Handle task reopening: was completed, now not completed
      if (!isCompletedInClio && taskRecord.status === 'completed') {
        console.log(`[TASK] ${taskId} REOPENED: ${taskRecord.task_name}`);

        // Update task status back to pending
        await SupabaseService.updateTask(taskId, {
          completed: false,
          status: 'pending',
          last_updated: new Date().toISOString(),
        });

        // Update webhook to success (reopened)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'task_reopened',
        });

        console.log(`[TASK] ${taskId} COMPLETED (task reopened)\n`);
        return { success: true, action: 'task_reopened' };
      }

      // Skip if task is not completed in Clio (but continue tracking assignee changes)
      if (!isCompletedInClio) {
        console.log(`[TASK] ${taskId} Not completed, skipping completion automation`);

        // Update webhook to success (skipped)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_not_completed',
        });

        return { success: true, action: 'skipped_not_completed' };
      }

      console.log(`[TASK] ${taskId} COMPLETED: ${taskRecord.task_name}`);

      // Step 3: Update task status in Supabase
      const updateSupabaseStepId = await EventTracker.startStep(traceId, {
        layerName: 'service',
        stepName: 'update_task_status_supabase',
        input: {
          taskId,
          taskName: taskRecord.task_name,
          matterId: taskRecord.matter_id,
          stageName: taskRecord.stage_name,
          previousStatus: taskRecord.status,
          operation: 'mark_task_completed',
        },
      });

      await SupabaseService.updateTask(taskId, {
        completed: true,
        status: 'completed',
        last_updated: new Date().toISOString(),
      });

      await EventTracker.endStep(updateSupabaseStepId, {
        status: 'success',
        output: {
          success: true,
          taskId,
          taskName: taskRecord.task_name,
          previousStatus: taskRecord.status,
          newStatus: 'completed',
          completedAt: new Date().toISOString(),
        },
      });

      // Step 4: Check for attempt sequences
      const attemptAction = await this.handleAttemptSequence(taskId, taskRecord, clioTask);
      if (attemptAction) {
        console.log(`[TASK] ${taskId} COMPLETED (attempt sequence)\n`);

        // Update webhook to success
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'attempt_sequence',
          tasks_created: 1,
        });

        return { success: true, action: 'attempt_sequence', ...attemptAction };
      }

      // Step 4.5: Check if this is an error task (missing data)
      const errorTaskAction = await this.handleErrorTaskCompletion(taskId, taskRecord, clioTask);
      if (errorTaskAction) {
        console.log(`[TASK] ${taskId} COMPLETED (error task - regenerating stage tasks)\n`);

        // Update webhook to success
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'error_task_regenerated',
          tasks_created: errorTaskAction.tasksCreated || 0,
        });

        return { success: true, action: 'error_task_regenerated', ...errorTaskAction };
      }

      // Step 5: Check for dependent tasks
      const dependentAction = await this.handleDependentTasks(taskId, taskRecord, clioTask);
      if (dependentAction) {
        console.log(`[TASK] ${taskId} COMPLETED (dependent tasks)\n`);

        // Update webhook to success
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'dependent_tasks',
          tasks_created: dependentAction.tasks?.filter(t => t.action === 'created').length || 0,
          tasks_updated: dependentAction.tasks?.filter(t => t.action === 'updated').length || 0,
        });

        return { success: true, action: 'dependent_tasks', ...dependentAction };
      }

      console.log(`[TASK] ${taskId} COMPLETED (no follow-ups)\n`);

      // Update webhook to success (no follow-ups)
      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: true,
        action: 'none',
      });

      return { success: true, action: 'none' };

    } catch (error) {
      console.error(`[TASK] ${taskId} ERROR: ${error.message}`);

      // Update webhook to failure
      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: false,
        action: 'error',
      });

      throw error;
    }
  }

  /**
   * Handle attempt sequences: Attempt 1 → 2 → 3 → No Response (from database)
   */
  static async handleAttemptSequence(taskId, taskRecord, clioTask) {
    const taskName = taskRecord.task_name.toLowerCase();

    // Get attempt sequences from database
    const attemptSequences = await SupabaseService.getAllAttemptSequences();

    // Check if this is an attempt task
    for (const sequence of attemptSequences) {
      if (taskName.includes(sequence.current_attempt)) {
        console.log(`[TASK] ${taskId} Attempt sequence: ${sequence.current_attempt} → ${sequence.next_attempt}`);

        // Get the task template for the next attempt
        const taskTemplates = await SupabaseService.getTaskListNonMeeting(taskRecord.stage_id);
        const nextTemplate = taskTemplates.find(t =>
          t.task_title.toLowerCase().includes(sequence.next_attempt.toLowerCase())
        );

        if (!nextTemplate) {
          console.log(`[TASK] ${taskId} Template for "${sequence.next_attempt}" not found`);
          return null;
        }

        // Get matter details for assignee resolution
        const matterDetails = await ClioService.getMatter(taskRecord.matter_id);

        // Skip if matter is closed
        if (matterDetails.status === 'Closed') {
          console.log(`[TASK] ${taskId} SKIPPED (matter is closed)`);
          return null;
        }

        // Resolve assignee
        const assignee = await resolveAssignee(nextTemplate.assignee, matterDetails);

        // Calculate due date
        const dueDate = calculateDueDate(nextTemplate, new Date());
        const dueDateFormatted = formatForClio(dueDate);

        // Create next attempt task
        const newTask = await ClioService.createTask({
          name: nextTemplate.task_title,
          description: nextTemplate['task-description'] || nextTemplate.task_description,
          matter: { id: taskRecord.matter_id },
          assignee: { id: assignee.id, type: assignee.type },
          due_at: dueDateFormatted,
        });

        console.log(`[TASK] ${taskId} Created: ${nextTemplate.task_title}`);

        // Record in Supabase
        await SupabaseService.insertTask({
          task_id: newTask.id,
          task_name: newTask.name,
          task_desc: newTask.description,
          matter_id: taskRecord.matter_id,
          assigned_user_id: assignee.id,
          assigned_user: assignee.name,
          due_date: dueDateFormatted,
          stage_id: taskRecord.stage_id,
          stage_name: taskRecord.stage_name,
          task_number: nextTemplate.task_number,
          completed: false,
          status: 'pending',
          task_date_generated: new Date().toISOString(),
          due_date_generated: new Date().toISOString(),
        });

        return { nextAttempt: sequence.next_attempt, taskCreated: newTask.id };
      }
    }

    return null;
  }

  /**
   * Handle dependent tasks (tasks with due dates relative to this task)
   */
  static async handleDependentTasks(taskId, taskRecord, clioTask) {
    // Get matter details to determine practice area
    const matterDetails = await ClioService.getMatter(taskRecord.matter_id);
    const practiceAreaId = matterDetails.practice_area?.id;

    // Check practice area by ID for reliable detection
    // Estate Planning ID: 44697423 (task-list-non-meeting and task-list-meeting)
    // Probate ID: 45045123 (task-list-probate)
    const PROBATE_PRACTICE_AREA_ID = 45045123;
    const isProbate = practiceAreaId === PROBATE_PRACTICE_AREA_ID;

    // Get all task templates for this stage based on practice area
    const taskTemplates = isProbate
      ? await SupabaseService.getTaskListProbate(taskRecord.stage_id)
      : await SupabaseService.getTaskListNonMeeting(taskRecord.stage_id);

    // Find tasks that depend on this task number
    const dependentTemplates = taskTemplates.filter(t => {
      const relation = t['due_date-relational'] || t.due_date_relation || '';
      return relation.toLowerCase().includes(`task ${taskRecord.task_number}`);
    });

    if (dependentTemplates.length === 0) {
      return null;
    }

    console.log(`[TASK] ${taskId} Found ${dependentTemplates.length} dependent tasks`);

    // Skip if matter is closed (matterDetails already fetched above)
    if (matterDetails.status === 'Closed') {
      console.log(`[TASK] ${taskId} SKIPPED (matter is closed)`);
      return null;
    }

    const updatedTasks = [];

    for (const template of dependentTemplates) {
      try {
        // Check if task already exists
        const existingTasks = await SupabaseService.getTasksByMatterAndStage(
          taskRecord.matter_id,
          taskRecord.stage_id,
          false // not completed
        );

        const existingTask = existingTasks.find(t => t.task_number === template.task_number);

        // Calculate due date relative to completion time
        const dueDate = calculateDueDate(template, new Date());
        const dueDateFormatted = formatForClio(dueDate);

        if (existingTask) {
          // Update existing task
          await ClioService.updateTask(existingTask.task_id, {
            due_at: dueDateFormatted,
          });

          await SupabaseService.updateTask(existingTask.task_id, {
            due_date: dueDateFormatted,
            due_date_generated: new Date().toISOString(),
          });

          console.log(`[TASK] ${taskId} Updated: ${template.task_title}`);
          updatedTasks.push({ action: 'updated', taskId: existingTask.task_id });
        } else {
          // Create new task

          const assignee = await resolveAssignee(template.assignee, matterDetails);

          const newTask = await ClioService.createTask({
            name: template.task_title,
            description: template['task-description'] || template.task_description,
            matter: { id: taskRecord.matter_id },
            assignee: { id: assignee.id, type: assignee.type },
            due_at: dueDateFormatted,
          });

          await SupabaseService.insertTask({
            task_id: newTask.id,
            task_name: newTask.name,
            task_desc: newTask.description,
            matter_id: taskRecord.matter_id,
            assigned_user_id: assignee.id,
            assigned_user: assignee.name,
            due_date: dueDateFormatted,
            stage_id: taskRecord.stage_id,
            stage_name: taskRecord.stage_name,
            task_number: template.task_number,
            completed: false,
            status: 'pending',
            task_date_generated: new Date().toISOString(),
            due_date_generated: new Date().toISOString(),
          });

          console.log(`[TASK] ${taskId} Created: ${template.task_title}`);
          updatedTasks.push({ action: 'created', taskId: newTask.id });
        }

      } catch (error) {
        console.error(`[TASK] ${taskId} Failed to process dependent task: ${error.message}`);
      }
    }

    return { tasksProcessed: updatedTasks.length, tasks: updatedTasks };
  }

  /**
   * Handle completion of error tasks (missing data tasks)
   * When completed, regenerate the stage tasks
   */
  static async handleErrorTaskCompletion(taskId, taskRecord, clioTask) {
    // Check if this is an error task (task_number = -1)
    if (taskRecord.task_number !== -1) {
      return null;
    }

    console.log(`[TASK] ${taskId} Error task completed - regenerating stage tasks`);

    const matterId = taskRecord.matter_id;
    const stageId = taskRecord.stage_id;
    const stageName = taskRecord.stage_name;

    // Import MatterStageChangeAutomation (dynamic to avoid circular dependency)
    const { MatterStageChangeAutomation } = await import('./matter-stage-change.js');

    // Get fresh matter details
    const matterDetails = await ClioService.getMatter(matterId);

    // Skip if matter is closed
    if (matterDetails.status === 'Closed') {
      console.log(`[TASK] ${taskId} SKIPPED (matter is closed)`);
      return null;
    }

    // Get task templates for this stage
    const practiceAreaId = matterDetails.practice_area?.id;

    // Check practice area by ID for reliable detection
    // Estate Planning ID: 44697423 (task-list-non-meeting and task-list-meeting)
    // Probate ID: 45045123 (task-list-probate)
    const PROBATE_PRACTICE_AREA_ID = 45045123;
    const isProbate = practiceAreaId === PROBATE_PRACTICE_AREA_ID;

    const taskTemplates = isProbate
      ? await SupabaseService.getTaskListProbate(stageId)
      : await SupabaseService.getTaskListNonMeeting(stageId);

    if (taskTemplates.length === 0) {
      console.log(`[TASK] ${taskId} No templates found for stage ${stageName}`);
      return null;
    }

    // Filter out Attempt 2, Attempt 3, and No Response
    // Note: Only filter exact matches for attempt sequence tasks, not tasks that happen to contain these words
    const tasksToCreate = taskTemplates.filter(template => {
      const title = template.task_title?.toLowerCase() || '';
      const isAttempt2 = title === 'attempt 2' || title === 'attempt 2 follow up';
      const isAttempt3 = title === 'attempt 3' || title === 'attempt 3 follow up';
      const isNoResponse = title === 'no response';
      return !isAttempt2 && !isAttempt3 && !isNoResponse;
    });

    console.log(`[TASK] ${taskId} Regenerating ${tasksToCreate.length} tasks for ${stageName}`);

    // Generate tasks using the same logic as matter-stage-change
    const result = await MatterStageChangeAutomation.generateTasks(
      matterId,
      matterDetails,
      tasksToCreate,
      stageId,
      stageName
    );

    console.log(`[TASK] ${taskId} Regenerated ${result.tasksCreated} tasks`);

    return {
      tasksCreated: result.tasksCreated,
      tasksFailed: result.tasksFailed,
      failures: result.failures
    };
  }
}
