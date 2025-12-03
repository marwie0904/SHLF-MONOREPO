/**
 * Tracked Axios Utility
 *
 * Creates axios instances that automatically track API calls as details
 * within the tracing system.
 */

const axios = require('axios');
const {
  startDetail,
  completeDetail,
  failDetail,
  sanitizeHeaders,
  truncatePayload,
} = require('./traceContext');

/**
 * Creates a tracked axios instance for a specific API provider
 *
 * @param {string} provider - API provider name (e.g., 'ghl', 'confido', 'make')
 * @param {string} traceId - Current trace ID
 * @param {string} stepId - Current step ID
 * @returns {AxiosInstance} - Axios instance with request/response tracking
 */
function createTrackedAxios(provider, traceId, stepId) {
  const instance = axios.create();

  // Request interceptor - start detail before API call
  instance.interceptors.request.use(
    async (config) => {
      if (traceId && stepId) {
        const startTime = Date.now();

        const { detailId } = await startDetail(traceId, stepId, {
          detailType: 'api_call',
          apiProvider: provider,
          apiEndpoint: config.url,
          apiMethod: config.method?.toUpperCase() || 'GET',
          requestHeaders: sanitizeHeaders(config.headers),
          requestBody: truncatePayload(config.data),
          requestQuery: config.params,
        });

        // Store tracking info on config for response interceptor
        config._tracing = {
          detailId,
          startTime,
          traceId,
        };
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor - complete detail after successful response
  instance.interceptors.response.use(
    async (response) => {
      if (response.config._tracing?.detailId) {
        await completeDetail(response.config._tracing.detailId, {
          responseStatus: response.status,
          responseBody: truncatePayload(response.data),
          responseHeaders: response.headers,
        });
      }
      return response;
    },
    async (error) => {
      // Handle error response
      if (error.config?._tracing?.detailId) {
        await failDetail(
          error.config._tracing.detailId,
          error,
          error.config._tracing.traceId
        );
      }
      return Promise.reject(error);
    }
  );

  return instance;
}

/**
 * Makes a tracked API call without creating a full axios instance
 *
 * @param {Object} options - Request options
 * @param {string} options.provider - API provider name
 * @param {string} options.traceId - Current trace ID
 * @param {string} options.stepId - Current step ID
 * @param {string} options.method - HTTP method
 * @param {string} options.url - Request URL
 * @param {Object} options.data - Request body
 * @param {Object} options.headers - Request headers
 * @param {Object} options.params - Query parameters
 * @returns {Promise<AxiosResponse>} - Axios response
 */
async function trackedRequest(options) {
  const {
    provider,
    traceId,
    stepId,
    method = 'GET',
    url,
    data,
    headers,
    params,
    ...axiosOptions
  } = options;

  let detailId = null;
  const startTime = Date.now();

  // Start detail tracking
  if (traceId && stepId) {
    const detail = await startDetail(traceId, stepId, {
      detailType: 'api_call',
      apiProvider: provider,
      apiEndpoint: url,
      apiMethod: method.toUpperCase(),
      requestHeaders: sanitizeHeaders(headers),
      requestBody: truncatePayload(data),
      requestQuery: params,
    });
    detailId = detail.detailId;
  }

  try {
    const response = await axios({
      method,
      url,
      data,
      headers,
      params,
      ...axiosOptions,
    });

    // Complete detail on success
    if (detailId) {
      await completeDetail(detailId, {
        responseStatus: response.status,
        responseBody: truncatePayload(response.data),
        responseHeaders: response.headers,
      });
    }

    return response;
  } catch (error) {
    // Fail detail on error
    if (detailId) {
      await failDetail(detailId, error, traceId);
    }
    throw error;
  }
}

/**
 * Creates a tracked fetch wrapper for GraphQL APIs
 *
 * @param {string} provider - API provider name (e.g., 'confido')
 * @param {string} baseUrl - Base URL for the GraphQL endpoint
 * @returns {Function} - Tracked GraphQL request function
 */
function createTrackedGraphQL(provider, baseUrl) {
  return async function trackedGraphQL(query, variables = {}, traceId = null, stepId = null) {
    let detailId = null;

    // Start detail tracking
    if (traceId && stepId) {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: provider,
        apiEndpoint: baseUrl,
        apiMethod: 'POST',
        requestBody: truncatePayload({
          query: query.substring(0, 500), // Truncate query preview
          variables,
        }),
      });
      detailId = detail.detailId;
    }

    try {
      const response = await axios.post(
        baseUrl,
        { query, variables },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      // Check for GraphQL errors
      if (response.data.errors) {
        const error = new Error(response.data.errors[0]?.message || 'GraphQL Error');
        error.graphqlErrors = response.data.errors;

        if (detailId) {
          await failDetail(detailId, error, traceId);
        }

        throw error;
      }

      // Complete detail on success
      if (detailId) {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: truncatePayload(response.data.data),
        });
      }

      return response.data.data;
    } catch (error) {
      // Fail detail on error (if not already failed for GraphQL errors)
      if (detailId && !error.graphqlErrors) {
        await failDetail(detailId, error, traceId);
      }
      throw error;
    }
  };
}

