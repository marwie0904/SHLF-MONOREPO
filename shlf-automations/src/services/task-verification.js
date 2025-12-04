import { ClioService } from './clio.js';
import { SupabaseService } from './supabase.js';
import { calculateDueDate, formatForClio } from '../utils/date-helpers.js';
import { resolveAssignee } from '../utils/assignee-resolver.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { EventTracker } from './event-tracker.js';

/**
 * Task Verification Service
 *
 * Provides post-verification functionality to ensure all expected tasks
 * were successfully created in both Clio and Supabase after stage changes
 * or meeting task generation.
 */
export class TaskVerificationService {

  /**
   * Verify task generation after stage change or meeting scheduled
   *
   * @param {Object} params
   * @param {number} params.matterId - Clio matter ID
   * @param {string} params.stageId - Stage ID
   * @param {string} params.stageName - Stage name
   * @param {number} params.practiceAreaId - Practice area ID
   * @param {Object} params.matterDetails - Full matter details from Clio
   * @param {number} params.expectedCount - Expected task count
   * @param {string} params.context - 'stage_change' or 'meeting_scheduled'
   * @param {string} params.calendarEntryId - (Optional) Calendar entry ID for meeting context
   * @param {string} traceId - (Optional) Trace ID for event tracking
   * @returns {Object} Verification results
   */
  static async verifyTaskGeneration(params, traceId = null) {
    const {
      matterId,
      stageId,
      stageName,
      practiceAreaId,
      matterDetails,
      expectedCount,
      context = 'stage_change',
      calendarEntryId = null
    } = params;

    const startTime = Date.now();

    // Start verify_tasks step
    const verifyStepId = await EventTracker.startStep(traceId, {
      layerName: 'automation',
      stepName: 'verify_tasks',
      metadata: { matterId, context, expectedCount },
    });
    const verifyCtx = EventTracker.createContext(traceId, verifyStepId);

    console.log(`[VERIFY] ${matterId} Starting verification (context: ${context}, expected: ${expectedCount} tasks)`);

    // Step 1: Wait 30 seconds for task creation to settle
    console.log(`[VERIFY] ${matterId} Waiting 30 seconds for task generation to complete...`);
    const waitStart = Date.now();
    await new Promise(resolve => setTimeout(resolve, 30000));
    const waitDurationMs = Date.now() - waitStart;

    // Step 2: Get expected task numbers
    let expectedTaskNumbers;
    if (context === 'meeting_scheduled' && calendarEntryId) {
      // Get meeting task templates
      const calendarEventId = await this._getCalendarEventId(calendarEntryId);
      const result = await SupabaseService.getExpectedMeetingTaskCount(calendarEventId);
      expectedTaskNumbers = result.expectedTaskNumbers;
    } else {
      // Get stage task templates
      const result = await SupabaseService.getExpectedTaskCount(stageId, practiceAreaId);
      expectedTaskNumbers = result.expectedTaskNumbers;
    }

    // Step 3: Query Supabase for recently generated tasks
    const actualTasks = await SupabaseService.getRecentTasksByMatterAndStage(
      matterId,
      stageId,
      1 // last 1 minute
    );

    // Filter by calendar_entry_id if meeting context
    const relevantTasks = calendarEntryId
      ? actualTasks.filter(t => t.calendar_entry_id === calendarEntryId)
      : actualTasks;

    console.log(`[VERIFY] ${matterId} Found ${relevantTasks.length} tasks in Supabase`);

    // Step 4: Identify missing task numbers
    const existingTaskNumbers = relevantTasks.map(t => t.task_number);
    const missingTaskNumbers = expectedTaskNumbers.filter(
      num => !existingTaskNumbers.includes(num)
    );

    // Step 5: Check if all tasks exist (including deleted ones)
    const allTaskNumbers = relevantTasks.map(t => t.task_number);
    const hasAllTasks = expectedTaskNumbers.every(num => allTaskNumbers.includes(num));

    // Build individual task details for logging
    const individualTasks = relevantTasks.map(t => ({
      taskId: t.task_id,
      taskNumber: t.task_number,
      taskName: t.task_name,
      status: t.status || (t.completed ? 'completed' : 'pending'),
    }));

    if (hasAllTasks) {
      console.log(`[VERIFY] ${matterId} ✓ All ${expectedTaskNumbers.length} tasks verified successfully`);

      // Log successful verification
      verifyCtx.logVerification({
        waitDurationMs,
        expectedCount: expectedTaskNumbers.length,
        matterId,
        stageId,
        stageName,
        context,
      }, {
        foundCount: relevantTasks.length,
        missingTaskNumbers: [],
        tasksRegenerated: 0,
        individualTasks,
        allTasksFound: true,
      }, Date.now() - startTime);

      await EventTracker.endStep(verifyStepId, {
        status: 'success',
        metadata: {
          expectedCount: expectedTaskNumbers.length,
          foundCount: relevantTasks.length,
          missingCount: 0,
          regeneratedCount: 0,
        },
      });

      return {
        success: true,
        tasksVerified: relevantTasks.length,
        tasksRegenerated: 0,
        missingTaskNumbers: []
      };
    }

    // Step 6: Regenerate missing tasks
    console.log(`[VERIFY] ${matterId} Missing ${missingTaskNumbers.length} tasks: ${missingTaskNumbers.join(', ')}`);

    const regenerated = await this._regenerateMissingTasks({
      matterId,
      stageId,
      stageName,
      practiceAreaId,
      matterDetails,
      missingTaskNumbers,
      context,
      calendarEntryId
    });

    console.log(`[VERIFY] ${matterId} Regenerated ${regenerated.success} tasks, ${regenerated.failed} failed`);

    // Log verification with regeneration results
    verifyCtx.logVerification({
      waitDurationMs,
      expectedCount: expectedTaskNumbers.length,
      matterId,
      stageId,
      stageName,
      context,
    }, {
      foundCount: relevantTasks.length,
      missingTaskNumbers,
      tasksRegenerated: regenerated.success,
      individualTasks,
      allTasksFound: false,
    }, Date.now() - startTime);

    await EventTracker.endStep(verifyStepId, {
      status: regenerated.failed > 0 ? 'error' : 'success',
      metadata: {
        expectedCount: expectedTaskNumbers.length,
        foundCount: relevantTasks.length,
        missingCount: missingTaskNumbers.length,
        regeneratedCount: regenerated.success,
        failedCount: regenerated.failed,
      },
    });

    return {
      success: regenerated.failed === 0,
      tasksVerified: relevantTasks.length,
      tasksRegenerated: regenerated.success,
      tasksFailed: regenerated.failed,
      missingTaskNumbers,
      failures: regenerated.failures
    };
  }

