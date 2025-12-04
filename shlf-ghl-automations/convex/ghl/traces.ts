import { mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * GHL Trace Mutations
 * Creates a new trace (parent level - webhook/cron trigger)
 */
export const createTrace = mutation({
  args: {
    traceId: v.string(),
    triggerType: v.union(v.literal("webhook"), v.literal("cron")),
    endpoint: v.string(),
    httpMethod: v.string(),
    requestHeaders: v.optional(v.any()),
    requestBody: v.optional(v.any()),
    requestQuery: v.optional(v.any()),
    requestIp: v.optional(v.string()),
    contactId: v.optional(v.string()),
    opportunityId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
    appointmentId: v.optional(v.string()),
    environment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("ghl_traces", {
      ...args,
      status: "started",
      startTime: Date.now(),
      stepCount: 0,
      detailCount: 0,
      errorCount: 0,
    });

    return { id, traceId: args.traceId };
  },
});

/**
 * Completes a trace successfully
 */
export const completeTrace = mutation({
  args: {
    traceId: v.string(),
    responseStatus: v.number(),
    responseBody: v.optional(v.any()),
    stepCount: v.optional(v.number()),
    detailCount: v.optional(v.number()),
    errorCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("ghl_traces")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();

    if (!trace) {
      console.error(`Trace not found: ${args.traceId}`);
      return null;
    }

    const endTime = Date.now();
    const hasErrors = args.errorCount && args.errorCount > 0;

    await ctx.db.patch(trace._id, {
      status: hasErrors ? "partial" : "completed",
      endTime,
      durationMs: endTime - trace.startTime,
      responseStatus: args.responseStatus,
      responseBody: args.responseBody,
      stepCount: args.stepCount ?? trace.stepCount,
      detailCount: args.detailCount ?? trace.detailCount,
      errorCount: args.errorCount ?? trace.errorCount,
    });

    return { id: trace._id, traceId: args.traceId };
  },
});

/**
 * Fails a trace with an error
 */
export const failTrace = mutation({
  args: {
    traceId: v.string(),
    error: v.object({
      message: v.string(),
      stack: v.optional(v.union(v.string(), v.null())),
      code: v.optional(v.union(v.string(), v.null())),
      httpStatus: v.optional(v.union(v.number(), v.null())),
      raw: v.optional(v.any()),
    }),
    responseStatus: v.optional(v.number()),
    responseBody: v.optional(v.any()),
    stepCount: v.optional(v.number()),
    detailCount: v.optional(v.number()),
    errorCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("ghl_traces")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();

    if (!trace) {
      console.error(`Trace not found: ${args.traceId}`);
      return null;
    }

    const endTime = Date.now();

    await ctx.db.patch(trace._id, {
      status: "failed",
      endTime,
      durationMs: endTime - trace.startTime,
      error: args.error,
      responseStatus: args.responseStatus ?? 500,
      responseBody: args.responseBody,
      stepCount: args.stepCount ?? trace.stepCount,
      detailCount: args.detailCount ?? trace.detailCount,
      errorCount: (args.errorCount ?? trace.errorCount ?? 0) + 1,
    });

    return { id: trace._id, traceId: args.traceId };
  },
});

/**
 * Updates trace counts (step, detail, error)
 */
export const updateTraceCounts = mutation({
  args: {
    traceId: v.string(),
    stepCount: v.optional(v.number()),
    detailCount: v.optional(v.number()),
    errorCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("ghl_traces")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();

    if (!trace) {
      return null;
    }

    const updates: Record<string, number> = {};
    if (args.stepCount !== undefined) updates.stepCount = args.stepCount;
    if (args.detailCount !== undefined) updates.detailCount = args.detailCount;
    if (args.errorCount !== undefined) updates.errorCount = args.errorCount;

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(trace._id, updates);
    }

    return { id: trace._id };
  },
});

/**
 * Updates extracted context IDs on a trace
 */
export const updateTraceContextIds = mutation({
  args: {
    traceId: v.string(),
    contactId: v.optional(v.string()),
    opportunityId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
    appointmentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("ghl_traces")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();

    if (!trace) {
      return null;
    }

    const updates: Record<string, string> = {};
    if (args.contactId) updates.contactId = args.contactId;
    if (args.opportunityId) updates.opportunityId = args.opportunityId;
    if (args.invoiceId) updates.invoiceId = args.invoiceId;
    if (args.appointmentId) updates.appointmentId = args.appointmentId;

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(trace._id, updates);
    }

    return { id: trace._id };
  },
});
