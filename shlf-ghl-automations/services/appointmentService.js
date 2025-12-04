const axios = require('axios');
const { searchOpportunitiesByContact } = require('./ghlOpportunityService');
const { shouldSendConfirmationEmail, sendMeetingConfirmationEmail, shouldSendDiscoveryCallEmail, sendProbateDiscoveryCallEmail, shouldSendTrustAdminEmail, sendTrustAdminMeetingEmail, shouldSendGeneralDiscoveryCallEmail, sendGeneralDiscoveryCallEmail, shouldSendDocReviewEmail, sendDocReviewMeetingEmail } = require('./appointmentEmailService');
const { sendConfirmationSms, scheduleReminderSms } = require('./appointmentSmsService');
const { getContact } = require('./ghlService');
const { startStep, completeStep, failStep, startDetail, completeDetail, failDetail } = require('../utils/traceContext');

/**
 * Appointment Service
 *
 * Handles GHL appointment operations including:
 * - Fetching form submissions
 * - Getting calendar details
 * - Updating appointment titles
 * - Moving opportunities to stages based on meeting type
 */

const BASE_URL = 'https://services.leadconnectorhq.com';

// Form ID for "Phone and Email" booking form
const APPOINTMENT_FORM_ID = 'GqeCjaSjT4CqyZuKWLIK';

// Form field IDs for "Phone and Email" booking form
const FORM_FIELDS = {
  MEETING_TYPE: '88Kn2yxnw7Xe6LNjHyQl',  // e.g., "EP Discovery Call"
  MEETING: 'VJRoVeTD3qyr8haFP2N0',        // e.g., "Naples"
  CALENDAR_NAME: 'calendar_name'           // e.g., "Gabby Ang's Personal Calendar"
};

// Meeting Type to Stage ID mapping
// Discovery calls → "Scheduled Discovery Call" stage
// Meetings → "Scheduled I/V" stage
const MEETING_TYPE_STAGE_MAP = {
  // Discovery Calls → Scheduled Discovery Call
  'EP Discovery Call': '12d9abab-c81b-4215-8b2a-020bc3fff912',
  'Deed Discovery Call': '12d9abab-c81b-4215-8b2a-020bc3fff912',
  'Probate Discovery Call': '12d9abab-c81b-4215-8b2a-020bc3fff912',
  // Meetings → Scheduled I/V
  'Trust Admin Meeting': '1648da87-eab3-491f-a51b-8d1646137550',
  'Initial Meeting': '1648da87-eab3-491f-a51b-8d1646137550',
  'Vision Meeting': '1648da87-eab3-491f-a51b-8d1646137550',
  'Doc Review Meeting': '1648da87-eab3-491f-a51b-8d1646137550',
  'Standalone Meeting': '1648da87-eab3-491f-a51b-8d1646137550',
};

/**
 * Gets common headers for GHL API requests
 */
