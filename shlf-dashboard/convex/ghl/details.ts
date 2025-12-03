import { mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * GHL Detail Mutations
 * Creates a new detail (grandchild level - individual operation/API call)
 */
export const createDetail = mutation({
  args: {
    detailId: v.string(),
    traceId: v.string(),
    stepId: v.string(),
    detailType: v.union(
      v.literal("api_call"),
      v.literal("db_query"),
      v.literal("internal"),
      v.literal("webhook_out"),
      v.literal("ai_call")
    ),
    sequence: v.number(),
    // For API calls
    apiProvider: v.optional(v.string()),
    apiEndpoint: v.optional(v.string()),
    apiMethod: v.optional(v.string()),
    requestHeaders: v.optional(v.any()),
    requestBody: v.optional(v.any()),
    requestQuery: v.optional(v.any()),
    // For internal operations
    operationName: v.optional(v.string()),
    operationInput: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("ghl_details", {
      ...args,
      status: "started",
      startTime: Date.now(),
    });

    return { id, detailId: args.detailId };
  },
});

/**
 * Completes a detail successfully
 */
export const completeDetail = mutation({
  args: {
    detailId: v.string(),
    responseStatus: v.optional(v.number()),
    responseBody: v.optional(v.any()),
    responseHeaders: v.optional(v.any()),
    operationOutput: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const detail = await ctx.db
      .query("ghl_details")
      .withIndex("by_detailId", (q) => q.eq("detailId", args.detailId))
      .first();

    if (!detail) {
      console.error(`Detail not found: ${args.detailId}`);
      return null;
    }

    const endTime = Date.now();

    await ctx.db.patch(detail._id, {
      status: "completed",
      endTime,
      durationMs: endTime - detail.startTime,
      responseStatus: args.responseStatus,
      responseBody: args.responseBody,
      responseHeaders: args.responseHeaders,
      operationOutput: args.operationOutput,
    });

    return { id: detail._id, detailId: args.detailId };
  },
});

/**
 * Fails a detail with an error
 */
export const failDetail = mutation({
  args: {
    detailId: v.string(),
    error: v.object({
      message: v.string(),
      stack: v.optional(v.string()),
      code: v.optional(v.string()),
      httpStatus: v.optional(v.number()),
      raw: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const detail = await ctx.db
      .query("ghl_details")
      .withIndex("by_detailId", (q) => q.eq("detailId", args.detailId))
      .first();

    if (!detail) {
      console.error(`Detail not found: ${args.detailId}`);
      return null;
    }

    const endTime = Date.now();

    await ctx.db.patch(detail._id, {
      status: "failed",
      endTime,
      durationMs: endTime - detail.startTime,
      error: args.error,
    });

    return { id: detail._id, detailId: args.detailId };
  },
});

/**
 * Creates and immediately completes a detail (for synchronous operations)
 */
export const createCompletedDetail = mutation({
  args: {
    detailId: v.string(),
    traceId: v.string(),
    stepId: v.string(),
    detailType: v.union(
      v.literal("api_call"),
      v.literal("db_query"),
      v.literal("internal"),
      v.literal("webhook_out"),
      v.literal("ai_call")
    ),
    sequence: v.number(),
    // For API calls
    apiProvider: v.optional(v.string()),
    apiEndpoint: v.optional(v.string()),
    apiMethod: v.optional(v.string()),
    requestHeaders: v.optional(v.any()),
    requestBody: v.optional(v.any()),
    requestQuery: v.optional(v.any()),
    responseStatus: v.optional(v.number()),
    responseBody: v.optional(v.any()),
    responseHeaders: v.optional(v.any()),
    // For internal operations
    operationName: v.optional(v.string()),
    operationInput: v.optional(v.any()),
    operationOutput: v.optional(v.any()),
    // Timing
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now() - args.durationMs;
    const endTime = Date.now();

    const id = await ctx.db.insert("ghl_details", {
      detailId: args.detailId,
      traceId: args.traceId,
      stepId: args.stepId,
      detailType: args.detailType,
      sequence: args.sequence,
      apiProvider: args.apiProvider,
      apiEndpoint: args.apiEndpoint,
      apiMethod: args.apiMethod,
      requestHeaders: args.requestHeaders,
      requestBody: args.requestBody,
      requestQuery: args.requestQuery,
      responseStatus: args.responseStatus,
      responseBody: args.responseBody,
      responseHeaders: args.responseHeaders,
      operationName: args.operationName,
      operationInput: args.operationInput,
      operationOutput: args.operationOutput,
      status: "completed",
      startTime,
      endTime,
      durationMs: args.durationMs,
    });

    return { id, detailId: args.detailId };
  },
});

/**
 * Creates and immediately fails a detail (for synchronous operations that errored)
 */
export const createFailedDetail = mutation({
  args: {
    detailId: v.string(),
    traceId: v.string(),
    stepId: v.string(),
    detailType: v.union(
      v.literal("api_call"),
      v.literal("db_query"),
      v.literal("internal"),
      v.literal("webhook_out"),
      v.literal("ai_call")
    ),
    sequence: v.number(),
    // For API calls
    apiProvider: v.optional(v.string()),
    apiEndpoint: v.optional(v.string()),
    apiMethod: v.optional(v.string()),
    requestHeaders: v.optional(v.any()),
    requestBody: v.optional(v.any()),
    requestQuery: v.optional(v.any()),
    // For internal operations
    operationName: v.optional(v.string()),
    operationInput: v.optional(v.any()),
    // Error and timing
    error: v.object({
      message: v.string(),
      stack: v.optional(v.string()),
      code: v.optional(v.string()),
      httpStatus: v.optional(v.number()),
      raw: v.optional(v.any()),
    }),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now() - args.durationMs;
    const endTime = Date.now();

    const id = await ctx.db.insert("ghl_details", {
      detailId: args.detailId,
      traceId: args.traceId,
      stepId: args.stepId,
      detailType: args.detailType,
      sequence: args.sequence,
      apiProvider: args.apiProvider,
      apiEndpoint: args.apiEndpoint,
      apiMethod: args.apiMethod,
      requestHeaders: args.requestHeaders,
      requestBody: args.requestBody,
      requestQuery: args.requestQuery,
      operationName: args.operationName,
      operationInput: args.operationInput,
      error: args.error,
      status: "failed",
      startTime,
      endTime,
      durationMs: args.durationMs,
    });

    return { id, detailId: args.detailId };
  },
});
