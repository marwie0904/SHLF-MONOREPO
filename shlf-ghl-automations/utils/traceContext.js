/**
 * Trace Context Manager for GHL Automation Tracking
 *
 * Provides hierarchical tracing functionality:
 * - Traces (parent): Webhook/cron triggers
 * - Steps (children): Service layer calls
 * - Details (grandchildren): Individual API calls/operations
 */

const { ConvexHttpClient } = require('convex/browser');
const crypto = require('crypto');
const { api } = require('../convex/_generated/api.cjs');

// Initialize Convex client
let convex = null;

function getConvexClient() {
  if (!convex) {
    const convexUrl = process.env.CONVEX_URL;
    if (!convexUrl) {
      console.warn('CONVEX_URL not configured - tracing disabled');
      return null;
    }
    convex = new ConvexHttpClient(convexUrl);
  }
  return convex;
}

// ============================================
// ID Generation
// ============================================

/**
 * Generates a unique trace ID
 * Format: trc_[timestamp-base36]_[random-hex]
 */
function generateTraceId() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `trc_${timestamp}_${random}`;
}

/**
 * Generates a unique step ID
 * Format: stp_[trace-suffix]_[sequence]
 */
function generateStepId(traceId, sequence) {
  const suffix = traceId.split('_').pop();
  return `stp_${suffix}_${sequence}`;
}

/**
 * Generates a unique detail ID
 * Format: dtl_[step-suffix]_[sequence]
 */
function generateDetailId(stepId, sequence) {
  const suffix = stepId.split('_').pop();
  return `dtl_${suffix}_${sequence}`;
}

// ============================================
// Data Extraction & Formatting
// ============================================

/**
 * Extracts relevant context IDs from request body
 */
function extractContextIds(body) {
  if (!body || typeof body !== 'object') {
    return {};
  }

  return {
    contactId: body.contactId || body.contact_id || body['contact-id'] ||
               body.customData?.contactId || body.customData?.['contact-id'] ||
               body.invoice?.contactDetails?.id || null,
    opportunityId: body.opportunityId || body.opportunity_id || body['opportunity-id'] ||
                   body.customData?.opportunityId || body.customData?.['opportunity-id'] ||
                   body.invoice?.opportunityDetails?.opportunityId || null,
    invoiceId: body.invoice?._id || body.invoice?.id || body.invoiceId || body.invoice_id ||
               body.recordId || body.id || null,
    appointmentId: body.calendar?.appointmentId || body.appointmentId ||
                   body.appointment_id || body['appointment-id'] || null,
  };
}

/**
 * Sanitizes headers to remove sensitive information
 */
function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const sanitized = { ...headers };
  const sensitiveKeys = [
    'authorization', 'x-api-key', 'cookie', 'set-cookie',
    'x-auth-token', 'api-key', 'bearer', 'x-confido-signature',
    'x-webhook-signature'
  ];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Formats error for storage
 */
function formatError(error) {
  if (!error) {
    return { message: 'Unknown error' };
  }

  let stack = error.stack;
  if (stack) {
    // Remove node_modules frames for cleaner traces
    stack = stack
      .split('\n')
      .filter(line => !line.includes('node_modules'))
      .slice(0, 15) // Limit stack depth
      .join('\n');

    // Truncate if too long
    if (stack.length > 2000) {
      stack = stack.substring(0, 2000) + '...[truncated]';
    }
  }

  return {
    message: error.message || String(error),
    stack: stack || null,
    code: error.code || error.response?.status?.toString() || null,
    httpStatus: error.response?.status || null,
    raw: error.response?.data || null,
  };
}

/**
 * Truncates large payloads for storage
 */
function truncatePayload(payload, maxSize = 50000) {
  if (!payload) return payload;

  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (str.length <= maxSize) {
    return payload;
  }

  return {
    _truncated: true,
    _originalSize: str.length,
    _preview: str.substring(0, 1000) + '...[truncated]',
  };
}

// ============================================
// Trace Context Class
// ============================================

/**
 * TraceContext class - manages trace state throughout request lifecycle
 */
