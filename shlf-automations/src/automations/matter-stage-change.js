import { ClioService } from '../services/clio.js';
import { SupabaseService } from '../services/supabase.js';
import { TaskVerificationService } from '../services/task-verification.js';
import { calculateDueDate, formatForClio } from '../utils/date-helpers.js';
import { resolveAssignee, createAssigneeErrorTask } from '../utils/assignee-resolver.js';
import { AssigneeError } from '../utils/assignee-error.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { config } from '../config/index.js';
import { EventTracker } from '../services/event-tracker.js';

/**
 * AUTOMATION #1: Clio Tasks Automation (Matter Stage Changes)
 *
 * Triggers: When matter is moved to another matter stage
 *
 * Process:
 * 1. Fetch full matter details
 * 2. Check for rollback window (3 minutes)
 * 3. Delete previous tasks if within window
 * 4. Generate tasks from templates
 * 5. Resolve assignees dynamically
 * 6. Calculate due dates (with weekend protection)
 * 7. Create tasks in Clio
 * 8. Record in Supabase
 */
export class MatterStageChangeAutomation {
  /**
   * Main entry point for matter stage change automation
   *
   * @param {Object} webhookData - The webhook payload from Clio
   * @param {string} [traceId] - Optional trace ID for event tracking
   */
  static async process(webhookData, traceId = null) {
    const matterId = webhookData.data.id;
    const timestamp = webhookData.data.matter_stage_updated_at || webhookData.data.updated_at;
    const updatingUser = webhookData.data.user; // User who updated the matter

    // Extract previous stage from webhook (if available)
    const webhookStageId = webhookData.data.matter_stage?.id;
    const webhookStageName = webhookData.data.matter_stage?.name;

    console.log(`[MATTER] ${matterId} UPDATED`);

    // Step: Log webhook received with full payload
    const webhookStepId = await EventTracker.startStep(traceId, {
      layerName: 'webhook',
      stepName: 'webhook_received',
      metadata: { matterId },
    });
    const webhookCtx = EventTracker.createContext(traceId, webhookStepId);

    // Log the full webhook payload
    webhookCtx.logWebhook('webhook_received', {
      eventType: webhookData.type,
      resourceId: matterId,
      resourceType: 'matter',
      webhookId: webhookData.id,
      stageIdFromWebhook: webhookStageId,
      stageNameFromWebhook: webhookStageName,
      rawPayload: webhookData,
    });

    await EventTracker.endStep(webhookStepId, { status: 'success' });

    // Step: Validation - validate webhook payload
    const validationStepId = await EventTracker.startStep(traceId, {
      layerName: 'automation',
      stepName: 'validation',
      metadata: { matterId },
    });

    const validationCtx = EventTracker.createContext(traceId, validationStepId);

    // Validate timestamp exists (required for idempotency)
    if (!timestamp) {
      const error = `Webhook missing required timestamp fields (matter_stage_updated_at, updated_at)`;
      console.error(`[MATTER] ${matterId} ${error}`);

      validationCtx.logValidation('validate_timestamp', { matterId }, { valid: false }, 'error', error);

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
      });

