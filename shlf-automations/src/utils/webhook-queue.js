import { EventTracker } from '../services/event-tracker.js';
import { ClioService } from '../services/clio.js';

/**
 * Rate-Limit Aware Webhook Queue System
 *
 * Only queues webhooks when Clio API rate limit is approaching threshold (45/50).
 * This prevents unnecessary delays when rate limit is healthy, while still
 * protecting against rate limit errors during high-volume periods.
 *
 * Features:
 * - Only queues when rate limit remaining <= threshold (default: 5)
 * - Tracks queue wait time for monitoring
 * - Per-matter sequential processing when queued
 */

// Rate limit threshold - queue when remaining <= this value
const RATE_LIMIT_THRESHOLD = 5;

class WebhookQueue {
  constructor() {
    // Map of matter_id → queue of webhook processors
    this.queues = new Map();

    // Map of matter_id → boolean (is currently processing)
    this.processing = new Map();

    // Global queue for rate limit protection (across all matters)
    this.rateLimitQueue = [];
    this.isProcessingRateLimitQueue = false;
  }

  /**
   * Check if we should queue based on rate limit
   * @returns {Object} { shouldQueue: boolean, rateLimitStatus: Object }
   */
  checkRateLimit() {
    const status = ClioService.getRateLimitStatus();
    const shouldQueue = status.remaining <= RATE_LIMIT_THRESHOLD;
    return { shouldQueue, rateLimitStatus: status };
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
   * Only queues if rate limit is approaching threshold (45/50)
   * Returns a promise that resolves when the webhook has been processed
   *
   * @param {Object} webhookData - The webhook payload
   * @param {Function} processor - Async function to process the webhook
   * @param {string} [traceId] - Optional trace ID for event tracking
   */
  async enqueue(webhookData, processor, traceId = null) {
    const matterId = this.extractMatterId(webhookData);
    const enqueuedAt = Date.now();

    // Check rate limit status
    const { shouldQueue, rateLimitStatus } = this.checkRateLimit();

    // If rate limit is healthy (remaining > threshold), process immediately
    if (!shouldQueue) {
      console.log(`[QUEUE] Rate limit healthy (${rateLimitStatus.remaining}/${rateLimitStatus.limit}) - processing immediately`);

      // Track that we bypassed the queue due to healthy rate limit
      if (traceId) {
        const stepId = await EventTracker.startStep(traceId, {
          layerName: 'processing',
          stepName: 'queue_check',
          input: {
            matterId,
            rateLimitRemaining: rateLimitStatus.remaining,
            rateLimitLimit: rateLimitStatus.limit,
            threshold: RATE_LIMIT_THRESHOLD,
          },
        });
        await EventTracker.endStep(stepId, {
          status: 'success',
          output: {
            queued: false,
            reason: 'rate_limit_healthy',
            rateLimitRemaining: rateLimitStatus.remaining,
            rateLimitLimit: rateLimitStatus.limit,
            processedImmediately: true,
          },
        });
      }

      // Process immediately without queueing
      return await processor();
    }

    // Rate limit approaching - need to queue
    console.log(`[QUEUE] Rate limit approaching (${rateLimitStatus.remaining}/${rateLimitStatus.limit}) - queueing webhook for matter ${matterId}`);

    // If no matter ID, still queue but use global queue
    const queueKey = matterId || 'global';

    // Initialize queue for this matter if it doesn't exist
    if (!this.queues.has(queueKey)) {
      this.queues.set(queueKey, []);
      this.processing.set(queueKey, false);
    }

    const queueSize = this.queues.get(queueKey).length;

    // Track queue entry with full metadata
    if (traceId) {
      const stepId = await EventTracker.startStep(traceId, {
        layerName: 'processing',
        stepName: 'queue_check',
        input: {
          matterId,
          rateLimitRemaining: rateLimitStatus.remaining,
          rateLimitLimit: rateLimitStatus.limit,
          threshold: RATE_LIMIT_THRESHOLD,
        },
      });
      await EventTracker.endStep(stepId, {
        status: 'success',
        output: {
          queued: true,
          reason: 'rate_limit_approaching',
          rateLimitRemaining: rateLimitStatus.remaining,
          rateLimitLimit: rateLimitStatus.limit,
          queueLength: queueSize + 1,
          position: queueSize + 1,
        },
      });
    }

    console.log(`[QUEUE] Matter ${queueKey} - Added to queue (position: ${queueSize + 1}, rate limit: ${rateLimitStatus.remaining}/${rateLimitStatus.limit})`);

    // Create a promise that will be resolved when this webhook is processed
    return new Promise((resolve, reject) => {
      // Add to queue with timing info
      this.queues.get(queueKey).push({
        processor,
        resolve,
        reject,
        webhookId: webhookData.id,
        eventType: webhookData.model || 'unknown',
        traceId,
        enqueuedAt,
        rateLimitAtEnqueue: rateLimitStatus.remaining,
      });

      // Start processing if not already processing
      this.processNext(queueKey);
    });
  }

  /**
   * Process the next webhook in queue for this matter
   */
  async processNext(queueKey) {
    // If already processing, don't start another
    if (this.processing.get(queueKey)) {
      return;
    }

    const queue = this.queues.get(queueKey);

    // If queue is empty, cleanup
    if (!queue || queue.length === 0) {
      console.log(`[QUEUE] ${queueKey} - Queue empty, cleaning up`);
      this.queues.delete(queueKey);
      this.processing.delete(queueKey);
      return;
    }

    // Check rate limit before processing
    const { shouldQueue, rateLimitStatus } = this.checkRateLimit();

    // If rate limit still at threshold, wait before processing
    if (shouldQueue && rateLimitStatus.reset) {
      const waitTime = Math.max(0, rateLimitStatus.reset.getTime() - Date.now());
      if (waitTime > 0 && waitTime < 15000) { // Max 15 second wait
        console.log(`[QUEUE] ${queueKey} - Rate limit at ${rateLimitStatus.remaining}/${rateLimitStatus.limit}, waiting ${waitTime}ms for reset`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Get next webhook from queue
    const item = queue.shift();
    const traceId = item.traceId;
    const waitTimeMs = Date.now() - item.enqueuedAt;

    console.log(`[QUEUE] ${queueKey} - Processing webhook ${item.webhookId} (${item.eventType}) - waited ${waitTimeMs}ms, ${queue.length} remaining`);

    // Mark as processing
    this.processing.set(queueKey, true);

    // Track queue exit with wait time
    let exitStepId = null;
    if (traceId) {
      exitStepId = await EventTracker.startStep(traceId, {
        layerName: 'processing',
        stepName: 'queue_exit',
        input: {
          queueKey,
          webhookId: item.webhookId,
          eventType: item.eventType,
          rateLimitAtEnqueue: item.rateLimitAtEnqueue,
        },
      });
      await EventTracker.endStep(exitStepId, {
        status: 'success',
        output: {
          waitTimeMs,
          waitTimeFormatted: waitTimeMs > 1000 ? `${(waitTimeMs / 1000).toFixed(1)}s` : `${waitTimeMs}ms`,
          remainingInQueue: queue.length,
          rateLimitNow: rateLimitStatus.remaining,
        },
      });
    }

    try {
      // Process the webhook
      const result = await item.processor();

      console.log(`[QUEUE] ${queueKey} - Webhook ${item.webhookId} completed successfully (waited ${waitTimeMs}ms)`);

      // Resolve the promise
      item.resolve(result);
    } catch (error) {
      console.error(`[QUEUE] ${queueKey} - Webhook ${item.webhookId} failed: ${error.message}`);

      // Reject the promise
      item.reject(error);
    } finally {
      // Mark as no longer processing
      this.processing.set(queueKey, false);

      // Small delay between queued requests to help rate limit recover
      await new Promise(resolve => setTimeout(resolve, 200));

      // Process next in queue (if any)
      setImmediate(() => this.processNext(queueKey));
    }
  }

  /**
   * Get queue stats for monitoring
   */
  getStats() {
    const rateLimitStatus = ClioService.getRateLimitStatus();
    const stats = {
      totalQueues: this.queues.size,
      rateLimit: {
        remaining: rateLimitStatus.remaining,
        limit: rateLimitStatus.limit,
        threshold: RATE_LIMIT_THRESHOLD,
        shouldQueue: rateLimitStatus.shouldQueue,
        reset: rateLimitStatus.reset,
        lastUpdated: rateLimitStatus.lastUpdated,
      },
      queues: [],
    };

    for (const [queueKey, queue] of this.queues.entries()) {
      const oldestItem = queue[0];
      stats.queues.push({
        queueKey,
        queueSize: queue.length,
        processing: this.processing.get(queueKey) || false,
        oldestWaitMs: oldestItem ? Date.now() - oldestItem.enqueuedAt : 0,
      });
    }

    return stats;
  }
}

// Singleton instance
export const webhookQueue = new WebhookQueue();