class TraceContext {
  constructor(traceId) {
    this.traceId = traceId;
    this.stepSequence = 0;
    this.detailSequences = {}; // stepId -> current sequence
    this.steps = []; // Track step IDs
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

// Active trace contexts stored by traceId
const activeContexts = new Map();

// ============================================
// Trace Operations (Parent Level)
// ============================================

/**
 * Creates and starts a new trace
 */
async function startTrace(options) {
  const {
    endpoint,
    httpMethod,
    headers,
    body,
    query,
    ip,
    triggerType = 'webhook'
  } = options;

  const traceId = generateTraceId();
  const contextIds = extractContextIds(body || {});
  const client = getConvexClient();

  if (!client) {
    // Return no-op context if Convex not configured
    const context = new TraceContext(traceId);
    activeContexts.set(traceId, context);
    return { traceId, context };
  }

  try {
    await client.mutation(api.ghl.traces.createTrace, {
      traceId,
      triggerType,
      endpoint,
      httpMethod,
      requestHeaders: sanitizeHeaders(headers || {}),
      requestBody: truncatePayload(body),
      requestQuery: query,
      requestIp: ip,
      ...contextIds,
      environment: process.env.NODE_ENV || 'development',
    });

    const context = new TraceContext(traceId);
    activeContexts.set(traceId, context);

    return { traceId, context };
  } catch (err) {
    console.error('Failed to start trace:', err.message);
    // Return a no-op context to prevent breaking the request
    const context = new TraceContext(traceId);
    activeContexts.set(traceId, context);
    return { traceId, context };
  }
}

/**
 * Completes a trace successfully
 */
async function completeTrace(traceId, responseStatus, responseBody) {
  const context = activeContexts.get(traceId);
  const client = getConvexClient();

  if (!client) {
    activeContexts.delete(traceId);
    return;
  }

  try {
    await client.mutation(api.ghl.traces.completeTrace, {
      traceId,
      responseStatus,
      responseBody: truncatePayload(responseBody),
      ...(context?.getStats() || {}),
    });
  } catch (err) {
    console.error('Failed to complete trace:', err.message);
  } finally {
    activeContexts.delete(traceId);
  }
}

/**
 * Fails a trace with error
 */
async function failTrace(traceId, error, responseStatus, responseBody) {
  const context = activeContexts.get(traceId);
  const client = getConvexClient();

  if (!client) {
    activeContexts.delete(traceId);
    return;
  }

  try {
    await client.mutation(api.ghl.traces.failTrace, {
      traceId,
      error: formatError(error),
      responseStatus: responseStatus || 500,
      responseBody: truncatePayload(responseBody),
      ...(context?.getStats() || {}),
    });
  } catch (err) {
    console.error('Failed to fail trace:', err.message);
  } finally {
    activeContexts.delete(traceId);
  }
}

/**
 * Updates context IDs on a trace (useful when IDs are discovered mid-processing)
 */
async function updateTraceContextIds(traceId, contextIds) {
  const client = getConvexClient();
  if (!client) return;

  try {
    await client.mutation(api.ghl.traces.updateTraceContextIds, {
      traceId,
      ...contextIds,
    });
  } catch (err) {
    console.error('Failed to update trace context IDs:', err.message);
  }
}

// ============================================
// Step Operations (Child Level)
// ============================================

/**
 * Starts a new step within a trace
 */
async function startStep(traceId, serviceName, functionName, input, contextData) {
  const context = activeContexts.get(traceId);

  if (!context) {
    console.warn(`No active context for trace ${traceId}`);
    return { stepId: null };
  }

  const sequence = context.getNextStepSequence();
  const stepId = generateStepId(traceId, sequence);
  context.addStep(stepId);

  const client = getConvexClient();
  if (!client) {
    return { stepId };
  }

  try {
    await client.mutation(api.ghl.steps.createStep, {
      stepId,
      traceId,
      serviceName,
      functionName,
      sequence,
      input: truncatePayload(input),
      contextData: truncatePayload(contextData),
    });

    return { stepId };
  } catch (err) {
    console.error('Failed to start step:', err.message);
    return { stepId };
  }
}

/**
 * Completes a step successfully
 */
async function completeStep(stepId, output) {
  if (!stepId) return;

  const client = getConvexClient();
  if (!client) return;

  try {
    await client.mutation(api.ghl.steps.completeStep, {
      stepId,
      output: truncatePayload(output),
    });
  } catch (err) {
    console.error('Failed to complete step:', err.message);
  }
}

/**
 * Fails a step with error
 */
async function failStep(stepId, error, traceId) {
  if (!stepId) return;

  const context = activeContexts.get(traceId);
  if (context) {
    context.addError(error);
  }

  const client = getConvexClient();
  if (!client) return;

  try {
    await client.mutation(api.ghl.steps.failStep, {
      stepId,
      error: formatError(error),
    });
  } catch (err) {
    console.error('Failed to fail step:', err.message);
  }
}

/**
 * Marks a step as skipped
 */
async function skipStep(stepId, reason) {
  if (!stepId) return;

  const client = getConvexClient();
  if (!client) return;

  try {
    await client.mutation(api.ghl.steps.skipStep, {
      stepId,
      reason,
    });
  } catch (err) {
    console.error('Failed to skip step:', err.message);
  }
}

// ============================================
// Detail Operations (Grandchild Level)
// ============================================

/**
 * Starts a new detail within a step
 */
async function startDetail(traceId, stepId, options) {
  if (!stepId) return { detailId: null };

  const context = activeContexts.get(traceId);
  if (!context) return { detailId: null };

  const sequence = context.getNextDetailSequence(stepId);
  const detailId = generateDetailId(stepId, sequence);

  const client = getConvexClient();
  if (!client) {
    return { detailId };
  }

  const {
    detailType,
    apiProvider,
    apiEndpoint,
    apiMethod,
    requestHeaders,
    requestBody,
    requestQuery,
    operationName,
    operationInput,
  } = options;

  try {
    await client.mutation(api.ghl.details.createDetail, {
      detailId,
      traceId,
      stepId,
      detailType,
      sequence,
      apiProvider,
      apiEndpoint,
      apiMethod,
      requestHeaders: requestHeaders ? sanitizeHeaders(requestHeaders) : undefined,
      requestBody: truncatePayload(requestBody),
      requestQuery,
      operationName,
      operationInput: truncatePayload(operationInput),
    });

    return { detailId };
  } catch (err) {
    console.error('Failed to start detail:', err.message);
    return { detailId };
  }
}

/**
 * Completes a detail successfully
 */
async function completeDetail(detailId, options) {
  if (!detailId) return;

  const client = getConvexClient();
  if (!client) return;

  const {
    responseStatus,
    responseBody,
    responseHeaders,
    operationOutput,
  } = options;

  try {
    await client.mutation(api.ghl.details.completeDetail, {
      detailId,
      responseStatus,
      responseBody: truncatePayload(responseBody),
      responseHeaders,
      operationOutput: truncatePayload(operationOutput),
    });
  } catch (err) {
    console.error('Failed to complete detail:', err.message);
  }
}

/**
 * Fails a detail with error
 */
async function failDetail(detailId, error, traceId) {
  if (!detailId) return;

  const context = activeContexts.get(traceId);
  if (context) {
    context.addError(error);
  }

  const client = getConvexClient();
  if (!client) return;

  try {
    await client.mutation(api.ghl.details.failDetail, {
      detailId,
      error: formatError(error),
    });
  } catch (err) {
    console.error('Failed to fail detail:', err.message);
  }
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Wraps an async function with step tracking
 */
function withStep(traceId, serviceName, functionName) {
  return async function(fn, input) {
    const { stepId } = await startStep(traceId, serviceName, functionName, input);

    try {
      const result = await fn();
      await completeStep(stepId, result);
      return result;
    } catch (error) {
      await failStep(stepId, error, traceId);
      throw error;
    }
  };
}

/**
 * Gets the active trace context
 */
function getTraceContext(traceId) {
  return activeContexts.get(traceId);
}

/**
 * Checks if tracing is enabled
 */
function isTracingEnabled() {
  return !!process.env.CONVEX_URL;
}

// ============================================
// Exports
// ============================================

module.exports = {
  // ID generation
  generateTraceId,
  generateStepId,
  generateDetailId,

  // Data utilities
  extractContextIds,
  sanitizeHeaders,
  formatError,
  truncatePayload,

  // Trace context class
  TraceContext,
  getTraceContext,

  // Trace operations (parent)
  startTrace,
  completeTrace,
  failTrace,
  updateTraceContextIds,

  // Step operations (child)
  startStep,
  completeStep,
  failStep,
  skipStep,

  // Detail operations (grandchild)
  startDetail,
  completeDetail,
  failDetail,

  // Convenience
  withStep,
  isTracingEnabled,
};
