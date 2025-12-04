import { v } from "convex/values";
import { query } from "../_generated/server";

/**
 * Get all traces with pagination and filtering
 * Supports both Clio and GHL traces
 */
export const listTraces = query({
  args: {
    system: v.union(v.literal("clio"), v.literal("ghl"), v.literal("all")),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    status: v.optional(v.string()),
    searchTerm: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    // Helper to map Clio trace to common format
    const mapClioTrace = (t: any) => ({
      _id: t._id,
      traceId: t.traceId,
      triggerName: t.triggerName,
      endpoint: t.endpoint,
      matterId: t.matterId,
      status: t.status,
      resultAction: t.resultAction,
      dateStarted: t.dateStarted,
      dateFinished: t.dateFinished,
      durationMs: t.durationMs,
      source: t.source,
      errorMessage: t.errorMessage,
      system: "clio" as const,
    });

    // Helper to map GHL trace to common format
    const mapGhlTrace = (t: any) => ({
      _id: t._id,
      traceId: t.traceId,
      triggerName: t.endpoint,
      endpoint: t.endpoint,
      contactId: t.contactId,
      opportunityId: t.opportunityId,
      status: t.status,
      resultAction: t.responseStatus?.toString(),
      dateStarted: t.startTime,
      dateFinished: t.endTime,
      durationMs: t.durationMs,
      source: t.triggerType,
      errorMessage: t.error?.message,
      stepCount: t.stepCount,
      detailCount: t.detailCount,
      system: "ghl" as const,
    });

    if (args.system === "all") {
      // Fetch from both tables
      const clioTraces = await ctx.db.query("clio_traces").order("desc").take(limit);
      const ghlTraces = await ctx.db.query("ghl_traces").order("desc").take(limit);

      // Map and combine
      const allTraces = [
        ...clioTraces.map(mapClioTrace),
        ...ghlTraces.map(mapGhlTrace),
      ];

      // Sort by dateStarted descending
      allTraces.sort((a, b) => {
        const aTime = a.dateStarted || 0;
        const bTime = b.dateStarted || 0;
        return bTime - aTime;
      });

      // Take the limit
      const items = allTraces.slice(0, limit);

      return {
        traces: items,
        hasMore: allTraces.length > limit,
      };
    } else if (args.system === "clio") {
      let dbQuery = ctx.db.query("clio_traces").order("desc");

      if (args.status) {
        dbQuery = ctx.db.query("clio_traces")
          .withIndex("by_status", (q) => q.eq("status", args.status as any))
          .order("desc");
      }

      const traces = await dbQuery.take(limit + 1);

      const hasMore = traces.length > limit;
      const items = hasMore ? traces.slice(0, limit) : traces;

      return {
        traces: items.map(mapClioTrace),
        hasMore,
      };
    } else {
      let dbQuery = ctx.db.query("ghl_traces").order("desc");

      if (args.status) {
        dbQuery = ctx.db.query("ghl_traces")
          .withIndex("by_status", (q) => q.eq("status", args.status as any))
          .order("desc");
      }

      const traces = await dbQuery.take(limit + 1);

      const hasMore = traces.length > limit;
      const items = hasMore ? traces.slice(0, limit) : traces;

      return {
        traces: items.map(mapGhlTrace),
        hasMore,
      };
    }
  },
});

/**
 * Get a single trace with all its steps and details
 */
export const getTraceDetails = query({
  args: {
    system: v.union(v.literal("clio"), v.literal("ghl")),
    traceId: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.system === "clio") {
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

      // Group details by stepId
      const detailsByStep = details.reduce((acc, detail) => {
        if (!acc[detail.stepId]) acc[detail.stepId] = [];
        acc[detail.stepId].push(detail);
        return acc;
      }, {} as Record<string, typeof details>);

      // Sort steps by stepOrder
      const sortedSteps = steps.sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));

      return {
        trace,
        steps: sortedSteps.map((step) => ({
          ...step,
          details: (detailsByStep[step.stepId] || []).sort(
            (a, b) => a.timestamp - b.timestamp
          ),
        })),
      };
    } else {
      // Get the trace
      const trace = await ctx.db
        .query("ghl_traces")
        .withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
        .first();

      if (!trace) return null;

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
      const detailsByStep = details.reduce((acc, detail) => {
        if (!acc[detail.stepId]) acc[detail.stepId] = [];
        acc[detail.stepId].push(detail);
        return acc;
      }, {} as Record<string, typeof details>);

      // Sort steps by sequence
      const sortedSteps = steps.sort((a, b) => a.sequence - b.sequence);

      return {
        trace,
        steps: sortedSteps.map((step) => ({
          ...step,
          details: (detailsByStep[step.stepId] || []).sort(
            (a, b) => a.sequence - b.sequence
          ),
        })),
      };
    }
  },
});

/**
 * Search traces by payload content (matter ID, contact ID, etc.)
 */
export const searchTraces = query({
  args: {
    system: v.union(v.literal("clio"), v.literal("ghl")),
    matterId: v.optional(v.number()),
    contactId: v.optional(v.string()),
    opportunityId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.system === "clio") {
      if (args.matterId) {
        const traces = await ctx.db
          .query("clio_traces")
          .withIndex("by_matterId", (q) => q.eq("matterId", args.matterId))
          .order("desc")
          .take(limit);

        return traces.map((t) => ({
          _id: t._id,
          traceId: t.traceId,
          triggerName: t.triggerName,
          endpoint: t.endpoint,
          matterId: t.matterId,
          status: t.status,
          resultAction: t.resultAction,
          dateStarted: t.dateStarted,
          dateFinished: t.dateFinished,
          durationMs: t.durationMs,
          source: t.source,
          errorMessage: t.errorMessage,
        }));
      }
      return [];
    } else {
      if (args.contactId) {
        const traces = await ctx.db
          .query("ghl_traces")
          .withIndex("by_contactId", (q) => q.eq("contactId", args.contactId))
          .order("desc")
          .take(limit);

        return traces.map((t) => ({
          _id: t._id,
          traceId: t.traceId,
          triggerName: t.endpoint,
          endpoint: t.endpoint,
          contactId: t.contactId,
          opportunityId: t.opportunityId,
          status: t.status,
          dateStarted: t.startTime,
          dateFinished: t.endTime,
          durationMs: t.durationMs,
          source: t.triggerType,
          errorMessage: t.error?.message,
        }));
      }
      if (args.opportunityId) {
        const traces = await ctx.db
          .query("ghl_traces")
          .withIndex("by_opportunityId", (q) => q.eq("opportunityId", args.opportunityId))
          .order("desc")
          .take(limit);

        return traces.map((t) => ({
          _id: t._id,
          traceId: t.traceId,
          triggerName: t.endpoint,
          endpoint: t.endpoint,
          contactId: t.contactId,
          opportunityId: t.opportunityId,
          status: t.status,
          dateStarted: t.startTime,
          dateFinished: t.endTime,
          durationMs: t.durationMs,
          source: t.triggerType,
          errorMessage: t.error?.message,
        }));
      }
      return [];
    }
  },
});
