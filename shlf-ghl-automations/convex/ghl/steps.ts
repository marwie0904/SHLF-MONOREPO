import { mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * GHL Step Mutations
 * Creates a new step (child level - service layer call)
 */
export const createStep = mutation({
  args: {
    stepId: v.string(),
    traceId: v.string(),
    serviceName: v.string(),
    functionName: v.string(),
    sequence: v.number(),
    input: v.optional(v.any()),
    contextData: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("ghl_steps", {
      ...args,
      status: "started",
      startTime: Date.now(),
      detailCount: 0,
    });

    return { id, stepId: args.stepId };
  },
});

/**
 * Completes a step successfully
 */
export const completeStep = mutation({
  args: {
    stepId: v.string(),
    output: v.optional(v.any()),
    detailCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db
      .query("ghl_steps")
      .withIndex("by_stepId", (q) => q.eq("stepId", args.stepId))
      .first();

    if (!step) {
      console.error(`Step not found: ${args.stepId}`);
      return null;
    }

    const endTime = Date.now();

    await ctx.db.patch(step._id, {
      status: "completed",
      endTime,
      durationMs: endTime - step.startTime,
      output: args.output,
      detailCount: args.detailCount ?? step.detailCount,
    });

    return { id: step._id, stepId: args.stepId };
  },
});

/**
 * Fails a step with an error
 */
export const failStep = mutation({
  args: {
    stepId: v.string(),
    error: v.object({
      message: v.string(),
      stack: v.optional(v.union(v.string(), v.null())),
      code: v.optional(v.union(v.string(), v.null())),
      httpStatus: v.optional(v.union(v.number(), v.null())),
      raw: v.optional(v.any()),
    }),
    detailCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db
      .query("ghl_steps")
      .withIndex("by_stepId", (q) => q.eq("stepId", args.stepId))
      .first();

    if (!step) {
      console.error(`Step not found: ${args.stepId}`);
      return null;
    }

    const endTime = Date.now();

    await ctx.db.patch(step._id, {
      status: "failed",
      endTime,
      durationMs: endTime - step.startTime,
      error: args.error,
      detailCount: args.detailCount ?? step.detailCount,
    });

    return { id: step._id, stepId: args.stepId };
  },
});

/**
 * Marks a step as skipped (e.g., when a condition is not met)
 */
export const skipStep = mutation({
  args: {
    stepId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db
      .query("ghl_steps")
      .withIndex("by_stepId", (q) => q.eq("stepId", args.stepId))
      .first();

    if (!step) {
      console.error(`Step not found: ${args.stepId}`);
      return null;
    }

    const endTime = Date.now();

    await ctx.db.patch(step._id, {
      status: "skipped",
      endTime,
      durationMs: endTime - step.startTime,
      output: args.reason ? { skippedReason: args.reason } : undefined,
    });

    return { id: step._id, stepId: args.stepId };
  },
});

/**
 * Updates the detail count for a step
 */
export const updateStepDetailCount = mutation({
  args: {
    stepId: v.string(),
    detailCount: v.number(),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db
      .query("ghl_steps")
      .withIndex("by_stepId", (q) => q.eq("stepId", args.stepId))
      .first();

    if (!step) {
      return null;
    }

    await ctx.db.patch(step._id, {
      detailCount: args.detailCount,
    });

    return { id: step._id };
  },
});
