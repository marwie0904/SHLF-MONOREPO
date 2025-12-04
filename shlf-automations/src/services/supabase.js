import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import { EventTracker } from './event-tracker.js';

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.key);

/**
 * Supabase Data Access Layer
 */
export class SupabaseService {
  /**
   * Get most recent matter record
   * @param {number} matterId - Matter ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getMatterHistory(matterId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('matters')
        .select('*')
        .eq('matter_id', matterId)
        .order('date', { ascending: false })
        .limit(1);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getMatterHistory', { matterId }, { found: !!data?.[0] }, Date.now() - start, 'success');
      return data?.[0] || null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getMatterHistory', { matterId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Check if stage changed within rollback window (3 minutes)
   * @param {number} matterId - Matter ID
   * @param {number} currentStageId - Current stage ID
   * @param {number} [minutes=3] - Rollback window in minutes
   * @param {Object} [ctx] - Optional tracking context
   */
  static async checkRecentStageChange(matterId, currentStageId, minutes = 3, ctx = null) {
    const start = Date.now();
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    try {
      const { data, error } = await supabase
        .from('matters')
        .select('*')
        .eq('matter_id', matterId)
        .neq('stage_id', currentStageId)
        .gt('date', cutoffTime)
        .order('date', { ascending: false })
        .limit(1);

      if (error) throw error;
      ctx?.logDbQuery('supabase_checkRecentStageChange', { matterId, currentStageId, minutes }, { found: !!data?.[0] }, Date.now() - start, 'success');
      return data?.[0] || null;
    } catch (error) {
      ctx?.logDbQuery('supabase_checkRecentStageChange', { matterId, currentStageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get tasks generated within time window
   * @param {number} matterId - Matter ID
   * @param {number} stageId - Stage ID
   * @param {number} [minutes=3] - Time window in minutes
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getRecentlyGeneratedTasks(matterId, stageId, minutes = 3, ctx = null) {
    const start = Date.now();
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('matter_id', matterId)
        .eq('stage_id', stageId)
        .gt('task_date_generated', cutoffTime);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getRecentlyGeneratedTasks', { matterId, stageId, minutes }, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getRecentlyGeneratedTasks', { matterId, stageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Delete tasks from Supabase
   * @param {number[]} taskIds - Array of task IDs
   * @param {Object} [ctx] - Optional tracking context
   */
  static async deleteTasks(taskIds, ctx = null) {
    if (!taskIds || taskIds.length === 0) return;

    const start = Date.now();
    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .in('task_id', taskIds);

      if (error) throw error;
      ctx?.logDbMutation('supabase_deleteTasks', { taskIds }, { deleted: taskIds.length }, Date.now() - start, 'success');
    } catch (error) {
      ctx?.logDbMutation('supabase_deleteTasks', { taskIds }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Delete a single task by ID
   * @param {number} taskId - Task ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async deleteTask(taskId, ctx = null) {
    const start = Date.now();
    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('task_id', taskId);

      if (error) throw error;
      ctx?.logDbMutation('supabase_deleteTask', { taskId }, { deleted: true }, Date.now() - start, 'success');
    } catch (error) {
      ctx?.logDbMutation('supabase_deleteTask', { taskId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get task templates for non-meeting tasks
   * @param {number} stageId - Stage ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTaskListNonMeeting(stageId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('task-list-non-meeting')
        .select('*')
        .eq('stage_id', stageId);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getTaskListNonMeeting', { stageId }, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getTaskListNonMeeting', { stageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get task templates for probate tasks
   * @param {number} stageId - Stage ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTaskListProbate(stageId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('task-list-probate')
        .select('*')
        .eq('stage_id', stageId);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getTaskListProbate', { stageId }, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getTaskListProbate', { stageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get task templates for meeting tasks
   * @param {number} calendarEventId - Calendar event ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTaskListMeeting(calendarEventId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('task-list-meeting')
        .select('*')
        .eq('calendar_event_id', calendarEventId);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getTaskListMeeting', { calendarEventId }, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getTaskListMeeting', { calendarEventId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get calendar event mapping by stage ID
   * @param {number} stageId - Stage ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getCalendarEventMappingByStage(stageId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('calendar_event_mappings')
        .select('*')
        .eq('stage_id', stageId.toString())
        .eq('active', true)
        .limit(1);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getCalendarEventMappingByStage', { stageId }, { found: !!(data && data.length > 0) }, Date.now() - start, 'success');
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getCalendarEventMappingByStage', { stageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get assignee by location
   * Supports both exact match and keyword search (case-insensitive)
   * @param {string} location - Location to search
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getAssigneeByLocation(location, ctx = null) {
    const start = Date.now();
    try {
      // First try exact match
      let { data, error } = await supabase
        .from('assigned_user_reference')
        .select('*')
        .contains('location', [location]);

      if (error) throw error;
      if (data && data.length > 0) {
        ctx?.logDbQuery('supabase_getAssigneeByLocation', { location, method: 'exact' }, { found: true, userId: data[0].user_id }, Date.now() - start, 'success');
        return data[0];
      }

      // Get valid location keywords from database
      const keywords = await this.getLocationKeywords(ctx);

      // If no exact match and location is a keyword, search with pattern matching
      // Convert keywords to lowercase for case-insensitive comparison
      const keywordsLower = keywords.map(k => k.toLowerCase());
      if (keywordsLower.includes(location.toLowerCase())) {
        const { data: allData, error: allError } = await supabase
          .from('assigned_user_reference')
          .select('*');

        if (allError) throw allError;

        // Find first user whose location array contains the keyword (case-insensitive)
        const match = allData?.find(user =>
          user.location?.some(loc =>
            loc.toLowerCase().includes(location.toLowerCase())
          )
        );

        ctx?.logDbQuery('supabase_getAssigneeByLocation', { location, method: 'keyword' }, { found: !!match, userId: match?.user_id }, Date.now() - start, 'success');
        return match || null;
      }

      ctx?.logDbQuery('supabase_getAssigneeByLocation', { location }, { found: false }, Date.now() - start, 'success');
      return null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getAssigneeByLocation', { location }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get assignee by attorney ID
   * @param {number} attorneyId - Attorney ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getAssigneeByAttorneyId(attorneyId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('assigned_user_reference')
        .select('*')
        .contains('attorney_id', [attorneyId]);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getAssigneeByAttorneyId', { attorneyId }, { found: !!data?.[0], userId: data?.[0]?.user_id }, Date.now() - start, 'success');
      return data?.[0] || null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getAssigneeByAttorneyId', { attorneyId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get assignee by attorney's ID in fund_table column
   * @param {number} attorneyId - The responsible attorney's Clio user ID
   * @param {Object} [ctx] - Optional tracking context
   * @returns {Promise<Object|null>} - Assignee record or null
   */
  static async getAssigneeByAttorneyFundTable(attorneyId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('assigned_user_reference')
        .select('*')
        .contains('fund_table', [attorneyId]);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getAssigneeByAttorneyFundTable', { attorneyId }, { found: !!data?.[0], userId: data?.[0]?.user_id }, Date.now() - start, 'success');
      return data?.[0] || null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getAssigneeByAttorneyFundTable', { attorneyId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get meeting date for a matter from matters-meetings-booked
   * @param {number} matterId - The matter ID
   * @param {number} calendarEventId - Optional calendar event type ID to filter by specific meeting type
   * @param {Object} [ctx] - Optional tracking context
   * @returns {string|null} - Meeting date or null if no meeting found
   */
  static async getMeetingDate(matterId, calendarEventId = null, ctx = null) {
    const start = Date.now();
    try {
      let query = supabase
        .from('matters-meetings-booked')
        .select('date')
        .eq('matter_id', matterId);

      // Filter by calendar event type if provided (e.g., Design Meeting, Signing Meeting)
      if (calendarEventId) {
        query = query.eq('calendar_event_id', calendarEventId);
      }

      const { data, error } = await query
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      ctx?.logDbQuery('supabase_getMeetingDate', { matterId, calendarEventId }, { found: !!data?.date, date: data?.date }, Date.now() - start, 'success');
      return data?.date || null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getMeetingDate', { matterId, calendarEventId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get tasks for a matter and stage (with or without due dates)
   * @param {number} matterId - Matter ID
   * @param {number} stageId - Stage ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTasksByMatterAndStageForMeetingUpdate(matterId, stageId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('matter_id', matterId)
        .eq('stage_id', stageId)
        .eq('completed', false);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getTasksByMatterAndStageForMeetingUpdate', { matterId, stageId }, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getTasksByMatterAndStageForMeetingUpdate', { matterId, stageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get tasks by calendar_entry_id
   * Used to find tasks that were generated for a specific calendar event
   * @param {number} calendarEntryId - Calendar entry ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTasksByCalendarEntryId(calendarEntryId, includeCompleted = false, ctx = null) {
    const start = Date.now();
    try {
      let query = supabase
        .from('tasks')
        .select('*')
        .eq('calendar_entry_id', calendarEntryId);

      // Filter to only incomplete tasks unless includeCompleted is true
      if (!includeCompleted) {
        query = query.eq('completed', false);
      }

      const { data, error } = await query;

      if (error) throw error;
      ctx?.logDbQuery('supabase_getTasksByCalendarEntryId', { calendarEntryId, includeCompleted }, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getTasksByCalendarEntryId', { calendarEntryId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get task template by stage and task number
   * @param {number} stageId - Stage ID
   * @param {number} taskNumber - Task number
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTaskTemplateByNumber(stageId, taskNumber, ctx = null) {
    const start = Date.now();
    try {
      // Try non-meeting templates first
      let { data, error } = await supabase
        .from('task-list-non-meeting')
        .select('*')
        .eq('stage_id', stageId)
        .eq('task_number', taskNumber)
        .single();

      if (!error && data) {
        ctx?.logDbQuery('supabase_getTaskTemplateByNumber', { stageId, taskNumber }, { found: true, source: 'non-meeting' }, Date.now() - start, 'success');
        return data;
      }

      // Try probate templates
      ({ data, error } = await supabase
        .from('task-list-probate')
        .select('*')
        .eq('stage_id', stageId)
        .eq('task_number', taskNumber)
        .single());

      if (!error && data) {
        ctx?.logDbQuery('supabase_getTaskTemplateByNumber', { stageId, taskNumber }, { found: true, source: 'probate' }, Date.now() - start, 'success');
        return data;
      }

      ctx?.logDbQuery('supabase_getTaskTemplateByNumber', { stageId, taskNumber }, { found: false }, Date.now() - start, 'success');
      return null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getTaskTemplateByNumber', { stageId, taskNumber }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Upsert matter info (current state)
   * @param {Object} matterData - Matter data to upsert
   * @param {Object} [ctx] - Optional tracking context
   */
  static async upsertMatterInfo(matterData, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('matter-info')
        .upsert(matterData, { onConflict: 'matter_id' })
        .select();

      if (error) throw error;
      ctx?.logDbMutation('supabase_upsertMatterInfo', { matterId: matterData.matter_id }, { id: data?.[0]?.id }, Date.now() - start, 'success');
      return data?.[0];
    } catch (error) {
      ctx?.logDbMutation('supabase_upsertMatterInfo', { matterId: matterData.matter_id }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Insert matter history record
   * @param {Object} matterData - Matter data to insert
   * @param {Object} [ctx] - Optional tracking context
   */
  static async insertMatterHistory(matterData, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('matters')
        .insert(matterData)
        .select();

      if (error) throw error;
      ctx?.logDbMutation('supabase_insertMatterHistory', { matterId: matterData.matter_id }, { id: data?.[0]?.id }, Date.now() - start, 'success');
      return data?.[0];
    } catch (error) {
      ctx?.logDbMutation('supabase_insertMatterHistory', { matterId: matterData.matter_id }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Insert task record
   * Uses upsert to handle both new inserts and updates
   * Primary conflict resolution on task_id
   * Unique constraint on (matter_id, stage_id, task_number) prevents duplicates
   * @param {Object} taskData - Task data to insert
   * @param {Object} [ctx] - Optional tracking context
   */
  static async insertTask(taskData, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('tasks')
        .upsert(taskData, {
          onConflict: 'task_id',
          ignoreDuplicates: false // We want to update if task_id already exists
        })
        .select();

      // Handle unique constraint violation on (matter_id, stage_id, task_number)
      if (error) {
        // PostgreSQL error code 23505 = unique_violation
        if (error.code === '23505' && error.message.includes('unique_task_per_stage')) {
          // Task exists for this (matter, stage, task#) - UPDATE it with new task_id and calendar_entry_id
          console.log(`[SUPABASE] Task already exists: matter=${taskData.matter_id}, stage=${taskData.stage_id}, task#=${taskData.task_number} - updating with new task_id and calendar_entry_id`);

          // Update the existing task with new task_id and calendar_entry_id
          const updateData = {
            task_id: taskData.task_id,
            task_name: taskData.task_name,
            task_desc: taskData.task_desc,
            assigned_user_id: taskData.assigned_user_id,
            assigned_user: taskData.assigned_user,
            due_date: taskData.due_date,
            status: taskData.status || 'pending',
            task_date_generated: taskData.task_date_generated,
            due_date_generated: taskData.due_date_generated,
          };

          // Only set calendar_entry_id if provided (don't overwrite with null)
          if (taskData.calendar_entry_id) {
            updateData.calendar_entry_id = taskData.calendar_entry_id;
          }

          const { data: updated, error: updateError } = await supabase
            .from('tasks')
            .update(updateData)
            .eq('matter_id', taskData.matter_id)
            .eq('stage_id', taskData.stage_id)
            .eq('task_number', taskData.task_number)
            .select()
            .single();

          if (updateError) {
            console.error(`[SUPABASE] Failed to update existing task: ${updateError.message}`);
            throw error; // Throw original error
          }

          ctx?.logDbMutation('supabase_insertTask', { taskId: taskData.task_id }, { existed: true, updated: true, id: updated?.id }, Date.now() - start, 'success');
          return updated;
        }

        throw error;
      }

      ctx?.logDbMutation('supabase_insertTask', { taskId: taskData.task_id, taskName: taskData.task_name }, { id: data?.[0]?.id }, Date.now() - start, 'success');
      return data?.[0];
    } catch (error) {
      ctx?.logDbMutation('supabase_insertTask', { taskId: taskData.task_id }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get task by ID from Supabase
   * @param {number} taskId - Task ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTaskById(taskId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('task_id', taskId)
        .single();

      if (error) throw error;
      ctx?.logDbQuery('supabase_getTaskById', { taskId }, { found: !!data }, Date.now() - start, 'success');
      return data;
    } catch (error) {
      ctx?.logDbQuery('supabase_getTaskById', { taskId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get tasks by matter and stage
   * @param {number} matterId - Matter ID
   * @param {number} stageId - Stage ID
   * @param {boolean} [completed=null] - Filter by completion status
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTasksByMatterAndStage(matterId, stageId, completed = null, ctx = null) {
    const start = Date.now();
    try {
      let query = supabase
        .from('tasks')
        .select('*')
        .eq('matter_id', matterId)
        .eq('stage_id', stageId)
        .neq('status', 'deleted'); // Exclude deleted tasks

      if (completed !== null) {
        query = query.eq('completed', completed);
      }

      const { data, error } = await query;
      if (error) throw error;
      ctx?.logDbQuery('supabase_getTasksByMatterAndStage', { matterId, stageId, completed }, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getTasksByMatterAndStage', { matterId, stageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get count of deleted tasks for a matter and stage
   * @param {number} matterId - Matter ID
   * @param {number} stageId - Stage ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getDeletedTasksCount(matterId, stageId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('task_id')
        .eq('matter_id', matterId)
        .eq('stage_id', stageId)
        .eq('status', 'deleted');

      if (error) throw error;
      const count = data?.length || 0;
      ctx?.logDbQuery('supabase_getDeletedTasksCount', { matterId, stageId }, { count }, Date.now() - start, 'success');
      return count;
    } catch (error) {
      ctx?.logDbQuery('supabase_getDeletedTasksCount', { matterId, stageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get tasks created by calendar entries for this matter and stage
   * (tasks that have a calendar_entry_id set, regardless of which specific entry)
   * @param {number} calendarEntryId - Calendar entry ID (unused but kept for API compat)
   * @param {number} matterId - Matter ID
   * @param {number} stageId - Stage ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTasksByCalendarEntry(calendarEntryId, matterId, stageId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error} = await supabase
        .from('tasks')
        .select('*')
        .eq('matter_id', matterId)
        .eq('stage_id', stageId)
        .eq('completed', false)
        .not('calendar_entry_id', 'is', null); // Get tasks created by ANY calendar entry

      if (error) throw error;
      ctx?.logDbQuery('supabase_getTasksByCalendarEntry', { matterId, stageId }, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getTasksByCalendarEntry', { matterId, stageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get tasks generated within time window for verification
   * Used by post-verification to check if all expected tasks were created
   * @param {number} matterId - Matter ID
   * @param {number} stageId - Stage ID
   * @param {number} [minutes=1] - Time window in minutes
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getRecentTasksByMatterAndStage(matterId, stageId, minutes = 1, ctx = null) {
    const start = Date.now();
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('task_id, task_number, status, calendar_entry_id, task_date_generated')
        .eq('matter_id', matterId)
        .eq('stage_id', stageId)
        .gte('task_date_generated', cutoffTime)
        .order('task_number', { ascending: true });

      if (error) throw error;
      ctx?.logDbQuery('supabase_getRecentTasksByMatterAndStage', { matterId, stageId, minutes }, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getRecentTasksByMatterAndStage', { matterId, stageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get expected task count for a stage (excludes Attempt 2/3/No Response)
   * @param {number} stageId - Stage ID
   * @param {number} practiceAreaId - Practice area ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getExpectedTaskCount(stageId, practiceAreaId, ctx = null) {
    const start = Date.now();
    const PROBATE_PRACTICE_AREA_ID = 45045123;
    const tableName = practiceAreaId === PROBATE_PRACTICE_AREA_ID
      ? 'task-list-probate'
      : 'task-list-non-meeting';

    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('task_number, task_title')
        .eq('stage_id', stageId);

      if (error) throw error;

      // Filter out attempt sequences (created by task completion automation)
      const filtered = (data || []).filter(t => {
        const title = t.task_title?.toLowerCase() || '';
        return !['attempt 2', 'attempt 2 follow up', 'attempt 3', 'attempt 3 follow up', 'no response'].includes(title);
      });

      const result = {
        expectedCount: filtered.length,
        expectedTaskNumbers: filtered.map(t => t.task_number)
      };

      ctx?.logDbQuery('supabase_getExpectedTaskCount', { stageId, practiceAreaId, tableName }, result, Date.now() - start, 'success');
      return result;
    } catch (error) {
      ctx?.logDbQuery('supabase_getExpectedTaskCount', { stageId, practiceAreaId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get expected meeting task count
   * @param {number} calendarEventId - Calendar event ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getExpectedMeetingTaskCount(calendarEventId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('task-list-meeting')
        .select('task_number, task_title')
        .eq('calendar_event_id', calendarEventId);

      if (error) throw error;

      const result = {
        expectedCount: (data || []).length,
        expectedTaskNumbers: (data || []).map(t => t.task_number)
      };

      ctx?.logDbQuery('supabase_getExpectedMeetingTaskCount', { calendarEventId }, result, Date.now() - start, 'success');
      return result;
    } catch (error) {
      ctx?.logDbQuery('supabase_getExpectedMeetingTaskCount', { calendarEventId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Upsert meeting booking record
   * @param {Object} meetingData - Meeting data
   * @param {Object} [ctx] - Optional tracking context
   */
  static async upsertMeetingBooking(meetingData, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('matters-meetings-booked')
        .upsert(meetingData, { onConflict: 'uuid' })
        .select();

      if (error) throw error;
      ctx?.logDbMutation('supabase_upsertMeetingBooking', { matterId: meetingData.matter_id }, { id: data?.[0]?.uuid }, Date.now() - start, 'success');
      return data?.[0];
    } catch (error) {
      ctx?.logDbMutation('supabase_upsertMeetingBooking', { matterId: meetingData.matter_id }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Check if meeting already recorded
   * @param {number} matterId - Matter ID
   * @param {number} calendarEventId - Calendar event ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getMeetingRecord(matterId, calendarEventId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('matters-meetings-booked')
        .select('*')
        .eq('matter_id', matterId)
        .eq('calendar_event_id', calendarEventId)
        .limit(1);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getMeetingRecord', { matterId, calendarEventId }, { found: !!data?.[0] }, Date.now() - start, 'success');
      return data?.[0] || null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getMeetingRecord', { matterId, calendarEventId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Update task
   * @param {number} taskId - Task ID
   * @param {Object} updates - Task updates
   * @param {Object} [ctx] - Optional tracking context
   */
  static async updateTask(taskId, updates, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('task_id', taskId)
        .select();

      if (error) throw error;
      ctx?.logDbMutation('supabase_updateTask', { taskId, updates: Object.keys(updates) }, { id: data?.[0]?.id }, Date.now() - start, 'success');
      return data?.[0];
    } catch (error) {
      ctx?.logDbMutation('supabase_updateTask', { taskId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Log error to error_logs table
   * @param {string} errorCode - Error code
   * @param {string} errorMessage - Error message
   * @param {Object} [context={}] - Error context
   * @param {Object} [ctx] - Optional tracking context
   */
  static async logError(errorCode, errorMessage, context = {}, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('error_logs')
        .insert({
          error_code: errorCode,
          error_message: errorMessage,
          context: context,
          matter_id: context.matter_id || null,
          task_id: context.task_id || null,
          calendar_entry_id: context.calendar_entry_id || null,
          created_at: new Date().toISOString(),
        })
        .select();

      if (error) {
        console.error('[SUPABASE] Failed to log error:', error);
        ctx?.logDbMutation('supabase_logError', { errorCode }, null, Date.now() - start, 'error', error.message);
        return null;
      }

      ctx?.logDbMutation('supabase_logError', { errorCode }, { id: data?.[0]?.id }, Date.now() - start, 'success');
      return data?.[0];
    } catch (error) {
      console.error('[SUPABASE] Exception logging error:', error.message);
      return null;
    }
  }

  /**
   * Track Sheila Condomina assignee changes
   * Logs when tasks are assigned to Sheila (IDs: 357896692, 358412483)
   * @param {Object} changeData - Change data
   * @param {Object} [ctx] - Optional tracking context
   */
  static async trackSheilaAssigneeChange(changeData, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('sheila-temp-assignee-changes')
        .insert({
          task_id: changeData.task_id,
          task_name: changeData.task_name,
          task_desc: changeData.task_desc,
          due_date: changeData.due_date,
          status: changeData.status,
          previous_assignee_id: changeData.previous_assignee_id,
          previous_assignee_name: changeData.previous_assignee_name,
          new_assignee_id: changeData.new_assignee_id,
          new_assignee_name: changeData.new_assignee_name,
          task_originally_created_at: changeData.task_originally_created_at,
          task_originally_created_by: changeData.task_originally_created_by,
          changed_at: changeData.changed_at || new Date().toISOString(),
          matter_id: changeData.matter_id,
          stage_name: changeData.stage_name,
        })
        .select();

      if (error) throw error;
      ctx?.logDbMutation('supabase_trackSheilaAssigneeChange', { taskId: changeData.task_id }, { id: data?.[0]?.id }, Date.now() - start, 'success');
      return data?.[0];
    } catch (error) {
      ctx?.logDbMutation('supabase_trackSheilaAssigneeChange', { taskId: changeData.task_id }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Check if tasks were recently generated for a matter and stage
   * Used to prevent duplicate processing
   * @param {number} matterId - Matter ID
   * @param {number} stageId - Stage ID
   * @param {number} [minutes=1] - Time window in minutes
   * @param {Object} [ctx] - Optional tracking context
   */
  static async checkRecentTaskGeneration(matterId, stageId, minutes = 1, ctx = null) {
    const start = Date.now();
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('matter_id', matterId)
        .eq('stage_id', stageId)
        .gt('task_date_generated', cutoffTime)
        .limit(1);

      if (error) throw error;
      const hasRecent = data && data.length > 0;
      ctx?.logDbQuery('supabase_checkRecentTaskGeneration', { matterId, stageId, minutes }, { hasRecent }, Date.now() - start, 'success');
      return hasRecent;
    } catch (error) {
      ctx?.logDbQuery('supabase_checkRecentTaskGeneration', { matterId, stageId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Generate idempotency key for webhook
   * Format: {event_type}:{resource_id}:{timestamp}
   */
  static generateIdempotencyKey(eventType, resourceId, timestamp) {
    return `${eventType}:${resourceId}:${timestamp}`;
  }

  /**
   * Check if webhook already processed
   * Returns webhook event record if found, null if not processed
   * @param {string} idempotencyKey - Idempotency key
   * @param {Object} [ctx] - Optional tracking context
   */
  static async checkWebhookProcessed(idempotencyKey, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('webhook_events')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      ctx?.logDbQuery('supabase_checkWebhookProcessed', { idempotencyKey }, { found: !!data }, Date.now() - start, 'success');
      return data || null;
    } catch (error) {
      // If table doesn't exist or other error, log and continue without idempotency
      console.warn('[SUPABASE] Idempotency check failed:', error.message);
      ctx?.logDbQuery('supabase_checkWebhookProcessed', { idempotencyKey }, null, Date.now() - start, 'error', error.message);
      return null;
    }
  }

  /**
   * Record webhook processing result
   * Returns webhook event record or null if duplicate
   * @param {Object} webhookData - Webhook data
   * @param {Object} [ctx] - Optional tracking context
   */
  static async recordWebhookProcessed(webhookData, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('webhook_events')
        .insert(webhookData)
        .select();

      if (error) {
        // If duplicate key (23505), webhook was processed by another request
        if (error.code === '23505') {
          console.log(`[SUPABASE] Duplicate idempotency key detected: ${webhookData.idempotency_key}`);
          ctx?.logDbMutation('supabase_recordWebhookProcessed', { idempotencyKey: webhookData.idempotency_key }, { duplicate: true }, Date.now() - start, 'success');
          return null; // Already processed
        }
        throw error;
      }

      ctx?.logDbMutation('supabase_recordWebhookProcessed', { idempotencyKey: webhookData.idempotency_key }, { id: data?.[0]?.id }, Date.now() - start, 'success');
      return data?.[0];
    } catch (error) {
      // Log error but don't throw - webhook processing already succeeded
      console.error('[SUPABASE] Failed to record webhook event:', error.message);
      ctx?.logDbMutation('supabase_recordWebhookProcessed', { idempotencyKey: webhookData.idempotency_key }, null, Date.now() - start, 'error', error.message);
      return null;
    }
  }

  /**
   * Update an existing webhook event record
   * @param {string} idempotencyKey - Idempotency key
   * @param {Object} updates - Updates to apply
   * @param {Object} [ctx] - Optional tracking context
   */
  static async updateWebhookProcessed(idempotencyKey, updates, ctx = null) {
    const start = Date.now();
    try {
      const { error } = await supabase
        .from('webhook_events')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('idempotency_key', idempotencyKey);

      if (error) {
        console.error('[SUPABASE] Failed to update webhook event:', error);
        ctx?.logDbMutation('supabase_updateWebhookProcessed', { idempotencyKey }, null, Date.now() - start, 'error', error.message);
        throw error;
      }
      ctx?.logDbMutation('supabase_updateWebhookProcessed', { idempotencyKey, updates: Object.keys(updates) }, { updated: true }, Date.now() - start, 'success');
    } catch (error) {
      ctx?.logDbMutation('supabase_updateWebhookProcessed', { idempotencyKey }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Validate task templates for duplicates and missing data
   */
  static validateTaskTemplates(templates) {
    const errors = [];

    if (!templates || templates.length === 0) {
      return { valid: false, errors: ['No templates found'] };
    }

    // Check for duplicate task_numbers
    const taskNumbers = templates.map(t => t.task_number).filter(n => n != null);
    const duplicates = taskNumbers.filter((num, index) => taskNumbers.indexOf(num) !== index);

    if (duplicates.length > 0) {
      errors.push(`Duplicate task_numbers found: ${duplicates.join(', ')}`);
    }

    // Check for missing required fields
    templates.forEach((template, index) => {
      if (!template.task_title) {
        errors.push(`Template at index ${index} missing task_title`);
      }
      if (template.task_number == null) {
        errors.push(`Template at index ${index} missing task_number`);
      }
    });

    return {
      valid: errors.length === 0,
      errors: errors,
    };
  }

  /**
   * Get calendar event mapping
   * @param {number} calendarEventId - Calendar event ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getCalendarEventMapping(calendarEventId, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('calendar_event_mappings')
        .select('*')
        .eq('calendar_event_id', calendarEventId)
        .eq('active', true)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      ctx?.logDbQuery('supabase_getCalendarEventMapping', { calendarEventId }, { found: !!data }, Date.now() - start, 'success');
      return data || null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getCalendarEventMapping', { calendarEventId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get all active calendar event mappings
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getAllCalendarEventMappings(ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('calendar_event_mappings')
        .select('*')
        .eq('active', true);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getAllCalendarEventMappings', {}, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getAllCalendarEventMappings', {}, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get attempt sequence for current attempt
   * @param {string} currentAttempt - Current attempt name
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getAttemptSequence(currentAttempt, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('attempt_sequences')
        .select('*')
        .eq('current_attempt', currentAttempt.toLowerCase())
        .eq('active', true)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      ctx?.logDbQuery('supabase_getAttemptSequence', { currentAttempt }, { found: !!data }, Date.now() - start, 'success');
      return data || null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getAttemptSequence', { currentAttempt }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get all active attempt sequences
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getAllAttemptSequences(ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('attempt_sequences')
        .select('*')
        .eq('active', true)
        .order('sequence_order', { ascending: true });

      if (error) throw error;
      ctx?.logDbQuery('supabase_getAllAttemptSequences', {}, { count: (data || []).length }, Date.now() - start, 'success');
      return data || [];
    } catch (error) {
      ctx?.logDbQuery('supabase_getAllAttemptSequences', {}, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get all active location keywords
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getLocationKeywords(ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('location_keywords')
        .select('keyword')
        .eq('active', true);

      if (error) throw error;
      ctx?.logDbQuery('supabase_getLocationKeywords', {}, { count: (data || []).length }, Date.now() - start, 'success');
      return (data || []).map(row => row.keyword);
    } catch (error) {
      ctx?.logDbQuery('supabase_getLocationKeywords', {}, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get matter status mapping for a given stage
   * Returns the status that should be set when matter moves to this stage
   * @param {string} stageName - Stage name
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getMatterStatusByStage(stageName, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('stage_status_mappings')
        .select('matter_status')
        .eq('stage_name', stageName)
        .eq('active', true)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      ctx?.logDbQuery('supabase_getMatterStatusByStage', { stageName }, { found: !!data?.matter_status }, Date.now() - start, 'success');
      return data?.matter_status || null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getMatterStatusByStage', { stageName }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get list of excluded folder names for document automation
   * Returns array of folder names (lowercase) that should not trigger task creation
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getExcludedFolders(ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('excluded_folders')
        .select('folder_name')
        .eq('active', true);

      if (error) {
        // If table doesn't exist yet, return empty array
        if (error.code === '42P01') {
          console.warn('[SUPABASE] excluded_folders table does not exist yet');
          ctx?.logDbQuery('supabase_getExcludedFolders', {}, { count: 0, reason: 'table_not_exists' }, Date.now() - start, 'success');
          return [];
        }
        throw error;
      }

      ctx?.logDbQuery('supabase_getExcludedFolders', {}, { count: (data || []).length }, Date.now() - start, 'success');
      return (data || []).map(row => row.folder_name.toLowerCase());
    } catch (error) {
      ctx?.logDbQuery('supabase_getExcludedFolders', {}, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get automation configuration value by key
   * @param {string} configKey - The configuration key to retrieve
   * @param {Object} [ctx] - Optional tracking context
   * @returns {Promise<any>} The configuration value (parsed from JSONB)
   */
  static async getAutomationConfig(configKey, ctx = null) {
    const start = Date.now();
    try {
      const { data, error } = await supabase
        .from('automation_config')
        .select('config_value')
        .eq('config_key', configKey)
        .single();

      if (error) {
        // If table doesn't exist yet or config not found, return null
        if (error.code === '42P01' || error.code === 'PGRST116') {
          console.warn(`[SUPABASE] automation_config not found for key: ${configKey}`);
          ctx?.logDbQuery('supabase_getAutomationConfig', { configKey }, { found: false }, Date.now() - start, 'success');
          return null;
        }
        throw error;
      }

      ctx?.logDbQuery('supabase_getAutomationConfig', { configKey }, { found: !!data?.config_value }, Date.now() - start, 'success');
      return data?.config_value || null;
    } catch (error) {
      ctx?.logDbQuery('supabase_getAutomationConfig', { configKey }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }
}
