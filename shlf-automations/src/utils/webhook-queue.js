import { EventTracker } from '../services/event-tracker.js';

/**
 * Per-Matter Webhook Queue System
 *
 * Prevents race conditions when multiple webhooks arrive for the same matter simultaneously.
 * Ensures webhooks for a matter are processed sequentially, not concurrently.
 *
 * Example:
 * - Matter 123 receives calendar_entry.created webhook
 * - While processing, matter_stage.changed webhook arrives for matter 123
 * - Second webhook is queued and waits for first to complete
 * - After first completes, second webhook processes
 */

class WebhookQueue {
  constructor() {
    // Map of matter_id → queue of webhook processors
    this.queues = new Map();

    // Map of matter_id → boolean (is currently processing)
    this.processing = new Map();
  }

  /**
   * Extract matter ID from webhook data
   * Handles different webhook types (matter, task, calendar entry)
   */
  extractMatterId(webhookData) {
    // Direct matter webhook
    if (webhookData.data?.id && webhookData.model === 'Matter') {
      return webhookData.data.id;
    }

    // Task webhook - matter is nested
    if (webhookData.data?.matter?.id) {
      return webhookData.data.matter.id;
    }

    // Calendar entry webhook - matter is nested
    if (webhookData.data?.matter?.id) {
      return webhookData.data.matter.id;
    }

    // No matter ID found
    return null;
  }

  /**
   * Add webhook to queue and process when ready
   * Returns a promise that resolves when the webhook has been processed
   *
   * @param {Object} webhookData - The webhook payload
   * @param {Function} processor - Async function to process the webhook
   * @param {string} [traceId] - Optional trace ID for event tracking
   */
  async enqueue(webhookData, processor, traceId = null) {
    const matterId = this.extractMatterId(webhookData);

    // If no matter ID, process immediately without queueing
    if (!matterId) {
      console.log('[QUEUE] No matter ID - processing immediately without queue');

      // Track queue bypass
      if (traceId) {
        const stepId = await EventTracker.startStep(traceId, {
          layerName: 'processing',
          stepName: 'queue_bypass',
          metadata: { reason: 'no_matter_id' },
        });
        const result = await processor();
        await EventTracker.endStep(stepId, { status: 'success' });
        return result;
      }

      return await processor();
    }

    // Initialize queue for this matter if it doesn't exist
    if (!this.queues.has(matterId)) {
      this.queues.set(matterId, []);
      this.processing.set(matterId, false);
    }

    const queueSize = this.queues.get(matterId).length;
    console.log(`[QUEUE] Matter ${matterId} - Adding webhook to queue (queue size: ${queueSize})`);

    // Track queue entry
    if (traceId) {
      const stepId = await EventTracker.startStep(traceId, {
        layerName: 'processing',
        stepName: 'queue_enqueue',
        metadata: { matterId, queueSize, position: queueSize + 1 },
      });
      await EventTracker.endStep(stepId, { status: 'success' });
    }

    // Create a promise that will be resolved when this webhook is processed
    return new Promise((resolve, reject) => {
      // Add to queue
      this.queues.get(matterId).push({
        processor,
        resolve,
        reject,
        webhookId: webhookData.id,
        eventType: webhookData.model || 'unknown',
        traceId,
      });

      // Start processing if not already processing
      this.processNext(matterId);
    });
  }

  /**
   * Process the next webhook in queue for this matter
   */
  async processNext(matterId) {
    // If already processing, don't start another
    if (this.processing.get(matterId)) {
      console.log(`[QUEUE] Matter ${matterId} - Already processing, waiting...`);
      return;
    }

    const queue = this.queues.get(matterId);

    // If queue is empty, cleanup
    if (!queue || queue.length === 0) {
      console.log(`[QUEUE] Matter ${matterId} - Queue empty, cleaning up`);
      this.queues.delete(matterId);
      this.processing.delete(matterId);
      return;
    }

    // Get next webhook from queue
    const item = queue.shift();
    const traceId = item.traceId;

    console.log(`[QUEUE] Matter ${matterId} - Processing webhook ${item.webhookId} (${item.eventType}) - ${queue.length} remaining in queue`);

    // Mark as processing
    this.processing.set(matterId, true);

    // Track queue processing step
    let stepId = null;
    if (traceId) {
      stepId = await EventTracker.startStep(traceId, {
        layerName: 'processing',
        stepName: 'queue_processing',
        metadata: {
          matterId,
          webhookId: item.webhookId,
          eventType: item.eventType,
          remainingInQueue: queue.length,
        },
      });
    }

    try {
      // Process the webhook
      const result = await item.processor();

      console.log(`[QUEUE] Matter ${matterId} - Webhook ${item.webhookId} completed successfully`);

      // End step with success
      if (stepId) {
        await EventTracker.endStep(stepId, { status: 'success' });
      }

      // Resolve the promise
      item.resolve(result);
    } catch (error) {
      console.error(`[QUEUE] Matter ${matterId} - Webhook ${item.webhookId} failed: ${error.message}`);

      // End step with error
      if (stepId) {
        await EventTracker.endStep(stepId, {
          status: 'error',
          errorMessage: error.message,
        });
      }

      // Reject the promise
      item.reject(error);
    } finally {
      // Mark as no longer processing
      this.processing.set(matterId, false);

      // Process next in queue (if any)
      setImmediate(() => this.processNext(matterId));
    }
  }

  /**
   * Get queue stats for monitoring
   */
  getStats() {
    const stats = {
      totalMatters: this.queues.size,
      matters: [],
    };

    for (const [matterId, queue] of this.queues.entries()) {
      stats.matters.push({
        matterId,
        queueSize: queue.length,
        processing: this.processing.get(matterId) || false,
      });
    }

    return stats;
  }
}

// Singleton instance
export const webhookQueue = new WebhookQueue();
