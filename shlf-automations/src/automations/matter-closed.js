import { ClioService } from '../services/clio.js';
import { SupabaseService } from '../services/supabase.js';
import { calculateDueDate, formatForClio } from '../utils/date-helpers.js';
import { resolveAssignee, createAssigneeErrorTask } from '../utils/assignee-resolver.js';
import { AssigneeError } from '../utils/assignee-error.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { config } from '../config/index.js';
import { EventTracker } from '../services/event-tracker.js';

/**
 * AUTOMATION: Matter Closed Without Payment
 *
 * Triggers: When matter status changes to "Closed"
 *
 * Process:
 * 1. Fetch full matter details
 * 2. Check if any payments were made via Clio Bills API
 * 3. If NO payments found:
 *    - Create task "Client did not engage"
 *    - Assign to CSC (based on matter location)
 *    - Due date: 24 hours from now
 * 4. Record in Supabase (upsert logic)
 */
export class MatterClosedAutomation {
  /**
   * Main entry point for matter closed automation
   *
   * @param {Object} webhookData - The webhook payload from Clio
   * @param {string} [traceId] - Optional trace ID for event tracking
   */
  static async process(webhookData, traceId = null) {
    const matterId = webhookData.data.id;
    const timestamp = webhookData.data.updated_at;
    const updatingUser = webhookData.data.user;

    console.log(`[MATTER-CLOSED] ${matterId} Status changed to Closed`);

    // Step: Validation
    const validationStepId = await EventTracker.startStep(traceId, {
      layerName: 'processing',
      stepName: 'validation',
      input: {
        matterId,
        timestamp,
        webhookId: webhookData.id,
        updatingUser: updatingUser?.name || updatingUser?.id,
      },
    });

    // Validate timestamp exists (required for idempotency)
    if (!timestamp) {
      const error = `Webhook missing required timestamp field (updated_at)`;
      console.error(`[MATTER-CLOSED] ${matterId} ${error}`);

      await SupabaseService.logError(
        ERROR_CODES.CLIO_API_FAILED,
        error,
        {
          matter_id: matterId,
          webhook_id: webhookData.id,
          webhook_data: webhookData.data,
        }
      );

      await EventTracker.endStep(validationStepId, {
        status: 'error',
        errorMessage: error,
        output: { valid: false, reason: 'missing_timestamp' },
      });
      throw new Error(error);
    }

    await EventTracker.endStep(validationStepId, {
      status: 'success',
      output: { valid: true, matterId, timestamp },
    });

    // Step: Idempotency check
    const idempotencyStepId = await EventTracker.startStep(traceId, {
      layerName: 'processing',
      stepName: 'idempotency_check',
      input: {
        matterId,
        timestamp,
        eventType: 'matter.closed',
      },
    });
    const idempotencyKey = SupabaseService.generateIdempotencyKey(
      'matter.closed',
      matterId,
      timestamp
    );

    const existing = await SupabaseService.checkWebhookProcessed(idempotencyKey);
    if (existing) {
      // Check if webhook is still processing
      if (existing.success === null) {
        console.log(`[MATTER-CLOSED] ${matterId} Still processing (concurrent request)`);
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

      console.log(`[MATTER-CLOSED] ${matterId} Already processed (idempotency) at ${existing.processed_at}`);
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

    // TEMPORARY: Test mode filter - only process specific matter ID
    if (config.testing.testMode && matterId !== config.testing.testMatterId) {
      console.log(`[MATTER-CLOSED] ${matterId} SKIPPED (test mode - matter ${matterId} !== ${config.testing.testMatterId})`);

      // Record as processed (skipped)
      await SupabaseService.recordWebhookProcessed({
        idempotency_key: idempotencyKey,
        webhook_id: webhookData.id,
        event_type: 'matter.closed',
        resource_type: 'matter',
        resource_id: matterId,
        success: true,
        action: 'skipped_test_mode',
        webhook_payload: webhookData,
      });

      return { success: true, action: 'skipped_test_mode' };
    }

    // Step 0.5: Reserve webhook immediately (prevents duplicate processing)
    await SupabaseService.recordWebhookProcessed({
      idempotency_key: idempotencyKey,
      webhook_id: webhookData.id,
      event_type: 'matter.closed',
      resource_type: 'matter',
      resource_id: matterId,
      success: null, // NULL = processing
      action: 'processing',
      webhook_payload: webhookData,
    });

    const startTime = Date.now();

    try {
      // Add 1-second delay for API consistency
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step: Fetch matter details
      const fetchMatterStepId = await EventTracker.startStep(traceId, {
        layerName: 'service',
        stepName: 'fetch_matter',
        input: {
          matterId,
          operation: 'get_matter_details',
        },
      });
      const fetchMatterCtx = EventTracker.createContext(traceId, fetchMatterStepId);

      const matterDetails = await ClioService.getMatter(matterId, fetchMatterCtx);

      // Double-check status is actually Closed
      if (matterDetails.status !== 'Closed') {
        console.log(`[MATTER-CLOSED] ${matterId} SKIPPED (status is not Closed: ${matterDetails.status})`);
        await EventTracker.endStep(fetchMatterStepId, {
          status: 'skipped',
          output: {
            found: true,
            status: matterDetails.status,
            reason: 'not_closed',
            matterName: matterDetails.display_number,
          },
        });

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_not_closed',
        });

        return { success: true, action: 'skipped_not_closed' };
      }

      const currentStageId = matterDetails.matter_stage?.id;
      const currentStageName = matterDetails.matter_stage?.name;

      await EventTracker.endStep(fetchMatterStepId, {
        status: 'success',
        output: {
          found: true,
          matterId,
          matterName: matterDetails.display_number,
          status: matterDetails.status,
          stageId: currentStageId,
          stageName: currentStageName,
          clientName: matterDetails.client?.name,
        },
      });

      console.log(`[MATTER-CLOSED] ${matterId} Checking for payments...`);

      // Step: Check payments
      const checkPaymentsStepId = await EventTracker.startStep(traceId, {
        layerName: 'service',
        stepName: 'check_payments',
        input: {
          matterId,
          operation: 'check_clio_bills_api',
        },
      });
      const checkPaymentsCtx = EventTracker.createContext(traceId, checkPaymentsStepId);

      let hasPayments = false;
      try {
        hasPayments = await ClioService.hasPayments(matterId, checkPaymentsCtx);
      } catch (paymentError) {
        const error = `Failed to check payments for matter ${matterId}`;
        console.error(`[MATTER-CLOSED] ${error}:`, paymentError.message);
        await EventTracker.endStep(checkPaymentsStepId, {
          status: 'error',
          errorMessage: paymentError.message,
          output: {
            success: false,
            error: paymentError.message,
          },
        });

        // Log the payment check error
        await SupabaseService.logError(
          ERROR_CODES.PAYMENT_CHECK_FAILED,
          error,
          {
            matter_id: matterId,
            error_message: paymentError.message,
            error_details: paymentError.response?.data,
          }
        );

        // Update webhook status and rethrow
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: false,
          action: 'payment_check_failed',
          error_message: error,
        });

        throw paymentError;
      }

