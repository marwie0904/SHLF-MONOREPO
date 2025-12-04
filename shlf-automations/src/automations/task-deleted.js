import { SupabaseService } from '../services/supabase.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { EventTracker } from '../services/event-tracker.js';
import { config } from '../config/index.js';

/**
 * AUTOMATION: Task Deletion
 *
 * Triggers: When a task is deleted in Clio
 *
 * Process:
 * 1. Get task ID from webhook
 * 2. Check if task exists in Supabase
 * 3. Mark task as deleted in Supabase (soft delete)
 * 4. This keeps Supabase in sync with Clio while preserving history
 */

export class TaskDeletedAutomation {
  /**
   * Main entry point for task deletion
   *
   * @param {Object} webhookData - The webhook payload from Clio
   * @param {string} [traceId] - Optional trace ID for event tracking
   */
  static async process(webhookData, traceId = null) {
    const taskId = webhookData.data.id;
    const matterId = webhookData.data.matter?.id || null;
    const deletedAt = webhookData.data.deleted_at || webhookData.occurred_at;

    console.log(`[TASK-DELETE] ${taskId} Processing deletion...`);

    // Step 1: Idempotency check
    const idempotencyStepId = await EventTracker.startStep(traceId, {
      layerName: 'processing',
      stepName: 'idempotency_check',
      input: {
        taskId,
        deletedAt,
        webhookId: webhookData.id,
      },
    });

    const idempotencyKey = SupabaseService.generateIdempotencyKey(
      'task.deleted',
      taskId,
      deletedAt
    );

    const existing = await SupabaseService.checkWebhookProcessed(idempotencyKey);
    if (existing) {
      if (existing.success === null) {
        console.log(`[TASK-DELETE] ${taskId} Still processing (concurrent request)`);
        await EventTracker.endStep(idempotencyStepId, {
          status: 'skipped',
          output: {
            isDuplicate: true,
            reason: 'still_processing',
            processing_started_at: existing.created_at,
          },
        });
        return {
          success: null,
          action: 'still_processing',
          processing_started_at: existing.created_at,
        };
      }

      console.log(`[TASK-DELETE] ${taskId} Already processed at ${existing.processed_at}`);
      await EventTracker.endStep(idempotencyStepId, {
        status: 'skipped',
        output: {
          isDuplicate: true,
          reason: 'already_processed',
          processed_at: existing.processed_at,
          cachedAction: existing.action,
        },
      });
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

    // Reserve webhook immediately
    await SupabaseService.recordWebhookProcessed({
      idempotency_key: idempotencyKey,
      webhook_id: webhookData.id,
      event_type: 'task.deleted',
      resource_type: 'task',
      resource_id: taskId,
      success: null, // NULL = processing
      action: 'processing',
      webhook_payload: webhookData,
    });

    const startTime = Date.now();

    try {
      // Step 2: Search for task in Supabase
      const checkStepId = await EventTracker.startStep(traceId, {
        layerName: 'service',
        stepName: 'search_task_in_supabase',
        input: {
          taskId,
          operation: 'search_task_record',
        },
      });

      const existingTask = await SupabaseService.getTaskById(taskId);

      if (!existingTask) {
        console.log(`[TASK-DELETE] ${taskId} Task not found in Supabase - already deleted or never tracked`);
        await EventTracker.endStep(checkStepId, {
          status: 'skipped',
          output: {
            found: false,
            reason: 'task_not_in_database',
          },
        });

        // Update webhook to success (nothing to delete)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'task_not_found',
        });

        console.log(`[TASK-DELETE] ${taskId} COMPLETED (not found)\n`);
        return { success: true, action: 'task_not_found' };
      }

      // Task found - include full metadata
      await EventTracker.endStep(checkStepId, {
        status: 'success',
        output: {
          found: true,
          taskId: existingTask.task_id,
          matterId: existingTask.matter_id,
          taskNumber: existingTask.task_number,
          taskName: existingTask.task_name,
          taskDescription: existingTask.task_desc,
          assignee: existingTask.assigned_user,
          assigneeId: existingTask.assigned_user_id,
          stageName: existingTask.stage_name,
          currentStatus: existingTask.status,
        },
      });

      // TEST MODE: Safety check - only process tasks from test matter
      if (config.testing.testMode && existingTask.matter_id !== config.testing.testMatterId) {
        console.log(`[TASK-DELETE] ${taskId} SKIPPED (test mode - matter ${existingTask.matter_id} !== ${config.testing.testMatterId})`);

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_test_mode',
        });

        return { success: true, action: 'skipped_test_mode' };
      }

      // Step 3: Delete task in Supabase (soft delete)
      const deleteStepId = await EventTracker.startStep(traceId, {
        layerName: 'service',
        stepName: 'delete_task_in_supabase',
        input: {
          taskId,
          matterId: existingTask.matter_id,
          taskNumber: existingTask.task_number,
          taskName: existingTask.task_name,
          taskDescription: existingTask.task_desc,
          assignee: existingTask.assigned_user,
          stageName: existingTask.stage_name,
          previousStatus: existingTask.status,
          operation: 'soft_delete_task',
        },
      });

      console.log(`[TASK-DELETE] ${taskId} Marking task as deleted: ${existingTask.task_name}`);
      console.log(`[TASK-DELETE] ${taskId} Matter: ${existingTask.matter_id}, Stage: ${existingTask.stage_name}`);

      await SupabaseService.updateTask(taskId, {
        status: 'deleted',
        last_updated: new Date().toISOString(),
      });

      const deletedTimestamp = new Date().toISOString();

      await EventTracker.endStep(deleteStepId, {
        status: 'success',
        output: {
          success: true,
          taskId,
          matterId: existingTask.matter_id,
          taskNumber: existingTask.task_number,
          taskName: existingTask.task_name,
          previousStatus: existingTask.status,
          newStatus: 'deleted',
          deletedAt: deletedTimestamp,
        },
      });

      // Update webhook to success
      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: true,
        action: 'deleted_in_supabase',
      });

      console.log(`[TASK-DELETE] ${taskId} COMPLETED - Marked as deleted in Supabase\n`);
      return {
        success: true,
        action: 'deleted_in_supabase',
        taskId,
        taskName: existingTask.task_name,
        matterId: existingTask.matter_id,
      };

    } catch (error) {
      console.error(`[TASK-DELETE] ${taskId} ERROR: ${error.message}`);

      // Log error
      await SupabaseService.logError(
        ERROR_CODES.AUTOMATION_FAILED,
        `Task deletion failed: ${error.message}`,
        {
          task_id: taskId,
          webhook_id: webhookData.id,
          error: error.message,
          stack: error.stack,
        }
      );

      // Update webhook to failure
      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: false,
        action: 'error',
      });

      throw error;
    }
  }
}
