/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as clio_cleanup from "../clio/cleanup.js";
import type * as clio_queries from "../clio/queries.js";
import type * as clio_tracking from "../clio/tracking.js";
import type * as dashboard_traces from "../dashboard/traces.js";
import type * as ghl_details from "../ghl/details.js";
import type * as ghl_queries from "../ghl/queries.js";
import type * as ghl_steps from "../ghl/steps.js";
import type * as ghl_traces from "../ghl/traces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "clio/cleanup": typeof clio_cleanup;
  "clio/queries": typeof clio_queries;
  "clio/tracking": typeof clio_tracking;
  "dashboard/traces": typeof dashboard_traces;
  "ghl/details": typeof ghl_details;
  "ghl/queries": typeof ghl_queries;
  "ghl/steps": typeof ghl_steps;
  "ghl/traces": typeof ghl_traces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
