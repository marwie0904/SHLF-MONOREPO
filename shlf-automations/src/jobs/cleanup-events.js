import { ConvexHttpClient } from "convex/browser";
import { config } from "../config/index.js";
import { EventTracker } from "../services/event-tracker.js";

/**
 * Event Tracking Cleanup Job
 *
 * Deletes event tracking data older than the configured retention period (default: 90 days).
 * Runs daily at 4:00 AM EST.
 *
 * Process:
 * 1. Calculate cutoff date based on retention days
 * 2. Delete old traces in batches (to avoid timeouts)
 * 3. Continue until all old data is cleaned up
 */

// Initialize Convex client
let convex = null;

function getConvexClient() {
  if (!convex && config.convex?.url) {
    convex = new ConvexHttpClient(config.convex.url);
  }
  return convex;
}

/**
 * Run the cleanup job
 *
 * @param {string} [traceId] - Optional trace ID for event tracking
 */
export async function run(traceId = null) {
  const retentionDays = config.tracking?.retentionDays || 90;

  console.log(`[CLEANUP-EVENTS] Starting cleanup of events older than ${retentionDays} days`);

  const client = getConvexClient();
  if (!client) {
    console.warn("[CLEANUP-EVENTS] Convex client not configured, skipping cleanup");
    return { success: false, reason: "convex_not_configured" };
  }

  // Track the cleanup job itself
  const stepId = await EventTracker.startStep(traceId, {
    layerName: "job",
    stepName: "cleanup_events",
    metadata: { retentionDays },
  });

  try {
    // Import the API dynamically
    const { api } = await import("@shlf/convex-backend");

    // First, preview what will be deleted
    const preview = await client.query(api.clio.cleanup.previewCleanup, {
      olderThanDays: retentionDays,
    });

    console.log(`[CLEANUP-EVENTS] Preview: ${preview.tracesToDelete} traces, ${preview.stepsToDelete} steps, ${preview.detailsToDelete} details to delete`);
    console.log(`[CLEANUP-EVENTS] Cutoff date: ${preview.cutoffDate}`);

    if (preview.tracesToDelete === 0) {
      console.log("[CLEANUP-EVENTS] No old data to clean up");
      await EventTracker.endStep(stepId, {
        status: "success",
        metadata: { deleted: 0 },
      });
      return {
        success: true,
        deletedTraces: 0,
        deletedSteps: 0,
        deletedDetails: 0,
      };
    }

    // Delete in batches
    let totalDeletedTraces = 0;
    let totalDeletedSteps = 0;
    let totalDeletedDetails = 0;
    let iterations = 0;
    const maxIterations = 100; // Safety limit

    let hasMore = true;
    while (hasMore && iterations < maxIterations) {
      iterations++;

      const result = await client.mutation(api.clio.cleanup.deleteOldTraces, {
        olderThanDays: retentionDays,
        batchSize: 100,
      });

      totalDeletedTraces += result.deletedTraces;
      totalDeletedSteps += result.deletedSteps;
      totalDeletedDetails += result.deletedDetails;
      hasMore = result.hasMore;

      console.log(`[CLEANUP-EVENTS] Batch ${iterations}: Deleted ${result.deletedTraces} traces, ${result.deletedSteps} steps, ${result.deletedDetails} details`);

      // Small delay between batches to avoid overwhelming the database
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    if (iterations >= maxIterations) {
      console.warn(`[CLEANUP-EVENTS] Reached max iterations (${maxIterations}), some old data may remain`);
    }

    console.log(`[CLEANUP-EVENTS] Cleanup complete: Deleted ${totalDeletedTraces} traces, ${totalDeletedSteps} steps, ${totalDeletedDetails} details`);

    await EventTracker.endStep(stepId, {
      status: "success",
      metadata: {
        deletedTraces: totalDeletedTraces,
        deletedSteps: totalDeletedSteps,
        deletedDetails: totalDeletedDetails,
        iterations,
      },
    });

    return {
      success: true,
      deletedTraces: totalDeletedTraces,
      deletedSteps: totalDeletedSteps,
      deletedDetails: totalDeletedDetails,
    };
  } catch (error) {
    console.error(`[CLEANUP-EVENTS] Cleanup failed: ${error.message}`);

    await EventTracker.endStep(stepId, {
      status: "error",
      errorMessage: error.message,
    });

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get cleanup statistics
 */
export async function getStats() {
  const client = getConvexClient();
  if (!client) {
    return { error: "convex_not_configured" };
  }

  try {
    const { api } = await import("@shlf/convex-backend");
    return await client.query(api.clio.cleanup.getCleanupStats, {});
  } catch (error) {
    return { error: error.message };
  }
}

// Allow running as standalone script
if (process.argv[1]?.includes("cleanup-events")) {
  run()
    .then((result) => {
      console.log("[CLEANUP-EVENTS] Job result:", result);
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("[CLEANUP-EVENTS] Job failed:", error);
      process.exit(1);
    });
}
