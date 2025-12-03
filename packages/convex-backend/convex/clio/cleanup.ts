import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Clio Event Tracking Cleanup
 *
 * These mutations handle the 90-day retention policy.
 * Old traces and their children are deleted in batches.
 */

/**
 * Delete old traces and all their children
 * Designed to be called repeatedly until hasMore is false
 */
export const deleteOldTraces = mutation({
  args: {
    olderThanDays: v.number(),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoffDate = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;
    const batchSize = args.batchSize || 100;

    // Find old traces
    const oldTraces = await ctx.db
      .query("clio_traces")
      .withIndex("by_dateStarted")
      .filter((q) => q.lt(q.field("dateStarted"), cutoffDate))
      .take(batchSize);

    let deletedTraces = 0;
    let deletedSteps = 0;
    let deletedDetails = 0;

    for (const trace of oldTraces) {
      // Delete all details for this trace
      const details = await ctx.db
        .query("clio_details")
        .withIndex("by_traceId", (q) => q.eq("traceId", trace.traceId))
        .collect();

      for (const detail of details) {
        await ctx.db.delete(detail._id);
        deletedDetails++;
      }

      // Delete all steps for this trace
      const steps = await ctx.db
        .query("clio_steps")
        .withIndex("by_traceId", (q) => q.eq("traceId", trace.traceId))
        .collect();

      for (const step of steps) {
        await ctx.db.delete(step._id);
        deletedSteps++;
      }

      // Delete the trace itself
      await ctx.db.delete(trace._id);
      deletedTraces++;
    }

    return {
      deletedTraces,
      deletedSteps,
      deletedDetails,
      hasMore: oldTraces.length === batchSize,
      cutoffDate: new Date(cutoffDate).toISOString(),
    };
  },
});

/**
 * Preview what would be deleted
 * Useful for dry-run before actual cleanup
 */
export const previewCleanup = query({
  args: {
    olderThanDays: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoffDate = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;

    // Count old traces
    const oldTraces = await ctx.db
      .query("clio_traces")
      .withIndex("by_dateStarted")
      .filter((q) => q.lt(q.field("dateStarted"), cutoffDate))
      .collect();

    // Get trace IDs
    const traceIds = oldTraces.map((t) => t.traceId);

    // Count steps for these traces
    let stepCount = 0;
    let detailCount = 0;

    for (const traceId of traceIds) {
      const steps = await ctx.db
        .query("clio_steps")
        .withIndex("by_traceId", (q) => q.eq("traceId", traceId))
        .collect();
      stepCount += steps.length;

      const details = await ctx.db
        .query("clio_details")
        .withIndex("by_traceId", (q) => q.eq("traceId", traceId))
        .collect();
      detailCount += details.length;
    }

    return {
      tracesToDelete: oldTraces.length,
      stepsToDelete: stepCount,
      detailsToDelete: detailCount,
      cutoffDate: new Date(cutoffDate).toISOString(),
      oldestTrace: oldTraces.length > 0
        ? new Date(Math.min(...oldTraces.map((t) => t.dateStarted))).toISOString()
        : null,
    };
  },
});

/**
 * Delete orphaned records
 * Clean up steps/details that don't have a parent trace
 */
export const deleteOrphans = mutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize || 100;

    // Get all trace IDs
    const traces = await ctx.db.query("clio_traces").collect();
    const traceIds = new Set(traces.map((t) => t.traceId));

    // Find orphaned steps
    const allSteps = await ctx.db.query("clio_steps").take(batchSize * 10);
    const orphanedSteps = allSteps.filter((s) => !traceIds.has(s.traceId));

    let deletedSteps = 0;
    for (const step of orphanedSteps.slice(0, batchSize)) {
      await ctx.db.delete(step._id);
      deletedSteps++;
    }

    // Get all step IDs (including deleted ones won't matter)
    const stepIds = new Set(allSteps.map((s) => s.stepId));

    // Find orphaned details
    const allDetails = await ctx.db.query("clio_details").take(batchSize * 10);
    const orphanedDetails = allDetails.filter(
      (d) => !traceIds.has(d.traceId) || !stepIds.has(d.stepId)
    );

    let deletedDetails = 0;
    for (const detail of orphanedDetails.slice(0, batchSize)) {
      await ctx.db.delete(detail._id);
      deletedDetails++;
    }

    return {
      deletedSteps,
      deletedDetails,
      hasMore: orphanedSteps.length > batchSize || orphanedDetails.length > batchSize,
    };
  },
});

/**
 * Get cleanup statistics
 * Overview of data volume and age distribution
 */
export const getCleanupStats = query({
  args: {},
  handler: async (ctx) => {
    const traces = await ctx.db.query("clio_traces").collect();
    const steps = await ctx.db.query("clio_steps").collect();
    const details = await ctx.db.query("clio_details").collect();

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Age distribution of traces
    const ageDistribution = {
      last24h: traces.filter((t) => now - t.dateStarted < day).length,
      last7d: traces.filter((t) => now - t.dateStarted < 7 * day).length,
      last30d: traces.filter((t) => now - t.dateStarted < 30 * day).length,
      last90d: traces.filter((t) => now - t.dateStarted < 90 * day).length,
      older: traces.filter((t) => now - t.dateStarted >= 90 * day).length,
    };

    // Find oldest trace
    const oldestTrace = traces.length > 0
      ? new Date(Math.min(...traces.map((t) => t.dateStarted))).toISOString()
      : null;

    return {
      totalTraces: traces.length,
      totalSteps: steps.length,
      totalDetails: details.length,
      ageDistribution,
      oldestTrace,
      estimatedStorageKB: Math.round(
        (JSON.stringify(traces).length +
          JSON.stringify(steps).length +
          JSON.stringify(details).length) /
          1024
      ),
    };
  },
});