      throw new Error(error);
    }

    validationCtx.logValidation('validate_timestamp', { matterId, timestamp }, { valid: true }, 'success');
    await EventTracker.endStep(validationStepId, { status: 'success' });

    // Step: Idempotency check
    const idempotencyStepId = await EventTracker.startStep(traceId, {
      layerName: 'processing',
      stepName: 'idempotency_check',
      metadata: { matterId },
    });

    const idempotencyCtx = EventTracker.createContext(traceId, idempotencyStepId);

    const idempotencyKey = SupabaseService.generateIdempotencyKey(
      'matter.updated',
      matterId,
      timestamp
    );

    const existing = await SupabaseService.checkWebhookProcessed(idempotencyKey, idempotencyCtx);
    if (existing) {
      // Check if webhook is still processing
      if (existing.success === null) {
        console.log(`[MATTER] ${matterId} Still processing (concurrent request)`);
        await EventTracker.endStep(idempotencyStepId, {
          status: 'skipped',
          metadata: { reason: 'still_processing' },
        });
        return {
          success: null,
          action: 'still_processing',
          processing_started_at: existing.created_at,
        };
      }

      console.log(`[MATTER] ${matterId} Already processed (idempotency) at ${existing.processed_at}`);
      await EventTracker.endStep(idempotencyStepId, {
        status: 'skipped',
        metadata: { reason: 'already_processed', cached: true },
      });
      return {
        success: existing.success,
        action: existing.action,
        processed_at: existing.processed_at,
        cached: true,
      };
    }

    await EventTracker.endStep(idempotencyStepId, { status: 'success' });

    // Step: Test mode filter - only process specific matter ID when test mode is enabled
    if (config.testing.testMode) {
      const testModeStepId = await EventTracker.startStep(traceId, {
        layerName: 'processing',
        stepName: 'test_mode_filter',
        metadata: { matterId },
      });
      const testModeCtx = EventTracker.createContext(traceId, testModeStepId);

      const isAllowed = matterId === config.testing.testMatterId;
      testModeCtx.logTestModeFilter(matterId, matterId, config.testing.testMatterId, isAllowed);

      if (!isAllowed) {
        console.log(`[MATTER] ${matterId} SKIPPED (test mode - matter ${matterId} !== ${config.testing.testMatterId})`);

        await EventTracker.endStep(testModeStepId, {
          status: 'skipped',
          metadata: { reason: 'not_in_allowlist', testMatterId: config.testing.testMatterId },
        });

        // Record as processed (skipped)
        await SupabaseService.recordWebhookProcessed({
          idempotency_key: idempotencyKey,
          webhook_id: webhookData.id,
          event_type: 'matter.updated',
          resource_type: 'matter',
          resource_id: matterId,
          success: true,
          action: 'skipped_test_mode',
          webhook_payload: webhookData,
        });

        return { success: true, action: 'skipped_test_mode' };
      }

      await EventTracker.endStep(testModeStepId, { status: 'success' });
    }

    // Step 0.5: Reserve webhook immediately (prevents duplicate processing)
    await SupabaseService.recordWebhookProcessed({
      idempotency_key: idempotencyKey,
      webhook_id: webhookData.id,
      event_type: 'matter.updated',
      resource_type: 'matter',
      resource_id: matterId,
      success: null, // NULL = processing
      action: 'processing',
      webhook_payload: webhookData,
    });

    const startTime = Date.now();
    let tasksCreated = 0;

    try {
      // Step 1: Add 1-second delay for API consistency
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step: Fetch matter details from Clio
      const fetchMatterStepId = await EventTracker.startStep(traceId, {
        layerName: 'automation',
        stepName: 'fetch_matter',
        metadata: { matterId },
      });
      const fetchMatterCtx = EventTracker.createContext(traceId, fetchMatterStepId);

      const matterDetails = await ClioService.getMatter(matterId, fetchMatterCtx);

      await EventTracker.endStep(fetchMatterStepId, {
        status: 'success',
        metadata: {
          status: matterDetails.status,
          stageId: matterDetails.matter_stage?.id,
          stageName: matterDetails.matter_stage?.name,
          practiceArea: matterDetails.practice_area?.name,
        },
      });

      // Step: Detect stage change (before → after)
      // Note: Clio webhook contains the NEW state (after change), not previous state
      // We get the previous stage from our database records
      const currentStage = {
        id: matterDetails.matter_stage?.id,
        name: matterDetails.matter_stage?.name,
      };

      // Get previous stage from Supabase (last recorded stage for this matter)
      const matterHistory = await SupabaseService.getMatterHistory(matterId);
      const previousStage = {
        id: matterHistory?.stage_id || null,
        name: matterHistory?.stage_name || 'Unknown',
      };

      // Determine if we have a previous record
      const hasPreviousRecord = previousStage.id !== null;

      const stageChangeStepId = await EventTracker.startStep(traceId, {
        layerName: 'automation',
        stepName: 'detect_stage_change',
        metadata: {
          matterId,
          hasPreviousRecord,
          previousStageId: previousStage.id,
          previousStageName: hasPreviousRecord ? previousStage.name : '(No previous record)',
          newStageId: currentStage.id,
          newStageName: currentStage.name,
        },
      });
      const stageChangeCtx = EventTracker.createContext(traceId, stageChangeStepId);

      // Determine if stage actually changed (null means no previous record, treat as changed)
      const stageChanged = !hasPreviousRecord || previousStage.id !== currentStage.id;

      // Log stage change details using the correct context method
      stageChangeCtx.logStageChange(matterId, previousStage, currentStage, stageChanged);

      await EventTracker.endStep(stageChangeStepId, {
        status: currentStage.id ? 'success' : 'skipped',
        metadata: {
          stageChanged,
          hasPreviousRecord,
          previousStageId: previousStage.id,
          previousStageName: hasPreviousRecord ? previousStage.name : '(No previous record)',
          newStageId: currentStage.id,
          newStageName: currentStage.name,
        },
      });

      // Step 2.1: Filter out closed matters
      if (matterDetails.status === 'Closed') {
        console.log(`[MATTER] ${matterId} SKIPPED (matter is closed)`);

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_closed_matter',
        });

        return { success: true, action: 'skipped_closed_matter' };
      }

      const currentStageId = matterDetails.matter_stage?.id;
      const currentStageName = matterDetails.matter_stage?.name;
      const practiceArea = matterDetails.practice_area?.name;
      const practiceAreaId = matterDetails.practice_area?.id;

      // Step 2.5: Validate required fields
      if (!currentStageId || !currentStageName) {
        const error = `Matter missing required stage information`;
        console.error(`[MATTER] ${matterId} ${error}`);

        await SupabaseService.logError(
          ERROR_CODES.VALIDATION_MISSING_STAGE,
          error,
          {
            matter_id: matterId,
            stage_id: currentStageId,
            stage_name: currentStageName,
            matter_data: {
              id: matterDetails.id,
              matter_stage: matterDetails.matter_stage,
              practice_area: matterDetails.practice_area,
            },
          }
        );

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: false,
          action: 'missing_stage',
        });

        console.log(`[MATTER] ${matterId} COMPLETED (missing stage)\n`);
        return { success: false, action: 'missing_stage' };
      }

      // Warn if practice area is missing (optional but recommended)
      if (!practiceArea || !practiceAreaId) {
        console.warn(`[MATTER] ${matterId} Missing practice area information, will use default templates`);
      }

      console.log(`[MATTER] ${matterId} Confirmed stage change`);
      console.log(`[MATTER] ${matterId} Changed to stage: ${currentStageName} (${practiceArea || 'Unknown'})`);

      // Step 2.75: Update matter status based on stage mapping
      try {
        const matterStatus = await SupabaseService.getMatterStatusByStage(currentStageName);
        if (matterStatus) {
          console.log(`[MATTER] ${matterId} Updating matter status to: ${matterStatus}`);
          await ClioService.updateMatterStatus(matterId, matterStatus);
          console.log(`[MATTER] ${matterId} Matter status updated successfully`);
        } else {
          console.log(`[MATTER] ${matterId} No status mapping found for stage: ${currentStageName}`);
        }
      } catch (statusError) {
        console.error(`[MATTER] ${matterId} Failed to update matter status: ${statusError.message}`);
        // Log error but don't fail the entire automation
        await SupabaseService.logError(
          ERROR_CODES.CLIO_API_FAILED,
          `Failed to update matter status: ${statusError.message}`,
          {
            matter_id: matterId,
            stage_id: currentStageId,
            stage_name: currentStageName,
          }
        );
      }

      // Step 3: Check for recent stage changes (3-minute rollback window)
      const recentChange = await SupabaseService.checkRecentStageChange(
        matterId,
        currentStageId,
        config.automation.rollbackWindowMinutes
      );

      // Step 4: Delete tasks if stage changed within rollback window
      if (recentChange) {
        console.log(`[MATTER] ${matterId} Rollback detected - deleting previous tasks`);
        await this.handleRollback(matterId, recentChange.stage_id);
      }

      // Step 5: Update matter-info (current state)
      await SupabaseService.upsertMatterInfo({
        matter_id: matterId,
        matter_name: matterDetails.display_number,
        stage_id: currentStageId,
        stage_name: currentStageName,
        matter_stage_last_updated: matterDetails.matter_stage_updated_at,
        task_generated: true,
      });

      // Step 6: Insert matter history record
      await SupabaseService.insertMatterHistory({
        matter_id: matterId,
        matter_name: matterDetails.display_number,
        stage_id: currentStageId,
        stage_name: currentStageName,
        date: new Date().toISOString(),
        source: 'Clio Tasks Automation - Supabase',
        practice_area: practiceArea,
        practice_area_id: practiceAreaId,
        due_generated: false,
      });

      // Step 7: Get task templates based on practice area
      let taskTemplates = [];

      // Check practice area by ID for reliable detection
      // Estate Planning ID: 44697423 (task-list-non-meeting and task-list-meeting)
      // Probate ID: 45045123 (task-list-probate)
      const PROBATE_PRACTICE_AREA_ID = 45045123;
      const isProbate = practiceAreaId === PROBATE_PRACTICE_AREA_ID;

      if (isProbate) {
        taskTemplates = await SupabaseService.getTaskListProbate(currentStageId);
      } else {
        // Estate Planning or other
        taskTemplates = await SupabaseService.getTaskListNonMeeting(currentStageId);
      }

      // NOTE: We do NOT fall back to task-list-meeting here
      // Tasks from task-list-meeting should ONLY be created when a calendar event is created
      // not when the matter stage changes
      if (taskTemplates.length === 0) {
        console.log(`[MATTER] ${matterId} No templates found for this stage`);
      }

      // Step 7.5: Validate templates
      const validation = SupabaseService.validateTaskTemplates(taskTemplates);
      if (!validation.valid) {
        console.error(`[MATTER] ${matterId} Template validation failed:`, validation.errors);

        // Log each validation error
        for (const error of validation.errors) {
          await SupabaseService.logError(
            error.includes('Duplicate') ? ERROR_CODES.TEMPLATE_DUPLICATE : ERROR_CODES.TEMPLATE_MISSING,
            error,
            {
              matter_id: matterId,
              stage_id: currentStageId,
              stage_name: currentStageName,
              practice_area: practiceArea,
            }
          );
        }

        // Update webhook to failure
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: false,
          action: 'template_validation_failed',
        });

        console.log(`[MATTER] ${matterId} COMPLETED (template validation failed)\n`);
        return { success: false, action: 'template_validation_failed', errors: validation.errors };
      }

      // Step 7.6: Check for existing tasks for this stage (excluding deleted)
      const existingTasks = await SupabaseService.getTasksByMatterAndStage(
        matterId,
        currentStageId,
        null // Get both completed and incomplete tasks
      );

      // Also get deleted tasks count for logging
      const deletedCount = await SupabaseService.getDeletedTasksCount(matterId, currentStageId);

      if (deletedCount > 0) {
        console.log(`[MATTER] ${matterId} Found ${deletedCount} deleted tasks and ${existingTasks.length} active tasks for this stage`);
      } else {
        console.log(`[MATTER] ${matterId} Found ${existingTasks.length} active tasks for this stage`);
      }

      // Step 7.6.5: Check if any existing ACTIVE tasks have calendar_entry_id
      // If tasks were created by calendar automation, skip stage-based generation
      const hasCalendarTasks = existingTasks.some(task => task.calendar_entry_id !== null);
      if (hasCalendarTasks) {
        console.log(`[MATTER] ${matterId} Active tasks with calendar_entry_id found - skipping stage-based generation`);
        console.log(`[MATTER] ${matterId} Calendar automation owns these tasks and will update them if needed`);

        // Update webhook to success (skipped)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_calendar_tasks_exist',
          tasks_found: existingTasks.length,
        });

        console.log(`[MATTER] ${matterId} COMPLETED (calendar tasks exist)\n`);
        return {
          success: true,
          action: 'skipped_calendar_tasks_exist',
          tasksFound: existingTasks.length
        };
      }

      // Step 7.7: Check for missing required data (location, attorney, etc.)
      const missingDataCheck = await this.checkForMissingData(
        taskTemplates,
        matterDetails,
        currentStageName,
        updatingUser
      );

      if (missingDataCheck.hasMissingData) {
        console.log(`[MATTER] ${matterId} Missing required data: ${missingDataCheck.missingFields.join(', ')}`);

        // Create error task instead of generating tasks
        const errorTask = await this.createMissingDataErrorTask(
          matterId,
          matterDetails,
          currentStageName,
          missingDataCheck.missingFields,
          updatingUser
        );

        // Update webhook to success (error task created)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'missing_data_error_task_created',
          tasks_created: 1,
        });

        console.log(`[MATTER] ${matterId} COMPLETED (missing data error task created)\n`);
        return {
          success: true,
          action: 'missing_data_error_task_created',
          missingFields: missingDataCheck.missingFields,
          errorTaskId: errorTask.id
        };
      }

      // Step 8: Generate or update tasks
      const generateTasksStepId = await EventTracker.startStep(traceId, {
        layerName: 'automation',
        stepName: 'generate_tasks',
        metadata: { matterId, templateCount: taskTemplates.length },
      });
      const generateTasksCtx = EventTracker.createContext(traceId, generateTasksStepId);

      let result = { tasksCreated: 0, tasksUpdated: 0, tasksFailed: 0, failures: [] };

      // Filter out Attempt 2, Attempt 3, and No Response - they're created by task completion automation
      // Note: Only filter exact matches for attempt sequence tasks, not tasks that happen to contain these words
      const tasksToCreate = taskTemplates.filter(template => {
        const title = template.task_title?.toLowerCase() || '';
        const isAttempt2 = title === 'attempt 2' || title === 'attempt 2 follow up';
        const isAttempt3 = title === 'attempt 3' || title === 'attempt 3 follow up';
        const isNoResponse = title === 'no response';
        return !isAttempt2 && !isAttempt3 && !isNoResponse;
      });

      if (tasksToCreate.length > 0) {

        if (existingTasks.length === 0) {
          // No existing tasks - create all tasks
          console.log(`[MATTER] ${matterId} No existing tasks - generating ${tasksToCreate.length} tasks (${taskTemplates.length - tasksToCreate.length} deferred)`);
          result = await this.generateTasks(matterId, matterDetails, tasksToCreate, currentStageId, currentStageName, generateTasksCtx);
          console.log(`[MATTER] ${matterId} Task generation complete: ${result.tasksCreated} created, ${result.tasksFailed} failed`);
        } else {
          // Existing tasks found - update incomplete, skip completed, create missing
          console.log(`[MATTER] ${matterId} Existing tasks found - updating incomplete tasks and creating missing tasks`);
          result = await this.updateOrCreateStageTasks(
            matterId,
            matterDetails,
            tasksToCreate,
            existingTasks,
            currentStageId,
            currentStageName,
            generateTasksCtx
          );
          console.log(`[MATTER] ${matterId} Task processing complete: ${result.tasksCreated} created, ${result.tasksUpdated} updated, ${result.tasksFailed} failed`);
        }
      } else {
        console.log(`[MATTER] ${matterId} No templates found for this stage`);
      }

      await EventTracker.endStep(generateTasksStepId, {
        status: result.tasksFailed > 0 ? 'error' : 'success',
        metadata: {
          tasksCreated: result.tasksCreated,
          tasksUpdated: result.tasksUpdated,
          tasksFailed: result.tasksFailed,
        },
      });

      // Step 9: Post-verification (verify all tasks were created)
      let verificationResult = null;
      if (result.tasksCreated > 0 || result.tasksFailed > 0) {
        try {
          verificationResult = await TaskVerificationService.verifyTaskGeneration({
            matterId,
            stageId: currentStageId,
            stageName: currentStageName,
            practiceAreaId,
            matterDetails,
            expectedCount: tasksToCreate.length,
            context: 'stage_change',
            calendarEntryId: null
          }, traceId);

          // Update result with verification data
          if (verificationResult.tasksRegenerated > 0) {
            console.log(`[MATTER] ${matterId} Verification regenerated ${verificationResult.tasksRegenerated} missing tasks`);
            result.tasksCreated += verificationResult.tasksRegenerated;
            result.tasksFailed += (verificationResult.tasksFailed || 0);
            if (verificationResult.failures) {
              result.failures.push(...verificationResult.failures);
            }
          }
        } catch (verifyError) {
          console.error(`[MATTER] ${matterId} Verification failed: ${verifyError.message}`);
          // Don't fail the whole webhook if verification fails
        }
      }

      // Determine if webhook processing was fully successful
      const success = result.tasksFailed === 0;
      const action = result.tasksFailed > 0 ? 'partial_failure' :
                     (result.tasksUpdated > 0 ? 'updated_tasks' : 'created_tasks');

      // Update webhook to success
      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: success,
        action: action,
        tasks_created: result.tasksCreated,
        tasks_updated: result.tasksUpdated || 0,
        failure_details: result.tasksFailed > 0 ? result.failures : undefined,
      });

      console.log(`[MATTER] ${matterId} COMPLETED\n`);
      return {
        success: success,
        tasksCreated: result.tasksCreated,
        tasksFailed: result.tasksFailed,
        failures: result.failures,
      };

    } catch (error) {
      console.error(`[MATTER] ${matterId} ERROR: ${error.message}`);

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
   * Handle rollback - delete tasks from previous stage change
   */
  static async handleRollback(matterId, previousStageId) {
    // Get recently generated tasks
    const recentTasks = await SupabaseService.getRecentlyGeneratedTasks(
      matterId,
      previousStageId,
      config.automation.rollbackWindowMinutes
    );

    console.log(`[MATTER] ${matterId} Deleting ${recentTasks.length} previous tasks`);

    // Delete from Clio
    for (const task of recentTasks) {
      try {
        await ClioService.deleteTask(task.task_id);
      } catch (error) {
        console.error(`[MATTER] ${matterId} Failed to delete task ${task.task_id}: ${error.message}`);
      }
    }

    // Delete from Supabase
    const taskIds = recentTasks.map(t => t.task_id);
    await SupabaseService.deleteTasks(taskIds);
  }

  /**
   * Generate tasks from templates
   * Returns: { tasksCreated, tasksFailed, failures }
   */
  static async generateTasks(matterId, matterDetails, taskTemplates, stageId, stageName, ctx = null) {
    let tasksCreated = 0;
    let tasksFailed = 0;
    const failures = [];

    for (const template of taskTemplates) {
      try {
        // Resolve assignee
        let assignee;
        try {
          const assigneeType = template.assignee?.toString().toUpperCase().trim();

          // Step 1: FUNDING_COOR always uses assignee_id directly
          if (assigneeType === 'FUNDING_COOR') {
            if (!template.assignee_id) {
              throw new AssigneeError(
                ERROR_CODES.ASSIGNEE_INVALID_TYPE,
                `FUNDING_COOR requires assignee_id to be set`,
                { matter_id: matterId, template: template.task_title }
              );
            }
            // Pass assignee_id as lookupReference for FUNDING_COOR
            assignee = await resolveAssignee(template.assignee, matterDetails, null, template.assignee_id);
          }
          // Step 2: Check if assignee_id exists and is numeric
          else if (template.assignee_id && !isNaN(String(template.assignee_id).trim())) {
            // Numeric assignee_id - use directly
            assignee = await resolveAssignee(String(template.assignee_id).trim(), matterDetails);
          }
          // Step 3: If assignee_id is non-numeric, use it as lookup reference
          else if (template.assignee_id) {
            // Non-numeric assignee_id - use as reference (e.g., "location", "attorney")
            assignee = await resolveAssignee(template.assignee, matterDetails, null, template.assignee_id);
          }
          // Step 4: No assignee_id, use assignee field
          else {
            assignee = await resolveAssignee(template.assignee, matterDetails);
          }
        } catch (assigneeError) {
          console.error(`[MATTER] ${matterId} Assignee error: ${assigneeError.message}`);

          // Handle AssigneeError with error codes
          if (assigneeError instanceof AssigneeError) {
            // No attorney error → create task for matter owner or leave unassigned
            if (assigneeError.code === ERROR_CODES.ASSIGNEE_NO_ATTORNEY) {
              const errorTask = await ClioService.createTask({
                name: `⚠️ Assignment Error - ${matterDetails.display_number}`,
                description: `Unable to generate tasks for stage ${stageName}. No attorney assigned to matter.`,
                matter: { id: matterDetails.id },
                due_at: new Date().toISOString(),
                priority: 'high',
              });

              console.log(`[MATTER] ${matterId} Created error task: ${errorTask.id}`);

              // Also log to error_logs
              await SupabaseService.logError(
                assigneeError.code,
                assigneeError.message,
                {
                  ...assigneeError.context,
                  stage_id: stageId,
                  stage_name: stageName,
                  template_title: template.task_title,
                  error_task_id: errorTask.id,
                }
              );

              continue;
            }

            // Other assignee errors (CSC, PARALEGAL, etc.) → log to error_logs only
            await SupabaseService.logError(
              assigneeError.code,
              assigneeError.message,
              {
                ...assigneeError.context,
                stage_id: stageId,
                stage_name: stageName,
                template_title: template.task_title,
              }
            );

            console.log(`[MATTER] ${matterId} Logged error: ${assigneeError.code}`);
            tasksFailed++;
            failures.push({
              task_title: template.task_title,
              task_number: template.task_number,
              error: assigneeError.message,
              error_code: assigneeError.code,
            });
            continue;
          }

          // Non-AssigneeError → log as generic error
          await SupabaseService.logError(
            ERROR_CODES.CLIO_API_FAILED,
            assigneeError.message,
            {
              matter_id: matterId,
              stage_id: stageId,
              stage_name: stageName,
              template_title: template.task_title,
            }
          );

          tasksFailed++;
          failures.push({
            task_title: template.task_title,
            task_number: template.task_number,
            error: assigneeError.message,
            error_code: ERROR_CODES.CLIO_API_FAILED,
          });
          continue;
        }

        // Calculate due date
        const relationType = template['due_date-relational'] || template.due_date_relational || '';
        const isRelationalToTask = relationType.toLowerCase().includes('after task');
        const isAttemptTask = (template.task_title?.toLowerCase() || '').includes('attempt');
        const isMeetingRelated = relationType.toLowerCase().includes('meeting');

        let dueDateFormatted;

        // Check 1: Non-attempt relational task (after task X)
        if (isRelationalToTask && !isAttemptTask) {
          dueDateFormatted = null;
        }
        // Check 2: Meeting-related task (before/after meeting)
        // NOTE: This should not happen in stage change automation since we removed the fallback
        // Meeting-related tasks are only in task-list-meeting and should be created by calendar events
        else if (isMeetingRelated) {
          console.warn(`[MATTER] ${matterId} WARNING: Meeting-related task "${template.task_title}" found in stage change automation`);
          console.warn(`[MATTER] ${matterId} This task should only be created by calendar event automation`);
          // Set to null as fallback
          dueDateFormatted = null;
        }
        // Check 3: Regular task (after creation)
        else {
          const dueDate = calculateDueDate(template, new Date());
          dueDateFormatted = formatForClio(dueDate);
        }

        // Build task data
        const taskData = {
          name: template.task_title,
          description: template['task-description'] || template.task_description || template.task_desc,
          matter: { id: matterDetails.id },
        };

        // Only add due_at if it's not null
        if (dueDateFormatted) {
          taskData.due_at = dueDateFormatted;
        }

        // Only add assignee if resolved (not null)
        if (assignee) {
          taskData.assignee = { id: assignee.id, type: assignee.type };
        }

        // Create task in Clio - pass full task metadata for logging
        let clioTask;
        try {
          clioTask = await ClioService.createTask(taskData, ctx, {
            taskNumber: template.task_number,
            assigneeName: assignee?.name,
            assigneeType: assignee?.type,
            assigneeSource: template.assignee_id ? 'template' : 'resolver',
            dueDateSource: isRelationalToTask ? 'relational' : (isMeetingRelated ? 'meeting' : 'creation'),
            stageId: stageId,
            stageName: stageName,
          });
        } catch (clioError) {
          console.error(`[MATTER] ${matterId} Clio API failed: ${clioError.message}`);

          // Log Clio API failure
          await SupabaseService.logError(
            ERROR_CODES.CLIO_API_FAILED,
            `Failed to create task in Clio: ${clioError.message}`,
            {
              matter_id: matterId,
              stage_id: stageId,
              stage_name: stageName,
              template_title: template.task_title,
            }
          );

          tasksFailed++;
          failures.push({
            task_title: template.task_title,
            task_number: template.task_number,
            error: `Clio API failed: ${clioError.message}`,
            error_code: ERROR_CODES.CLIO_API_FAILED,
          });
          continue; // Skip to next task
        }

        const dueInfo = dueDateFormatted ? `Due: ${dueDateFormatted}` : 'Due: TBD';
        console.log(`[MATTER] ${matterId} Created task: ${template.task_title} (${dueInfo})`);

        // Record in Supabase
        try {
          await SupabaseService.insertTask({
            task_id: clioTask.id,
            task_name: clioTask.name,
            task_desc: clioTask.description,
            matter_id: matterDetails.id,
            assigned_user_id: assignee?.id || null,
            assigned_user: assignee?.name || 'Unassigned',
            due_date: dueDateFormatted || null,
            stage_id: stageId,
            stage_name: stageName,
            task_number: template.task_number,
            completed: false,
            status: 'pending',
            task_date_generated: new Date().toISOString(),
            due_date_generated: dueDateFormatted ? new Date().toISOString() : null,
          });

          // Task successfully created and recorded
          tasksCreated++;
        } catch (supabaseError) {
          console.error(`[MATTER] ${matterId} Supabase sync failed: ${supabaseError.message}`);

          // Log orphaned task (created in Clio but not in Supabase)
          await SupabaseService.logError(
            ERROR_CODES.SUPABASE_SYNC_FAILED,
            `Task created in Clio but failed to record in Supabase: ${supabaseError.message}`,
            {
              matter_id: matterId,
              task_id: clioTask.id,
              stage_id: stageId,
              stage_name: stageName,
              template_title: template.task_title,
            }
          );

          // Count as success (task exists in Clio)
          tasksCreated++;
        }

      } catch (error) {
        console.error(`[MATTER] ${matterId} Failed to create task: ${error.message}`);
        tasksFailed++;
        failures.push({
          task_title: template.task_title,
          task_number: template.task_number,
          error: error.message,
          error_code: 'UNKNOWN_ERROR',
        });
      }
    }

    return { tasksCreated, tasksFailed, failures };
  }

  /**
   * Update existing incomplete tasks and create missing tasks when returning to a stage
   * - Skip completed tasks (don't regenerate)
   * - Update incomplete tasks with new due dates
   * - Create tasks that don't exist yet
   */
  static async updateOrCreateStageTasks(matterId, matterDetails, taskTemplates, existingTasks, stageId, stageName, ctx = null) {
    let tasksCreated = 0;
    let tasksUpdated = 0;
    let tasksFailed = 0;
    const failures = [];

    for (const template of taskTemplates) {
      try {
        // Check if task already exists
        const existingTask = existingTasks.find(t => t.task_number === template.task_number);

        if (existingTask && existingTask.completed) {
          // Task completed - skip it
          console.log(`[MATTER] ${matterId} Skipping completed task: ${template.task_title}`);
          continue;
        }

        // Resolve assignee
        let assignee;
        try {
          const assigneeType = template.assignee?.toString().toUpperCase().trim();

          // Step 1: FUNDING_COOR always uses assignee_id directly
          if (assigneeType === 'FUNDING_COOR') {
            if (!template.assignee_id) {
              throw new AssigneeError(
                ERROR_CODES.ASSIGNEE_INVALID_TYPE,
                `FUNDING_COOR requires assignee_id to be set`,
                { matter_id: matterId, template: template.task_title }
              );
            }
            // Pass assignee_id as lookupReference for FUNDING_COOR
            assignee = await resolveAssignee(template.assignee, matterDetails, null, template.assignee_id);
          }
          // Step 2: Check if assignee_id exists and is numeric
          else if (template.assignee_id && !isNaN(String(template.assignee_id).trim())) {
            // Numeric assignee_id - use directly
            assignee = await resolveAssignee(String(template.assignee_id).trim(), matterDetails);
          }
          // Step 3: If assignee_id is non-numeric, use it as lookup reference
          else if (template.assignee_id) {
            // Non-numeric assignee_id - use as reference (e.g., "location", "attorney")
            assignee = await resolveAssignee(template.assignee, matterDetails, null, template.assignee_id);
          }
          // Step 4: No assignee_id, use assignee field
          else {
            assignee = await resolveAssignee(template.assignee, matterDetails);
          }
        } catch (assigneeError) {
          console.error(`[MATTER] ${matterId} Assignee error: ${assigneeError.message}`);
          if (assigneeError instanceof AssigneeError) {
            await SupabaseService.logError(
              assigneeError.code,
              assigneeError.message,
              {
                ...assigneeError.context,
                stage_id: stageId,
                stage_name: stageName,
                template_title: template.task_title,
              }
            );
          }
          tasksFailed++;
          failures.push({
            task_title: template.task_title,
            task_number: template.task_number,
            error: assigneeError.message,
            error_code: assigneeError.code || ERROR_CODES.CLIO_API_FAILED,
          });
          continue;
        }

        // Calculate due date
        const relationType = template['due_date-relational'] || template.due_date_relation || '';
        const isRelationalToTask = relationType.toLowerCase().includes('after task');
        const isAttemptTask = /attempt [2-3]/i.test(template.task_title || '');

        let dueDateFormatted = null;
        if (!isRelationalToTask || isAttemptTask) {
          const dueDate = calculateDueDate(template, new Date());
          dueDateFormatted = formatForClio(dueDate);
        } else {
          // Task is relative to another task's completion
          // Check if the parent task is already completed
          const parentTaskNumber = this.extractParentTaskNumber(relationType);

          if (parentTaskNumber !== null) {
            const parentTask = existingTasks.find(t => t.task_number === parentTaskNumber);

            if (parentTask && parentTask.completed) {
              // Parent task is completed - calculate due date from NOW (stage change time)
              // This gives the task a "second chance" to get a due date
              console.log(`[MATTER] ${matterId} Parent task ${parentTaskNumber} already completed, calculating due date from stage change time`);
              const dueDate = calculateDueDate(template, new Date());
              dueDateFormatted = formatForClio(dueDate);
            } else {
              // Parent task not completed yet - keep NULL (will be set when parent completes)
              dueDateFormatted = null;
            }
          } else {
            // Could not parse parent task number - keep NULL
            dueDateFormatted = null;
          }
        }

        if (existingTask) {
          // Task exists in Supabase - try to update it in Clio
          console.log(`[MATTER] ${matterId} Updating incomplete task: ${template.task_title}`);

          try {
            await ClioService.updateTask(existingTask.task_id, {
              due_at: dueDateFormatted,
              assignee: { id: assignee.id, type: assignee.type },
            }, ctx);

            await SupabaseService.updateTask(existingTask.task_id, {
              due_date: dueDateFormatted || null,
              assigned_user_id: assignee.id,
              assigned_user: assignee.name,
              due_date_generated: dueDateFormatted ? new Date().toISOString() : null,
            });

            tasksUpdated++;
          } catch (updateError) {
            // If task was deleted in Clio (404), create a new one
            if (updateError.response?.status === 404 || updateError.message?.includes('404')) {
              console.log(`[MATTER] ${matterId} Task deleted in Clio - creating new task: ${template.task_title}`);

              // Delete old task record from Supabase
              await SupabaseService.updateTask(existingTask.task_id, {
                status: 'deleted',
                last_updated: new Date().toISOString(),
              });

              // Create new task in Clio
              const clioTask = await ClioService.createTask({
                name: template.task_title,
                description: template['task-description'] || template.task_description || template.task_desc,
                matter: { id: matterId },
                assignee: { id: assignee.id, type: assignee.type },
                due_at: dueDateFormatted,
              }, ctx, {
                taskNumber: template.task_number,
                assigneeName: assignee?.name,
                assigneeType: assignee?.type,
                dueDateSource: isRelationalToTask ? 'relational' : 'creation',
                stageId: stageId,
                stageName: stageName,
              });

              // Insert new task in Supabase
              await SupabaseService.insertTask({
                task_id: clioTask.id,
                task_name: clioTask.name,
                task_desc: clioTask.description,
                matter_id: matterId,
                assigned_user_id: assignee.id,
                assigned_user: assignee.name,
                due_date: dueDateFormatted || null,
                stage_id: stageId,
                stage_name: stageName,
                task_number: template.task_number,
                completed: false,
                task_date_generated: new Date().toISOString(),
                due_date_generated: dueDateFormatted ? new Date().toISOString() : null,
              });

              tasksCreated++;
            } else {
              // Other error - rethrow
              throw updateError;
            }
          }
        } else {
          // Task doesn't exist - create it
          console.log(`[MATTER] ${matterId} Creating missing task: ${template.task_title}`);

          const clioTask = await ClioService.createTask({
            name: template.task_title,
            description: template['task-description'] || template.task_description || template.task_desc,
            matter: { id: matterId },
            assignee: { id: assignee.id, type: assignee.type },
            due_at: dueDateFormatted,
          }, ctx, {
            taskNumber: template.task_number,
            assigneeName: assignee?.name,
            assigneeType: assignee?.type,
            dueDateSource: isRelationalToTask ? 'relational' : 'creation',
            stageId: stageId,
            stageName: stageName,
          });

          await SupabaseService.insertTask({
            task_id: clioTask.id,
            task_name: clioTask.name,
            task_desc: clioTask.description,
            matter_id: matterId,
            assigned_user_id: assignee.id,
            assigned_user: assignee.name,
            due_date: dueDateFormatted || null,
            stage_id: stageId,
            stage_name: stageName,
            task_number: template.task_number,
            completed: false,
            task_date_generated: new Date().toISOString(),
            due_date_generated: dueDateFormatted ? new Date().toISOString() : null,
          });

          tasksCreated++;
        }

      } catch (error) {
        console.error(`[MATTER] ${matterId} Failed to process task: ${error.message}`);
        tasksFailed++;
        failures.push({
          task_title: template.task_title,
          task_number: template.task_number,
          error: error.message,
          error_code: 'UNKNOWN_ERROR',
        });
      }
    }

    return { tasksCreated, tasksUpdated, tasksFailed, failures };
  }

  /**
   * Extract parent task number from relational string
   * Examples:
   *   "after task 1" → 1
   *   "after task 2" → 2
   *   "3 days after task 5" → 5
   * Returns null if cannot parse
   */
  static extractParentTaskNumber(relationType) {
    if (!relationType) return null;

    // Match patterns like "after task 1", "3 days after task 2", etc.
    const match = relationType.match(/after\s+task\s+(\d+)/i);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }

    return null;
  }

  /**
   * Check if matter is missing required data for task generation
   */
  static async checkForMissingData(taskTemplates, matterDetails, stageName) {
    const missingFields = [];
    const matterId = matterDetails.id;

    // Check if any templates require location-based assignment (CSC, location)
    const requiresLocation = taskTemplates.some(t => {
      const assignee = (t.assignee || '').toLowerCase();
      return assignee.includes('csc') || assignee.includes('location');
    });

    if (requiresLocation && !matterDetails.location) {
      missingFields.push('location');
      console.log(`[MATTER] ${matterId} Missing location (required for CSC/location-based tasks)`);
    }

    // Check if any templates require attorney
    const requiresAttorney = taskTemplates.some(t => {
      const assignee = (t.assignee || '').toLowerCase();
      return assignee.includes('attorney') || assignee.includes('originating attorney');
    });

    // Check for attorney - prioritize responsible_attorney over originating_attorney
    if (requiresAttorney) {
      if (matterDetails.responsible_attorney?.id) {
        // Has responsible attorney - valid
      } else if (matterDetails.originating_attorney?.id) {
        // Has originating attorney as fallback - valid
      } else {
        // No attorney found - invalid
        missingFields.push('responsible_attorney');
        console.log(`[MATTER] ${matterId} Missing responsible attorney (required for attorney-based tasks)`);
      }
    }

    // Check for signing meeting location requirement (if stage involves signing)
    if (stageName && stageName.toLowerCase().includes('signing')) {
      // For signing meetings, we need meeting location which comes from calendar events
      // This is handled differently - we'll mark it as needing signing meeting location
      const requiresSigningLocation = taskTemplates.some(t => {
        const assigneeId = t.assignee_id || '';
        return assigneeId === 'signing_meeting_location';
      });

      if (requiresSigningLocation) {
        // We can't check this here since it comes from calendar events
        // We'll handle this in the meeting-scheduled automation instead
      }
    }

    return {
      hasMissingData: missingFields.length > 0,
      missingFields
    };
  }

  /**
   * Create error task when required data is missing
   */
  static async createMissingDataErrorTask(matterId, matterDetails, stageName, missingFields, updatingUser) {
    // Determine what's missing and craft appropriate message
    let missingDataDescription = '';

    if (missingFields.includes('location')) {
      missingDataDescription += '\n• Matter Location (SHLF Naples, SHLF Fort Myers, or SHLF Bonita Springs)';
    }

    if (missingFields.includes('responsible_attorney')) {
      missingDataDescription += '\n• Responsible Attorney';
    }

    const errorTaskData = {
      name: `⚠️ Missing Data - Cannot Generate Tasks for ${stageName}`,
      description: `Please add the following information to this matter:${missingDataDescription}\n\nOnce you've added the missing information, mark this task as complete and the automation will regenerate the tasks for ${stageName} stage automatically.`,
      matter: { id: matterId },
      priority: 'high',
      due_at: new Date().toISOString(), // Due immediately
    };

    // Always assign to Jacqui (357379471) for missing data tasks
    // Same user ID as VA assignee type in assignee-resolver.js
    errorTaskData.assignee = {
      id: 357379471,
      type: 'User'
    };
    console.log(`[MATTER] ${matterId} Assigning error task to Jacqui (357379471)`);

    // Create the error task in Clio
    const errorTask = await ClioService.createTask(errorTaskData);
    console.log(`[MATTER] ${matterId} Created error task: ${errorTask.id}`);

    // Record in Supabase with special marker
    await SupabaseService.insertTask({
      task_id: errorTask.id,
      task_name: errorTask.name,
      task_desc: errorTask.description,
      matter_id: matterId,
      assigned_user_id: 357379471, // Jacqui
      assigned_user: 'Jacqui',
      due_date: errorTaskData.due_at,
      stage_id: matterDetails.matter_stage?.id,
      stage_name: stageName,
      task_number: -1, // Special marker for error tasks
      completed: false,
      task_date_generated: new Date().toISOString(),
      due_date_generated: new Date().toISOString(),
    });

    // Log error for tracking
    await SupabaseService.logError(
      ERROR_CODES.VALIDATION_MISSING_DATA || 'MISSING_DATA',
      `Missing required data for task generation: ${missingFields.join(', ')}`,
      {
        matter_id: matterId,
        stage_name: stageName,
        missing_fields: missingFields,
        error_task_id: errorTask.id,
      }
    );

    return errorTask;
  }
}