  /**
   * Regenerate specific tasks by task number
   */
  static async _regenerateMissingTasks(params) {
    const {
      matterId,
      stageId,
      stageName,
      practiceAreaId,
      matterDetails,
      missingTaskNumbers,
      context,
      calendarEntryId
    } = params;

    let tasksCreated = 0;
    let tasksFailed = 0;
    const failures = [];

    // Get all templates
    let allTemplates;
    if (context === 'meeting_scheduled' && calendarEntryId) {
      const calendarEventId = await this._getCalendarEventId(calendarEntryId);
      allTemplates = await SupabaseService.getTaskListMeeting(calendarEventId);
    } else {
      const PROBATE_PRACTICE_AREA_ID = 45045123;
      allTemplates = practiceAreaId === PROBATE_PRACTICE_AREA_ID
        ? await SupabaseService.getTaskListProbate(stageId)
        : await SupabaseService.getTaskListNonMeeting(stageId);
    }

    // Filter to only missing task numbers
    const templatesToRegenerate = allTemplates.filter(t =>
      missingTaskNumbers.includes(t.task_number)
    );

    console.log(`[VERIFY] ${matterId} Regenerating ${templatesToRegenerate.length} tasks`);

    // Regenerate each missing task
    for (const template of templatesToRegenerate) {
      try {
        // Resolve assignee
        let assignee;
        try {
          assignee = await resolveAssignee(template.assignee, matterDetails);
        } catch (assigneeError) {
          console.error(`[VERIFY] ${matterId} Assignee resolution failed for task ${template.task_number}: ${assigneeError.message}`);
          tasksFailed++;
          failures.push({
            task_number: template.task_number,
            task_title: template.task_title,
            error: `Assignee resolution failed: ${assigneeError.message}`,
            error_code: ERROR_CODES.ASSIGNEE_NOT_FOUND
          });
          continue;
        }

        // Calculate due date
        let dueDate = null;
        const dueDateRelation = template['due_date-relational'] || template.due_date_relational;

        if (dueDateRelation && dueDateRelation.toLowerCase().includes('after task')) {
          // Relational - set to NULL (will be calculated by task completion automation)
          dueDate = null;
        } else if (context === 'meeting_scheduled') {
          // Meeting-based - calculate from meeting date
          const meetingDate = await SupabaseService.getMeetingDate(matterId, calendarEntryId);
          if (meetingDate) {
            dueDate = calculateDueDate(template, new Date(meetingDate));
          }
        } else {
          // Regular task - calculate from now
          dueDate = calculateDueDate(template, new Date());
        }

        const dueDateFormatted = dueDate ? formatForClio(dueDate) : null;

        // Build task data
        const taskData = {
          name: template.task_title,
          description: template['task-description'] || template.task_description || template.task_desc,
          matter: { id: matterId },
        };

        if (assignee) {
          taskData.assignee = { id: assignee.id, type: assignee.type };
        }

        if (dueDateFormatted) {
          taskData.due_at = dueDateFormatted;
        }

        // Create in Clio
        const newTask = await ClioService.createTask(taskData);
        console.log(`[VERIFY] ${matterId} Created task ${template.task_number}: ${newTask.id}`);

        // Record in Supabase
        await SupabaseService.insertTask({
          task_id: newTask.id,
          task_name: newTask.name,
          task_desc: newTask.description,
          matter_id: matterId,
          assigned_user_id: assignee?.id,
          assigned_user: assignee?.name,
          due_date: dueDateFormatted,
          stage_id: stageId,
          stage_name: stageName,
          task_number: template.task_number,
          completed: false,
          status: 'pending',
          task_date_generated: new Date().toISOString(),
          due_date_generated: dueDateFormatted ? new Date().toISOString() : null,
          calendar_entry_id: calendarEntryId,
          verification_attempted: true,
          verification_attempted_at: new Date().toISOString()
        });

        tasksCreated++;

      } catch (error) {
        console.error(`[VERIFY] ${matterId} Failed to regenerate task ${template.task_number}: ${error.message}`);
        tasksFailed++;
        failures.push({
          task_number: template.task_number,
          task_title: template.task_title,
          error: error.message,
          error_code: ERROR_CODES.CLIO_API_FAILED
        });
      }
    }

    return {
      success: tasksCreated,
      failed: tasksFailed,
      failures
    };
  }

  /**
   * Get calendar event ID from calendar entry ID
   */
  static async _getCalendarEventId(calendarEntryId) {
    const entry = await ClioService.getCalendarEntry(calendarEntryId);
    return entry.calendar_entry_event_type?.id;
  }
}
