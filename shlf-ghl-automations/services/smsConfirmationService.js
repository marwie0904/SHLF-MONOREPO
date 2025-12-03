/**
 * SMS Confirmation Service
 *
 * Handles inbound SMS webhooks from GHL.
 * Detects "Y" or "y" replies as appointment confirmations.
 * Adds "Confirmed [meeting_type]" tag to the contact.
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { startDetail, completeDetail, failDetail } = require('../utils/traceContext');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const BASE_URL = 'https://services.leadconnectorhq.com';

// All meeting types that can be confirmed
const MEETING_TYPES = [
  'EP Discovery Call',
  'Deed Discovery Call',
  'Probate Discovery Call',
  'Trust Admin Meeting',
  'Initial Meeting',
  'Vision Meeting',
  'Doc Review Meeting',
  'Standalone Meeting'
];

// Pre-generated tag names for each meeting type
const CONFIRMATION_TAGS = MEETING_TYPES.map(type => `Confirmed ${type}`);

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
 * Creates a tag in GHL location (if it doesn't exist)
 * @param {string} tagName - The tag name to create
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Tag creation result
 */
async function createTag(tagName, traceId = null, stepId = null) {
  const locationId = process.env.GHL_LOCATION_ID;

  if (!locationId) {
    throw new Error('GHL_LOCATION_ID not configured in environment variables');
  }

  const endpoint = `${BASE_URL}/locations/${locationId}/tags`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'POST',
        requestBody: { name: tagName }
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    console.log(`🏷️ Creating tag: "${tagName}"`);

    const response = await axios.post(
      endpoint,
      { name: tagName },
      { headers: getHeaders() }
    );

    if (detailId) {
      try { await completeDetail(detailId, { responseStatus: response.status, responseBody: { tagName } }); } catch (e) { console.error('Error completing detail:', e.message); }
    }

    console.log(`✅ Tag created: "${tagName}"`);
    return { success: true, tag: response.data };
  } catch (error) {
    // Tag might already exist - that's okay
    if (error.response?.status === 422 || error.response?.data?.message?.includes('already exists')) {
      if (detailId) {
        try { await completeDetail(detailId, { responseStatus: 422, responseBody: { alreadyExists: true } }); } catch (e) { console.error('Error completing detail:', e.message); }
      }
      console.log(`ℹ️ Tag already exists: "${tagName}"`);
      return { success: true, alreadyExists: true };
    }

    if (detailId) {
      try { await failDetail(detailId, error, traceId); } catch (e) { console.error('Error failing detail:', e.message); }
    }

    console.error(`❌ Error creating tag "${tagName}":`, error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Creates all confirmation tags in GHL
 * Run this once to set up the tags
 * @returns {Promise<Object>} Results of tag creation
 */
async function createAllConfirmationTags() {
  console.log('\n========================================');
  console.log('🏷️ Creating Confirmation Tags in GHL');
  console.log('========================================\n');

  const results = {
    created: [],
    alreadyExists: [],
    failed: []
  };

  for (const tagName of CONFIRMATION_TAGS) {
    const result = await createTag(tagName);

    if (result.success) {
      if (result.alreadyExists) {
        results.alreadyExists.push(tagName);
      } else {
        results.created.push(tagName);
      }
    } else {
      results.failed.push({ tagName, error: result.error });
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('\n========================================');
  console.log(`✅ Created: ${results.created.length}`);
  console.log(`ℹ️ Already Existed: ${results.alreadyExists.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  console.log('========================================\n');

  return results;
}

/**
 * Adds a tag to a contact in GHL
 * @param {string} contactId - The GHL contact ID
 * @param {string[]} tags - Array of tag names to add
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Result of adding tags
 */
async function addTagsToContact(contactId, tags, traceId = null, stepId = null) {
  if (!contactId) {
    throw new Error('contactId is required');
  }

  if (!tags || tags.length === 0) {
    throw new Error('At least one tag is required');
  }

  const endpoint = `${BASE_URL}/contacts/${contactId}/tags`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: endpoint,
        apiMethod: 'POST',
        requestBody: { tags }
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    console.log(`🏷️ Adding tags to contact ${contactId}:`, tags);

    const response = await axios.post(
      endpoint,
      { tags: tags },
      { headers: getHeaders() }
    );

    if (detailId) {
      try { await completeDetail(detailId, { responseStatus: response.status, responseBody: { tagsAdded: tags.length } }); } catch (e) { console.error('Error completing detail:', e.message); }
    }

    console.log(`✅ Tags added to contact ${contactId}`);
    return { success: true, data: response.data };
  } catch (error) {
    if (detailId) {
      try { await failDetail(detailId, error, traceId); } catch (e) { console.error('Error failing detail:', e.message); }
    }
    console.error(`❌ Error adding tags to contact ${contactId}:`, error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Gets the most recent pending appointment for a contact from scheduled_sms table
 * @param {string} contactId - The GHL contact ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object|null>} The appointment info or null
 */
async function getPendingAppointmentForContact(contactId, traceId = null, stepId = null) {
  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'db_query',
        apiProvider: 'supabase',
        operationName: 'select_scheduled_sms_pending',
        operationInput: { contactId }
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    // Look for pending or sent reminders (scheduled within the last week, appointment in the future)
    const { data, error } = await supabase
      .from('scheduled_sms')
      .select('*')
      .eq('contact_id', contactId)
      .in('status', ['pending', 'sent'])
      .gte('appointment_time', new Date().toISOString())
      .order('appointment_time', { ascending: true })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      if (detailId) {
        try { await failDetail(detailId, error, traceId); } catch (e) { console.error('Error failing detail:', e.message); }
      }
      console.error('Error fetching pending appointment:', error);
      return null;
    }

    if (detailId) {
      try { await completeDetail(detailId, { operationOutput: { found: !!data, appointmentId: data?.appointment_id } }); } catch (e) { console.error('Error completing detail:', e.message); }
    }

    return data;
  } catch (error) {
    if (detailId) {
      try { await failDetail(detailId, error, traceId); } catch (e) { console.error('Error failing detail:', e.message); }
    }
    console.error('Error fetching pending appointment:', error);
    return null;
  }
}

/**
 * Extracts meeting type from event title
 * The event title format is: "Calendar Name - Meeting Type - Location - Contact Name"
 * @param {string} eventTitle - The event title
 * @returns {string|null} The meeting type or null
 */
function extractMeetingTypeFromTitle(eventTitle) {
  if (!eventTitle) return null;

  // Try to find a matching meeting type in the title
  for (const meetingType of MEETING_TYPES) {
    if (eventTitle.includes(meetingType)) {
      return meetingType;
    }
  }

  return null;
}

/**
 * Checks if the SMS body is a confirmation (Y or y)
 * @param {string} body - The SMS message body
 * @returns {boolean} True if it's a confirmation
 */
function isConfirmationReply(body) {
  if (!body) return false;

  const trimmed = body.trim().toLowerCase();
  return trimmed === 'y' || trimmed === 'yes';
}

/**
 * Processes an inbound SMS message
 * Detects "Y"/"y" replies and adds confirmation tag to contact
 * @param {Object} smsData - The inbound SMS data from GHL webhook
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Processing result
 */
async function processInboundSms(smsData, traceId = null, stepId = null) {
  const {
    type,
    body,
    contactId,
    messageType,
    direction,
    conversationId,
    locationId
  } = smsData;

  console.log('\n========================================');
  console.log('📱 Processing Inbound SMS');
  console.log('========================================');
  console.log('Type:', type);
  console.log('Message Type:', messageType);
  console.log('Direction:', direction);
  console.log('Body:', body);
  console.log('Contact ID:', contactId);
  console.log('Conversation ID:', conversationId);
  console.log('Location ID:', locationId);
  console.log('========================================\n');

  // Validate this is an inbound SMS
  if (type !== 'InboundMessage') {
    console.log('⚠️ Not an InboundMessage, skipping');
    return { success: true, action: 'skipped', reason: 'Not an InboundMessage' };
  }

  if (messageType !== 'SMS') {
    console.log('⚠️ Not an SMS message, skipping');
    return { success: true, action: 'skipped', reason: 'Not an SMS message' };
  }

  if (!contactId) {
    console.log('⚠️ No contact ID in message, skipping');
    return { success: true, action: 'skipped', reason: 'No contact ID' };
  }

  // Check if this is a confirmation reply
  if (!isConfirmationReply(body)) {
    console.log('ℹ️ Not a confirmation reply (Y/y), skipping');
    return { success: true, action: 'skipped', reason: 'Not a confirmation reply' };
  }

  console.log('✅ Detected confirmation reply!');

  // Find the pending appointment for this contact
  const pendingAppointment = await getPendingAppointmentForContact(contactId, traceId, stepId);

  if (!pendingAppointment) {
    console.log('⚠️ No pending appointment found for contact');
    return {
      success: true,
      action: 'skipped',
      reason: 'No pending appointment found for contact'
    };
  }

  console.log('📅 Found pending appointment:', pendingAppointment.event_title);

  // Extract the meeting type from the event title
  const meetingType = extractMeetingTypeFromTitle(pendingAppointment.event_title);

  if (!meetingType) {
    console.log('⚠️ Could not determine meeting type from event title');
    // Still add a generic confirmation tag
    const tagResult = await addTagsToContact(contactId, ['Confirmed Appointment'], traceId, stepId);
    return {
      success: true,
      action: 'tagged',
      tagAdded: 'Confirmed Appointment',
      meetingType: null,
      appointmentId: pendingAppointment.appointment_id,
      tagResult
    };
  }

  // Build the confirmation tag
  const confirmationTag = `Confirmed ${meetingType}`;
  console.log(`🏷️ Adding confirmation tag: "${confirmationTag}"`);

  // Add the tag to the contact
  const tagResult = await addTagsToContact(contactId, [confirmationTag], traceId, stepId);

  // Update the scheduled_sms record to mark as confirmed (optional)
  try {
    await supabase
      .from('scheduled_sms')
      .update({
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', pendingAppointment.id);
  } catch (updateError) {
    console.error('⚠️ Failed to update scheduled_sms record:', updateError);
  }

  return {
    success: true,
    action: 'tagged',
    tagAdded: confirmationTag,
    meetingType: meetingType,
    appointmentId: pendingAppointment.appointment_id,
    eventTitle: pendingAppointment.event_title,
    tagResult
  };
}

module.exports = {
  createTag,
  createAllConfirmationTags,
  addTagsToContact,
  processInboundSms,
  isConfirmationReply,
  extractMeetingTypeFromTitle,
  getPendingAppointmentForContact,
  MEETING_TYPES,
  CONFIRMATION_TAGS
};
