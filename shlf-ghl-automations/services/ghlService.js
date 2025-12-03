const axios = require('axios');
const { startDetail, completeDetail, failDetail, sanitizeHeaders, truncatePayload } = require('../utils/traceContext');

/**
 * Searches for existing contact by phone or email
 * @param {string} phone - Contact phone number
 * @param {string} locationId - GHL location ID
 * @param {string} apiKey - GHL API key
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object|null>} Existing contact or null
 */
async function findExistingContact(phone, locationId, apiKey, traceId = null, stepId = null) {
  if (!phone) return null;

  const endpoint = `https://services.leadconnectorhq.com/contacts/`;
  const queryParams = { locationId, query: phone };

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'GET',
        requestQuery: queryParams
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.get(endpoint, {
      params: queryParams,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: truncatePayload(response.data)
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    if (response.data.contacts && response.data.contacts.length > 0) {
      return response.data.contacts[0];
    }
    return null;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('Error searching for contact:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Updates an existing contact in GoHighLevel
 * @param {string} contactId - GHL contact ID
 * @param {Object} contactData - Contact data in GHL format
 * @param {string} apiKey - GHL API key
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} API response
 */
async function updateGHLContact(contactId, contactData, apiKey, traceId = null, stepId = null) {
  const endpoint = `https://services.leadconnectorhq.com/contacts/${contactId}`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'PUT',
        requestBody: truncatePayload(contactData)
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.put(endpoint, contactData, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: truncatePayload(response.data)
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('GHL Contact updated successfully:', response.data);
    return response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('Error updating GHL contact:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Creates or updates a contact in GoHighLevel
 * @param {Object} contactData - Contact data in GHL format
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} API response with contactId and isDuplicate flag
 */
async function createGHLContact(contactData, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  if (!locationId) {
    throw new Error('GHL_LOCATION_ID not configured in environment variables');
  }

  const payload = {
    ...contactData,
    locationId: locationId
  };

  // Track API call
  let detailId = null;
  if (traceId && stepId) {
    const detail = await startDetail(traceId, stepId, {
      detailType: 'api_call',
      apiProvider: 'ghl',
      apiEndpoint: 'https://services.leadconnectorhq.com/contacts/',
      apiMethod: 'POST',
      requestBody: truncatePayload(payload),
    });
    detailId = detail.detailId;
  }

  try {
    // Try to create contact
    const response = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      payload,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28'
        }
      }
    );

    if (detailId) {
      await completeDetail(detailId, {
        responseStatus: response.status,
        responseBody: truncatePayload(response.data),
      });
    }

    console.log('GHL Contact created successfully:', response.data);
    return {
      ...response.data,
      isDuplicate: false
    };
  } catch (error) {
    console.error('GHL API Error Details:', JSON.stringify(error.response?.data, null, 2));

    // Check if it's a duplicate contact error
    const isDuplicateError = error.response?.status === 400 &&
                            error.response?.data?.message?.includes('duplicated');

    if (isDuplicateError) {
      // Mark this detail as completed (duplicate is expected flow)
      if (detailId) {
        await completeDetail(detailId, {
          responseStatus: error.response?.status,
          responseBody: { isDuplicate: true, message: 'Duplicate contact, searching for existing' },
        });
      }

      console.log('Duplicate contact detected, searching for existing contact...');

      // Search for existing contact (track as separate detail)
      let searchDetailId = null;
      if (traceId && stepId) {
        const detail = await startDetail(traceId, stepId, {
          detailType: 'api_call',
          apiProvider: 'ghl',
          apiEndpoint: 'https://services.leadconnectorhq.com/contacts/',
          apiMethod: 'GET',
          requestBody: { query: contactData.phone },
        });
        searchDetailId = detail.detailId;
      }

      const existingContact = await findExistingContact(contactData.phone, locationId, apiKey);

      if (searchDetailId) {
        await completeDetail(searchDetailId, {
          responseStatus: existingContact ? 200 : 404,
          responseBody: existingContact ? { contactId: existingContact.id } : { found: false },
        });
      }

      if (existingContact) {
        console.log('Found existing contact, updating:', existingContact.id);

        // Track update as separate detail
        let updateDetailId = null;
        if (traceId && stepId) {
          const detail = await startDetail(traceId, stepId, {
            detailType: 'api_call',
            apiProvider: 'ghl',
            apiEndpoint: `https://services.leadconnectorhq.com/contacts/${existingContact.id}`,
            apiMethod: 'PUT',
            requestBody: truncatePayload(contactData),
          });
          updateDetailId = detail.detailId;
        }

        try {
          const updateResponse = await updateGHLContact(existingContact.id, contactData, apiKey);

          if (updateDetailId) {
            await completeDetail(updateDetailId, {
              responseStatus: 200,
              responseBody: truncatePayload(updateResponse),
            });
          }

          return {
            contact: { id: existingContact.id },
            id: existingContact.id,
            isDuplicate: true,
            ...updateResponse
          };
        } catch (updateError) {
          if (updateDetailId) await failDetail(updateDetailId, updateError, traceId);
          throw updateError;
        }
      } else {
        console.error('Could not find existing contact to update');
        throw new Error('Duplicate contact error but could not find existing contact');
      }
    }

    // Fail the detail for non-duplicate errors
    if (detailId) await failDetail(detailId, error, traceId);

    // Re-throw if not a duplicate error
    console.error('Error creating GHL contact:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Creates an opportunity for a contact in GoHighLevel
 * @param {string} contactId - GHL contact ID
 * @param {string} pipelineId - GHL pipeline ID
 * @param {string} stageId - GHL stage ID (default: Pending Contact)
 * @param {string} name - Opportunity name
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} API response
 */
async function createGHLOpportunity(contactId, pipelineId, stageId, name, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  if (!locationId) {
    throw new Error('GHL_LOCATION_ID not configured in environment variables');
  }

  const endpoint = 'https://services.leadconnectorhq.com/opportunities/';
  const payload = {
    pipelineId: pipelineId,
    locationId: locationId,
    name: name,
    pipelineStageId: stageId,
    status: 'open',
    contactId: contactId
  };

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'POST',
        requestBody: payload
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.post(endpoint, payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: truncatePayload(response.data)
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('GHL Opportunity created successfully:', response.data);
    return response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('Error creating GHL opportunity:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetches all custom fields from GoHighLevel location
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Array>} Array of custom field objects
 */
async function getCustomFields(traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  if (!locationId) {
    throw new Error('GHL_LOCATION_ID not configured in environment variables');
  }

  const endpoint = `https://services.leadconnectorhq.com/locations/${locationId}/customFields`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'GET'
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.get(endpoint, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: { fieldCount: response.data.customFields?.length || 0 }
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('Custom fields fetched successfully');
    return response.data.customFields || [];
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('Error fetching custom fields:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Gets a contact by ID from GoHighLevel
 * @param {string} contactId - GHL contact ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Contact data
 */
async function getContact(contactId, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  const endpoint = `https://services.leadconnectorhq.com/contacts/${contactId}`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'GET'
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.get(endpoint, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: truncatePayload(response.data)
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('Contact fetched successfully:', contactId);
    return response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('Error fetching contact:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Creates a task in GoHighLevel
 * @param {string} contactId - Contact ID to assign task to
 * @param {string} title - Task title
 * @param {string} body - Task description/body
 * @param {string} dueDate - ISO date string for due date
 * @param {string} assignedTo - User ID to assign task to (optional)
 * @param {string} opportunityId - Opportunity ID to link task to (optional)
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Task creation response
 */
async function createTask(contactId, title, body, dueDate, assignedTo = null, opportunityId = null, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  const endpoint = 'https://services.leadconnectorhq.com/opportunities/tasks';
  const payload = {
    contactId: contactId,
    title: title,
    body: body,
    dueDate: dueDate,
    completed: false
  };

  // Add optional fields if provided
  if (assignedTo) {
    payload.assignedTo = assignedTo;
  }

  if (opportunityId) {
    payload.opportunityId = opportunityId;
  }

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'POST',
        requestBody: payload
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.post(endpoint, payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: response.data
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('Task created successfully:', response.data);
    return response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('Error creating task:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Records a manual payment for an invoice in GoHighLevel
 * @param {string} invoiceId - GHL invoice ID
 * @param {Object} paymentData - Payment information
 * @param {number} paymentData.amount - Payment amount in dollars
 * @param {string} paymentData.paymentMethod - Payment method (e.g., 'credit_card', 'ach', 'cash')
 * @param {string} paymentData.transactionId - External transaction ID (Confido payment ID)
 * @param {string} paymentData.note - Payment note/memo
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Payment record response
 */
async function recordInvoicePayment(invoiceId, paymentData, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  console.log('=== Recording Payment in GHL Invoice ===');
  console.log('Invoice ID:', invoiceId);
  console.log('Payment Data:', JSON.stringify(paymentData, null, 2));

  const endpoint = `https://services.leadconnectorhq.com/invoices/${invoiceId}/record-payment`;
  const payload = {
    amount: paymentData.amount, // Amount in dollars
    paymentMode: paymentData.paymentMethod || 'other',
    transactionId: paymentData.transactionId || null,
    note: paymentData.note || 'Payment processed via Confido Legal'
  };

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'POST',
        requestBody: payload
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.post(endpoint, payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: response.data
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('✅ Payment recorded in GHL invoice successfully');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('❌ Error recording payment in GHL invoice:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Gets invoice details from GoHighLevel
 * @param {string} invoiceId - GHL invoice ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Invoice data
 */
async function getInvoice(invoiceId, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  console.log('=== Fetching Invoice from GHL ===');
  console.log('Invoice ID:', invoiceId);

  const endpoint = `https://services.leadconnectorhq.com/invoices/${invoiceId}`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'GET'
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.get(endpoint, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: truncatePayload(response.data)
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('✅ Invoice fetched successfully from GHL');
    return response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('❌ Error fetching invoice from GHL:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Gets custom object details from GoHighLevel
 * @param {string} objectKey - Custom object schema key (e.g., "custom_objects.invoices")
 * @param {string} recordId - Custom object record ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Custom object data
 */
async function getCustomObject(objectKey, recordId, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  console.log('=== Fetching Custom Object from GHL ===');
  console.log('Object Key:', objectKey);
  console.log('Record ID:', recordId);

  const endpoint = `https://services.leadconnectorhq.com/objects/${objectKey}/records/${recordId}`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'GET'
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.get(endpoint, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: truncatePayload(response.data)
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('✅ Custom object fetched successfully from GHL');
    return response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('❌ Error fetching custom object from GHL:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Updates custom object properties in GoHighLevel
 * @param {string} objectKey - Custom object schema key (e.g., 'custom_objects.invoices')
 * @param {string} recordId - Custom object record ID
 * @param {string} locationId - GHL location ID (required for PUT requests)
 * @param {Object} properties - Object of property updates { fieldName: value }
 *                              Use short field names (e.g., 'payment_link' not 'custom_objects.invoices.payment_link')
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Update response
 */
async function updateCustomObject(objectKey, recordId, locationId, properties, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  if (!locationId) {
    throw new Error('locationId is required for updating custom objects');
  }

  console.log('=== Updating Custom Object in GHL ===');
  console.log('Object Key:', objectKey);
  console.log('Record ID:', recordId);
  console.log('Location ID:', locationId);
  console.log('Properties:', JSON.stringify(properties, null, 2));

  const endpoint = `https://services.leadconnectorhq.com/objects/${objectKey}/records/${recordId}?locationId=${locationId}`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'PUT',
        requestBody: { properties }
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    // locationId must be passed as query parameter for PUT requests
    const response = await axios.put(endpoint, { properties }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: response.data
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('✅ Custom object updated successfully in GHL');
    return response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('❌ Error updating custom object in GHL:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Gets relations/associations for a custom object record
 * @param {string} recordId - Custom object record ID
 * @param {string} locationId - GHL location ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Relations data
 */
async function getRelations(recordId, locationId, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  console.log('=== Fetching Relations from GHL ===');
  console.log('Record ID:', recordId);
  console.log('Location ID:', locationId);

  const endpoint = `https://services.leadconnectorhq.com/associations/relations/${recordId}`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'GET',
        requestQuery: { locationId }
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.get(endpoint, {
      params: { locationId },
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: { relationsCount: response.data.relations?.length || 0 }
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('✅ Relations fetched successfully from GHL');
    console.log(`Found ${response.data.relations?.length || 0} relations`);
    return response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('❌ Error fetching relations from GHL:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Searches for opportunities by contact ID
 * @param {string} contactId - GHL contact ID
 * @param {string} pipelineId - Optional pipeline ID to filter by
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Array>} Array of opportunities for the contact
 */
async function searchOpportunitiesByContact(contactId, pipelineId = null, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  if (!locationId) {
    throw new Error('GHL_LOCATION_ID not configured in environment variables');
  }

  console.log('=== Searching Opportunities by Contact ===');
  console.log('Contact ID:', contactId);
  console.log('Pipeline ID:', pipelineId || 'All pipelines');

  const endpoint = 'https://services.leadconnectorhq.com/opportunities/search';
  const params = {
    location_id: locationId,
    contact_id: contactId
  };

  if (pipelineId) {
    params.pipeline_id = pipelineId;
  }

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'GET',
        requestQuery: params
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.get(endpoint, {
      params,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: { opportunitiesCount: response.data.opportunities?.length || 0 }
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    const opportunities = response.data.opportunities || [];
    console.log(`Found ${opportunities.length} opportunities for contact`);
    return opportunities;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('Error searching opportunities:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Creates or updates an opportunity for a contact in GoHighLevel
 * If an opportunity already exists for the contact in the pipeline, it updates it
 * Otherwise, it creates a new opportunity
 * @param {string} contactId - GHL contact ID
 * @param {string} pipelineId - GHL pipeline ID
 * @param {string} stageId - GHL stage ID
 * @param {string} name - Opportunity name
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} API response with isNew flag
 */
async function upsertGHLOpportunity(contactId, pipelineId, stageId, name, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  if (!locationId) {
    throw new Error('GHL_LOCATION_ID not configured in environment variables');
  }

  try {
    // First, search for existing opportunities for this contact in this pipeline
    console.log('=== Checking for existing opportunity ===');

    // Track search as detail
    let searchDetailId = null;
    if (traceId && stepId) {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: 'https://services.leadconnectorhq.com/opportunities/search',
        apiMethod: 'GET',
        requestBody: { contactId, pipelineId },
      });
      searchDetailId = detail.detailId;
    }

    const existingOpportunities = await searchOpportunitiesByContact(contactId, pipelineId);

    if (searchDetailId) {
      await completeDetail(searchDetailId, {
        responseStatus: 200,
        responseBody: { found: existingOpportunities.length, opportunityIds: existingOpportunities.map(o => o.id) },
      });
    }

    if (existingOpportunities.length > 0) {
      // Found existing opportunity - update it
      const existingOpp = existingOpportunities[0]; // Take the first/most recent one
      console.log(`Found existing opportunity: ${existingOpp.id}, updating...`);

      const updatePayload = {
        pipelineStageId: stageId,
        name: name
      };

      // Track update as detail
      let updateDetailId = null;
      if (traceId && stepId) {
        const detail = await startDetail(traceId, stepId, {
          detailType: 'api_call',
          apiProvider: 'ghl',
          apiEndpoint: `https://services.leadconnectorhq.com/opportunities/${existingOpp.id}`,
          apiMethod: 'PUT',
          requestBody: updatePayload,
        });
        updateDetailId = detail.detailId;
      }

      try {
        const response = await axios.put(
          `https://services.leadconnectorhq.com/opportunities/${existingOpp.id}`,
          updatePayload,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Version': '2021-07-28'
            }
          }
        );

        if (updateDetailId) {
          await completeDetail(updateDetailId, {
            responseStatus: response.status,
            responseBody: truncatePayload(response.data),
          });
        }

        console.log('GHL Opportunity updated successfully:', response.data);
        return {
          ...response.data,
          isNew: false,
          existingOpportunityId: existingOpp.id
        };
      } catch (updateError) {
        if (updateDetailId) await failDetail(updateDetailId, updateError, traceId);
        throw updateError;
      }
    } else {
      // No existing opportunity - create new one
      console.log('No existing opportunity found, creating new one...');

      const createPayload = {
        pipelineId: pipelineId,
        locationId: locationId,
        name: name,
        pipelineStageId: stageId,
        status: 'open',
        contactId: contactId
      };

      // Track create as detail
      let createDetailId = null;
      if (traceId && stepId) {
        const detail = await startDetail(traceId, stepId, {
          detailType: 'api_call',
          apiProvider: 'ghl',
          apiEndpoint: 'https://services.leadconnectorhq.com/opportunities/',
          apiMethod: 'POST',
          requestBody: createPayload,
        });
        createDetailId = detail.detailId;
      }

      try {
        const response = await axios.post(
          'https://services.leadconnectorhq.com/opportunities/',
          createPayload,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Version': '2021-07-28'
            }
          }
        );

        if (createDetailId) {
          await completeDetail(createDetailId, {
            responseStatus: response.status,
            responseBody: truncatePayload(response.data),
          });
        }

        console.log('GHL Opportunity created successfully:', response.data);
        return {
          ...response.data,
          isNew: true
        };
      } catch (createError) {
        if (createDetailId) await failDetail(createDetailId, createError, traceId);
        throw createError;
      }
    }
  } catch (error) {
    console.error('Error upserting GHL opportunity:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Gets opportunity details including contact information
 * @param {string} opportunityId - GHL opportunity ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Opportunity data with contact details
 */
async function getOpportunity(opportunityId, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  console.log('=== Fetching Opportunity from GHL ===');
  console.log('Opportunity ID:', opportunityId);

  const endpoint = `https://services.leadconnectorhq.com/opportunities/${opportunityId}`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'GET'
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.get(endpoint, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28'
      }
    });

    // Complete detail tracking
    if (detailId) {
      try {
        await completeDetail(detailId, {
          responseStatus: response.status,
          responseBody: truncatePayload(response.data)
        });
      } catch (e) {
        console.error('Error completing detail:', e.message);
      }
    }

    console.log('✅ Opportunity fetched successfully from GHL');
    return response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('❌ Error fetching opportunity from GHL:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  createGHLContact,
  updateGHLContact,
  createGHLOpportunity,
  upsertGHLOpportunity,
  searchOpportunitiesByContact,
  getCustomFields,
  getContact,
  createTask,
  recordInvoicePayment,
  getInvoice,
  getCustomObject,
  updateCustomObject,
  getRelations,
  getOpportunity
};
