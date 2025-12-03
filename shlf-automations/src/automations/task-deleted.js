import { SupabaseService } from '../services/supabase.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { EventTracker } from '../services/event-tracker.js';

/**
 * AUTOMATION: Task Deletion
 *
 * Triggers: When a task is deleted in Clio
 *
 * Process:
 * 1. Get task ID from webhook
 * 2. Mark task as deleted in Supabase (soft delete)
 * 3. This keeps Supabase in sync with Clio while preserving history
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

    console.log(`[TASK-DELETE] ${taskId} Processing deletion...`);

    // Step: Idempotency check
    const idempotencyStepId = await EventTracker.startStep(traceId, {
      layerName: 'processing',
      stepName: 'idempotency_check',
      metadata: { taskId },
    });
    const idempotencyKey = SupabaseService.generateIdempotencyKey(
      'task.deleted',
      taskId,
      webhookData.data.deleted_at || webhookData.occurred_at
    );

    const existing = await SupabaseService.checkWebhookProcessed(idempotencyKey);
    if (existing) {
      if (existing.success === null) {
        console.log(`[TASK-DELETE] ${taskId} Still processing (concurrent request)`);
        await EventTracker.endStep(idempotencyStepId, { status: 'skipped', metadata: { reason: 'still_processing' } });
        return {
          success: null,
          action: 'still_processing',
          processing_started_at: existing.created_at,
        };
      }

      console.log(`[TASK-DELETE] ${taskId} Already processed at ${existing.processed_at}`);
      await EventTracker.endStep(idempotencyStepId, { status: 'skipped', metadata: { reason: 'already_processed' } });
      return {
        success: existing.success,
        action: existing.action,
        processed_at: existing.processed_at,
        cached: true,
      };
    }

    await EventTracker.endStep(idempotencyStepId, { status: 'success' });

    // Step 0.5: Reserve webhook immediately
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
      // Step: Update task status
      const updateTaskStepId = await EventTracker.startStep(traceId, {
        layerName: 'automation',
        stepName: 'update_task_status',
        metadata: { taskId },
      });
      const updateTaskCtx = EventTracker.createContext(traceId, updateTaskStepId);

      // Check if task exists in Supabase
      const existingTask = await SupabaseService.getTaskById(taskId, updateTaskCtx);

      if (!existingTask) {
        console.log(`[TASK-DELETE] ${taskId} Task not found in Supabase - already deleted or never tracked`);
        await EventTracker.endStep(updateTaskStepId, { status: 'skipped', metadata: { reason: 'task_not_found' } });

        // Update webhook to success (nothing to delete)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'task_not_found',
        });

        console.log(`[TASK-DELETE] ${taskId} COMPLETED (not found)\n`);
        return { success: true, action: 'task_not_found' };
      }

      // Mark task as deleted in Supabase (soft delete)
      console.log(`[TASK-DELETE] ${taskId} Marking task as deleted: ${existingTask.task_name}`);
      console.log(`[TASK-DELETE] ${taskId} Matter: ${existingTask.matter_id}, Stage: ${existingTask.stage_name}`);

      await SupabaseService.updateTask(taskId, {
        status: 'deleted',
        last_updated: new Date().toISOString(),
      }, updateTaskCtx);

      await EventTracker.endStep(updateTaskStepId, { status: 'success', metadata: { taskName: existingTask.task_name, matterId: existingTask.matter_id } });

      // Update webhook to success
      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: true,
        action: 'task_marked_deleted',
      });

      console.log(`[TASK-DELETE] ${taskId} COMPLETED - Marked as deleted in Supabase\n`);
      return {
        success: true,
        action: 'task_marked_deleted',
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