      // If payments exist, skip task creation
      if (hasPayments) {
        console.log(`[MATTER-CLOSED] ${matterId} SKIPPED (matter has payments)`);
        await EventTracker.endStep(checkPaymentsStepId, {
          status: 'skipped',
          output: {
            hasPayments: true,
            reason: 'client_made_payments',
          },
        });

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_has_payments',
        });

        return { success: true, action: 'skipped_has_payments' };
      }

      await EventTracker.endStep(checkPaymentsStepId, {
        status: 'success',
        output: {
          hasPayments: false,
          reason: 'no_payments_found',
        },
      });

      console.log(`[MATTER-CLOSED] ${matterId} No payments found - creating task...`);

      // Step: Create task
      const createTaskStepId = await EventTracker.startStep(traceId, {
        layerName: 'automation',
        stepName: 'create_task',
        input: {
          matterId,
          matterName: matterDetails.display_number,
          taskName: 'Client did not engage',
          taskDescription: 'Purge Green Folder - Client did not engage',
          assigneeRole: 'CSC',
          stageName: currentStageName,
        },
      });
      const createTaskCtx = EventTracker.createContext(traceId, createTaskStepId);

      // Resolve CSC assignee
      let assignee;
      try {
        assignee = await resolveAssignee('CSC', matterDetails);
        console.log(`[MATTER-CLOSED] ${matterId} Resolved CSC assignee: ${assignee.name} (${assignee.id})`);
      } catch (assigneeError) {
        if (assigneeError instanceof AssigneeError) {
          console.error(`[MATTER-CLOSED] ${matterId} Assignee resolution failed: ${assigneeError.message}`);

          // Create error task in Clio
          const errorTask = await createAssigneeErrorTask(
            matterId,
            assigneeError,
            currentStageId,
            currentStageName,
            'Client did not engage'
          );

          await EventTracker.endStep(createTaskStepId, {
            status: 'error',
            errorMessage: assigneeError.message,
            output: {
              success: false,
              errorTaskCreated: true,
              errorTaskId: errorTask.id,
              error: assigneeError.message,
            },
          });

          // Update webhook as completed (error task created)
          await SupabaseService.updateWebhookProcessed(idempotencyKey, {
            processing_duration_ms: Date.now() - startTime,
            success: true,
            action: 'error_task_created',
            error_message: assigneeError.message,
          });

          return {
            success: true,
            action: 'error_task_created',
            error_task_id: errorTask.id,
          };
        }

        // Unknown error - rethrow
        await EventTracker.endStep(createTaskStepId, {
          status: 'error',
          errorMessage: assigneeError.message,
          output: { success: false, error: assigneeError.message },
        });
        throw assigneeError;
      }

      // Calculate due date (24 hours from now)
      const dueDate = calculateDueDate({
        'due_date-time': 1,
        'due_date-units': 'days'
      });
      const dueDateFormatted = formatForClio(dueDate);

      console.log(`[MATTER-CLOSED] ${matterId} Due date: ${dueDateFormatted}`);

      // Create task in Clio
      const taskData = {
        name: 'Client did not engage',
        description: 'Purge Green Folder - Client did not engage',
        matter: { id: matterId },
        assignee: { id: assignee.id, type: assignee.type },
        due_at: dueDateFormatted,
      };

      let newTask;
      try {
        newTask = await ClioService.createTask(taskData, createTaskCtx);
        console.log(`[MATTER-CLOSED] ${matterId} Task created: ${newTask.id}`);
      } catch (taskError) {
        const error = `Failed to create task for closed matter ${matterId}`;
        console.error(`[MATTER-CLOSED] ${error}:`, taskError.message);
        await EventTracker.endStep(createTaskStepId, {
          status: 'error',
          errorMessage: taskError.message,
          output: {
            success: false,
            error: taskError.message,
            assignee: assignee.name,
          },
        });

        // Log the task creation error
        await SupabaseService.logError(
          ERROR_CODES.CLOSED_MATTER_TASK_FAILED,
          error,
          {
            matter_id: matterId,
            assignee_id: assignee.id,
            assignee_name: assignee.name,
            error_message: taskError.message,
            error_details: taskError.response?.data,
          }
        );

        // Update webhook status and rethrow
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: false,
          action: 'task_creation_failed',
          error_message: error,
        });

        throw taskError;
      }

      // Record task in Supabase (upsert logic)
      const taskRecord = {
        task_id: newTask.id,
        task_name: newTask.name,
        task_desc: newTask.description,
        matter_id: matterId,
        assigned_user_id: assignee.id,
        assigned_user: assignee.name,
        due_date: dueDateFormatted,
        stage_id: currentStageId,
        stage_name: currentStageName,
        task_number: -2, // Special identifier for "Client did not engage" tasks
        completed: false,
        task_date_generated: new Date().toISOString(),
        due_date_generated: new Date().toISOString(),
      };

      await SupabaseService.insertTask(taskRecord, createTaskCtx);
      console.log(`[MATTER-CLOSED] ${matterId} Task recorded in Supabase`);

      await EventTracker.endStep(createTaskStepId, {
        status: 'success',
        output: {
          success: true,
          taskId: newTask.id,
          taskName: newTask.name,
          taskDescription: newTask.description,
          matterId,
          assignee: assignee.name,
          assigneeId: assignee.id,
          dueDate: dueDateFormatted,
          stageName: currentStageName,
          recordedInSupabase: true,
        },
      });

      // Update webhook as successfully processed
      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: true,
        action: 'task_created',
        tasks_created: 1,
      });

      console.log(`[MATTER-CLOSED] ${matterId} Automation completed successfully`);

      return {
        success: true,
        action: 'task_created',
        task_id: newTask.id,
        processing_duration_ms: Date.now() - startTime,
      };

    } catch (error) {
      console.error(`[MATTER-CLOSED] ${matterId} Automation failed:`, error.message);

      // Update webhook as failed
      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: false,
        action: 'failed',
        error_message: error.message,
      });

      throw error;
    }
  }
}
