import { query } from "../_generated/server";
import { v } from "convex/values";

/**
 * GHL Event Tracking Queries
 */

/**
 * Get a trace with all its steps and details (full tree)
 */
export const getTraceWithChildren = query({
  args: { traceId: v.string() },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("ghl_traces")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .first();

    if (!trace) {
      return null;
    }

    // Get all steps for this trace
    const steps = await ctx.db
      .query("ghl_steps")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .collect();

    // Get all details for this trace
    const details = await ctx.db
      .query("ghl_details")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .collect();

    // Group details by stepId
    const detailsByStep = details.reduce(
      (acc, detail) => {
        if (!acc[detail.stepId]) acc[detail.stepId] = [];
        acc[detail.stepId].push(detail);
        return acc;
      },
      {} as Record<string, typeof details>
    );

    // Sort steps by sequence and attach details
    const sortedSteps = steps
      .sort((a, b) => a.sequence - b.sequence)
      .map((step) => ({
        ...step,
        details: (detailsByStep[step.stepId] || []).sort(
          (a, b) => a.sequence - b.sequence
        ),
      }));

    return {
      ...trace,
      steps: sortedSteps,
    };
  },
});

/**
 * List traces with optional filters
 */
export const listTraces = query({
  args: {
    endpoint: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("started"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("partial")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    if (args.endpoint) {
      const traces = await ctx.db
        .query("ghl_traces")
        .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint!))
        .order("desc")
        .take(limit);

      if (args.status) {
        return traces.filter((t) => t.status === args.status);
      }
      return traces;
    }

    if (args.status) {
      return await ctx.db
        .query("ghl_traces")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("ghl_traces")
      .withIndex("by_startTime")
      .order("desc")
      .take(limit);
  },
});

/**
 * Get all traces for a specific contact
 */
export const getTracesByContact = query({
  args: {
    contactId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ghl_traces")
      .withIndex("by_contactId", (q) => q.eq("contactId", args.contactId))
      .order("desc")
      .take(args.limit || 50);
  },
});

/**
 * Get all traces for a specific opportunity
 */
export const getTracesByOpportunity = query({
  args: {
    opportunityId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ghl_traces")
      .withIndex("by_opportunityId", (q) =>
        q.eq("opportunityId", args.opportunityId)
      )
      .order("desc")
      .take(args.limit || 50);
  },
});

/**
 * Get all traces for a specific invoice
 */
export const getTracesByInvoice = query({
  args: {
    invoiceId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ghl_traces")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
      .order("desc")
      .take(args.limit || 50);
  },
});

/**
 * Get all traces for a specific appointment
 */
export const getTracesByAppointment = query({
  args: {
    appointmentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ghl_traces")
      .withIndex("by_appointmentId", (q) =>
        q.eq("appointmentId", args.appointmentId)
      )
      .order("desc")
      .take(args.limit || 50);
  },
});

/**
 * Get steps for a specific trace
 */
export const getStepsByTrace = query({
  args: { traceId: v.string() },
  handler: async (ctx, args) => {
    const steps = await ctx.db
      .query("ghl_steps")
      .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
      .collect();

    return steps.sort((a, b) => a.sequence - b.sequence);
  },
});

/**
 * Get details for a specific step
 */
export const getDetailsByStep = query({
  args: { stepId: v.string() },
  handler: async (ctx, args) => {
    const details = await ctx.db
      .query("ghl_details")
      .withIndex("by_stepId", (q) => q.eq("stepId", args.stepId))
      .collect();

    return details.sort((a, b) => a.sequence - b.sequence);
  },
});

/**
 * Get failed traces within a time range
 */
export const getFailedTraces = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ghl_traces")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(args.limit || 50);
  },
});

/**
 * Get trace statistics (counts by status)
 */
export const getTraceStats = query({
  args: {
    endpoint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let traces;

    if (args.endpoint) {
      traces = await ctx.db
        .query("ghl_traces")
        .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint!))
        .collect();
    } else {
      traces = await ctx.db.query("ghl_traces").collect();
    }

    const stats = {
      total: traces.length,
      started: 0,
      completed: 0,
      failed: 0,
      partial: 0,
      avgDurationMs: 0,
    };

    let totalDuration = 0;
    let durationCount = 0;

    for (const trace of traces) {
      stats[trace.status as keyof typeof stats]++;
      if (trace.durationMs) {
        totalDuration += trace.durationMs;
        durationCount++;
      }
    }

    if (durationCount > 0) {
      stats.avgDurationMs = Math.round(totalDuration / durationCount);
    }

    return stats;
  },
});

/**
 * Search traces by various criteria
 */
export const searchTraces = query({
  args: {
    contactId: v.optional(v.string()),
    opportunityId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
    appointmentId: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    // Priority: use the most specific index available
    if (args.contactId) {
      return await ctx.db
        .query("ghl_traces")
        .withIndex("by_contactId", (q) => q.eq("contactId", args.contactId!))
        .order("desc")
        .take(limit);
    }

    if (args.opportunityId) {
      return await ctx.db
        .query("ghl_traces")
        .withIndex("by_opportunityId", (q) =>
          q.eq("opportunityId", args.opportunityId!)
        )
        .order("desc")
        .take(limit);
    }

    if (args.invoiceId) {
      return await ctx.db
        .query("ghl_traces")
        .withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId!))
        .order("desc")
        .take(limit);
    }

    if (args.appointmentId) {
      return await ctx.db
        .query("ghl_traces")
        .withIndex("by_appointmentId", (q) =>
          q.eq("appointmentId", args.appointmentId!)
        )
        .order("desc")
        .take(limit);
    }

    if (args.endpoint) {
      return await ctx.db
        .query("ghl_traces")
        .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint!))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("ghl_traces")
      .withIndex("by_startTime")
      .order("desc")
      .take(limit);
  },
});
