import { query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Clio Event Tracking Queries
 *
 * These queries retrieve tracking data for debugging and analysis.
 */

// ============================================================================
// FULL TRACE RETRIEVAL
// ============================================================================

/**
 * Get a complete trace with all steps and details
 * Returns the full hierarchy for a single trace
 */
export const getFullTrace = query({
  args: {
    traceId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get the trace
    const trace = await ctx.db
      .query("clio_traces")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();

    if (!trace) return null;

    // Get all steps for this trace
    const steps = await ctx.db
      .query("clio_steps")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .collect();

    // Get all details for this trace
    const details = await ctx.db
      .query("clio_details")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .collect();

    // Group details by step
    const detailsByStep: Record<string, typeof details> = {};
    for (const detail of details) {
      if (!detailsByStep[detail.stepId]) {
        detailsByStep[detail.stepId] = [];
      }
      detailsByStep[detail.stepId].push(detail);
    }

    // Sort steps by dateStarted and attach details
    const sortedSteps = steps
      .sort((a, b) => a.dateStarted - b.dateStarted)
      .map((step) => ({
        ...step,
        details: (detailsByStep[step.stepId] || []).sort(
          (a, b) => a.timestamp - b.timestamp
        ),
      }));

    return {
      ...trace,
      steps: sortedSteps,
    };
  },
});

// ============================================================================
// TRACE LISTING QUERIES
// ============================================================================

/**
 * Get traces by matter ID
 * Useful for seeing all automation activity for a specific matter
 */
export const getTracesByMatter = query({
  args: {
    matterId: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("clio_traces")
      .withIndex("by_matterId", (q) => q.eq("matterId", args.matterId))
      .order("desc");

    const traces = await query.collect();
    return args.limit ? traces.slice(0, args.limit) : traces;
  },
});

/**
 * Get traces by date range
 * Useful for seeing all activity within a time period
 */
export const getTracesByDateRange = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const traces = await ctx.db
      .query("clio_traces")
      .withIndex("by_dateStarted")
      .filter((q) =>
        q.and(
          q.gte(q.field("dateStarted"), args.startDate),
          q.lte(q.field("dateStarted"), args.endDate)
        )
      )
      .order("desc")
      .collect();

    return args.limit ? traces.slice(0, args.limit) : traces;
  },
});

/**
 * Get error traces
 * Useful for debugging failed automations
 */
export const getErrorTraces = query({
  args: {
    limit: v.optional(v.number()),
    triggerName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("clio_traces")
      .withIndex("by_status", (q) => q.eq("status", "error"))
      .order("desc");

    let traces = await query.collect();

    // Filter by trigger name if provided
    if (args.triggerName) {
      traces = traces.filter((t) => t.triggerName === args.triggerName);
    }

    return args.limit ? traces.slice(0, args.limit) : traces;
  },
});

/**
 * Get traces by trigger name
 * Useful for analyzing specific automation types
 */
export const getTracesByTrigger = query({
  args: {
    triggerName: v.string(),
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("in_progress"),
        v.literal("success"),
        v.literal("error"),
        v.literal("skipped")
      )
    ),
  },
  handler: async (ctx, args) => {
    let traces = await ctx.db
      .query("clio_traces")
      .withIndex("by_triggerName", (q) => q.eq("triggerName", args.triggerName))
      .order("desc")
      .collect();

    // Filter by status if provided
    if (args.status) {
      traces = traces.filter((t) => t.status === args.status);
    }

    return args.limit ? traces.slice(0, args.limit) : traces;
  },
});

/**
 * Get recent traces
 * General overview of recent activity
 */
export const getRecentTraces = query({
  args: {
    limit: v.optional(v.number()),
    source: v.optional(v.union(v.literal("webhook"), v.literal("job"))),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    if (args.source) {
      const traces = await ctx.db
        .query("clio_traces")
        .withIndex("by_source", (q) => q.eq("source", args.source!))
        .order("desc")
        .collect();
      return traces.slice(0, limit);
    }

    const traces = await ctx.db
      .query("clio_traces")
      .withIndex("by_dateStarted")
      .order("desc")
      .collect();
    return traces.slice(0, limit);
  },
});

/**
 * Get in-progress traces
 * Useful for monitoring currently running operations
 */
export const getInProgressTraces = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("clio_traces")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .collect();
  },
});

// ============================================================================
// STEP QUERIES
// ============================================================================

