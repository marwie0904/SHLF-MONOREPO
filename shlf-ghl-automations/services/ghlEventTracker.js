/**
 * GHL Event Tracker Service
 *
 * Provides a unified interface for tracking events across all layers
 * of the GHL automation system. Uses Convex for storage.
 *
 * Based on the proven Clio EventTracker pattern.
 *
 * Hierarchy:
 * - TRACE (Parent): One per webhook/cron invocation
 * - STEP (Child): Major operations within a trace
 * - DETAIL (Grandchild): Individual operations within a step
 *
 * Features:
 * - Buffered detail logging for efficiency
 * - Automatic sanitization of sensitive data
 * - Silent failures (tracking errors don't break main flow)
 * - Context helpers for cleaner code
 */

const { ConvexHttpClient } = require('convex/browser');
const crypto = require('crypto');

// Initialize Convex client
let convex = null;
let trackingEnabled = false;
let convexApi = null;

// Detail buffer for batch inserts
let detailBuffer = [];
let flushTimeout = null;
const BUFFER_SIZE = 50;
const FLUSH_INTERVAL_MS = 5000;

// Active trace contexts (for step sequencing)
const activeContexts = new Map();

/**
 * Initialize the GHL Event Tracker
 * Call once at app startup
 */
async function initializeGHLEventTracker() {
  try {
    const convexUrl = process.env.CONVEX_URL;
    if (!convexUrl) {
      console.warn('[GHLEventTracker] No CONVEX_URL configured - tracking disabled');
      trackingEnabled = false;
      return;
    }

    // Try to import the Convex API
    try {
      const apiModule = require('../convex/_generated/api.cjs');
      convexApi = apiModule.api;
      convex = new ConvexHttpClient(convexUrl);
      trackingEnabled = true;
      console.log(`[GHLEventTracker] Initialized ✓ (${convexUrl})`);
    } catch (importError) {
      console.warn('[GHLEventTracker] Convex API not available - tracking disabled');
      console.warn('[GHLEventTracker] Error:', importError.message);
      trackingEnabled = false;
    }
  } catch (error) {
    console.error('[GHLEventTracker] Failed to initialize:', error.message);
    trackingEnabled = false;
  }
}

/**
 * Generate unique IDs
 */
function generateTraceId() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `trc_${timestamp}_${random}`;
}

function generateStepId(traceId, sequence) {
  const suffix = traceId.split('_').pop();
  return `stp_${suffix}_${sequence}`;
}

