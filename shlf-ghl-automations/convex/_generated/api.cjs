/* eslint-disable */
/**
 * CommonJS wrapper for the generated Convex API.
 *
 * This file provides CommonJS compatibility for the ES module api.js
 */

const { anyApi, componentsGeneric } = require("convex/server");

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
const api = anyApi;
const internal = anyApi;
const components = componentsGeneric();

module.exports = { api, internal, components };
