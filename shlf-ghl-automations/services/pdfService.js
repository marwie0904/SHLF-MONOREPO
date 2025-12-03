const axios = require('axios');
const FormData = require('form-data');
const { startDetail, completeDetail, failDetail } = require('../utils/traceContext');

/**
 * Downloads PDF from JotForm
 * @param {string} submissionId - JotForm submission ID
 * @param {string} formId - JotForm form ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Buffer>} PDF file buffer
 */
async function downloadPdfFromJotForm(submissionId, formId, traceId = null, stepId = null) {
  const jotformApiKey = process.env.JOTFORM_API_KEY;

  if (!jotformApiKey) {
    throw new Error('JOTFORM_API_KEY not configured in environment variables');
  }

  const downloadUrl = `https://www.jotform.com/server.php?action=getSubmissionPDF&sid=${submissionId}&formID=${formId}&apiKey=${jotformApiKey}`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'jotform',
        apiEndpoint: 'https://www.jotform.com/server.php',
        apiMethod: 'GET',
        requestQuery: { action: 'getSubmissionPDF', sid: submissionId, formID: formId }
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    console.log('Downloading PDF from JotForm...');
    console.log('Download URL:', downloadUrl);
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer'
    });

    if (detailId) {
      try { await completeDetail(detailId, { responseStatus: response.status, responseBody: { pdfSize: response.data?.length } }); } catch (e) { console.error('Error completing detail:', e.message); }
    }

    console.log('PDF downloaded successfully from JotForm');
    return Buffer.from(response.data);
  } catch (error) {
    if (detailId) {
      try { await failDetail(detailId, error, traceId); } catch (e) { console.error('Error failing detail:', e.message); }
    }
    console.error('Error downloading PDF from JotForm:', error.response?.status, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Uploads PDF to GHL custom field
 * @param {string} contactId - GHL contact ID
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} fileName - File name for the PDF
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Upload response
 */
async function uploadPdfToGHL(contactId, pdfBuffer, fileName, traceId = null, stepId = null) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const customFieldId = process.env.GHL_PDF_FIELD_ID || 'UvlnLTzwo1TQe2KXDfzW';

  if (!apiKey) {
    throw new Error('GHL_API_KEY not configured in environment variables');
  }

  if (!locationId) {
    throw new Error('GHL_LOCATION_ID not configured in environment variables');
  }

  const uploadUrl = `https://services.leadconnectorhq.com/forms/upload-custom-files?contactId=${contactId}&locationId=${locationId}`;

  // Start detail tracking
  let detailId = null;
  if (traceId && stepId) {
    try {
      const detail = await startDetail(traceId, stepId, {
        detailType: 'api_call',
        apiProvider: 'ghl',
        apiEndpoint: uploadUrl,
        apiMethod: 'POST',
        requestBody: { contactId, fileName, pdfSize: pdfBuffer?.length }
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const timestamp = Date.now();
    const fieldKey = `${customFieldId}_${timestamp}`;

    // Create form data
    const formData = new FormData();
    formData.append(fieldKey, pdfBuffer, {
      filename: fileName,
      contentType: 'application/pdf'
    });

    console.log('Uploading PDF to GHL custom field...');
    const response = await axios.post(uploadUrl, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28'
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    if (detailId) {
      try { await completeDetail(detailId, { responseStatus: response.status, responseBody: { success: true } }); } catch (e) { console.error('Error completing detail:', e.message); }
    }

    console.log('PDF uploaded successfully to GHL');
    return response.data;
  } catch (error) {
    if (detailId) {
      try { await failDetail(detailId, error, traceId); } catch (e) { console.error('Error failing detail:', e.message); }
    }
    console.error('Error uploading PDF to GHL:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Gets contact details including custom fields
 * @param {string} contactId - GHL contact ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Contact data
 */
async function getContactDetails(contactId, traceId = null, stepId = null) {
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
        apiMethod: 'GET',
        requestQuery: { contactId }
      });
      detailId = detail.detailId;
    } catch (e) {
      console.error('Error starting detail:', e.message);
    }
  }

  try {
    const response = await axios.get(
      endpoint,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-07-28'
        }
      }
    );

    if (detailId) {
      try { await completeDetail(detailId, { responseStatus: response.status, responseBody: { contactId } }); } catch (e) { console.error('Error completing detail:', e.message); }
    }

    return response.data;
  } catch (error) {
    if (detailId) {
      try { await failDetail(detailId, error, traceId); } catch (e) { console.error('Error failing detail:', e.message); }
    }
    console.error('Error getting contact details:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Checks if PDF custom field has existing file
 * @param {string} contactId - GHL contact ID
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<boolean>} True if field has file
 */
async function hasExistingPdf(contactId, traceId = null, stepId = null) {
  const customFieldId = process.env.GHL_PDF_FIELD_ID || 'UvlnLTzwo1TQe2KXDfzW';

  try {
    const contactData = await getContactDetails(contactId, traceId, stepId);
    const customFields = contactData.contact?.customFields || [];

    const pdfField = customFields.find(field => field.id === customFieldId);

    if (pdfField && pdfField.value && pdfField.value.trim() !== '') {
      console.log('Existing PDF found in custom field:', pdfField.value);
      return true;
    }

    console.log('No existing PDF in custom field');
    return false;
  } catch (error) {
    console.error('Error checking existing PDF:', error.message);
    return false;
  }
}

/**
 * Main function to handle PDF download and upload
 * @param {string} submissionId - JotForm submission ID
 * @param {string} formId - JotForm form ID
 * @param {string} contactId - GHL contact ID
 * @param {string} contactName - Contact name for file naming
 * @param {string} traceId - Optional trace ID for tracking
 * @param {string} stepId - Optional step ID for tracking
 * @returns {Promise<Object>} Result object
 */
async function handlePdfUpload(submissionId, formId, contactId, contactName, traceId = null, stepId = null) {
  try {
    console.log('Starting PDF upload process...');

    // Check if existing PDF exists
    const hasExisting = await hasExistingPdf(contactId, traceId, stepId);
    if (hasExisting) {
      console.log('Existing PDF detected. Will replace with new PDF.');
    }

    // Download PDF from JotForm
    const pdfBuffer = await downloadPdfFromJotForm(submissionId, formId, traceId, stepId);

    // Generate filename
    const sanitizedName = contactName.replace(/[^a-z0-9]/gi, '_');
    const fileName = `Form_${sanitizedName}.pdf`;

    // Upload to GHL (this will replace existing if present)
    const uploadResult = await uploadPdfToGHL(contactId, pdfBuffer, fileName, traceId, stepId);

    console.log('PDF upload process completed successfully');
    return {
      success: true,
      fileName: fileName,
      hadExisting: hasExisting,
      uploadResult: uploadResult
    };
  } catch (error) {
    console.error('Error in PDF upload process:', error.message);
    throw error;
  }
}

module.exports = {
  downloadPdfFromJotForm,
  uploadPdfToGHL,
  hasExistingPdf,
  handlePdfUpload
};