function getHeaders() {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  return {
    'Authorization': `Bearer ${apiKey}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json'
  };
}

/**
 * Fetches form submission by phone or email
 * @param {string} formId - The form ID to search
 * @param {string} searchQuery - Phone number or email to search
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object|null>} Form submission data or null if not found
 */
async function getFormSubmission(formId, searchQuery, traceId = null, stepId = null) {
  const locationId = process.env.GHL_LOCATION_ID;

  if (!locationId) {
    throw new Error('GHL_LOCATION_ID not configured in environment variables');
  }

  if (!searchQuery) {
    console.log('⚠️ No search query provided for form submission lookup');
    return null;
  }

  // Clean the search query for phone numbers
  // - Remove + prefix (causes regex issues in GHL API)
  // - Remove spaces (phone might come as "+63 2 1319 4213")
  let cleanedQuery = searchQuery;
  if (searchQuery.match(/^[\+\d\s]+$/)) {
    // It looks like a phone number - clean it
    cleanedQuery = searchQuery.replace(/[\+\s]/g, '');
    console.log(`📞 Cleaned phone number: "${searchQuery}" -> "${cleanedQuery}"`);
  }

  const endpoint = `${BASE_URL}/forms/submissions`;
  const queryParams = { locationId, formId, q: cleanedQuery, limit: 1 };

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
    console.log(`🔍 Searching form submissions for: ${cleanedQuery}`);

    const response = await axios.get(endpoint, {
      params: queryParams,
      headers: getHeaders()
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

    const submissions = response.data.submissions || [];

    if (submissions.length === 0) {
      console.log(`⚠️ No form submission found for query: ${searchQuery}`);
      return null;
    }

    console.log(`✅ Found form submission: ${submissions[0].id}`);
    return submissions[0];
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('❌ Error fetching form submission:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Extracts meeting data from form submission
 * @param {Object} submission - Form submission object
 * @returns {Object} Extracted meeting data
 */
function extractMeetingData(submission) {
  const others = submission.others || {};

  return {
    meetingType: others[FORM_FIELDS.MEETING_TYPE] || null,
    meeting: others[FORM_FIELDS.MEETING] || null,
    calendarName: others[FORM_FIELDS.CALENDAR_NAME] || null
  };
}

/**
 * Fetches calendar details by ID
 * @param {string} calendarId - The calendar ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object|null>} Calendar data or null if not found
 */
async function getCalendar(calendarId, traceId = null, stepId = null) {
  if (!calendarId) {
    console.log('⚠️ No calendar ID provided');
    return null;
  }

  const endpoint = `${BASE_URL}/calendars/${calendarId}`;

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
    console.log(`📅 Fetching calendar: ${calendarId}`);

    const response = await axios.get(endpoint, {
      headers: getHeaders()
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

    console.log(`✅ Found calendar: ${response.data.calendar?.name || 'Unknown'}`);
    return response.data.calendar || response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('❌ Error fetching calendar:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Fetches an appointment by ID
 * @param {string} appointmentId - The appointment/event ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object|null>} Appointment data or null if not found
 */
async function getAppointment(appointmentId, traceId = null, stepId = null) {
  if (!appointmentId) {
    console.log('⚠️ No appointment ID provided');
    return null;
  }

  const endpoint = `${BASE_URL}/calendars/events/appointments/${appointmentId}`;

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
    console.log(`📅 Fetching appointment: ${appointmentId}`);

    const response = await axios.get(endpoint, {
      headers: getHeaders()
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

    console.log(`✅ Found appointment`);
    return response.data.event || response.data;
  } catch (error) {
    // Fail detail tracking
    if (detailId) {
      try {
        await failDetail(detailId, error, traceId);
      } catch (e) {
        console.error('Error failing detail:', e.message);
      }
    }
    console.error('❌ Error fetching appointment:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Updates an appointment's title
 * @param {string} appointmentId - The appointment/event ID
 * @param {string} title - New title for the appointment
 * @param {string} calendarId - The calendar ID (required for the endpoint, will be fetched if not provided)
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object|null>} Updated appointment data or null on failure
 */
async function updateAppointmentTitle(appointmentId, title, calendarId, traceId = null, stepId = null) {
  if (!appointmentId) {
    throw new Error('Appointment ID is required');
  }

  if (!title) {
    throw new Error('Title is required');
  }

  // If calendarId not provided, fetch the appointment to get it
  let resolvedCalendarId = calendarId;
  if (!resolvedCalendarId) {
    console.log('📅 No calendarId provided, fetching appointment to get it...');
    const appointment = await getAppointment(appointmentId, traceId, stepId);
    if (appointment) {
      resolvedCalendarId = appointment.calendarId;
      console.log(`📅 Got calendarId from appointment: ${resolvedCalendarId}`);
    }
  }

  if (!resolvedCalendarId) {
    throw new Error('Could not determine calendarId for appointment update');
  }

  const endpoint = `${BASE_URL}/calendars/events/appointments/${appointmentId}`;
  const payload = { title, calendarId: resolvedCalendarId };

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'PUT',
        requestBody: payload
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    console.log(`📝 Updating appointment ${appointmentId} title to: "${title}"`);

    const response = await axios.put(endpoint, payload, {
      headers: getHeaders()
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

    console.log(`✅ Appointment title updated successfully`);
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
    console.error('❌ Error updating appointment:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Gets the stage ID for a given meeting type
 * @param {string} meetingType - The meeting type (e.g., "EP Discovery Call")
 * @returns {string|null} Stage ID or null if no mapping exists
 */
function getStageIdForMeetingType(meetingType) {
  if (!meetingType) return null;
  return MEETING_TYPE_STAGE_MAP[meetingType] || null;
}

/**
 * Updates an opportunity's stage in GHL
 * @param {string} opportunityId - The opportunity ID
 * @param {string} stageId - The target stage ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object|null>} Updated opportunity data or null on failure
 */
async function updateOpportunityStage(opportunityId, stageId, traceId = null, stepId = null) {
  if (!opportunityId) {
    console.log('⚠️ No opportunity ID provided, skipping stage update');
    return null;
  }

  if (!stageId) {
    console.log('⚠️ No stage ID provided, skipping stage update');
    return null;
  }

  const pipelineId = process.env.GHL_PIPELINE_ID || 'LFxLIUP3LCVES60i9iwN';
  const endpoint = `${BASE_URL}/opportunities/${opportunityId}`;
  const payload = { pipelineId, pipelineStageId: stageId };

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'PUT',
        requestBody: payload
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    console.log(`📊 Updating opportunity ${opportunityId} to stage ${stageId}`);

    const response = await axios.put(endpoint, payload, {
      headers: getHeaders()
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

    console.log(`✅ Opportunity stage updated successfully`);
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
    console.error('❌ Error updating opportunity stage:', error.response?.data || error.message);
    // Don't throw - stage update failure shouldn't fail the whole webhook
    return null;
  }
}

/**
 * Cleans calendar name by removing "'s Personal Calendar" suffix
 * @param {string} calendarName - Raw calendar name (e.g., "Gabby Ang's Personal Calendar")
 * @returns {string} Cleaned name (e.g., "Gabby Ang")
 */
function cleanCalendarName(calendarName) {
  if (!calendarName) return null;

  // Remove "'s Personal Calendar" suffix if present
  return calendarName.replace(/'s Personal Calendar$/i, '').trim();
}

/**
 * Builds the appointment title from components
 * @param {Object} options - Title components
 * @param {string} options.calendarName - Calendar name
 * @param {string} options.meetingType - Meeting type (e.g., "EP Discovery Call")
 * @param {string} options.meeting - Meeting location/name (e.g., "Naples")
 * @param {string} options.contactName - Contact's full name
 * @returns {string} Formatted title
 */
function buildAppointmentTitle({ calendarName, meetingType, meeting, contactName }) {
  const parts = [];

  // Clean calendar name (remove "'s Personal Calendar" suffix)
  const cleanedCalendarName = cleanCalendarName(calendarName);
  if (cleanedCalendarName) parts.push(cleanedCalendarName);
  if (meetingType) parts.push(meetingType);
  if (meeting) parts.push(meeting);
  if (contactName) parts.push(contactName);

  return parts.join(' - ');
}

/**
 * Main handler for appointment created webhook
 * Fetches form submission, extracts data, updates appointment title,
 * and moves opportunity to appropriate stage based on meeting type
 *
 * @param {Object} webhookData - Webhook payload from GHL
 * @param {string} webhookData.appointmentId - The appointment ID
 * @param {string} webhookData.contactId - Contact ID
 * @param {string} webhookData.contactPhone - Contact phone number
 * @param {string} webhookData.contactEmail - Contact email
 * @param {string} webhookData.contactName - Contact full name
 * @param {string} webhookData.calendarId - Calendar ID (optional)
 * @param {string} webhookData.calendarName - Calendar name (optional, preferred over calendarId)
 * @param {string} webhookData.opportunityId - Opportunity ID (optional, for stage updates)
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Result of the operation
 */
async function processAppointmentCreated(webhookData, traceId = null, stepId = null) {
  const {
    appointmentId,
    contactId,
    contactPhone,
    contactEmail,
    contactName,
    calendarId,
    calendarName: webhookCalendarName,
    opportunityId
  } = webhookData;

  console.log('\n========================================');
  console.log('📅 Processing Appointment Created Webhook');
  console.log('========================================');
  console.log(`Appointment ID: ${appointmentId}`);
  console.log(`Contact: ${contactName} (${contactId})`);
  console.log(`Phone: ${contactPhone}`);
  console.log(`Email: ${contactEmail}`);
  console.log(`Calendar ID: ${calendarId || '(not provided)'}`);
  console.log(`Calendar Name: ${webhookCalendarName || '(not provided)'}`);
  console.log(`Opportunity ID: ${opportunityId || '(not provided)'}`);
  console.log('========================================\n');

  // Validate required fields
  if (!appointmentId) {
    throw new Error('Missing required field: appointmentId');
  }

  const formId = APPOINTMENT_FORM_ID;

  let meetingData = null;
  let calendarName = null;

  // ===== STEP 1: Get Form Submission =====
  let formStepId = null;
  if (traceId) {
    try {
      const step = await startStep(traceId, 'ghl', 'getFormSubmission', {
        formId,
        searchQuery: contactPhone || contactEmail,
        hasPhone: !!contactPhone,
        hasEmail: !!contactEmail
      });
      formStepId = step.stepId;
    } catch (e) {
      console.error('Error starting getFormSubmission step:', e.message);
    }
  }

  const searchQuery = contactPhone || contactEmail;
  let formSubmissionFound = false;

  if (searchQuery) {
    const submission = await getFormSubmission(formId, searchQuery, traceId, formStepId || stepId);

    if (submission) {
      formSubmissionFound = true;
      meetingData = extractMeetingData(submission);
      calendarName = meetingData.calendarName;
      console.log('📋 Extracted meeting data:', meetingData);
    }
  }

  if (formStepId) {
    try {
      await completeStep(formStepId, {
        submissionFound: formSubmissionFound,
        meetingType: meetingData?.meetingType || null,
        meeting: meetingData?.meeting || null,
        calendarName: meetingData?.calendarName || null
      });
    } catch (e) {
      console.error('Error completing getFormSubmission step:', e.message);
    }
  }

  // ===== STEP 2: Get Calendar Name (if needed) =====
  let calendarStepId = null;
  let calendarSource = formSubmissionFound ? 'form_submission' : null;

  if (!calendarName) {
    if (traceId) {
      try {
        const step = await startStep(traceId, 'ghl', 'getCalendarName', {
          hasWebhookCalendarName: !!webhookCalendarName,
          hasCalendarId: !!calendarId
        });
        calendarStepId = step.stepId;
      } catch (e) {
        console.error('Error starting getCalendarName step:', e.message);
      }
    }

    if (webhookCalendarName) {
      // Use calendar name provided directly in webhook
      calendarName = webhookCalendarName;
      calendarSource = 'webhook';
      console.log(`📅 Using calendar name from webhook: "${calendarName}"`);
    } else if (calendarId) {
      // Fallback: fetch from calendar API
      console.log('📅 Fetching calendar name from API (fallback)...');
      const calendar = await getCalendar(calendarId, traceId, calendarStepId || stepId);
      if (calendar) {
        calendarName = calendar.name;
        calendarSource = 'api';
      }
    }

    if (calendarStepId) {
      try {
        await completeStep(calendarStepId, {
          calendarName: calendarName || null,
          source: calendarSource || 'not_found'
        });
      } catch (e) {
        console.error('Error completing getCalendarName step:', e.message);
      }
    }
  }

  // ===== STEP 3: Build Title =====
  let buildTitleStepId = null;
  if (traceId) {
    try {
      const step = await startStep(traceId, 'processing', 'buildTitle', {
        hasMeetingData: !!meetingData,
        hasMeetingType: !!meetingData?.meetingType,
        calendarName: calendarName || null,
        contactName
      });
      buildTitleStepId = step.stepId;
    } catch (e) {
      console.error('Error starting buildTitle step:', e.message);
    }
  }

  let title;
  let usedFallback = false;

  if (meetingData && meetingData.meetingType) {
    // Full format: Calendar Name - Meeting Type - Meeting - Contact Name
    title = buildAppointmentTitle({
      calendarName: calendarName,
      meetingType: meetingData.meetingType,
      meeting: meetingData.meeting,
      contactName: contactName
    });
  } else {
    // Fallback format: Calendar Name - Contact Name
    title = buildAppointmentTitle({
      calendarName: calendarName || 'Appointment',
      contactName: contactName
    });
    usedFallback = true;
    console.log('⚠️ Using fallback title format (form submission not found or missing data)');
  }

  console.log(`🏷️ Final title: "${title}"`);

  if (buildTitleStepId) {
    try {
      await completeStep(buildTitleStepId, {
        title,
        usedFallback,
        format: usedFallback ? 'fallback' : 'full'
      });
    } catch (e) {
      console.error('Error completing buildTitle step:', e.message);
    }
  }

  // ===== STEP 4: Update Appointment Title =====
  let updateTitleStepId = null;
  if (traceId) {
    try {
      const step = await startStep(traceId, 'ghl', 'updateAppointmentTitle', {
        appointmentId,
        title,
        calendarId
      });
      updateTitleStepId = step.stepId;
    } catch (e) {
      console.error('Error starting updateAppointmentTitle step:', e.message);
    }
  }

  const updateResult = await updateAppointmentTitle(appointmentId, title, calendarId, traceId, updateTitleStepId || stepId);

  if (updateTitleStepId) {
    try {
      await completeStep(updateTitleStepId, {
        success: !!updateResult,
        appointmentId
      });
    } catch (e) {
      console.error('Error completing updateAppointmentTitle step:', e.message);
    }
  }

  // ===== STEP 5: Search/Resolve Opportunity =====
  let stageUpdateResult = null;
  let targetStageId = null;
  let resolvedOpportunityId = opportunityId;
  let opportunitySource = opportunityId ? 'webhook' : null;

  // If no opportunityId provided, try to find it by contactId
  if (!resolvedOpportunityId && contactId) {
    let searchOppStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'ghl', 'searchOpportunity', {
          contactId,
          reason: 'No opportunity ID in webhook'
        });
        searchOppStepId = step.stepId;
      } catch (e) {
        console.error('Error starting searchOpportunity step:', e.message);
      }
    }

    console.log(`🔍 No opportunity ID provided, searching by contact ID: ${contactId}`);
    try {
      const locationId = process.env.GHL_LOCATION_ID;
      const opportunities = await searchOpportunitiesByContact(contactId, locationId, traceId, searchOppStepId || stepId);

      if (opportunities && opportunities.length > 0) {
        // Use the first open opportunity, or fall back to the first one
        const openOpportunity = opportunities.find(opp => opp.status === 'open');
        resolvedOpportunityId = openOpportunity?.id || opportunities[0].id;
        opportunitySource = 'search';
        console.log(`✅ Found opportunity: ${resolvedOpportunityId} (from ${opportunities.length} total)`);
      } else {
        console.log('⚠️ No opportunities found for contact');
      }

      if (searchOppStepId) {
        try {
          await completeStep(searchOppStepId, {
            opportunitiesFound: opportunities?.length || 0,
            resolvedOpportunityId: resolvedOpportunityId || null,
            usedOpenOpportunity: !!opportunities?.find(opp => opp.status === 'open')
          });
        } catch (e) {
          console.error('Error completing searchOpportunity step:', e.message);
        }
      }
    } catch (searchError) {
      console.error('❌ Error searching for opportunity:', searchError.message);
      if (searchOppStepId) {
        try {
          await failStep(searchOppStepId, searchError, traceId);
        } catch (e) {
          console.error('Error failing searchOpportunity step:', e.message);
        }
      }
    }
  }

  // ===== STEP 6: Check Stage Mapping =====
  let stageMappingStepId = null;
  if (traceId) {
    try {
      const step = await startStep(traceId, 'processing', 'checkStageMapping', {
        meetingType: meetingData?.meetingType || null,
        hasOpportunity: !!resolvedOpportunityId
      });
      stageMappingStepId = step.stepId;
    } catch (e) {
      console.error('Error starting checkStageMapping step:', e.message);
    }
  }

  let shouldUpdateStage = false;
  let skipReason = null;

  if (resolvedOpportunityId && meetingData?.meetingType) {
    targetStageId = getStageIdForMeetingType(meetingData.meetingType);

    if (targetStageId) {
      shouldUpdateStage = true;
      console.log(`📊 Meeting type "${meetingData.meetingType}" maps to stage ID: ${targetStageId}`);
    } else {
      skipReason = 'no_stage_mapping';
      console.log(`⚠️ No stage mapping found for meeting type: "${meetingData.meetingType}", skipping stage update`);
    }
  } else if (!resolvedOpportunityId) {
    skipReason = 'no_opportunity';
    console.log('⚠️ No opportunity ID found (not provided and not found by contact), skipping stage update');
  } else if (!meetingData?.meetingType) {
    skipReason = 'no_meeting_type';
    console.log('⚠️ No meeting type found, skipping stage update');
  }

  if (stageMappingStepId) {
    try {
      await completeStep(stageMappingStepId, {
        mappingFound: !!targetStageId,
        targetStageId: targetStageId || null,
        shouldUpdateStage,
        skipReason: skipReason || null
      });
    } catch (e) {
      console.error('Error completing checkStageMapping step:', e.message);
    }
  }

  // ===== STEP 7: Update Opportunity Stage =====
  if (shouldUpdateStage) {
    let updateStageStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'ghl', 'updateOpportunityStage', {
          opportunityId: resolvedOpportunityId,
          targetStageId,
          meetingType: meetingData?.meetingType
        });
        updateStageStepId = step.stepId;
      } catch (e) {
        console.error('Error starting updateOpportunityStage step:', e.message);
      }
    }

    stageUpdateResult = await updateOpportunityStage(resolvedOpportunityId, targetStageId, traceId, updateStageStepId || stepId);

    if (updateStageStepId) {
      try {
        await completeStep(updateStageStepId, {
          success: !!stageUpdateResult,
          opportunityId: resolvedOpportunityId,
          newStageId: targetStageId
        });
      } catch (e) {
        console.error('Error completing updateOpportunityStage step:', e.message);
      }
    }
  }

  // ===== STEP 8: Check Email Requirements =====
  let emailCheckStepId = null;
  if (traceId) {
    try {
      const step = await startStep(traceId, 'processing', 'checkEmailRequirements', {
        meetingType: meetingData?.meetingType || null
      });
      emailCheckStepId = step.stepId;
    } catch (e) {
      console.error('Error starting checkEmailRequirements step:', e.message);
    }
  }

  let emailResult = null;
  const requiresConfirmationEmail = meetingData?.meetingType && shouldSendConfirmationEmail(meetingData.meetingType);
  const requiresDiscoveryCallEmail = meetingData?.meetingType && shouldSendDiscoveryCallEmail(meetingData.meetingType);
  const requiresTrustAdminEmail = meetingData?.meetingType && shouldSendTrustAdminEmail(meetingData.meetingType);
  const requiresGeneralDiscoveryCallEmail = meetingData?.meetingType && shouldSendGeneralDiscoveryCallEmail(meetingData.meetingType);
  const requiresDocReviewEmail = meetingData?.meetingType && shouldSendDocReviewEmail(meetingData.meetingType);
  const requiresAnyEmail = requiresConfirmationEmail || requiresDiscoveryCallEmail || requiresTrustAdminEmail || requiresGeneralDiscoveryCallEmail || requiresDocReviewEmail;

  let emailType = null;
  if (requiresConfirmationEmail) emailType = 'confirmation';
  if (requiresDiscoveryCallEmail) emailType = 'probate_discovery_call';
  if (requiresTrustAdminEmail) emailType = 'trust_admin';
  if (requiresGeneralDiscoveryCallEmail) emailType = 'general_discovery_call';
  if (requiresDocReviewEmail) emailType = 'doc_review';

  if (emailCheckStepId) {
    try {
      await completeStep(emailCheckStepId, {
        requiresEmail: requiresAnyEmail,
        emailType: emailType || 'none'
      });
    } catch (e) {
      console.error('Error completing checkEmailRequirements step:', e.message);
    }
  }

  // Variables for contact details used by email/SMS
  let appointmentStartTime = null;
  let appointmentContactId = contactId;
  let recipientEmail = contactEmail;
  let recipientName = contactName;
  let recipientFirstName = null;
  let recipientPhone = contactPhone;

  if (requiresAnyEmail) {
    console.log(`📧 Meeting type "${meetingData.meetingType}" requires ${emailType} email`);

    // ===== STEP 9: Get Appointment Details =====
    let getApptStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'ghl', 'getAppointmentDetails', {
          appointmentId,
          reason: 'Get start time for email'
        });
        getApptStepId = step.stepId;
      } catch (e) {
        console.error('Error starting getAppointmentDetails step:', e.message);
      }
    }

    const appointmentDetails = await getAppointment(appointmentId, traceId, getApptStepId || stepId);
    console.log('📅 Appointment details:', JSON.stringify(appointmentDetails, null, 2));

    // Extract appointment data (may be nested under 'appointment' key)
    const appointment = appointmentDetails?.appointment || appointmentDetails;
    appointmentStartTime = appointment?.startTime || appointment?.start_time;
    appointmentContactId = appointment?.contactId || appointment?.contact_id || contactId;
    console.log(`📅 Appointment start time: ${appointmentStartTime}`);

    if (getApptStepId) {
      try {
        await completeStep(getApptStepId, {
          found: !!appointmentDetails,
          startTime: appointmentStartTime || null,
          contactId: appointmentContactId
        });
      } catch (e) {
        console.error('Error completing getAppointmentDetails step:', e.message);
      }
    }

    // ===== STEP 10: Get Contact Details =====
    let getContactStepId = null;
    if (traceId && appointmentContactId) {
      try {
        const step = await startStep(traceId, 'ghl', 'getContactDetails', {
          contactId: appointmentContactId,
          reason: 'Get email/name for notification'
        });
        getContactStepId = step.stepId;
      } catch (e) {
        console.error('Error starting getContactDetails step:', e.message);
      }
    }

    if (appointmentContactId) {
      try {
        console.log(`👤 Fetching contact details for: ${appointmentContactId}`);
        const contactData = await getContact(appointmentContactId);
        const contact = contactData?.contact || contactData;

        if (contact?.email) {
          recipientEmail = contact.email;
          console.log(`✅ Found contact email: ${recipientEmail}`);
        }
        if (contact?.firstName) {
          recipientFirstName = contact.firstName;
          console.log(`✅ Found contact first name: ${recipientFirstName}`);
        }
        if (contact?.phone) {
          recipientPhone = contact.phone;
          console.log(`✅ Found contact phone: ${recipientPhone}`);
        }
        if (contact?.name || contact?.firstName) {
          recipientName = contact.name || `${contact.firstName} ${contact.lastName || ''}`.trim();
        }

        if (getContactStepId) {
          try {
            await completeStep(getContactStepId, {
              found: true,
              hasEmail: !!recipientEmail,
              hasPhone: !!recipientPhone,
              hasFirstName: !!recipientFirstName
            });
          } catch (e) {
            console.error('Error completing getContactDetails step:', e.message);
          }
        }
      } catch (contactError) {
        console.error('⚠️ Could not fetch contact, using webhook data:', contactError.message);
        if (getContactStepId) {
          try {
            await failStep(getContactStepId, contactError, traceId);
          } catch (e) {
            console.error('Error failing getContactDetails step:', e.message);
          }
        }
      }
    }

    // ===== STEP 11: Send Email =====
    let sendEmailStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'email', 'sendConfirmationEmail', {
          emailType,
          recipientEmail,
          meetingType: meetingData?.meetingType,
          startTime: appointmentStartTime
        });
        sendEmailStepId = step.stepId;
      } catch (e) {
        console.error('Error starting sendConfirmationEmail step:', e.message);
      }
    }

    if (!recipientEmail) {
      console.log('⚠️ No email found for contact, skipping email');
      emailResult = { success: false, reason: 'No email address found' };
    } else if (requiresConfirmationEmail) {
      // Send meeting confirmation email (Initial, Vision, Standalone)
      emailResult = await sendMeetingConfirmationEmail({
        contactEmail: recipientEmail,
        contactName: recipientName,
        contactFirstName: recipientFirstName,
        startTime: appointmentStartTime,
        meetingLocation: meetingData.meeting,
        meetingType: meetingData.meetingType
      });
    } else if (requiresDiscoveryCallEmail) {
      // Send discovery call email (Probate Discovery Call)
      emailResult = await sendProbateDiscoveryCallEmail({
        contactEmail: recipientEmail,
        contactName: recipientName,
        contactFirstName: recipientFirstName,
        contactPhone: recipientPhone,
        startTime: appointmentStartTime,
        meetingType: meetingData.meetingType
      });
    } else if (requiresTrustAdminEmail) {
      // Send trust admin meeting email (Trust Admin Meeting)
      emailResult = await sendTrustAdminMeetingEmail({
        contactEmail: recipientEmail,
        contactName: recipientName,
        contactFirstName: recipientFirstName,
        startTime: appointmentStartTime,
        meetingLocation: meetingData.meeting,
        meetingType: meetingData.meetingType
      });
    } else if (requiresGeneralDiscoveryCallEmail) {
      // Send general discovery call email (EP, Deed Discovery Call)
      emailResult = await sendGeneralDiscoveryCallEmail({
        contactEmail: recipientEmail,
        contactName: recipientName,
        contactFirstName: recipientFirstName,
        contactPhone: recipientPhone,
        startTime: appointmentStartTime,
        meetingType: meetingData.meetingType
      });
    } else if (requiresDocReviewEmail) {
      // Send doc review meeting email (Doc Review Meeting)
      emailResult = await sendDocReviewMeetingEmail({
        contactEmail: recipientEmail,
        contactName: recipientName,
        contactFirstName: recipientFirstName,
        startTime: appointmentStartTime,
        meetingLocation: meetingData.meeting,
        meetingType: meetingData.meetingType
      });
    }

    if (sendEmailStepId) {
      try {
        await completeStep(sendEmailStepId, {
          success: emailResult?.success || false,
          reason: emailResult?.reason || null,
          emailType
        });
      } catch (e) {
        console.error('Error completing sendConfirmationEmail step:', e.message);
      }
    }
  } else if (meetingData?.meetingType) {
    console.log(`📧 Meeting type "${meetingData.meetingType}" does not require confirmation email`);
  }

  // ===== STEP 12: Send SMS Notifications =====
  let smsResult = null;
  let reminderSmsResult = null;

  // Only send SMS if we sent an email (same conditions)
  if (emailResult?.success && appointmentContactId) {
    let sendSmsStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'sms', 'sendConfirmationSms', {
          contactId: appointmentContactId,
          appointmentId,
          startTime: appointmentStartTime
        });
        sendSmsStepId = step.stepId;
      } catch (e) {
        console.error('Error starting sendConfirmationSms step:', e.message);
      }
    }

    console.log('📱 Sending SMS notifications...');

    // Build the event title for SMS
    const smsEventTitle = title || `${meetingData?.meetingType || 'Appointment'} - ${contactName}`;
    const smsLocation = meetingData?.meeting || '[Location]';

    // Send confirmation SMS immediately
    smsResult = await sendConfirmationSms({
      contactId: appointmentContactId,
      eventTitle: smsEventTitle,
      startTime: appointmentStartTime,
      location: smsLocation,
      contactName: recipientName,
      contactPhone: recipientPhone
    });

    // Schedule reminder SMS (24 hours before, within 8am-4pm EST)
    reminderSmsResult = await scheduleReminderSms({
      contactId: appointmentContactId,
      appointmentId: appointmentId,
      eventTitle: smsEventTitle,
      startTime: appointmentStartTime,
      location: smsLocation,
      contactName: recipientName,
      contactPhone: recipientPhone
    });

    if (sendSmsStepId) {
      try {
        await completeStep(sendSmsStepId, {
          confirmationSent: smsResult?.success || false,
          reminderScheduled: reminderSmsResult?.success || false
        });
      } catch (e) {
        console.error('Error completing sendConfirmationSms step:', e.message);
      }
    }
  } else if (!emailResult?.success) {
    console.log('📱 Skipping SMS - email was not sent successfully');
  } else if (!appointmentContactId) {
    console.log('📱 Skipping SMS - no contact ID available');
  }

  // Determine action for outcome tracking
  let action = 'appointment_processed';
  if (emailResult?.success && smsResult?.success) {
    action = 'appointment_processed_with_notifications';
  } else if (emailResult?.success) {
    action = 'appointment_processed_with_email';
  } else if (stageUpdateResult) {
    action = 'appointment_processed_with_stage_update';
  }

  return {
    success: true,
    action,
    appointmentId,
    title,
    usedFallback,
    meetingData,
    stageUpdate: {
      opportunityId: resolvedOpportunityId,
      opportunityIdSource: opportunitySource || 'not_found',
      targetStageId,
      success: !!stageUpdateResult
    },
    emailSent: emailResult,
    smsSent: smsResult,
    reminderSmsScheduled: reminderSmsResult
  };
}

module.exports = {
  getFormSubmission,
  extractMeetingData,
  getCalendar,
  getAppointment,
  updateAppointmentTitle,
  buildAppointmentTitle,
  processAppointmentCreated,
  getStageIdForMeetingType,
  updateOpportunityStage,
  FORM_FIELDS,
  MEETING_TYPE_STAGE_MAP
};
