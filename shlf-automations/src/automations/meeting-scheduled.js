import { ClioService } from '../services/clio.js';
import { SupabaseService } from '../services/supabase.js';
import { TaskVerificationService } from '../services/task-verification.js';
import { calculateDueDate, formatForClio } from '../utils/date-helpers.js';
import { resolveAssignee } from '../utils/assignee-resolver.js';
import { AssigneeError } from '../utils/assignee-error.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { config } from '../config/index.js';
import { EventTracker } from '../services/event-tracker.js';

/**
 * AUTOMATION #3: Due Date Relative to Meeting
 *
 * Triggers: When a calendar entry is created/updated
 *
 * Process:
 * 1. Get calendar entry details
 * 2. Map calendar event type to stage ID (from database)
 * 3. Check/record meeting in Supabase
 * 4. Generate or update tasks with due dates relative to meeting
 * 5. Special handling for signing meetings (use meeting location)
 */

export class MeetingScheduledAutomation {
  /**
   * Main entry point for meeting scheduled automation
   *
   * @param {Object} webhookData - The webhook payload from Clio
   * @param {string} [traceId] - Optional trace ID for event tracking
   */
  static async process(webhookData, traceId = null) {
    const calendarEntryId = webhookData.data.id;

    // Determine if this is a create or update event
    // Use updated_at if it exists and is different from created_at
    const isUpdate = webhookData.data.updated_at &&
                     webhookData.data.created_at !== webhookData.data.updated_at;
    const eventType = isUpdate ? 'calendar_entry.updated' : 'calendar_entry.created';

    // Use updated_at for updates (so each update has unique idempotency key)
    // Use created_at for creates
    const timestamp = isUpdate ? webhookData.data.updated_at : webhookData.data.created_at;

    console.log(`[CALENDAR] ${calendarEntryId} ${isUpdate ? 'UPDATED' : 'CREATED'}`);
    console.log(`[CALENDAR] ${calendarEntryId} Timestamps - created_at: ${webhookData.data.created_at}, updated_at: ${webhookData.data.updated_at}`);

    // Step: Validation
    const validationStepId = await EventTracker.startStep(traceId, {
      layerName: 'processing',
      stepName: 'validation',
      input: {
        calendarEntryId,
        eventType,
        isUpdate,
        timestamp,
        webhookId: webhookData.id,
      },
    });

    // Validate timestamp exists (required for idempotency)
    if (!timestamp) {
      const error = `Webhook missing required timestamp fields (created_at, updated_at)`;
      console.error(`[CALENDAR] ${calendarEntryId} ${error}`);

      await SupabaseService.logError(
        ERROR_CODES.CLIO_API_FAILED,
        error,
        {
          calendar_entry_id: calendarEntryId,
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
      output: { valid: true, calendarEntryId, eventType, isUpdate },
    });

    // Step: Idempotency check
    const idempotencyStepId = await EventTracker.startStep(traceId, {
      layerName: 'processing',
      stepName: 'idempotency_check',
      input: {
        calendarEntryId,
        eventType,
        timestamp,
      },
    });
    const idempotencyKey = SupabaseService.generateIdempotencyKey(
      eventType,
      calendarEntryId,
      timestamp
    );

    const existing = await SupabaseService.checkWebhookProcessed(idempotencyKey);
    if (existing) {
      // Check if webhook is still processing
      if (existing.success === null) {
        console.log(`[CALENDAR] ${calendarEntryId} Still processing (concurrent request)`);
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

      console.log(`[CALENDAR] ${calendarEntryId} Already processed (idempotency) at ${existing.processed_at}`);
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

    // Step 0.5: Reserve webhook immediately (prevents duplicate processing)
    await SupabaseService.recordWebhookProcessed({
      idempotency_key: idempotencyKey,
      webhook_id: webhookData.id,
      event_type: eventType,
      resource_type: 'calendar_entry',
      resource_id: calendarEntryId,
      success: null, // NULL = processing
      action: 'processing',
      webhook_payload: webhookData,
    });

    const startTime = Date.now();

    try {
      // Step 1: Fetch calendar entry details
      const fetchCalendarStepId = await EventTracker.startStep(traceId, {
        layerName: 'service',
        stepName: 'fetch_calendar_entry',
        input: {
          calendarEntryId,
          operation: 'get_calendar_entry_details',
        },
      });

      const calendarEntry = await ClioService.getCalendarEntry(calendarEntryId);

      const calendarEventTypeId = calendarEntry.calendar_entry_event_type?.id;
      const calendarEventTypeName = calendarEntry.calendar_entry_event_type?.name;
      const matterId = calendarEntry.matter?.id;
      const meetingLocation = calendarEntry.location;
      const meetingDate = calendarEntry.start_at;

      // Step 1.5: Validate meeting date (required for task due date calculations)
      if (!meetingDate) {
        const error = `Calendar entry missing required start_at date`;
        console.error(`[CALENDAR] ${calendarEntryId} ${error}`);

        await EventTracker.endStep(fetchCalendarStepId, {
          status: 'error',
          errorMessage: error,
          output: {
            found: true,
            calendarEntryId,
            hasMeetingDate: false,
            reason: 'missing_start_at',
          },
        });

        await SupabaseService.logError(
          ERROR_CODES.VALIDATION_MISSING_REQUIRED_FIELD,
          error,
          {
            calendar_entry_id: calendarEntryId,
            calendar_data: {
              id: calendarEntry.id,
              start_at: calendarEntry.start_at,
              matter: calendarEntry.matter,
              calendar_entry_event_type: calendarEntry.calendar_entry_event_type,
            },
          }
        );

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: false,
          action: 'missing_meeting_date',
        });

        console.log(`[CALENDAR] ${calendarEntryId} COMPLETED (missing meeting date)\n`);
        return { success: false, action: 'missing_meeting_date' };
      }

      // Test mode filter - only process meetings for specific matter when TEST_MODE is enabled
      if (config.testing.testMode && matterId !== config.testing.testMatterId) {
        console.log(`[CALENDAR] ${calendarEntryId} SKIPPED (test mode - matter ${matterId} !== ${config.testing.testMatterId})`);

        await EventTracker.endStep(fetchCalendarStepId, {
          status: 'skipped',
          output: {
            found: true,
            calendarEntryId,
            matterId,
            reason: 'test_mode_blocked',
          },
        });

        // Update webhook to success (skipped)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_test_mode',
        });

        return { success: true, action: 'skipped_test_mode' };
      }

      if (!calendarEventTypeId) {
        console.log(`[CALENDAR] ${calendarEntryId} No event type, skipping`);

        await EventTracker.endStep(fetchCalendarStepId, {
          status: 'skipped',
          output: {
            found: true,
            calendarEntryId,
            hasEventType: false,
            reason: 'no_event_type',
          },
        });

        // Update webhook to success (skipped)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_no_event_type',
        });

