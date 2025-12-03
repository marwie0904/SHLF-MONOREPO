/* eslint-disable */
/**
 * CommonJS wrapper for Convex API.
 * This allows require() to work in CommonJS projects.
 */

const { anyApi, componentsGeneric } = require('convex/server');

const api = anyApi;
const internal = anyApi;
const components = componentsGeneric();

module.exports = { api, internal, components };
