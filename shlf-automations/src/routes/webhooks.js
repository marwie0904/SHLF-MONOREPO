import express from 'express';
import { MatterStageChangeAutomation } from '../automations/matter-stage-change.js';
import { MatterClosedAutomation } from '../automations/matter-closed.js';
import { TaskCompletionAutomation } from '../automations/task-completion.js';
import { TaskDeletedAutomation } from '../automations/task-deleted.js';
import { MeetingScheduledAutomation } from '../automations/meeting-scheduled.js';
import { CalendarEntryDeletedAutomation } from '../automations/calendar-entry-deleted.js';
import { DocumentCreatedAutomation } from '../automations/document-created.js';
import { webhookQueue } from '../utils/webhook-queue.js';
import { EventTracker } from '../services/event-tracker.js';
import { ClioService } from '../services/clio.js';
import { config } from '../config/index.js';

const router = express.Router();

/**
 * TEST MODE CONFIGURATION
 * Uses environment variables: TEST_MODE=true and TEST_MATTER_ID=1675950832
 * This provides an EARLY filter at the router level before any automation runs.
 * Individual automations also check test mode as a safety net.
 */

/**
 * Extract matter ID from various webhook data structures (for test mode filtering)
 */
const extractMatterIdForFilter = (webhookData) => {
  // Direct matter webhook
  if (webhookData.data?.id && !webhookData.data?.matter) {
    return webhookData.data.id;
  }
  // Task/Calendar/Document webhook with nested matter
  if (webhookData.data?.matter?.id) {
    return webhookData.data.matter.id;
  }
  // Sometimes matter_id is at the top level
  if (webhookData.data?.matter_id) {
    return webhookData.data.matter_id;
  }
  return null;
};

/**
 * Test mode middleware - filters webhooks to only process allowed matters
 * Uses config.testing.testMode and config.testing.testMatterId from environment
 */
const testModeFilter = (req, res, next) => {
  // Skip if test mode is disabled
  if (!config.testing.testMode) {
    return next();
  }

  const webhookData = req.body;
  const matterId = extractMatterIdForFilter(webhookData);

  // If we can't determine matter ID from webhook data, block it in test mode
  // This is safer than allowing unknown matters through
  if (!matterId) {
    console.log('🚫 [TEST MODE] Could not extract matter ID from webhook - blocking for safety');
    console.log('   Webhook data keys:', Object.keys(webhookData.data || {}));
    return res.status(200).json({
      success: true,
      action: 'skipped',
      reason: 'test_mode_no_matter_id',
      message: 'Test mode active - could not determine matter ID from webhook',
    });
  }

  // Check if matter matches allowed test matter
  if (matterId === config.testing.testMatterId) {
    console.log(`✅ [TEST MODE] Matter ${matterId} is the test matter, processing webhook`);
    return next();
  }

  // Matter not allowed - skip silently
  console.log(`🚫 [TEST MODE] Matter ${matterId} !== ${config.testing.testMatterId}, skipping`);
  return res.status(200).json({
    success: true,
    action: 'skipped',
    reason: 'test_mode_filter',
    message: `Test mode active - only processing matter: ${config.testing.testMatterId}`,
  });
};

/**
 * Webhook activation handler - responds to Clio's handshake
 */
const handleWebhookActivation = (req, res, next) => {
  // Check if this is an activation request (contains X-Hook-Secret header)
  const hookSecret = req.headers['x-hook-secret'];

  if (hookSecret) {
    console.log(`🔐 Webhook activation request received (secret: ${hookSecret.substring(0, 10)}...)`);

    // IMPORTANT: Echo the secret back in the X-Hook-Secret header
    // This completes the Clio webhook activation handshake
    res.setHeader('X-Hook-Secret', hookSecret);

    return res.status(200).json({
      success: true,
      message: 'Webhook activated',
    });
  }

  // Not an activation request, continue to webhook handler
  next();
};

/**
 * Extract matter ID from various webhook data structures
 */
const extractMatterId = (webhookData) => {
  // Direct matter webhook
  if (webhookData.data?.id && !webhookData.data?.matter) {
    return webhookData.data.id;
  }
  // Task/Calendar/Document webhook with nested matter
  if (webhookData.data?.matter?.id) {
    return webhookData.data.matter.id;
  }
  return null;
};

