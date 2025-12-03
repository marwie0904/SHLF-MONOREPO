import axios from 'axios';
import { config } from '../config/index.js';
import { TokenRefreshService } from './token-refresh.js';
import { EventTracker } from './event-tracker.js';

/**
 * Clio API Integration Layer
 */
export class ClioService {
  static client = axios.create({
    baseURL: config.clio.apiBaseUrl,
    headers: {
      'Authorization': `Bearer ${config.clio.accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  /**
   * Initialize axios interceptors for automatic token refresh
   * Call this once on app startup
   */
  static initializeInterceptors() {
    // Response interceptor to handle 401 errors
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // Check if it's a 401 error and we haven't already retried
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          console.log('🔐 Received 401 Unauthorized, attempting token refresh...');

          try {
            // Refresh the token
            const tokenData = await TokenRefreshService.refreshAccessToken();

            // Update the authorization header with new token
            originalRequest.headers['Authorization'] = `Bearer ${tokenData.access_token}`;
            this.client.defaults.headers['Authorization'] = `Bearer ${tokenData.access_token}`;

            // Retry the original request with new token
            console.log('🔄 Retrying original request with new token...');
            return this.client(originalRequest);
          } catch (refreshError) {
            console.error('❌ Token refresh failed, cannot retry request');
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      }
    );

    console.log('🔌 CLIO API interceptors initialized');
  }

  /**
   * Get full matter details
   * @param {number} matterId - Clio matter ID
   * @param {Object} [ctx] - Optional tracking context from EventTracker.createContext()
   */
  static async getMatter(matterId, ctx = null) {
    const start = Date.now();
    try {
      const response = await this.client.get(
        `/api/v4/matters/${matterId}`,
        {
          params: {
            fields: 'id,display_number,etag,status,matter_stage,matter_stage_updated_at,location,practice_area,originating_attorney,responsible_attorney',
          },
        }
      );
      ctx?.logApiCall('clio_getMatter', { matterId }, { id: response.data.data.id, status: response.data.data.status }, Date.now() - start, 'success');
      return response.data.data;
    } catch (error) {
      ctx?.logApiCall('clio_getMatter', { matterId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get task details
   * @param {number} taskId - Clio task ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTask(taskId, ctx = null) {
    const start = Date.now();
    try {
      const response = await this.client.get(
        `/api/v4/tasks/${taskId}`,
        {
          params: {
            fields: 'id,name,description,status,matter{id,display_number},assignee{id,name},due_at',
          },
        }
      );
      ctx?.logApiCall('clio_getTask', { taskId }, { id: response.data.data.id, name: response.data.data.name }, Date.now() - start, 'success');
      return response.data.data;
    } catch (error) {
      ctx?.logApiCall('clio_getTask', { taskId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get all tasks for a specific matter
   * @param {number} matterId - Clio matter ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getTasksByMatter(matterId, ctx = null) {
    const start = Date.now();
    try {
      const response = await this.client.get(
        '/api/v4/tasks',
        {
          params: {
            matter_id: matterId,
            fields: 'id,name,description,status,matter{id,display_number},assignee{id,name},due_at',
          },
        }
      );
      ctx?.logApiCall('clio_getTasksByMatter', { matterId }, { count: response.data.data.length }, Date.now() - start, 'success');
      return response.data.data;
    } catch (error) {
      ctx?.logApiCall('clio_getTasksByMatter', { matterId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get calendar entry details
   * @param {number} entryId - Clio calendar entry ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getCalendarEntry(entryId, ctx = null) {
    const start = Date.now();
    try {
      const response = await this.client.get(
        `/api/v4/calendar_entries/${entryId}.json`,
        {
          params: {
            fields: 'calendar_entry_event_type,matter,location,start_at,end_at',
          },
        }
      );
      ctx?.logApiCall('clio_getCalendarEntry', { entryId }, { id: response.data.data.id }, Date.now() - start, 'success');
      return response.data.data;
    } catch (error) {
      ctx?.logApiCall('clio_getCalendarEntry', { entryId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get document details
   * @param {number} documentId - Clio document ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getDocument(documentId, ctx = null) {
    const start = Date.now();
    try {
      const response = await this.client.get(
        `/api/v4/documents/${documentId}.json`,
        {
          params: {
            fields: 'id,name,parent{id,name,type},matter,created_at',
          },
        }
      );
      ctx?.logApiCall('clio_getDocument', { documentId }, { id: response.data.data.id, name: response.data.data.name }, Date.now() - start, 'success');
      return response.data.data;
    } catch (error) {
      ctx?.logApiCall('clio_getDocument', { documentId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Create a calendar entry in Clio
   * @param {Object} data - Calendar entry data
   * @param {Object} [ctx] - Optional tracking context
   */
  static async createCalendarEntry(data, ctx = null) {
    const start = Date.now();
    try {
      const payload = {
        data: {
          summary: data.summary,
          calendar_entry_event_type: { id: data.eventTypeId },
          calendar_owner: { id: data.calendarOwnerId || 7077963 },
          matter: { id: data.matterId },
          start_at: data.startAt,
          end_at: data.endAt,
          all_day: false,
        },
      };

      // Only add location if provided
      if (data.location) {
        payload.data.location = { id: data.location };
      }

      const response = await this.client.post('/api/v4/calendar_entries', payload, {
        params: {
          fields: 'id,summary,calendar_entry_event_type,matter,location,start_at,end_at,created_at',
        },
      });
      ctx?.logApiCall('clio_createCalendarEntry', { matterId: data.matterId, summary: data.summary }, { id: response.data.data.id }, Date.now() - start, 'success');
      return response.data.data;
    } catch (error) {
      console.error('Clio API Error Details (Calendar Entry):');
      console.error('  Status:', error.response?.status);
      console.error('  Data:', JSON.stringify(error.response?.data, null, 2));
      console.error('  Request payload:', JSON.stringify({
        summary: data.summary,
        eventTypeId: data.eventTypeId,
        calendarOwnerId: data.calendarOwnerId || 356869833,
        matterId: data.matterId,
        location: data.location,
        startAt: data.startAt,
        endAt: data.endAt,
      }, null, 2));
      ctx?.logApiCall('clio_createCalendarEntry', { matterId: data.matterId, summary: data.summary }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Create a task in Clio
   * @param {Object} taskData - Task data (name, description, matter, due_at, assignee)
   * @param {Object} [ctx] - Optional tracking context
   * @param {Object} [taskMeta] - Optional task metadata for richer logging
   * @param {string} [taskMeta.assigneeName] - Human-readable assignee name
   * @param {string} [taskMeta.assigneeType] - Assignee type (Attorney, CSC, VA, etc.)
   * @param {number} [taskMeta.taskNumber] - Task sequence number in stage
   */
  static async createTask(taskData, ctx = null, taskMeta = {}) {
    const start = Date.now();
    try {
      const response = await this.client.post('/api/v4/tasks', {
        data: taskData,
      }, {
        params: {
          fields: 'id,name,description,status,assignee,matter,due_at',
        },
      });

      // Log with full task details if context available
      if (ctx?.logTaskCreation) {
        ctx.logTaskCreation(
          {
            matterId: taskData.matter?.id,
            name: taskData.name,
            description: taskData.description,
            dueDate: taskData.due_at,
            assigneeId: taskData.assignee?.id,
            assigneeName: taskMeta.assigneeName || response.data.data.assignee?.name,
            assigneeType: taskMeta.assigneeType || taskData.assignee?.type,
            taskNumber: taskMeta.taskNumber,
          },
          response.data.data,
          Date.now() - start,
          'success'
        );
      } else {
        ctx?.logApiCall('clio_createTask', { name: taskData.name, matterId: taskData.matter?.id }, { id: response.data.data.id }, Date.now() - start, 'success');
      }

      return response.data.data;
    } catch (error) {
      // Log detailed error for debugging
      console.error('Clio API Error Details:');
      console.error('  Status:', error.response?.status);
      console.error('  Data:', JSON.stringify(error.response?.data, null, 2));
      console.error('  Request data:', JSON.stringify(taskData, null, 2));

      // Log with full task details and structured error
      if (ctx?.logTaskCreation) {
        ctx.logTaskCreation(
          {
            matterId: taskData.matter?.id,
            name: taskData.name,
            description: taskData.description,
            dueDate: taskData.due_at,
            assigneeId: taskData.assignee?.id,
            assigneeName: taskMeta.assigneeName,
            assigneeType: taskMeta.assigneeType || taskData.assignee?.type,
            taskNumber: taskMeta.taskNumber,
          },
          null,
          Date.now() - start,
          'error',
          error
        );
      } else {
        ctx?.logApiCall('clio_createTask', { name: taskData.name, matterId: taskData.matter?.id }, null, Date.now() - start, 'error', error);
      }

      throw error;
    }
  }

  /**
   * Update a task in Clio
   * @param {number} taskId - Clio task ID
   * @param {Object} updates - Task updates
   * @param {Object} [ctx] - Optional tracking context
   */
  static async updateTask(taskId, updates, ctx = null) {
    const start = Date.now();
    try {
      const response = await this.client.patch(`/api/v4/tasks/${taskId}`, {
        data: updates,
      });
      ctx?.logApiCall('clio_updateTask', { taskId, updates: Object.keys(updates) }, { id: response.data.data.id }, Date.now() - start, 'success');
      return response.data.data;
    } catch (error) {
      ctx?.logApiCall('clio_updateTask', { taskId, updates: Object.keys(updates) }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Delete a task from Clio
   * @param {number} taskId - Clio task ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async deleteTask(taskId, ctx = null) {
    const start = Date.now();
    try {
      await this.client.delete(`/api/v4/tasks/${taskId}`);
      ctx?.logApiCall('clio_deleteTask', { taskId }, { deleted: true }, Date.now() - start, 'success');
    } catch (error) {
      ctx?.logApiCall('clio_deleteTask', { taskId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Update matter fields (location, attorney, etc.)
   * @param {number} matterId - Clio matter ID
   * @param {Object} updates - Matter updates
   * @param {Object} [ctx] - Optional tracking context
   */
  static async updateMatter(matterId, updates, ctx = null) {
    const start = Date.now();
    try {
      const response = await this.client.patch(`/api/v4/matters/${matterId}`, {
        data: updates,
      });
      ctx?.logApiCall('clio_updateMatter', { matterId, updates: Object.keys(updates) }, { id: response.data.data.id }, Date.now() - start, 'success');
      return response.data.data;
    } catch (error) {
      ctx?.logApiCall('clio_updateMatter', { matterId, updates: Object.keys(updates) }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Update matter status
   * @param {number} matterId - Clio matter ID
   * @param {string} status - New status
   * @param {Object} [ctx] - Optional tracking context
   */
  static async updateMatterStatus(matterId, status, ctx = null) {
    const start = Date.now();
    try {
      const response = await this.client.patch(`/api/v4/matters/${matterId}`, {
        data: {
          status: status,
        },
      });
      ctx?.logApiCall('clio_updateMatterStatus', { matterId, status }, { id: response.data.data.id, status: response.data.data.status }, Date.now() - start, 'success');
      return response.data.data;
    } catch (error) {
      ctx?.logApiCall('clio_updateMatterStatus', { matterId, status }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Get all bills for a matter
   * @param {number} matterId - Clio matter ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async getBillsByMatter(matterId, ctx = null) {
    const start = Date.now();
    try {
      const response = await this.client.get('/api/v4/bills', {
        params: {
          matter_id: matterId,
          fields: 'id,total,paid,balance,status',
        },
      });
      ctx?.logApiCall('clio_getBillsByMatter', { matterId }, { count: response.data.data.length }, Date.now() - start, 'success');
      return response.data.data;
    } catch (error) {
      ctx?.logApiCall('clio_getBillsByMatter', { matterId }, null, Date.now() - start, 'error', error.message);
      throw error;
    }
  }

  /**
   * Check if a matter has any payments
   * Returns true if any bills exist with paid > 0
   * @param {number} matterId - Clio matter ID
   * @param {Object} [ctx] - Optional tracking context
   */
  static async hasPayments(matterId, ctx = null) {
    const start = Date.now();
    try {
      const bills = await this.getBillsByMatter(matterId, ctx);

      // Check if any bill has payments (paid amount > 0)
      const hasAnyPayments = bills.some(bill => {
        const paidAmount = parseFloat(bill.paid || 0);
        return paidAmount > 0;
      });

      ctx?.logCalculation('check_hasPayments', { matterId, billCount: bills.length }, { hasPayments: hasAnyPayments });
      return hasAnyPayments;
    } catch (error) {
      console.error('Error checking payments for matter:', matterId);
      console.error('  Status:', error.response?.status);
      console.error('  Data:', JSON.stringify(error.response?.data, null, 2));
      throw error;
    }
  }

  /**
   * Retry wrapper for API calls
   * @param {Function} fn - Function to retry
   * @param {number} [maxAttempts=3] - Max retry attempts
   * @param {number} [delayMs=1000] - Delay between retries
   * @param {Object} [ctx] - Optional tracking context
   */
  static async withRetry(fn, maxAttempts = 3, delayMs = 1000, ctx = null) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        ctx?.logDecision('retry_attempt', { attempt, maxAttempts }, { willRetry: attempt < maxAttempts, error: error.message });
        if (attempt === maxAttempts) throw error;

        console.log(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
}