/**
 * Creates a tracked webhook caller
 *
 * @param {string} provider - Webhook provider name (e.g., 'make', 'ghl')
 * @returns {Function} - Tracked webhook request function
 */
function createTrackedWebhook(provider) {
  return async function trackedWebhook(url, payload, traceId = null, stepId = null) {
    let detailId = null;

    // Start detail tracking
    if (traceId && stepId) {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'webhook_out',
        apiProvider: provider,
        apiEndpoint: url,
        apiMethod: 'POST',
        requestBody: truncatePayload(payload),
      });
      detailId = detail.detailId;
    }

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Complete detail on success
      if (detailId) {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: truncatePayload(response.data),
        });
      }

      return response;
    } catch (error) {
      // Fail detail on error
      if (detailId) {
        await failDetail(detailId, error, traceId);
      }
      throw error;
    }
  };
}

/**
 * Tracks a Supabase database operation
 *
 * @param {string} operation - Operation name (e.g., 'select', 'insert', 'update')
 * @param {string} table - Table name
 * @param {Object} params - Operation parameters
 * @param {string} traceId - Current trace ID
 * @param {string} stepId - Current step ID
 * @param {Function} fn - The async function to execute
 * @returns {Promise<any>} - Operation result
 */
async function trackedSupabaseOp(operation, table, params, traceId, stepId, fn) {
  let detailId = null;

  // Start detail tracking
  if (traceId && stepId) {
    const detail = await startDetail(traceId, stepId, {
      detailType: 'db_query',
      apiProvider: 'supabase',
      operationName: `${operation}:${table}`,
      operationInput: truncatePayload(params),
    });
    detailId = detail.detailId;
  }

  try {
    const result = await fn();

    // Complete detail on success
    if (detailId) {
      await completeDetail(detailId, {
        operationOutput: truncatePayload(result),
      });
    }

    return result;
  } catch (error) {
    // Fail detail on error
    if (detailId) {
      await failDetail(detailId, error, traceId);
    }
    throw error;
  }
}

/**
 * Tracks an AI/LLM API call
 *
 * @param {string} provider - AI provider name (e.g., 'openrouter', 'openai')
 * @param {string} model - Model name
 * @param {Object} options - Call options
 * @param {string} traceId - Current trace ID
 * @param {string} stepId - Current step ID
 * @param {Function} fn - The async function to execute
 * @returns {Promise<any>} - AI response
 */
async function trackedAICall(provider, model, options, traceId, stepId, fn) {
  let detailId = null;

  // Start detail tracking
  if (traceId && stepId) {
    const detail = await startDetail(traceId, stepId, {
      detailType: 'ai_call',
      apiProvider: provider,
      operationName: model,
      operationInput: truncatePayload({
        model,
        promptLength: options.prompt?.length || options.messages?.length,
        ...options,
      }),
    });
    detailId = detail.detailId;
  }

  try {
    const result = await fn();

    // Complete detail on success
    if (detailId) {
      await completeDetail(detailId, {
        operationOutput: truncatePayload({
          responseLength: result?.length || result?.choices?.[0]?.message?.content?.length,
          usage: result?.usage,
          model: result?.model,
        }),
      });
    }

    return result;
  } catch (error) {
    // Fail detail on error
    if (detailId) {
      await failDetail(detailId, error, traceId);
    }
    throw error;
  }
}

module.exports = {
  createTrackedAxios,
  trackedRequest,
  createTrackedGraphQL,
  createTrackedWebhook,
  trackedSupabaseOp,
  trackedAICall,
};