/**
 * Get steps for a trace
 * Without the full detail hierarchy
 */
export const getStepsForTrace = query({
  args: {
    traceId: v.string(),
  },
  handler: async (ctx, args) => {
    const steps = await ctx.db
      .query("clio_steps")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .collect();

    return steps.sort((a, b) => a.dateStarted - b.dateStarted);
  },
});

/**
 * Get error steps
 * Useful for finding which steps are failing
 */
export const getErrorSteps = query({
  args: {
    limit: v.optional(v.number()),
    layerName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let steps = await ctx.db.query("clio_steps").collect();

    // Filter to errors only
    steps = steps.filter((s) => s.status === "error");

    // Filter by layer if provided
    if (args.layerName) {
      steps = steps.filter((s) => s.layerName === args.layerName);
    }

    // Sort by date descending
    steps.sort((a, b) => b.dateStarted - a.dateStarted);

    return args.limit ? steps.slice(0, args.limit) : steps;
  },
});

// ============================================================================
// DETAIL QUERIES
// ============================================================================

/**
 * Get details for a step
 */
export const getDetailsForStep = query({
  args: {
    stepId: v.string(),
  },
  handler: async (ctx, args) => {
    const details = await ctx.db
      .query("clio_details")
      .withIndex("by_stepId", (q) => q.eq("stepId", args.stepId))
      .collect();

    return details.sort((a, b) => a.timestamp - b.timestamp);
  },
});

/**
 * Get error details
 * Useful for finding specific operation failures
 */
export const getErrorDetails = query({
  args: {
    limit: v.optional(v.number()),
    operationType: v.optional(
      v.union(
        v.literal("api_call"),
        v.literal("db_query"),
        v.literal("db_mutation"),
        v.literal("validation"),
        v.literal("calculation"),
        v.literal("decision"),
        v.literal("external_call")
      )
    ),
  },
  handler: async (ctx, args) => {
    let details = await ctx.db.query("clio_details").collect();

    // Filter to errors only
    details = details.filter((d) => d.status === "error");

    // Filter by operation type if provided
    if (args.operationType) {
      details = details.filter((d) => d.operationType === args.operationType);
    }

    // Sort by timestamp descending
    details.sort((a, b) => b.timestamp - a.timestamp);

    return args.limit ? details.slice(0, args.limit) : details;
  },
});

// ============================================================================
// STATISTICS QUERIES
// ============================================================================

/**
 * Get trace statistics
 * Overview of automation health
 */
export const getTraceStats = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let traces = await ctx.db.query("clio_traces").collect();

    // Filter by date range if provided
    if (args.startDate) {
      traces = traces.filter((t) => t.dateStarted >= args.startDate!);
    }
    if (args.endDate) {
      traces = traces.filter((t) => t.dateStarted <= args.endDate!);
    }

    // Calculate statistics
    const total = traces.length;
    const byStatus = {
      in_progress: traces.filter((t) => t.status === "in_progress").length,
      success: traces.filter((t) => t.status === "success").length,
      error: traces.filter((t) => t.status === "error").length,
      skipped: traces.filter((t) => t.status === "skipped").length,
    };

    const bySource = {
      webhook: traces.filter((t) => t.source === "webhook").length,
      job: traces.filter((t) => t.source === "job").length,
    };

    const byTrigger: Record<string, number> = {};
    for (const trace of traces) {
      byTrigger[trace.triggerName] = (byTrigger[trace.triggerName] || 0) + 1;
    }

    // Calculate average duration for completed traces
    const completedTraces = traces.filter((t) => t.durationMs !== undefined);
    const avgDuration =
      completedTraces.length > 0
        ? completedTraces.reduce((sum, t) => sum + (t.durationMs || 0), 0) /
          completedTraces.length
        : 0;

    return {
      total,
      byStatus,
      bySource,
      byTrigger,
      avgDurationMs: Math.round(avgDuration),
    };
  },
});

/**
 * Get slow traces
 * Find traces that took longer than threshold
 */
export const getSlowTraces = query({
  args: {
    thresholdMs: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const traces = await ctx.db.query("clio_traces").collect();

    const slowTraces = traces
      .filter((t) => t.durationMs !== undefined && t.durationMs > args.thresholdMs)
      .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));

    return args.limit ? slowTraces.slice(0, args.limit) : slowTraces;
  },
});
