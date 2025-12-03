const axios = require('axios');
const { startDetail, completeDetail, failDetail } = require('../utils/traceContext');

/**
 * Triggers PDF webhook if savePdf flag is true
 * @param {Object} submissionData - JotForm submission data
 * @param {string} ghlContactId - GHL contact ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object|null>} Webhook response or null if not triggered
 */
async function triggerPdfWebhook(submissionData, ghlContactId, traceId = null, stepId = null) {
  const pdfWebhookUrl = process.env.PDF_WEBHOOK_URL;

  // Check if savePdf is true/truthy
  const shouldSavePdf = submissionData.savePdf && submissionData.savePdf.trim() !== '';

  if (!shouldSavePdf) {
    console.log('PDF save not requested, skipping webhook trigger');
    return null;
  }

  if (!pdfWebhookUrl) {
    console.warn('PDF_WEBHOOK_URL not configured, skipping webhook trigger');
    return null;
  }

  const payload = {
    submissionId: submissionData.eventId || submissionData.submitDate,
    contactId: ghlContactId,
    firstName: submissionData.yourFirstName,
    lastName: submissionData.yourLastName,
    formTitle: submissionData.formTitle || 'Personal Information Form',
    submitDate: submissionData.submitDate,
    savePdf: submissionData.savePdf
  };

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'webhook_out',
        apiProvider: 'make',
        apiEndpoint: pdfWebhookUrl,
        apiMethod: 'POST',
        requestBody: { contactId: ghlContactId, submissionId: payload.submissionId }
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.post(pdfWebhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (detailId) {
      try { await completeDetail(detailId, { responseStatus: response.status, responseBody: { success: true } }); } catch (e) { console.error('Error completing detail:', e.message); }
    }

    console.log('PDF webhook triggered successfully:', response.data);
    return response.data;
  } catch (error) {
    if (detailId) {
      try { await failDetail(detailId, error, traceId); } catch (e) { console.error('Error failing detail:', e.message); }
    }
    console.error('Error triggering PDF webhook:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = { triggerPdfWebhook };
