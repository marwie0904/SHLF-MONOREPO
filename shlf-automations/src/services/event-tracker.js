import { ConvexHttpClient } from "convex/browser";
import { config } from "../config/index.js";
import { randomUUID } from "crypto";

/**
 * Event Tracker Service
 *
 * Provides a unified interface for tracking events across all layers
 * of the automation system. Uses Convex for storage.
 *
 * Hierarchy:
 * - TRACE (Parent): One per webhook/job invocation
 * - STEP (Child): Major operations within a trace
 * - DETAIL (Grandchild): Individual operations within a step
 *
 * Features:
 * - Buffered detail logging for efficiency
 * - Automatic sanitization of sensitive data
 * - Silent failures (tracking errors don't break main flow)
 * - Context helpers for cleaner code
 */

// Initialize Convex client
let convex = null;
let trackingEnabled = true;
let convexApi = null;

// Detail buffer for batch inserts
let detailBuffer = [];
let flushTimeout = null;
const BUFFER_SIZE = 50;
const FLUSH_INTERVAL_MS = 5000;

/**
 * Initialize the Convex client
 * Called once at app startup
 */
export async function initializeEventTracker() {
  try {
    if (config.convex?.url) {
      // Try to import the Convex API - it may not exist in all environments
      try {
        const apiModule = await import("../../convex/_generated/api.js");
        convexApi = apiModule.api;
        convex = new ConvexHttpClient(config.convex.url);
        trackingEnabled = config.tracking?.enabled !== false;
        console.log(
          `[EventTracker] Initialized ${trackingEnabled ? "✓" : "(disabled)"}`
        );
      } catch (importError) {
        console.warn("[EventTracker] Convex API not available - tracking disabled");
        console.warn("[EventTracker] Run 'npx convex dev' or 'npx convex deploy' to generate API");
        trackingEnabled = false;
      }
    } else {
      console.warn("[EventTracker] No Convex URL configured, tracking disabled");
      trackingEnabled = false;
    }
  } catch (error) {
    console.error("[EventTracker] Failed to initialize:", error.message);
    trackingEnabled = false;
  }
}

/**
 * Generate a unique identifier
 */
function generateId() {
  return randomUUID();
}

/**
 * Format an error into a structured object
 * - Extracts message, stack, code, httpStatus, and response
 * - Cleans stack trace (filters node_modules, limits lines)
 * - Captures API response data when available
 *
 * @param {Error|Object} error - The error to format
 * @returns {Object} Structured error object
 */
function formatError(error) {
  if (!error) return null;

  // Get the error message
  const message = error.message || String(error);

  // Clean and truncate stack trace
  let stack = error.stack || null;
  if (stack) {
    // Filter out node_modules lines for cleaner traces
    const lines = stack.split("\n");
    const filteredLines = lines.filter(
      (line) => !line.includes("node_modules") || line.includes("shlf-")
    );
    // Limit to 15 lines and 2000 chars
    stack = filteredLines.slice(0, 15).join("\n");
    if (stack.length > 2000) {
      stack = stack.substring(0, 2000) + "\n...[truncated]";
    }
  }

  // Extract error code
  const code = error.code || error.response?.data?.error || null;

  // Extract HTTP status from axios-style errors
  const httpStatus = error.response?.status || error.status || null;

  // Extract response body (sanitized)
  let response = null;
  if (error.response?.data) {
    response = sanitize(error.response.data, 2);
  }

  return {
    message,
    stack,
    code: code ? String(code) : null,
    httpStatus: httpStatus ? Number(httpStatus) : null,
    response,
  };
}

/**
 * Sanitize data for logging
 * - Redacts sensitive fields (tokens, passwords, etc.)
 * - Truncates large strings
 * - Limits array sizes
 * - Limits object depth
 */
function sanitize(data, maxDepth = 3) {
  if (!data || maxDepth <= 0) {
    return maxDepth <= 0 ? "[truncated]" : data;
  }

  if (typeof data !== "object") {
    // Truncate long strings
    if (typeof data === "string" && data.length > 500) {
      return data.substring(0, 500) + "...[truncated]";
    }
    return data;
  }

  if (Array.isArray(data)) {
    // Limit array size
    return data.slice(0, 10).map((item) => sanitize(item, maxDepth - 1));
  }

  // Object handling
  const sanitized = {};
  const sensitiveKeys = [
    "password",
    "token",
    "secret",
    "authorization",
    "key",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "bearer",
    "credential",
  ];

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((k) => lowerKey.includes(k))) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitize(value, maxDepth - 1);
    }
  }

  return sanitized;
}

/**
 * Safe async wrapper - catches errors silently
 * Tracking failures should never break the main application
 */