/**
 * Determine the trigger name from webhook data
 */
const determineTriggerName = (webhookData, endpoint) => {
  // Check for deletion events
  if (webhookData.data?.deleted_at || webhookData.type === 'activity.deleted') {
    if (endpoint === '/tasks') return 'task-deleted';
    if (endpoint === '/calendar') return 'calendar-entry-deleted';
  }

  // Check for matter closed
  if (endpoint === '/matters' && webhookData.data?.status === 'Closed') {
    return 'matter-closed';
  }

  // Default triggers by endpoint
  const triggerMap = {
    '/matters': 'matter-stage-change',
    '/tasks': 'task-completed',
    '/calendar': 'meeting-scheduled',
    '/documents': 'document-created',
  };

  return triggerMap[endpoint] || 'unknown';
};

/**
 * Middleware for error handling with retry logic, per-matter queueing, and event tracking
 * Ensures webhooks for the same matter are processed sequentially
 */
const withRetry = (handler, endpoint, maxAttempts = 3) => {
  return async (req, res) => {
    const webhookData = req.body;
    const matterId = extractMatterId(webhookData);
    const triggerName = determineTriggerName(webhookData, endpoint);

    // Start trace for this webhook with full input payload
    const traceId = await EventTracker.startTrace({
      source: 'webhook',
      triggerName,
      endpoint: `/webhooks${endpoint}`,
      matterId,
      webhookId: webhookData.id,
      input: {
        webhookId: webhookData.id,
        webhookType: webhookData.type,
        resourceId: webhookData.data?.id,
        matterId,
        endpoint: `/webhooks${endpoint}`,
        payload: webhookData,
      },
      metadata: {
        webhookType: webhookData.type,
        resourceId: webhookData.data?.id,
      },
    });

    // Log webhook received as first step with full payload
    const webhookStepId = await EventTracker.startStep(traceId, {
      layerName: 'webhook',
      stepName: 'webhook_received',
      stepOrder: 0,
      input: {
        webhookId: webhookData.id,
        eventType: webhookData.type,
        resourceId: webhookData.data?.id,
        matterId,
        endpoint: `/webhooks${endpoint}`,
        rawPayload: webhookData,
      },
    });

    const webhookCtx = EventTracker.createContext(traceId, webhookStepId);
    webhookCtx.logWebhook('webhook_received', {
      eventType: webhookData.type,
      resourceId: webhookData.data?.id,
      resourceType: triggerName.split('-')[0], // e.g., 'matter', 'task', 'calendar'
      webhookId: webhookData.id,
      endpoint: `/webhooks${endpoint}`,
      rawPayload: webhookData,
    });

    await EventTracker.endStep(webhookStepId, {
      status: 'success',
      output: {
        webhookParsed: true,
        matterId,
        resourceId: webhookData.data?.id,
      },
    });

    // Enqueue the webhook processing for this matter
    // This ensures sequential processing per matter to avoid race conditions
    try {
      const result = await webhookQueue.enqueue(webhookData, async () => {
        // Retry logic within the queue
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            // Pass traceId to handler for nested tracking
            return await handler(webhookData, traceId);
          } catch (error) {
            console.error(`Attempt ${attempt} failed:`, error.message);

            if (attempt === maxAttempts) {
              throw error; // Throw on final attempt
            }

            // Wait 1 second before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }, traceId);

      // End trace with success and output
      await EventTracker.endTrace(traceId, {
        status: 'success',
        resultAction: result?.action || 'processed',
        output: result,
        metadata: { result },
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      // End trace with error - include structured error info and output
      await EventTracker.endTrace(traceId, {
        status: 'error',
        errorMessage: error.message,
        output: {
          success: false,
          error: error.message,
          errorCode: error.code || error.response?.data?.error,
          httpStatus: error.response?.status,
        },
        metadata: {
          errorCode: error.code || error.response?.data?.error,
          httpStatus: error.response?.status,
          errorStack: error.stack?.split('\n').slice(0, 5).join('\n'),
        },
      });

      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };
};

/**
 * Webhook: Matter Updates (Stage Changes and Status Changes)
 * Triggered by Clio when a matter is created or updated
 */
router.post('/matters', handleWebhookActivation, testModeFilter, withRetry(async (webhookData, traceId) => {
  console.log('📨 Received matter webhook');

  const matterId = webhookData.data?.id;
  if (!matterId) {
    console.log('   No matter ID in webhook, skipping');
    return { action: 'skipped', reason: 'no_matter_id' };
  }

  // Fetch current matter status from Clio (don't trust stale webhook data)
  let currentMatter;
  try {
    currentMatter = await ClioService.getMatter(matterId);
    console.log(`   Current matter status: ${currentMatter.status}, stage: ${currentMatter.matter_stage?.name || 'none'}`);
  } catch (error) {
    console.error(`   Failed to fetch matter ${matterId} from Clio:`, error.message);
    throw error;
  }

  // Check if matter is currently closed (using live Clio data)
  if (currentMatter.status === 'Closed') {
    console.log('   Matter is Closed - processing closed matter automation');
    // Enrich webhook data with current matter info
    webhookData.data = { ...webhookData.data, ...currentMatter };
    return await MatterClosedAutomation.process(webhookData, traceId);
  }

  // Only process stage changes if matter stage exists
  if (!currentMatter.matter_stage) {
    console.log('   No matter stage, skipping');
    return { action: 'skipped', reason: 'no_stage' };
  }

  // Enrich webhook data with current matter info
  webhookData.data = { ...webhookData.data, ...currentMatter };
  return await MatterStageChangeAutomation.process(webhookData, traceId);
}, '/matters'));

/**
 * Webhook: Task Updates (Completions) and Deletions
 * Triggered by Clio when a task is updated or deleted
 */
router.post('/tasks', handleWebhookActivation, testModeFilter, withRetry(async (webhookData, traceId) => {
  console.log('📨 Received task webhook');
  console.log('   Webhook type:', webhookData.type);
  console.log('   Has deleted_at?', !!webhookData.data?.deleted_at);

  // Check if this is a deletion event
  // Clio sends deleted_at field for deleted resources OR type='activity.deleted'
  if (webhookData.data?.deleted_at || webhookData.type === 'activity.deleted') {
    console.log('   Task deletion detected');
    return await TaskDeletedAutomation.process(webhookData, traceId);
  }

  // Otherwise, treat as update/completion
  return await TaskCompletionAutomation.process(webhookData, traceId);
}, '/tasks'));

/**
 * Webhook: Calendar Entries (Meetings)
 * Triggered by Clio when a calendar entry is created, updated, or deleted
 */
router.post('/calendar', handleWebhookActivation, testModeFilter, withRetry(async (webhookData, traceId) => {
  console.log('📨 Received calendar webhook');

  // Check if this is a deletion event
  if (webhookData.data?.deleted_at) {
    console.log('   Calendar entry deletion detected');
    return await CalendarEntryDeletedAutomation.process(webhookData, traceId);
  }

  // Otherwise, treat as create/update
  return await MeetingScheduledAutomation.process(webhookData, traceId);
}, '/calendar'));

/**
 * Webhook: Documents (Clio Drive)
 * Triggered by Clio when a document is created
 */
router.post('/documents', handleWebhookActivation, testModeFilter, withRetry(async (webhookData, traceId) => {
  console.log('📨 Received document webhook');

  return await DocumentCreatedAutomation.process(webhookData, traceId);
}, '/documents'));

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    testMode: {
      enabled: config.testing.testMode,
      testMatterId: config.testing.testMode ? config.testing.testMatterId : 'all matters allowed',
    },
    automations: [
      'matter-stage-change',
      'matter-closed',
      'task-completion',
      'task-deletion',
      'meeting-scheduled',
      'calendar-entry-deletion',
      'document-created',
    ],
  });
});

/**
 * Queue stats endpoint - monitor webhook processing queues
 */
router.get('/queue-stats', (req, res) => {
  const stats = webhookQueue.getStats();
  res.json({
    timestamp: new Date().toISOString(),
    queue: stats,
  });
});

export default router;