function generateDetailId() {
  return `dtl_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Format an error into a structured object
 */
function formatError(error) {
  if (!error) return null;

  const message = error.message || String(error);

  // Clean and truncate stack trace
  let stack = error.stack || null;
  if (stack) {
    const lines = stack.split('\n');
    const filteredLines = lines.filter(
      line => !line.includes('node_modules') || line.includes('shlf-')
    );
    stack = filteredLines.slice(0, 15).join('\n');
    if (stack.length > 2000) {
      stack = stack.substring(0, 2000) + '\n...[truncated]';
    }
  }

  const code = error.code || error.response?.data?.error || null;
  const httpStatus = error.response?.status || error.status || null;

  let response = null;
  if (error.response?.data) {
    response = sanitize(error.response.data, 2);
  }

  return {
    message,
    stack,
    code: code ? String(code) : null,
    httpStatus: httpStatus ? Number(httpStatus) : null,
    raw: response,
  };
}

/**
 * Sanitize data for logging
 */
function sanitize(data, maxDepth = 5) {
  if (!data || maxDepth <= 0) {
    return maxDepth <= 0 ? '[truncated]' : data;
  }

  if (typeof data !== 'object') {
    if (typeof data === 'string' && data.length > 500) {
      return data.substring(0, 500) + '...[truncated]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.slice(0, 20).map(item => sanitize(item, maxDepth - 1));
  }

  const sanitized = {};
  const sensitiveKeys = [
    'password', 'token', 'secret', 'authorization', 'key',
    'api_key', 'apikey', 'access_token', 'refresh_token',
    'bearer', 'credential', 'signature'
  ];

  for (const [key, value] of Object.entries(data)) {
    // Sanitize non-ASCII characters in keys for Convex compatibility
    const sanitizedKey = key
      .replace(/—/g, '-')
      .replace(/–/g, '-')
      .replace(/'/g, "'")
      .replace(/'/g, "'")
      .replace(/"/g, '"')
      .replace(/"/g, '"')
      .replace(/[^\x00-\x7F]/g, '');

    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(k => lowerKey.includes(k))) {
      sanitized[sanitizedKey] = '[REDACTED]';
    } else {
      sanitized[sanitizedKey] = sanitize(value, maxDepth - 1);
    }
  }

  return sanitized;
}

/**
 * Safe async wrapper - catches errors silently
 * Tracking failures should never break the main application
 */
async function safeAsync(fn, context = '') {
  if (!trackingEnabled || !convex || !convexApi) return null;

  try {
    return await fn();
  } catch (error) {
    console.error(`[GHLEventTracker] ${context} failed:`, error.message);
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

  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  await safeAsync(async () => {
    // GHL uses individual detail logging, so we'll send them one by one
    // This can be optimized later with a batch mutation
    for (const detail of batch) {
      await convex.mutation(convexApi.ghl.details.createDetail, detail);
    }
  }, 'flushBuffer');
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

/**
 * TraceContext class - manages trace state throughout request lifecycle
 */
class TraceContext {
  constructor(traceId) {
    this.traceId = traceId;
    this.stepSequence = 0;
    this.detailSequences = {};
    this.steps = [];
    this.errors = [];
    this.totalDetails = 0;
  }

  getNextStepSequence() {
    return ++this.stepSequence;
  }

  getNextDetailSequence(stepId) {
    if (!this.detailSequences[stepId]) {
      this.detailSequences[stepId] = 0;
    }
    this.totalDetails++;
    return ++this.detailSequences[stepId];
  }

  addStep(stepId) {
    this.steps.push(stepId);
  }

  addError(error) {
    this.errors.push(formatError(error));
  }

  getStats() {
    return {
      stepCount: this.steps.length,
      detailCount: this.totalDetails,
      errorCount: this.errors.length,
    };
  }
}

/**
 * Extract context IDs from request body
 */
function extractContextIds(body) {
  if (!body || typeof body !== 'object') return {};

  const result = {};

  const contactId = body.contactId || body.contact_id || body['contact-id'] ||
           body.customData?.contactId || body.customData?.['contact-id'] ||
           body.invoice?.contactDetails?.id;
  if (contactId) result.contactId = contactId;

  const opportunityId = body.opportunityId || body.opportunity_id || body['opportunity-id'] ||
               body.customData?.opportunityId || body.customData?.['opportunity-id'] ||
               body.invoice?.opportunityDetails?.opportunityId;
  if (opportunityId) result.opportunityId = opportunityId;

  const invoiceId = body.invoice?._id || body.invoice?.id || body.invoiceId || body.invoice_id ||
           body.recordId || body.id;
  if (invoiceId) result.invoiceId = invoiceId;

  const appointmentId = body.calendar?.appointmentId || body.appointmentId ||
             body.appointment_id || body['appointment-id'];
  if (appointmentId) result.appointmentId = appointmentId;

  return result;
}

// ============================================================================
// PUBLIC API
// ============================================================================

const GHLEventTracker = {
  /**
   * Start a new trace (Level 1)
   *
   * @param {Object} params
   * @param {string} params.endpoint - e.g., "/webhooks/ghl/custom-object-created"
   * @param {string} params.httpMethod - GET, POST, etc.
   * @param {string} [params.triggerType] - "webhook" or "cron"
   * @param {Object} [params.headers] - Request headers (will be sanitized)
   * @param {Object} [params.body] - Request body
   * @param {Object} [params.query] - Query params
   * @param {string} [params.ip] - Client IP
   * @returns {Promise<{traceId: string, context: TraceContext}>}
   */
  async startTrace(params) {
    const traceId = generateTraceId();
    const context = new TraceContext(traceId);
    activeContexts.set(traceId, context);

    const contextIds = extractContextIds(params.body || {});

    await safeAsync(async () => {
      await convex.mutation(convexApi.ghl.traces.createTrace, {
        traceId,
        triggerType: params.triggerType || 'webhook',
        endpoint: params.endpoint,
        httpMethod: params.httpMethod,
        requestHeaders: sanitize(params.headers),
        requestBody: sanitize(params.body),
        requestQuery: params.query,
        requestIp: params.ip,
        ...contextIds,
        environment: process.env.NODE_ENV || 'development',
      });
    }, `startTrace(${params.endpoint})`);

    return { traceId, context };
  },

  /**
   * Complete a trace successfully
   */
  async completeTrace(traceId, responseStatus, responseBody) {
    // Flush any remaining details first
    await flushBuffer();

    const context = activeContexts.get(traceId);

    await safeAsync(async () => {
      await convex.mutation(convexApi.ghl.traces.completeTrace, {
        traceId,
        responseStatus,
        responseBody: sanitize(responseBody),
        ...(context?.getStats() || {}),
      });
    }, `completeTrace(${traceId})`);

    activeContexts.delete(traceId);
  },

  /**
   * Fail a trace with error
   */
  async failTrace(traceId, error, responseStatus, responseBody) {
    // Flush any remaining details first
    await flushBuffer();

    const context = activeContexts.get(traceId);

    await safeAsync(async () => {
      await convex.mutation(convexApi.ghl.traces.failTrace, {
        traceId,
        error: formatError(error),
        responseStatus: responseStatus || 500,
        responseBody: sanitize(responseBody),
        ...(context?.getStats() || {}),
      });
    }, `failTrace(${traceId})`);

    activeContexts.delete(traceId);
  },

  /**
   * Update context IDs on a trace
   */
  async updateTraceContextIds(traceId, contextIds) {
    await safeAsync(async () => {
      await convex.mutation(convexApi.ghl.traces.updateTraceContextIds, {
        traceId,
        ...contextIds,
      });
    }, `updateTraceContextIds(${traceId})`);
  },

  /**
   * Start a new step (Level 2)
   *
   * @param {string} traceId - Parent trace ID
   * @param {string} serviceName - e.g., "ghlService", "confidoService"
   * @param {string} functionName - e.g., "getOpportunity", "createInvoice"
   * @param {Object} [input] - Input data for this step
   * @param {Object} [contextData] - Additional context
   * @returns {Promise<{stepId: string}>} Object containing stepId
   */
  async startStep(traceId, serviceName, functionName, input, contextData) {
    if (!traceId) return { stepId: null };

    const context = activeContexts.get(traceId);
    if (!context) {
      console.warn(`[GHLEventTracker] No active context for trace ${traceId}`);
      return { stepId: null };
    }

    const sequence = context.getNextStepSequence();
    const stepId = generateStepId(traceId, sequence);
    context.addStep(stepId);

    await safeAsync(async () => {
      await convex.mutation(convexApi.ghl.steps.createStep, {
        stepId,
        traceId,
        serviceName,
        functionName,
        sequence,
        input: sanitize(input),
        contextData: sanitize(contextData),
      });
    }, `startStep(${functionName})`);

    return { stepId };
  },

  /**
   * Complete a step successfully
   */
  async completeStep(stepId, output) {
    if (!stepId) return;

    await safeAsync(async () => {
      await convex.mutation(convexApi.ghl.steps.completeStep, {
        stepId,
        output: sanitize(output),
      });
    }, `completeStep(${stepId})`);
  },

  /**
   * Fail a step with error
   */
  async failStep(stepId, error, traceId) {
    if (!stepId) return;

    const context = activeContexts.get(traceId);
    if (context) {
      context.addError(error);
    }

    await safeAsync(async () => {
      await convex.mutation(convexApi.ghl.steps.failStep, {
        stepId,
        error: formatError(error),
      });
    }, `failStep(${stepId})`);
  },

  /**
   * Skip a step
   */
  async skipStep(stepId, reason) {
    if (!stepId) return;

    await safeAsync(async () => {
      await convex.mutation(convexApi.ghl.steps.skipStep, {
        stepId,
        reason,
      });
    }, `skipStep(${stepId})`);
  },

  /**
   * Log a detail (Level 3)
   * Details are buffered and batch-inserted for efficiency
   */
  logDetail(stepId, traceId, params) {
    if (!trackingEnabled || !stepId || !traceId) return;

    const context = activeContexts.get(traceId);
    const sequence = context ? context.getNextDetailSequence(stepId) : 1;

    detailBuffer.push({
      detailId: generateDetailId(),
      stepId,
      traceId,
      detailType: params.detailType || 'operation',
      sequence,
      apiProvider: params.apiProvider,
      apiEndpoint: params.apiEndpoint,
      apiMethod: params.apiMethod,
      requestHeaders: params.requestHeaders ? sanitize(params.requestHeaders) : undefined,
      requestBody: sanitize(params.requestBody),
      requestQuery: params.requestQuery,
      operationName: params.operationName,
      operationInput: sanitize(params.operationInput),
      responseStatus: params.responseStatus,
      responseBody: sanitize(params.responseBody),
      responseHeaders: params.responseHeaders,
      operationOutput: sanitize(params.operationOutput),
      durationMs: params.durationMs,
      status: params.status || 'completed',
      error: params.error ? formatError(params.error) : undefined,
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
   */
  createContext(traceId, stepId) {
    return {
      traceId,
      stepId,

      /**
       * Log an API call
       */
      logApiCall: (provider, endpoint, method, input, output, durationMs, status, error) => {
        GHLEventTracker.logDetail(stepId, traceId, {
          detailType: 'api_call',
          apiProvider: provider,
          apiEndpoint: endpoint,
          apiMethod: method,
          operationInput: input,
          operationOutput: output,
          durationMs,
          status: status === 'error' ? 'failed' : 'completed',
          error: status === 'error' ? error : undefined,
        });
      },

      /**
       * Log a decision/branching point
       */
      logDecision: (operationName, input, decision) => {
        GHLEventTracker.logDetail(stepId, traceId, {
          detailType: 'decision',
          operationName,
          operationInput: input,
          operationOutput: decision,
          status: 'completed',
        });
      },

      /**
       * Log a calculation
       */
      logCalculation: (operationName, input, output, durationMs) => {
        GHLEventTracker.logDetail(stepId, traceId, {
          detailType: 'calculation',
          operationName,
          operationInput: input,
          operationOutput: output,
          durationMs,
          status: 'completed',
        });
      },

      /**
       * Log a validation
       */
      logValidation: (operationName, input, result, status, errorMessage) => {
        GHLEventTracker.logDetail(stepId, traceId, {
          detailType: 'validation',
          operationName,
          operationInput: input,
          operationOutput: result,
          status: status === 'error' ? 'failed' : 'completed',
          error: status === 'error' ? { message: errorMessage } : undefined,
        });
      },

      /**
       * Log webhook data
       */
      logWebhook: (operationName, webhookData) => {
        GHLEventTracker.logDetail(stepId, traceId, {
          detailType: 'webhook',
          operationName,
          operationInput: webhookData,
          status: 'completed',
        });
      },
    };
  },

  /**
   * Execute a step with automatic start/end handling
   *
   * @param {string} traceId
   * @param {string} serviceName
   * @param {string} functionName
   * @param {Object} input
   * @param {Function} fn - Async function that receives (ctx, stepId)
   * @returns {Promise<*>} Result of fn
   */
  async withStep(traceId, serviceName, functionName, input, fn) {
    const { stepId } = await this.startStep(traceId, serviceName, functionName, input);
    const ctx = this.createContext(traceId, stepId);

    try {
      const result = await fn(ctx, stepId);
      await this.completeStep(stepId, result);
      return result;
    } catch (error) {
      await this.failStep(stepId, error, traceId);
      throw error;
    }
  },

  /**
   * Get the active trace context
   */
  getTraceContext(traceId) {
    return activeContexts.get(traceId);
  },

  /**
   * Manually flush the detail buffer
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

module.exports = {
  initializeGHLEventTracker,
  GHLEventTracker,
  TraceContext,
  extractContextIds,
  sanitize,
  formatError,
};