        return { success: true, action: 'skipped' };
      }

      if (!matterId) {
        console.log(`[CALENDAR] ${calendarEntryId} No matter associated`);

        await EventTracker.endStep(fetchCalendarStepId, {
          status: 'skipped',
          output: {
            found: true,
            calendarEntryId,
            hasMatter: false,
            reason: 'no_matter_associated',
          },
        });

        // Update webhook to success (skipped)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'no_matter',
        });

        return { success: true, action: 'no_matter' };
      }

      await EventTracker.endStep(fetchCalendarStepId, {
        status: 'success',
        output: {
          found: true,
          calendarEntryId,
          matterId,
          meetingDate,
          meetingLocation,
          calendarEventTypeId,
          calendarEventTypeName,
        },
      });

      // Step 2: Map calendar event to stage (from database)
      const mapEventStepId = await EventTracker.startStep(traceId, {
        layerName: 'service',
        stepName: 'map_event_to_stage',
        input: {
          calendarEventTypeId,
          calendarEventTypeName,
          operation: 'lookup_stage_mapping',
        },
      });

      const mapping = await SupabaseService.getCalendarEventMapping(calendarEventTypeId);
      if (!mapping) {
        console.log(`[CALENDAR] ${calendarEntryId} Event type not mapped`);

        await EventTracker.endStep(mapEventStepId, {
          status: 'skipped',
          output: {
            mapped: false,
            calendarEventTypeId,
            reason: 'event_type_not_mapped',
          },
        });

        // Update webhook to success (skipped)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'not_mapped',
        });

        return { success: true, action: 'not_mapped' };
      }

      await EventTracker.endStep(mapEventStepId, {
        status: 'success',
        output: {
          mapped: true,
          calendarEventTypeId,
          stageId: mapping.stage_id,
          stageName: mapping.stage_name,
          usesMeetingLocation: mapping.uses_meeting_location,
        },
      });

      console.log(`[CALENDAR] ${calendarEntryId} Confirmed for matter ${matterId}`);
      console.log(`[CALENDAR] ${calendarEntryId} Meeting: ${mapping.stage_name} on ${meetingDate}`);

      // Step 3: Check/record meeting in Supabase
      const existingMeeting = await SupabaseService.getMeetingRecord(matterId, calendarEventTypeId);

      await SupabaseService.upsertMeetingBooking({
        matter_id: matterId,
        calendar_event_id: calendarEventTypeId,
        calendar_entry_id: calendarEntryId,
        date: meetingDate,
        tasks_booked: true,
      });

      // Step 4: Fetch matter details
      const fetchMatterStepId = await EventTracker.startStep(traceId, {
        layerName: 'service',
        stepName: 'fetch_matter',
        input: {
          matterId,
          operation: 'get_matter_details',
        },
      });

      const matterDetails = await ClioService.getMatter(matterId);

      // Step 4.1: Filter out closed matters
      if (matterDetails.status === 'Closed') {
        console.log(`[CALENDAR] ${calendarEntryId} SKIPPED (matter is closed)`);

        await EventTracker.endStep(fetchMatterStepId, {
          status: 'skipped',
          output: {
            found: true,
            matterId,
            matterStatus: matterDetails.status,
            reason: 'matter_is_closed',
          },
        });

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_closed_matter',
        });

        return { success: true, action: 'skipped_closed_matter' };
      }

      await EventTracker.endStep(fetchMatterStepId, {
        status: 'success',
        output: {
          found: true,
          matterId,
          matterName: matterDetails.display_number,
          matterStatus: matterDetails.status,
          clientName: matterDetails.client?.name,
          matterLocation: matterDetails.location,
          practiceArea: matterDetails.practice_area?.name,
        },
      });

      // Step 5: Get task templates for this meeting type
      const taskTemplates = await SupabaseService.getTaskListMeeting(calendarEventTypeId);

      if (taskTemplates.length === 0) {
        console.log(`[CALENDAR] ${calendarEntryId} No task templates found`);

        // Update webhook to success (no templates)
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'no_templates',
        });

        return { success: true, action: 'no_templates' };
      }

      // Step 5.5: Validate templates
      const validation = SupabaseService.validateTaskTemplates(taskTemplates);
      if (!validation.valid) {
        console.error(`[CALENDAR] ${calendarEntryId} Template validation failed:`, validation.errors);

        // Log each validation error
        for (const error of validation.errors) {
          await SupabaseService.logError(
            error.includes('Duplicate') ? ERROR_CODES.TEMPLATE_DUPLICATE : ERROR_CODES.TEMPLATE_MISSING,
            error,
            {
              matter_id: matterId,
              calendar_entry_id: calendarEntryId,
              calendar_event_type_id: calendarEventTypeId,
              stage_name: mapping.stageName,
            }
          );
        }

        // Update webhook to failure
        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: false,
          action: 'template_validation_failed',
        });

        console.log(`[CALENDAR] ${calendarEntryId} COMPLETED (template validation failed)\n`);
        return { success: false, action: 'template_validation_failed', errors: validation.errors };
      }

      // Step 6: Check for existing tasks - either from this calendar entry OR from stage automation
      const checkExistingTasksStepId = await EventTracker.startStep(traceId, {
        layerName: 'service',
        stepName: 'check_existing_tasks',
        input: {
          calendarEntryId,
          matterId,
          stageId: mapping.stage_id,
          stageName: mapping.stage_name,
        },
      });

      const existingTasksForCalendarEntry = await SupabaseService.getTasksByCalendarEntryId(calendarEntryId);
      const existingTasksForStage = await SupabaseService.getTasksByMatterAndStage(
        matterId,
        mapping.stage_id,
        null // Get both completed and incomplete
      );

      // Filter stage tasks to only those WITHOUT calendar_entry_id (stage-generated tasks)
      const stageGeneratedTasks = existingTasksForStage.filter(task => task.calendar_entry_id === null);

      await EventTracker.endStep(checkExistingTasksStepId, {
        status: 'success',
        output: {
          calendarEntryTasksCount: existingTasksForCalendarEntry.length,
          stageGeneratedTasksCount: stageGeneratedTasks.length,
          hasCalendarTasks: existingTasksForCalendarEntry.length > 0,
          hasStageTasks: stageGeneratedTasks.length > 0,
          scenario: existingTasksForCalendarEntry.length > 0 ? 'update_calendar_tasks' :
                    stageGeneratedTasks.length > 0 ? 'link_stage_tasks' : 'create_new_tasks',
        },
      });

      console.log(`[CALENDAR] ${calendarEntryId} Found ${existingTasksForCalendarEntry.length} existing tasks for this calendar entry`);
      console.log(`[CALENDAR] ${calendarEntryId} Found ${stageGeneratedTasks.length} existing stage-generated tasks (without calendar_entry_id)`);
      console.log(`[CALENDAR] ${calendarEntryId} Meeting location: "${meetingLocation}"`);
      console.log(`[CALENDAR] ${calendarEntryId} Matter location: "${matterDetails.location}"`);
      console.log(`[CALENDAR] ${calendarEntryId} Uses meeting location: ${mapping.uses_meeting_location}`);

      // Step 6.5: Check for missing required data
      const { MatterStageChangeAutomation } = await import('./matter-stage-change.js');
      const missingDataCheck = await MatterStageChangeAutomation.checkForMissingData(
        taskTemplates,
        matterDetails,
        mapping.stage_name
      );

      if (missingDataCheck.hasMissingData) {
        console.log(`[CALENDAR] ${calendarEntryId} Missing required data: ${missingDataCheck.missingFields.join(', ')}`);

        // Create error task
        const updatingUser = webhookData.data.user;
        const errorTask = await MatterStageChangeAutomation.createMissingDataErrorTask(
          matterId,
          matterDetails,
          mapping.stage_name,
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

        console.log(`[CALENDAR] ${calendarEntryId} COMPLETED (missing data error task created)\n`);
        return {
          success: true,
          action: 'missing_data_error_task_created',
          missingFields: missingDataCheck.missingFields,
          errorTaskId: errorTask.id
        };
      }

      let tasksCreated = 0;
      let tasksUpdated = 0;
      let tasksLinked = 0;
      let tasksFailed = 0;
      let failures = [];
      let createdTasksList = []; // Track created tasks with full details
      let action = 'no_changes';

      // Step 7: Generate/Update Tasks
      const generateTasksStepId = await EventTracker.startStep(traceId, {
        layerName: 'automation',
        stepName: 'generate_tasks',
        input: {
          calendarEntryId,
          matterId,
          stageName: mapping.stage_name,
          meetingDate,
          meetingLocation,
          templateCount: taskTemplates.length,
          existingCalendarTasksCount: existingTasksForCalendarEntry.length,
          existingStageTasksCount: stageGeneratedTasks.length,
          scenario: existingTasksForCalendarEntry.length > 0 ? 'update_calendar_tasks' :
                    stageGeneratedTasks.length > 0 ? 'link_stage_tasks' : 'create_new_tasks',
        },
      });

      // Step 7: Handle three scenarios
      if (existingTasksForCalendarEntry.length > 0) {
        // Scenario A: Tasks already exist for this calendar entry - UPDATE them
        console.log(`[CALENDAR] ${calendarEntryId} Updating ${existingTasksForCalendarEntry.length} existing tasks for this calendar entry`);

        const updateResult = await this.updateCalendarEntryTasks(
          existingTasksForCalendarEntry,
          taskTemplates,
          meetingDate,
          meetingLocation,
          matterDetails,
          mapping,
          calendarEntryId
        );

        tasksUpdated = updateResult.tasksUpdated;
        tasksCreated += updateResult.tasksCreated || 0;
        tasksFailed += updateResult.tasksFailed || 0;

        action = 'tasks_updated';
        console.log(`[CALENDAR] ${calendarEntryId} Updated ${tasksUpdated} tasks, Created ${updateResult.tasksCreated || 0} (regenerated), Failed ${updateResult.tasksFailed || 0}`);

      } else if (stageGeneratedTasks.length > 0) {
        // Scenario B: Tasks already exist from stage automation - LINK and UPDATE them
        console.log(`[CALENDAR] ${calendarEntryId} Found ${stageGeneratedTasks.length} stage-generated tasks - linking and updating them`);

        const result = await this.linkAndUpdateStageTasks(
          calendarEntryId,
          stageGeneratedTasks,
          taskTemplates,
          meetingDate,
          meetingLocation,
          matterDetails,
          mapping
        );

        tasksLinked = result.tasksLinked;
        tasksUpdated = result.tasksUpdated;
        tasksCreated += result.tasksCreated || 0;
        tasksFailed += result.tasksFailed || 0;
        action = 'tasks_linked_and_updated';
        console.log(`[CALENDAR] ${calendarEntryId} Linked ${tasksLinked} tasks, Updated ${tasksUpdated} tasks, Created ${result.tasksCreated || 0} (regenerated), Failed ${result.tasksFailed || 0}`);

      } else {
        // Scenario C: No existing tasks - CREATE them from templates
        console.log(`[CALENDAR] ${calendarEntryId} No existing tasks found - creating tasks from templates`);

        const result = await this.processTaskTemplates(
          calendarEntryId,
          taskTemplates,
          matterDetails,
          mapping,
          meetingDate,
          meetingLocation,
          [], // No existing tasks
          'create'
        );

        tasksCreated = result.tasksCreated;
        tasksFailed = result.tasksFailed || 0;
        failures = result.failures || [];
        createdTasksList = result.tasks || []; // Capture created tasks
        action = 'tasks_created';
        console.log(`[CALENDAR] ${calendarEntryId} Created ${tasksCreated} new tasks`);
      }

      // End generate_tasks step with output (including tasks array like matter-stage-change)
      await EventTracker.endStep(generateTasksStepId, {
        status: tasksFailed > 0 ? 'error' : 'success',
        output: {
          action,
          tasksCreated,
          tasksUpdated,
          tasksLinked,
          tasksFailed,
          stageName: mapping.stage_name,
          meetingDate,
          tasks: createdTasksList, // Full task details array
        },
      });

      // Post-verification (verify all tasks were created)
      let verificationResult = null;
      if (tasksCreated > 0 || tasksFailed > 0) {
        try {
          verificationResult = await TaskVerificationService.verifyTaskGeneration({
            matterId: matterDetails.id,
            stageId: mapping.stage_id,
            stageName: mapping.stage_name,
            practiceAreaId: matterDetails.practice_area?.id,
            matterDetails,
            expectedCount: taskTemplates.length,
            context: 'meeting_scheduled',
            calendarEntryId
          });

          if (verificationResult.tasksRegenerated > 0) {
            console.log(`[CALENDAR] ${calendarEntryId} Verification regenerated ${verificationResult.tasksRegenerated} missing tasks`);
            tasksCreated += verificationResult.tasksRegenerated;
            tasksFailed += (verificationResult.tasksFailed || 0);
            if (verificationResult.failures) {
              failures.push(...verificationResult.failures);
            }
          }
        } catch (verifyError) {
          console.error(`[CALENDAR] ${calendarEntryId} Verification failed: ${verifyError.message}`);
          // Don't fail the whole webhook if verification fails
        }
      }

      // Update webhook to success
      // Note: tasks_linked is tracked in 'action' field, not as separate column
      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: true,
        action,
        tasks_created: tasksCreated,
        tasks_updated: tasksUpdated,
      });

      console.log(`[CALENDAR] ${calendarEntryId} COMPLETED - Created: ${tasksCreated}, Updated: ${tasksUpdated}, Linked: ${tasksLinked}\n`);
      return { success: true, action, tasksCreated, tasksUpdated, tasksLinked };

    } catch (error) {
      console.error(`[CALENDAR] ${calendarEntryId} ERROR: ${error.message}`);

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
   * Process task templates - create or update tasks
   */
  static async processTaskTemplates(
    calendarEntryId,
    taskTemplates,
    matterDetails,
    mapping,
    meetingDate,
    meetingLocation,
    existingTasks,
    action
  ) {
    console.log(`[CALENDAR] ${calendarEntryId} processTaskTemplates called with:`);
    console.log(`[CALENDAR] ${calendarEntryId}   - calendarEntryId: ${calendarEntryId}`);
    console.log(`[CALENDAR] ${calendarEntryId}   - action: ${action}`);
    console.log(`[CALENDAR] ${calendarEntryId}   - templates: ${taskTemplates.length}`);
    console.log(`[CALENDAR] ${calendarEntryId}   - existingTasks: ${existingTasks.length}`);

    let tasksCreated = 0;
    let tasksFailed = 0;
    const failures = [];
    const createdTasks = []; // Track all created tasks with full details

    for (const template of taskTemplates) {
      console.log(`[CALENDAR] ${calendarEntryId} Processing template: ${template.task_title} (task_number: ${template.task_number})`);
      try {
        // Special handling for signing meetings - use meeting location
        const locationForAssignee = mapping.uses_meeting_location
          ? meetingLocation
          : matterDetails.location;

        // Resolve assignee
        let assignee;
        try {
          assignee = await resolveAssignee(
            template.assignee,
            matterDetails,
            locationForAssignee,
            null, // lookupReference
            mapping.uses_meeting_location // requireMeetingLocation - no fallback for signing meetings
          );
        } catch (assigneeError) {
          console.error(`[CALENDAR] ${calendarEntryId} Assignee error: ${assigneeError.message}`);

          // Handle AssigneeError with error codes
          if (assigneeError instanceof AssigneeError) {
            // Meeting location errors → create error task assigned to Jacqui
            if (assigneeError.code === ERROR_CODES.MEETING_NO_LOCATION ||
                assigneeError.code === ERROR_CODES.MEETING_INVALID_LOCATION) {
              // Get valid location keywords for error message
              const validKeywords = await SupabaseService.getLocationKeywords();
              const keywordsList = validKeywords.join(', ');

              const errorTask = await ClioService.createTask({
                name: `⚠️ Meeting Location Empty - ${mapping.stage_name}`,
                description: `Meeting location is empty. Cannot create tasks for signing meeting.\n\nMeeting: ${mapping.stage_name}\nCalendar Entry ID: ${calendarEntryId}\nLocation: ${meetingLocation || 'Not specified'}\n\nExpected location to contain one of: ${keywordsList}\n\nPlease update the calendar entry with a valid location.`,
                matter: { id: matterDetails.id },
                assignee: { id: 357379471, type: 'User' }, // Jacqui (VA)
                due_at: new Date().toISOString(),
                priority: 'high',
              });

              console.log(`[CALENDAR] ${calendarEntryId} Created error task assigned to Jacqui: ${errorTask.id}`);
              return { success: true, action: 'error_task_created', errorTaskId: errorTask.id };
            }

            // Other assignee errors → log to error_logs table
            await SupabaseService.logError(
              assigneeError.code,
              assigneeError.message,
              {
                ...assigneeError.context,
                calendar_entry_id: calendarEntryId,
                stage_name: mapping.stageName,
                template_title: template.task_title,
              }
            );

            console.log(`[CALENDAR] ${calendarEntryId} Logged error: ${assigneeError.code}`);
            tasksFailed++;
            failures.push({
              task_title: template.task_title,
              task_number: template.task_number,
              error: assigneeError.message,
              error_code: assigneeError.code,
            });
            continue; // Skip this task
          }

          // Non-AssigneeError → log as generic error
          await SupabaseService.logError(
            ERROR_CODES.CLIO_API_FAILED,
            assigneeError.message,
            {
              matter_id: matterDetails.id,
              calendar_entry_id: calendarEntryId,
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

        // Determine if task is relative to meeting or creation
        const relationType = template['due_date-relational'] || template.due_date_relation || '';
        const isMeetingRelative = relationType.toLowerCase().includes('meeting');

        // Calculate due date
        let dueDate, dueDateFormatted;
        if (isMeetingRelative) {
          // Tasks relative to meeting: use meeting date
          const meetingDateObj = new Date(meetingDate);
          dueDate = calculateDueDate(template, meetingDateObj, 'meeting');
          dueDateFormatted = formatForClio(dueDate);
        } else {
          // Tasks "after creation": use current time (NOW)
          dueDate = calculateDueDate(template, new Date(), 'creation');
          dueDateFormatted = formatForClio(dueDate);
        }

        // Check if task already exists
        const existingTask = existingTasks.find(t => t.task_number === template.task_number);

        if (existingTask && action === 'update') {
          // Update existing task
          console.log(`[CALENDAR] ${calendarEntryId} Updating task ${existingTask.task_id}:`);
          console.log(`[CALENDAR] ${calendarEntryId}   Old assignee: ${existingTask.assigned_user} (${existingTask.assigned_user_id})`);
          console.log(`[CALENDAR] ${calendarEntryId}   New assignee: ${assignee.name} (${assignee.id})`);
          console.log(`[CALENDAR] ${calendarEntryId}   Location used: ${locationForAssignee}`);

          try {
            await ClioService.updateTask(existingTask.task_id, {
              due_at: dueDateFormatted,
              assignee: { id: assignee.id, type: assignee.type },
            });
          } catch (clioError) {
            console.error(`[CALENDAR] ${calendarEntryId} Clio update failed: ${clioError.message}`);

            // Check if task was deleted (404 detection)
            const verification = await this.verifyTaskExistsOrMarkDeleted(
              existingTask.task_id,
              template.task_number
            );

            if (!verification.exists) {
              // Task deleted - will be recreated in create loop below
              console.log(`[CALENDAR] ${calendarEntryId} Task ${existingTask.task_id} deleted - will recreate`);
              // Don't add to existingTaskIds so it falls through to creation
              continue;
            }

            // Other error - log and skip
            await SupabaseService.logError(
              ERROR_CODES.CLIO_API_FAILED,
              `Failed to update task in Clio: ${clioError.message}`,
              {
                matter_id: matterDetails.id,
                calendar_entry_id: calendarEntryId,
                task_id: existingTask.task_id,
                template_title: template.task_title,
              }
            );
            tasksFailed++;
            failures.push({
              task_title: template.task_title,
              task_number: template.task_number,
              error: `Clio update failed: ${clioError.message}`,
              error_code: ERROR_CODES.CLIO_API_FAILED,
            });
            continue;
          }

          try {
            await SupabaseService.updateTask(existingTask.task_id, {
              due_date: dueDateFormatted,
              assigned_user_id: assignee.id,
              assigned_user: assignee.name,
              due_date_generated: new Date().toISOString(),
            });
          } catch (supabaseError) {
            console.error(`[CALENDAR] ${calendarEntryId} Supabase update failed: ${supabaseError.message}`);
            await SupabaseService.logError(
              ERROR_CODES.SUPABASE_SYNC_FAILED,
              `Task updated in Clio but failed to sync to Supabase: ${supabaseError.message}`,
              {
                matter_id: matterDetails.id,
                calendar_entry_id: calendarEntryId,
                task_id: existingTask.task_id,
                template_title: template.task_title,
              }
            );
          }

          tasksCreated++;
          console.log(`[CALENDAR] ${calendarEntryId} Updated: ${template.task_title}`);

        } else {
          // Create new task
          console.log(`[CALENDAR] ${calendarEntryId} Creating NEW task: ${template.task_title}`);
          let newTask;
          try {
            newTask = await ClioService.createTask({
              name: template.task_title,
              description: template.task_desc,
              matter: { id: matterDetails.id },
              assignee: { id: assignee.id, type: assignee.type },
              due_at: dueDateFormatted,
            });
            console.log(`[CALENDAR] ${calendarEntryId} Clio task created: ${newTask.id}`);
          } catch (clioError) {
            console.error(`[CALENDAR] ${calendarEntryId} Clio API failed: ${clioError.message}`);
            await SupabaseService.logError(
              ERROR_CODES.CLIO_API_FAILED,
              `Failed to create task in Clio: ${clioError.message}`,
              {
                matter_id: matterDetails.id,
                calendar_entry_id: calendarEntryId,
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
            continue;
          }

          try {
            const taskData = {
              task_id: newTask.id,
              task_name: newTask.name,
              task_desc: newTask.description,
              matter_id: matterDetails.id,
              assigned_user_id: assignee.id,
              assigned_user: assignee.name,
              due_date: dueDateFormatted,
              stage_id: mapping.stage_id,
              stage_name: mapping.stage_name,
              task_number: template.task_number,
              completed: false,
              status: 'pending',
              task_date_generated: new Date().toISOString(),
              due_date_generated: new Date().toISOString(),
              calendar_entry_id: calendarEntryId, // Track which calendar entry created this task
            };
            console.log(`[CALENDAR] ${calendarEntryId} Inserting into Supabase:`, JSON.stringify({
              task_id: taskData.task_id,
              task_name: taskData.task_name,
              calendar_entry_id: taskData.calendar_entry_id,
              stage_id: taskData.stage_id,
              task_number: taskData.task_number
            }));
            await SupabaseService.insertTask(taskData);
            console.log(`[CALENDAR] ${calendarEntryId} Supabase insert SUCCESS for task ${newTask.id}`);
          } catch (supabaseError) {
            console.error(`[CALENDAR] ${calendarEntryId} Supabase sync failed: ${supabaseError.message}`);
            console.error(`[CALENDAR] ${calendarEntryId} Supabase error details:`, supabaseError);
            await SupabaseService.logError(
              ERROR_CODES.SUPABASE_SYNC_FAILED,
              `Task created in Clio but failed to record in Supabase: ${supabaseError.message}`,
              {
                matter_id: matterDetails.id,
                calendar_entry_id: calendarEntryId,
                task_id: newTask.id,
                template_title: template.task_title,
              }
            );
          }

          tasksCreated++;
          // Track created task with full details
          createdTasks.push({
            taskNumber: template.task_number,
            taskId: newTask.id,
            taskName: newTask.name,
            taskDescription: newTask.description || template.task_desc,
            assignee: assignee.name,
            assigneeId: assignee.id,
            dueDate: dueDateFormatted,
            status: 'created',
          });
          console.log(`[CALENDAR] ${calendarEntryId} Created: ${template.task_title}`);
        }

      } catch (error) {
        console.error(`[CALENDAR] ${calendarEntryId} Failed to process task: ${error.message}`);
        tasksFailed++;
        failures.push({
          task_title: template.task_title,
          task_number: template.task_number,
          error: error.message,
          error_code: ERROR_CODES.CLIO_API_FAILED,
        });
        // Track failed tasks too
        createdTasks.push({
          taskNumber: template.task_number,
          taskId: null,
          taskName: template.task_title,
          taskDescription: template.task_desc,
          assignee: null,
          assigneeId: null,
          dueDate: null,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return { tasksCreated, tasksFailed, failures, tasks: createdTasks };
  }

  /**
   * Update meeting-related tasks with new due dates and assignees
   * Updates tasks with null due dates OR different due dates (meeting changed)
   * Also updates assignee if meeting location changed (for signing meetings)
   * Returns the count of tasks updated
   */
  static async updateMeetingRelatedTasks(tasks, meetingDate, meetingLocation, matterDetails, mapping) {
    let updatedCount = 0;

    for (const task of tasks) {
      try {
        // Get the task template to determine relation type
        const template = await SupabaseService.getTaskTemplateByNumber(
          task.stage_id,
          task.task_number
        );

        if (!template) continue;

        const relationType = template['due_date-relational'] || template.due_date_relational || '';
        if (!relationType.toLowerCase().includes('meeting')) continue;

        // Calculate new due date from meeting date
        const dueDate = calculateDueDate(template, new Date(meetingDate));
        const dueDateFormatted = formatForClio(dueDate);

        // Determine location for assignee resolution (signing meetings use meeting location)
        const locationForAssignee = mapping.uses_meeting_location
          ? meetingLocation
          : matterDetails.location;

        // Resolve assignee (may have changed if meeting location changed)
        let assignee;
        try {
          assignee = await resolveAssignee(
            template.assignee,
            matterDetails,
            locationForAssignee,
            null, // lookupReference
            mapping.uses_meeting_location // requireMeetingLocation
          );
        } catch (assigneeError) {
          console.error(`[CALENDAR] Assignee error for task ${task.task_id}: ${assigneeError.message}`);
          continue; // Skip this task if assignee can't be resolved
        }

        // Check if due date OR assignee changed
        const dueDateChanged = !task.due_date || task.due_date !== dueDateFormatted;
        const assigneeChanged = task.assigned_user_id !== assignee.id;

        if (dueDateChanged || assigneeChanged) {
          // Update task in Clio
          await ClioService.updateTask(task.task_id, {
            due_at: dueDateFormatted,
            assignee: { id: assignee.id, type: assignee.type },
          });

          // Update task in Supabase
          await SupabaseService.updateTask(task.task_id, {
            due_date: dueDateFormatted,
            assigned_user_id: assignee.id,
            assigned_user: assignee.name,
            due_date_generated: new Date().toISOString(),
          });

          updatedCount++;
          const changes = [];
          if (dueDateChanged) changes.push(`due date: ${dueDateFormatted}`);
          if (assigneeChanged) changes.push(`assignee: ${assignee.name}`);
          console.log(`[CALENDAR] Updated task ${task.task_name} - ${changes.join(', ')}`);
        }

      } catch (error) {
        console.error(`[CALENDAR] Failed to update task ${task.task_id}: ${error.message}`);
      }
    }

    return updatedCount;
  }

  /**
   * Verifies if a task exists in Clio. If not found (404), marks it as deleted in Supabase.
   * @param {number} taskId - The Clio task ID
   * @param {number} taskNumber - The task template number
   * @returns {Object} { exists: boolean, taskNumber: number|null }
   */
  static async verifyTaskExistsOrMarkDeleted(taskId, taskNumber) {
    try {
      await ClioService.getTask(taskId);
      return { exists: true, taskNumber: null };
    } catch (fetchError) {
      // Detect 404 (same pattern as task-completion.js)
      if (fetchError.response?.status === 404 || fetchError.message?.includes('404')) {
        console.log(`[CALENDAR] Task ${taskId} not found in Clio (404) - marking as deleted`);

        // Mark as deleted in Supabase
        await SupabaseService.updateTask(taskId, {
          status: 'deleted',
          last_updated: new Date().toISOString(),
        });

        await SupabaseService.logError(
          ERROR_CODES.TASK_NOT_FOUND_IN_CLIO,
          `Task ${taskId} deleted in Clio, marked for regeneration`,
          { taskId, taskNumber }
        );

        return { exists: false, taskNumber };
      }

      // Re-throw if not 404
      throw fetchError;
    }
  }

  /**
   * Regenerates tasks that were deleted in Clio
   * @param {number[]} taskNumbers - Task numbers to regenerate
   * @param {Array} allTemplates - All task templates for the stage
   * @param {Object} matterDetails - Matter information
   * @param {Object} mapping - Stage mapping
   * @param {number} calendarEntryId - Calendar entry ID
   * @param {Date} meetingDate - Meeting date for due date calculation
   * @param {string} meetingLocation - Meeting location for assignee resolution
   * @returns {Object} { created: number, failed: number, failures: Array }
   */
  static async regenerateDeletedTasks(taskNumbers, allTemplates, matterDetails, mapping, calendarEntryId, meetingDate, meetingLocation) {
    let created = 0;
    let failed = 0;
    const failures = [];

    console.log(`[CALENDAR] ${calendarEntryId} Regenerating tasks: ${taskNumbers.join(', ')}`);

    // Filter templates to only deleted task numbers
    const templatesToRegenerate = allTemplates.filter(t =>
      taskNumbers.includes(t.task_number)
    );

    for (const template of templatesToRegenerate) {
      try {
        // Special handling for signing meetings - use meeting location
        const locationForAssignee = mapping.uses_meeting_location
          ? meetingLocation
          : matterDetails.location;

        // Resolve assignee
        let assignee;
        try {
          assignee = await resolveAssignee(
            template.assignee,
            matterDetails,
            locationForAssignee,
            null, // lookupReference
            mapping.uses_meeting_location // requireMeetingLocation
          );
        } catch (assigneeError) {
          console.error(`[CALENDAR] ${calendarEntryId} Assignee error during regeneration: ${assigneeError.message}`);

          // If assignee resolution fails, log and skip this task
          await SupabaseService.logError(
            assigneeError.code || ERROR_CODES.CLIO_API_FAILED,
            `Failed to resolve assignee during task regeneration: ${assigneeError.message}`,
            { taskNumber: template.task_number, template }
          );

          failed++;
          failures.push({
            taskNumber: template.task_number,
            taskName: template.task_title,
            error: assigneeError.message,
          });
          continue;
        }

        // Calculate due date
        const dueDate = calculateDueDate(template, new Date(meetingDate));
        const dueDateFormatted = formatForClio(dueDate);

        // Create in Clio
        const newTask = await ClioService.createTask({
          name: template.task_title,
          description: template.task_desc,
          matter: { id: matterDetails.id },
          assignee: { id: assignee.id, type: assignee.type },
          due_at: dueDateFormatted,
        });

        // Record in Supabase (replaces deleted task)
        await SupabaseService.insertTask({
          task_id: newTask.id,
          task_name: newTask.name,
          task_desc: newTask.description,
          matter_id: matterDetails.id,
          assigned_user_id: assignee.id,
          assigned_user: assignee.name,
          due_date: dueDateFormatted,
          stage_id: mapping.stage_id,
          stage_name: mapping.stage_name,
          task_number: template.task_number,
          completed: false,
          status: 'pending',
          task_date_generated: new Date().toISOString(),
          due_date_generated: new Date().toISOString(),
          calendar_entry_id: calendarEntryId,
          verification_attempted: true, // Mark as regenerated
          verification_attempted_at: new Date().toISOString(),
        });

        console.log(`[CALENDAR] ${calendarEntryId} Regenerated task ${template.task_number}: ${newTask.id}`);
        created++;

      } catch (error) {
        console.error(`[CALENDAR] ${calendarEntryId} Failed to regenerate task ${template.task_number}: ${error.message}`);

        await SupabaseService.logError(
          ERROR_CODES.CLIO_API_FAILED,
          `Failed to regenerate deleted task: ${error.message}`,
          { taskNumber: template.task_number, error: error.message }
        );

        failed++;
        failures.push({
          taskNumber: template.task_number,
          taskName: template.task_title,
          error: error.message,
        });
      }
    }

    return { created, failed, failures };
  }

  /**
   * Update tasks that were created for a specific calendar entry
   * This method is called when a calendar event is updated
   * It updates ALL tasks for this calendar entry based on the current templates
   */
  static async updateCalendarEntryTasks(existingTasks, taskTemplates, meetingDate, meetingLocation, matterDetails, mapping, calendarEntryId) {
    let updatedCount = 0;
    let skippedCompleted = 0;
    let tasksCreated = 0;
    let tasksFailed = 0;
    const deletedTaskNumbers = []; // Track deleted tasks for regeneration

    for (const task of existingTasks) {
      try {
        // Skip completed tasks - don't update them when meeting changes
        if (task.completed) {
          console.log(`[CALENDAR] Skipping completed task: ${task.task_name} (${task.task_id})`);
          skippedCompleted++;
          continue;
        }

        // Find the corresponding template for this task
        const template = taskTemplates.find(t => t.task_number === task.task_number);

        if (!template) {
          console.log(`[CALENDAR] No template found for task ${task.task_id} (task_number: ${task.task_number})`);
          continue;
        }

        // Determine if task is relative to meeting or creation
        const relationType = template['due_date-relational'] || template.due_date_relation || '';
        const isMeetingRelative = relationType.toLowerCase().includes('meeting');

        // Calculate new due date
        let dueDate, dueDateFormatted;
        if (isMeetingRelative) {
          // Tasks relative to meeting: recalculate from meeting date
          dueDate = calculateDueDate(template, new Date(meetingDate));
          dueDateFormatted = formatForClio(dueDate);
        } else {
          // Tasks "after creation": DON'T recalculate (keep existing due date)
          // These were already calculated when task was created
          dueDateFormatted = task.due_date;
          console.log(`[CALENDAR] Keeping existing due date for 'after creation' task: ${task.task_name}`);
        }

        // Determine location for assignee resolution (signing meetings use meeting location)
        const locationForAssignee = mapping.uses_meeting_location
          ? meetingLocation
          : matterDetails.location;

        // Resolve assignee (may have changed if meeting location changed)
        let assignee;
        try {
          assignee = await resolveAssignee(
            template.assignee,
            matterDetails,
            locationForAssignee,
            null, // lookupReference
            mapping.uses_meeting_location // requireMeetingLocation
          );
        } catch (assigneeError) {
          console.error(`[CALENDAR] Assignee error for task ${task.task_id}: ${assigneeError.message}`);
          continue; // Skip this task if assignee can't be resolved
        }

        // Check if due date OR assignee changed
        const dueDateChanged = !task.due_date || task.due_date !== dueDateFormatted;
        const assigneeChanged = task.assigned_user_id !== assignee.id;

        if (dueDateChanged || assigneeChanged) {
          try {
            // Update task in Clio
            await ClioService.updateTask(task.task_id, {
              due_at: dueDateFormatted,
              assignee: { id: assignee.id, type: assignee.type },
            });

            // Update task in Supabase
            await SupabaseService.updateTask(task.task_id, {
              due_date: dueDateFormatted,
              assigned_user_id: assignee.id,
              assigned_user: assignee.name,
              due_date_generated: new Date().toISOString(),
            });

            updatedCount++;
            const changes = [];
            if (dueDateChanged) changes.push(`due date: ${dueDateFormatted}`);
            if (assigneeChanged) changes.push(`assignee: ${assignee.name}`);
            console.log(`[CALENDAR] Updated task ${task.task_name} (${task.task_id}) - ${changes.join(', ')}`);

          } catch (updateError) {
            console.error(`[CALENDAR] Failed to update task ${task.task_id}: ${updateError.message}`);

            // Verify if task was deleted (404 detection)
            const verification = await this.verifyTaskExistsOrMarkDeleted(
              task.task_id,
              task.task_number
            );

            if (!verification.exists) {
              // Task was deleted - track for regeneration
              deletedTaskNumbers.push(verification.taskNumber);
              tasksFailed++;
            } else {
              // Other error - log and continue
              await SupabaseService.logError(
                ERROR_CODES.CLIO_API_FAILED,
                `Failed to update task: ${updateError.message}`,
                { taskId: task.task_id, error: updateError.message }
              );
              tasksFailed++;
            }
          }
        }

      } catch (error) {
        console.error(`[CALENDAR] Failed to process task ${task.task_id}: ${error.message}`);
        tasksFailed++;
      }
    }

    if (skippedCompleted > 0) {
      console.log(`[CALENDAR] Skipped ${skippedCompleted} completed task(s)`);
    }

    // REGENERATE deleted tasks
    if (deletedTaskNumbers.length > 0) {
      console.log(`[CALENDAR] ${calendarEntryId} Regenerating ${deletedTaskNumbers.length} deleted task(s)`);

      const regenerationResult = await this.regenerateDeletedTasks(
        deletedTaskNumbers,
        taskTemplates,
        matterDetails,
        mapping,
        calendarEntryId,
        meetingDate,
        meetingLocation
      );

      tasksCreated += regenerationResult.created;
      tasksFailed += regenerationResult.failed;

      console.log(`[CALENDAR] ${calendarEntryId} Regeneration complete - Created: ${regenerationResult.created}, Failed: ${regenerationResult.failed}`);
    }

    return { tasksUpdated: updatedCount, tasksCreated, tasksFailed };
  }

  /**
   * Link stage-generated tasks to calendar entry and update their due dates
   * This is called when a calendar event is created AFTER stage change happened
   * It takes ownership of the stage-generated tasks by linking them with calendar_entry_id
   */
  static async linkAndUpdateStageTasks(calendarEntryId, stageTasks, taskTemplates, meetingDate, meetingLocation, matterDetails, mapping) {
    let tasksLinked = 0;
    let tasksUpdated = 0;
    let skippedCompleted = 0;
    let tasksCreated = 0;
    let tasksFailed = 0;
    const deletedTaskNumbers = []; // Track deleted tasks for regeneration

    console.log(`[CALENDAR] ${calendarEntryId} Linking ${stageTasks.length} stage-generated tasks to calendar entry`);

    for (const task of stageTasks) {
      try {
        // Skip completed tasks
        if (task.completed) {
          console.log(`[CALENDAR] Skipping completed task: ${task.task_name} (${task.task_id})`);
          skippedCompleted++;
          continue;
        }

        // Find the corresponding template for this task
        const template = taskTemplates.find(t => t.task_number === task.task_number);

        if (!template) {
          console.log(`[CALENDAR] No template found for task ${task.task_id} (task_number: ${task.task_number})`);
          continue;
        }

        // Determine if task is relative to meeting or creation
        const relationType = template['due_date-relational'] || template.due_date_relation || '';
        const isMeetingRelative = relationType.toLowerCase().includes('meeting');

        // Calculate due date ONLY for meeting-relative tasks
        let dueDate, dueDateFormatted;
        if (isMeetingRelative) {
          // Tasks relative to meeting: calculate from meeting date
          dueDate = calculateDueDate(template, new Date(meetingDate));
          dueDateFormatted = formatForClio(dueDate);
        } else {
          // Tasks "after creation": keep existing due date from stage automation
          dueDateFormatted = task.due_date;
          console.log(`[CALENDAR] Keeping existing due date for 'after creation' task: ${task.task_name} (${task.due_date})`);
        }

        // Determine location for assignee resolution (signing meetings use meeting location)
        const locationForAssignee = mapping.uses_meeting_location
          ? meetingLocation
          : matterDetails.location;

        // Resolve assignee
        let assignee;
        try {
          assignee = await resolveAssignee(
            template.assignee,
            matterDetails,
            locationForAssignee,
            null, // lookupReference
            mapping.uses_meeting_location // requireMeetingLocation
          );
        } catch (assigneeError) {
          console.error(`[CALENDAR] Assignee error for task ${task.task_id}: ${assigneeError.message}`);
          continue;
        }

        // Check if due date OR assignee changed
        const dueDateChanged = isMeetingRelative && (!task.due_date || task.due_date !== dueDateFormatted);
        const assigneeChanged = task.assigned_user_id !== assignee.id;

        // Link task to calendar entry in Supabase
        await SupabaseService.updateTask(task.task_id, {
          calendar_entry_id: calendarEntryId,
        });
        tasksLinked++;

        if (dueDateChanged || assigneeChanged) {
          try {
            // Update task in Clio
            await ClioService.updateTask(task.task_id, {
              due_at: dueDateFormatted,
              assignee: { id: assignee.id, type: assignee.type },
            });

            // Update task in Supabase (due date and assignee)
            await SupabaseService.updateTask(task.task_id, {
              due_date: dueDateFormatted,
              assigned_user_id: assignee.id,
              assigned_user: assignee.name,
              due_date_generated: new Date().toISOString(),
            });

            tasksUpdated++;
            const changes = [];
            if (dueDateChanged) changes.push(`due date: ${task.due_date || 'NULL'} → ${dueDateFormatted}`);
            if (assigneeChanged) changes.push(`assignee: ${assignee.name}`);
            console.log(`[CALENDAR] Linked and updated task ${task.task_name} (${task.task_id}) - ${changes.join(', ')}`);

          } catch (updateError) {
            console.error(`[CALENDAR] Failed to update linked task ${task.task_id}: ${updateError.message}`);

            // Verify if task was deleted (404 detection)
            const verification = await this.verifyTaskExistsOrMarkDeleted(
              task.task_id,
              task.task_number
            );

            if (!verification.exists) {
              // Task was deleted - track for regeneration
              deletedTaskNumbers.push(verification.taskNumber);
              tasksFailed++;
            } else {
              // Other error - log and continue
              await SupabaseService.logError(
                ERROR_CODES.CLIO_API_FAILED,
                `Failed to update linked task: ${updateError.message}`,
                { taskId: task.task_id, error: updateError.message }
              );
              tasksFailed++;
            }
          }
        } else {
          console.log(`[CALENDAR] Linked task ${task.task_name} (${task.task_id}) - no changes needed`);
        }

      } catch (error) {
        console.error(`[CALENDAR] Failed to process task ${task.task_id}: ${error.message}`);
        tasksFailed++;
      }
    }

    if (skippedCompleted > 0) {
      console.log(`[CALENDAR] Skipped ${skippedCompleted} completed task(s)`);
    }

    // REGENERATE deleted tasks
    if (deletedTaskNumbers.length > 0) {
      console.log(`[CALENDAR] ${calendarEntryId} Regenerating ${deletedTaskNumbers.length} deleted task(s)`);

      const regenerationResult = await this.regenerateDeletedTasks(
        deletedTaskNumbers,
        taskTemplates,
        matterDetails,
        mapping,
        calendarEntryId,
        meetingDate,
        meetingLocation
      );

      tasksCreated += regenerationResult.created;
      tasksFailed += regenerationResult.failed;

      console.log(`[CALENDAR] ${calendarEntryId} Regeneration complete - Created: ${regenerationResult.created}, Failed: ${regenerationResult.failed}`);
    }

    console.log(`[CALENDAR] ${calendarEntryId} Linked ${tasksLinked} tasks, updated ${tasksUpdated} tasks, created ${tasksCreated} (regenerated), failed ${tasksFailed}`);

    return { tasksLinked, tasksUpdated, tasksCreated, tasksFailed };
  }
}
