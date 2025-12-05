/**
 * Express Tracing Middleware
 *
 * Automatically creates traces for all incoming requests and
 * captures response data when the request completes.
 *
 * Uses the GHLEventTracker service for proper Convex integration.
 */

const { GHLEventTracker } = require('../services/ghlEventTracker');

/**
 * Paths to skip tracing (health checks, static assets, etc.)
 */
const SKIP_PATHS = [
  '/health',
  '/favicon.ico',
  '/static',
  '/assets',
];

/**
 * Check if a path should be skipped for tracing
 */
function shouldSkipPath(path) {
  return SKIP_PATHS.some(skip => path.startsWith(skip));
}

/**
 * Express middleware that automatically creates traces for all requests
 */
function tracingMiddleware(req, res, next) {
  // Skip certain paths
  if (shouldSkipPath(req.path)) {
    return next();
  }

  // Skip if tracing is disabled
  if (!GHLEventTracker.isEnabled()) {
    req.traceId = null;
    req.traceContext = null;
    return next();
  }

  // Handle internal forwarded requests (from axios routing within the server)
  // These requests continue using the parent trace instead of creating a new one
  if (req.headers['x-internal-forward'] === 'true') {
    const parentTraceId = req.headers['x-parent-trace-id'] || null;
    console.log(`[TRACING] Internal forward to ${req.path} - continuing parent trace ${parentTraceId}`);
    req.traceId = parentTraceId;
    // Retrieve the existing trace context so steps can continue to be added
    req.traceContext = parentTraceId ? GHLEventTracker.getTraceContext(parentTraceId) : null;
    req.isForwardedRequest = true;
    // Don't set up response handlers - the parent request will complete the trace
    return next();
  }

  // Determine trigger type based on path
  const triggerType = req.path.startsWith('/cron') ? 'cron' : 'webhook';

  // Start trace asynchronously
  console.log(`[TRACING] Starting trace for ${req.method} ${req.path}`);
  GHLEventTracker.startTrace({
    endpoint: req.path,
    httpMethod: req.method,
    headers: req.headers,
    body: req.body,
    query: req.query,
    ip: req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress,
    triggerType,
  })
    .then(({ traceId, context }) => {
      console.log(`[TRACING] Trace started: ${traceId}`);
      // Attach trace info to request for use in handlers
      req.traceId = traceId;
      req.traceContext = context;

      // Store original response methods
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);

      // Track if response has been captured
      let responseCaptured = false;
      let responseBody = undefined;

      // Override res.json to capture response body
      res.json = function (body) {
        if (!responseCaptured) {
          responseCaptured = true;
          responseBody = body;
        }
        return originalJson(body);
      };

      // Override res.send to capture response body
      res.send = function (body) {
        if (!responseCaptured) {
          responseCaptured = true;
          // Try to parse JSON if it's a string
          if (typeof body === 'string') {
            try {
              responseBody = JSON.parse(body);
            } catch {
              responseBody = { _raw: body.substring(0, 1000) };
            }
          } else {
            responseBody = body;
          }
        }
        return originalSend(body);
      };

      // Complete or fail trace when response finishes
      res.on('finish', () => {
        console.log(`[TRACING] Response finished for ${traceId} with status ${res.statusCode}`);
        // Determine if the request succeeded or failed based on status code
        if (res.statusCode >= 400) {
          // Create error object from response
          const error = {
            message: `HTTP ${res.statusCode}`,
            code: res.statusCode.toString(),
            raw: responseBody,
          };

          console.log(`[TRACING] Failing trace ${traceId}`);
          GHLEventTracker.failTrace(traceId, error, res.statusCode, responseBody).catch((err) => {
            console.error('[TRACING] Error failing trace:', err.message);
          });
        } else {
          console.log(`[TRACING] Completing trace ${traceId}`);
          GHLEventTracker.completeTrace(traceId, res.statusCode, responseBody).catch((err) => {
            console.error('[TRACING] Error completing trace:', err.message);
          });
        }
      });

      // Handle request errors
      res.on('error', (error) => {
        GHLEventTracker.failTrace(traceId, error, 500, { error: error.message }).catch((err) => {
          console.error('Error failing trace on response error:', err.message);
        });
      });

      next();
    })
    .catch((err) => {
      console.error('Tracing middleware error:', err.message);
      // Continue without tracing if it fails
      req.traceId = null;
      req.traceContext = null;
      next();
    });
}

/**
 * Error handling middleware that captures unhandled errors
 */
function tracingErrorMiddleware(err, req, res, next) {
  // If we have a trace, fail it with the error
  if (req.traceId) {
    GHLEventTracker.failTrace(req.traceId, err, 500, { error: err.message }).catch((traceErr) => {
      console.error('Error failing trace in error middleware:', traceErr.message);
    });
  }

  // Pass error to next error handler
  next(err);
}

/**
 * Async handler wrapper that ensures errors are properly tracked
 */
function tracedHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      // If we have a trace, the error will be captured by response finish event
      // Just pass to next error handler
      next(error);
    }
  };
}

module.exports = {
  tracingMiddleware,
  tracingErrorMiddleware,
  tracedHandler,
};
