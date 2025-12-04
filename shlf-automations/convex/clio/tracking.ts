import { mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Clio Event Tracking Mutations
 *
 * These mutations are called by the event-tracker.js service
 * to create and update tracking records.
 */

// ============================================================================
// TRACE MUTATIONS (Level 1)
// ============================================================================

/**
 * Create a new trace (parent record)
 * Called at the start of webhook/job processing
 */
export const createTrace = mutation({
  args: {
    traceId: v.string(),
    source: v.union(v.literal("webhook"), v.literal("job")),
    triggerName: v.string(),
    endpoint: v.optional(v.string()),
    matterId: v.optional(v.number()),
    webhookId: v.optional(v.string()),
    jobName: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("clio_traces", {
      traceId: args.traceId,
      source: args.source,
      triggerName: args.triggerName,
      endpoint: args.endpoint,
      matterId: args.matterId,
      webhookId: args.webhookId,
      jobName: args.jobName,
      dateStarted: Date.now(),
      status: "in_progress",
      metadata: args.metadata,
    });
  },
});

/**
 * End a trace (update with final status)
 * Called at the end of webhook/job processing
 */
export const endTrace = mutation({
  args: {
    traceId: v.string(),
    status: v.union(
      v.literal("success"),
      v.literal("error"),
      v.literal("skipped")
    ),
    errorMessage: v.optional(v.string()),
    resultAction: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("clio_traces")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();

    if (!trace) {
      console.warn(`[Convex] Trace not found: ${args.traceId}`);
      return null;
    }

    const dateFinished = Date.now();
    const durationMs = dateFinished - trace.dateStarted;

    await ctx.db.patch(trace._id, {
      status: args.status,
      dateFinished,
      durationMs,
      errorMessage: args.errorMessage,
      resultAction: args.resultAction,
      metadata: args.metadata
        ? { ...trace.metadata, ...args.metadata }
        : trace.metadata,
    });

    return trace._id;
  },
});

// ============================================================================
// STEP MUTATIONS (Level 2)
// ============================================================================

/**
 * Create a new step (child of trace)
 * Called at the start of each major operation
 */
export const createStep = mutation({
  args: {
    stepId: v.string(),
    traceId: v.string(),
    layerName: v.string(),
    stepName: v.string(),
    stepOrder: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("clio_steps", {
      stepId: args.stepId,
      traceId: args.traceId,
      layerName: args.layerName,
      stepName: args.stepName,
      stepOrder: args.stepOrder,
      dateStarted: Date.now(),
      status: "in_progress",
      metadata: args.metadata,
    });
  },
});

/**
 * End a step (update with final status)
 * Called at the end of each major operation
 */
export const endStep = mutation({
  args: {
    stepId: v.string(),
    status: v.union(
      v.literal("success"),
      v.literal("error"),
      v.literal("skipped")
    ),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db
      .query("clio_steps")
      .withIndex("by_stepId", (q) => q.eq("stepId", args.stepId))
      .first();

    if (!step) {
      console.warn(`[Convex] Step not found: ${args.stepId}`);
      return null;
    }

    const dateFinished = Date.now();
    const durationMs = dateFinished - step.dateStarted;

    await ctx.db.patch(step._id, {
      status: args.status,
      dateFinished,
      durationMs,
      errorMessage: args.errorMessage,
      metadata: args.metadata
        ? { ...step.metadata, ...args.metadata }
        : step.metadata,
    });

    return step._id;
  },
});

// ============================================================================
// DETAIL MUTATIONS (Level 3)
// ============================================================================

/**
 * Log a single detail (grandchild of trace)
 * Called for each atomic operation
 */
export const logDetail = mutation({
  args: {
    detailId: v.string(),
    stepId: v.string(),
    traceId: v.string(),
    operation: v.string(),
    operationType: v.union(
      v.literal("api_call"),
      v.literal("db_query"),
      v.literal("db_mutation"),
      v.literal("validation"),
      v.literal("calculation"),
      v.literal("decision"),
      v.literal("external_call"),
      v.literal("webhook")
    ),
    input: v.optional(v.any()),
    output: v.optional(v.any()),
    durationMs: v.optional(v.number()),
    status: v.union(
      v.literal("success"),
      v.literal("error"),
      v.literal("skipped")
    ),
    errorMessage: v.optional(v.string()),
    error: v.optional(
      v.object({
        message: v.string(),
        stack: v.optional(v.string()),
        code: v.optional(v.string()),
        httpStatus: v.optional(v.number()),
        response: v.optional(v.any()),
      })
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("clio_details", {
      detailId: args.detailId,
      stepId: args.stepId,
      traceId: args.traceId,
      operation: args.operation,
      operationType: args.operationType,
      input: args.input,
      output: args.output,
      durationMs: args.durationMs,
      status: args.status,
      errorMessage: args.errorMessage,
      error: args.error,
      timestamp: Date.now(),
    });
  },
});

/**
 * Log multiple details in a single batch
 * More efficient for high-volume logging
 */
export const logDetailsBatch = mutation({
  args: {
    details: v.array(
      v.object({
        detailId: v.string(),
        stepId: v.string(),
        traceId: v.string(),
        operation: v.string(),
        operationType: v.union(
          v.literal("api_call"),
          v.literal("db_query"),
          v.literal("db_mutation"),
          v.literal("validation"),
          v.literal("calculation"),
          v.literal("decision"),
          v.literal("external_call"),
          v.literal("webhook")
        ),
        input: v.optional(v.any()),
        output: v.optional(v.any()),
        durationMs: v.optional(v.number()),
        status: v.union(
          v.literal("success"),
          v.literal("error"),
          v.literal("skipped")
        ),
        errorMessage: v.optional(v.string()),
        error: v.optional(
          v.object({
            message: v.string(),
            stack: v.optional(v.string()),
            code: v.optional(v.string()),
            httpStatus: v.optional(v.number()),
            response: v.optional(v.any()),
          })
        ),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const ids = [];
    for (const detail of args.details) {
      const id = await ctx.db.insert("clio_details", detail);
      ids.push(id);
    }
    return ids;
  },
});

// ============================================================================
// UTILITY MUTATIONS
// ============================================================================

/**
 * Update trace metadata without ending it
 * Useful for adding context as processing progresses
 */
export const updateTraceMetadata = mutation({
  args: {
    traceId: v.string(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("clio_traces")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();

    if (!trace) return null;

    await ctx.db.patch(trace._id, {
      metadata: { ...trace.metadata, ...args.metadata },
    });

    return trace._id;
  },
});

/**
 * Update step metadata without ending it
 */
export const updateStepMetadata = mutation({
  args: {
    stepId: v.string(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db
      .query("clio_steps")
      .withIndex("by_stepId", (q) => q.eq("stepId", args.stepId))
      .first();

    if (!step) return null;

    await ctx.db.patch(step._id, {
      metadata: { ...step.metadata, ...args.metadata },
    });

    return step._id;
  },
});

/**
 * Update trace trigger name
 * Used when the actual trigger type is discovered during processing
 * (e.g., task-completion becomes task-deleted when Clio returns 404)
 */
export const updateTraceTriggerName = mutation({
  args: {
    traceId: v.string(),
    triggerName: v.string(),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("clio_traces")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();

    if (!trace) return null;

    await ctx.db.patch(trace._id, {
      triggerName: args.triggerName,
    });

    return trace._id;
  },
});