async function safeAsync(fn, context = "") {
  if (!trackingEnabled || !convex) return null;

  try {
    return await fn();
  } catch (error) {
    console.error(`[EventTracker] ${context} failed:`, error.message);
    return null;
  }
}

/**
 * Flush the detail buffer to Convex
 */
async function flushBuffer() {
  if (!trackingEnabled || !convex || !convexApi || detailBuffer.length === 0) return;

  const batch = [...detailBuffer];
  detailBuffer = [];

  await safeAsync(async () => {
    await convex.mutation(convexApi.clio.tracking.logDetailsBatch, { details: batch });
  }, "flushBuffer");
}

/**
 * Schedule a buffer flush
 */
function scheduleFlush() {
  if (flushTimeout) return;
  flushTimeout = setTimeout(async () => {
    flushTimeout = null;
    await flushBuffer();
  }, FLUSH_INTERVAL_MS);
}

// ============================================================================
// PUBLIC API
// ============================================================================

export const EventTracker = {
  /**
   * Start a new trace (Level 1)
   * Call at the beginning of webhook/job processing
   *
   * @param {Object} params
   * @param {string} params.source - "webhook" or "job"
   * @param {string} params.triggerName - e.g., "matter-stage-change"
   * @param {string} [params.endpoint] - e.g., "/webhooks/matters"
   * @param {number} [params.matterId] - Clio matter ID
   * @param {string} [params.webhookId] - Original webhook ID
   * @param {string} [params.jobName] - For scheduled jobs
   * @param {Object} [params.metadata] - Additional context
   * @returns {Promise<string>} traceId
   */
  async startTrace(params) {
    const traceId = generateId();

    await safeAsync(async () => {
      await convex.mutation(convexApi.clio.tracking.createTrace, {
        traceId,
        source: params.source,
        triggerName: params.triggerName,
        endpoint: params.endpoint,
        matterId: params.matterId ? Number(params.matterId) : undefined,
        webhookId: params.webhookId,
        jobName: params.jobName,
        metadata: sanitize(params.metadata),
      });
    }, `startTrace(${params.triggerName})`);

    return traceId;
  },

  /**
   * End a trace
   * Call at the end of webhook/job processing
   *
   * @param {string} traceId
   * @param {Object} params
   * @param {string} params.status - "success", "error", or "skipped"
   * @param {string} [params.errorMessage]
   * @param {string} [params.resultAction] - e.g., "tasks_created"
   * @param {Object} [params.metadata]
   */
  async endTrace(traceId, params) {
    // Flush any remaining details first
    await flushBuffer();

    await safeAsync(async () => {
      await convex.mutation(convexApi.clio.tracking.endTrace, {
        traceId,
        status: params.status,
        errorMessage: params.errorMessage,
        resultAction: params.resultAction,
        metadata: sanitize(params.metadata),
      });
    }, `endTrace(${traceId})`);
  },

  /**
   * Start a new step (Level 2)
   * Call at the beginning of each major operation
   *
   * @param {string} traceId - Parent trace ID
   * @param {Object} params
   * @param {string} params.layerName - "webhook", "processing", "automation", "service"
   * @param {string} params.stepName - e.g., "fetch_matter", "generate_tasks"
   * @param {Object} [params.metadata]
   * @returns {Promise<string>} stepId
   */
  async startStep(traceId, params) {
    if (!traceId) return null;

    const stepId = generateId();

    await safeAsync(async () => {
      await convex.mutation(convexApi.clio.tracking.createStep, {
        stepId,
        traceId,
        layerName: params.layerName,
        stepName: params.stepName,
        metadata: sanitize(params.metadata),
      });
    }, `startStep(${params.stepName})`);

    return stepId;
  },

  /**
   * End a step
   * Call at the end of each major operation
   *
   * @param {string} stepId
   * @param {Object} params
   * @param {string} params.status - "success", "error", or "skipped"
   * @param {string} [params.errorMessage]
   * @param {Object} [params.metadata]
   */
  async endStep(stepId, params) {
    if (!stepId) return;

    await safeAsync(async () => {
      await convex.mutation(convexApi.clio.tracking.endStep, {
        stepId,
        status: params.status,
        errorMessage: params.errorMessage,
        metadata: sanitize(params.metadata),
      });
    }, `endStep(${stepId})`);
  },

  /**
   * Log a detail (Level 3)
   * Call for each individual operation
   * Details are buffered and batch-inserted for efficiency
   *
   * @param {string} stepId - Parent step ID
   * @param {string} traceId - Root trace ID
   * @param {Object} params
   * @param {string} params.operation - e.g., "clio_getMatter"
   * @param {string} params.operationType - "api_call", "db_query", etc.
   * @param {Object} [params.input]
   * @param {Object} [params.output]
   * @param {number} [params.durationMs]
   * @param {string} params.status - "success", "error", or "skipped"
   * @param {string} [params.errorMessage] - Legacy: simple error message
   * @param {Error|Object} [params.error] - New: error object for structured logging
   */
  logDetail(stepId, traceId, params) {
    if (!trackingEnabled || !stepId || !traceId) return;

    // Format error if provided as an Error object
    const formattedError = params.error ? formatError(params.error) : null;

    detailBuffer.push({
      detailId: generateId(),
      stepId,
      traceId,
      operation: params.operation,
      operationType: params.operationType,
      input: sanitize(params.input),
      output: sanitize(params.output),
      durationMs: params.durationMs,
      status: params.status,
      // Keep legacy errorMessage for backward compatibility
      errorMessage: params.errorMessage || (formattedError?.message),
      // Add structured error object
      error: formattedError,
      timestamp: Date.now(),
    });

    // Flush if buffer is full, otherwise schedule flush
    if (detailBuffer.length >= BUFFER_SIZE) {
      flushBuffer();
    } else {
      scheduleFlush();
    }
  },

  /**
   * Create a context helper for a step
   * Provides convenient methods for logging different operation types
   *
   * @param {string} traceId
   * @param {string} stepId
   * @returns {Object} Context helper with logging methods
   */
  createContext(traceId, stepId) {
    return {
      traceId,
      stepId,

      /**
       * Log an API call (Clio, external services)
       */
      logApiCall: (operation, input, output, durationMs, status, errorMessage) => {
        EventTracker.logDetail(stepId, traceId, {
          operation,
          operationType: "api_call",
          input,
          output,
          durationMs,
          status,
          errorMessage,
        });
      },

      /**
       * Log a database query (read operation)
       */
      logDbQuery: (operation, input, output, durationMs, status, errorMessage) => {
        EventTracker.logDetail(stepId, traceId, {
          operation,
          operationType: "db_query",
          input,
          output,
          durationMs,
          status,
          errorMessage,
        });
      },

      /**
       * Log a database mutation (write operation)
       */
      logDbMutation: (operation, input, output, durationMs, status, errorMessage) => {
        EventTracker.logDetail(stepId, traceId, {
          operation,
          operationType: "db_mutation",
          input,
          output,
          durationMs,
          status,
          errorMessage,
        });
      },

      /**
       * Log a validation operation
       */
      logValidation: (operation, input, result, status, errorMessage) => {
        EventTracker.logDetail(stepId, traceId, {
          operation,
          operationType: "validation",
          input,
          output: result,
          status,
          errorMessage,
        });
      },

      /**
       * Log a calculation (due dates, assignee resolution, etc.)
       */
      logCalculation: (operation, input, output, durationMs) => {
        EventTracker.logDetail(stepId, traceId, {
          operation,
          operationType: "calculation",
          input,
          output,
          durationMs,
          status: "success",
        });
      },

      /**
       * Log a decision/branching point
       */
      logDecision: (operation, input, decision) => {
        EventTracker.logDetail(stepId, traceId, {
          operation,
          operationType: "decision",
          input,
          output: decision,
          status: "success",
        });
      },

      /**
       * Log an external call (non-Clio external services)
       */
      logExternalCall: (operation, input, output, durationMs, status, error) => {
        EventTracker.logDetail(stepId, traceId, {
          operation,
          operationType: "external_call",
          input,
          output,
          durationMs,
          status,
          error: status === "error" ? error : undefined,
        });
      },

      /**
       * Log webhook received data
       */
      logWebhook: (operation, webhookData, status = "success") => {
        EventTracker.logDetail(stepId, traceId, {
          operation,
          operationType: "webhook",
          input: webhookData,
          status,
        });
      },

      /**
       * Log a stage change decision
       * @param {number} matterId - Matter ID
       * @param {Object} previousStage - Previous stage { id, name }
       * @param {Object} newStage - New stage { id, name }
       * @param {boolean} stageChanged - Whether the stage actually changed
       */
      logStageChange: (matterId, previousStage, newStage, stageChanged) => {
        const hasPreviousRecord = previousStage?.id !== null;
        EventTracker.logDetail(stepId, traceId, {
          operation: "stage_change_detected",
          operationType: "decision",
          input: {
            matterId,
            previousStageId: previousStage?.id,
            previousStageName: hasPreviousRecord ? previousStage?.name : "(No previous record)",
            newStageId: newStage?.id,
            newStageName: newStage?.name,
            hasPreviousRecord,
          },
          output: {
            stageChanged,
            action: !hasPreviousRecord ? "first_stage_record" : (stageChanged ? "stage_changed" : "same_stage"),
          },
          status: "success",
        });
      },

      /**
       * Log task creation with full details
       */
      logTaskCreation: (taskData, result, durationMs, status = "success", error = null) => {
        EventTracker.logDetail(stepId, traceId, {
          operation: "clio_createTask",
          operationType: "api_call",
          input: {
            matterId: taskData.matterId,
            name: taskData.name,
            description: taskData.description,
            dueDate: taskData.dueDate,
            dueDateSource: taskData.dueDateSource,
            assigneeId: taskData.assigneeId,
            assigneeName: taskData.assigneeName,
            assigneeType: taskData.assigneeType,
            assigneeSource: taskData.assigneeSource,
            taskNumber: taskData.taskNumber,
            stageId: taskData.stageId,
            stageName: taskData.stageName,
            calendarEntryId: taskData.calendarEntryId,
          },
          output: result ? { taskId: result.id || result.taskId } : null,
          durationMs,
          status,
          error: status === "error" ? error : undefined,
        });
      },

      /**
       * Log webhook received with standardized format
       * @param {Object} webhookData - The raw webhook payload
       * @param {string} resourceType - e.g., 'matter', 'task', 'calendar_entry', 'document'
       */
      logWebhookReceived: (webhookData, resourceType) => {
        EventTracker.logDetail(stepId, traceId, {
          operation: "webhook_received",
          operationType: "webhook",
          input: {
            eventType: webhookData.type,
            resourceType,
            resourceId: webhookData.data?.id,
            webhookId: webhookData.id,
            timestamp: webhookData.occurred_at || webhookData.data?.created_at || webhookData.data?.updated_at,
            rawPayload: webhookData,
          },
          status: "success",
        });
      },

      /**
       * Log test mode filter decision
       * @param {number} resourceId - The resource ID being filtered
       * @param {number} resourceMatterId - The matter ID associated with the resource
       * @param {number} testMatterId - The configured test matter ID
       * @param {boolean} allowed - Whether the resource passed the filter
       */
      logTestModeFilter: (resourceId, resourceMatterId, testMatterId, allowed) => {
        EventTracker.logDetail(stepId, traceId, {
          operation: "test_mode_filter",
          operationType: "decision",
          input: { resourceId, resourceMatterId, testMatterId },
          output: {
            allowed,
            reason: allowed ? "in_allowlist" : "not_in_allowlist",
          },
          status: allowed ? "success" : "skipped",
        });
      },

      /**
       * Log task verification operation with full details
       * @param {Object} params - Verification parameters
       * @param {Object} result - Verification results
       * @param {number} durationMs - Total duration
       */
      logVerification: (params, result, durationMs) => {
        EventTracker.logDetail(stepId, traceId, {
          operation: "verify_task_generation",
          operationType: "calculation",
          input: {
            waitDurationMs: params.waitDurationMs,
            expectedCount: params.expectedCount,
            matterId: params.matterId,
            stageId: params.stageId,
            stageName: params.stageName,
            context: params.context,
          },
          output: {
            foundCount: result.foundCount,
            missingTaskNumbers: result.missingTaskNumbers,
            tasksRegenerated: result.tasksRegenerated,
            individualTasks: result.individualTasks,
            allTasksFound: result.allTasksFound,
          },
          durationMs,
          status: result.allTasksFound ? "success" : "warning",
        });
      },
    };
  },

  /**
   * Track an async operation with automatic timing and error handling
   *
   * @param {string} stepId
   * @param {string} traceId
   * @param {Object} params - Detail params (operation, operationType, input)
   * @param {Function} fn - Async function to execute
   * @returns {Promise<*>} Result of fn
   */
  async track(stepId, traceId, params, fn) {
    const start = Date.now();
    try {
      const result = await fn();
      EventTracker.logDetail(stepId, traceId, {
        ...params,
        output: result,
        durationMs: Date.now() - start,
        status: "success",
      });
      return result;
    } catch (error) {
      EventTracker.logDetail(stepId, traceId, {
        ...params,
        durationMs: Date.now() - start,
        status: "error",
        error: error, // Pass full error for structured logging
      });
      throw error;
    }
  },

  /**
   * Execute a step with automatic start/end handling
   *
   * @param {string} traceId
   * @param {Object} stepParams - Step parameters (layerName, stepName)
   * @param {Function} fn - Async function that receives context
   * @returns {Promise<*>} Result of fn
   */
  async withStep(traceId, stepParams, fn) {
    const stepId = await this.startStep(traceId, stepParams);
    const ctx = this.createContext(traceId, stepId);

    try {
      const result = await fn(ctx);
      await this.endStep(stepId, { status: "success" });
      return result;
    } catch (error) {
      await this.endStep(stepId, {
        status: "error",
        errorMessage: error.message,
      });
      throw error;
    }
  },

  /**
   * Manually flush the detail buffer
   * Call this before the process exits
   */
  async flush() {
    await flushBuffer();
  },

  /**
   * Check if tracking is enabled
   */
  isEnabled() {
    return trackingEnabled;
  },
};

export default EventTracker;
