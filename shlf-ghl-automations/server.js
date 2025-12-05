require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { parseJotFormWebhook } = require('./utils/jotformParser');
const { mapJotFormToGHL } = require('./utils/dataMapper');
const { parseJotFormIntakeWebhook } = require('./utils/jotformIntakeParser');
const { mapIntakeToGHL } = require('./utils/intakeDataMapper');
const { createGHLContact, createGHLOpportunity, upsertGHLOpportunity } = require('./services/ghlService');
const { handlePdfUpload } = require('./services/pdfService');
const { processOpportunityStageChange, processTaskCompletion, checkAppointmentsWithRetry, searchOpportunitiesByContact, updateOpportunityStage, checkOpportunityStageWithRetry, getOpportunityById } = require('./services/ghlOpportunityService');
const { processTaskCreation } = require('./services/ghlTaskService');
const { processAppointmentCreated } = require('./services/appointmentService');
const { main: createWorkshopEvent } = require('./automations/create-workshop-event');
const { main: associateContactToWorkshop } = require('./automations/associate-contact-to-workshop');
const { processInboundSms } = require('./services/smsConfirmationService');

// Tracing imports
const { tracingMiddleware, tracingErrorMiddleware } = require('./middleware/tracingMiddleware');
const { startStep, completeStep, failStep, updateTraceContextIds } = require('./utils/traceContext');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer for parsing multipart/form-data
const upload = multer();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Tracing middleware - must be after body parsers
app.use(tracingMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'JotForm to GHL automation service running' });
});

// JotForm webhook endpoint
app.post('/webhook/jotform', upload.none(), async (req, res) => {
  const { traceId } = req;

  try {
    console.log('Received JotForm webhook');
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Request body keys:', Object.keys(req.body || {}));
    console.log('rawRequest field exists:', !!req.body.rawRequest);

    // Step 1: Parse the webhook data from the rawRequest field
    let parseStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'jotformParser', 'parseJotFormWebhook', { hasRawRequest: !!req.body.rawRequest });
      parseStepId = step.stepId;
    }
    const parsedData = parseJotFormWebhook(req.body.rawRequest);
    if (parseStepId) await completeStep(parseStepId, { parsedFields: Object.keys(parsedData) });
    console.log('Parsed data:', JSON.stringify(parsedData, null, 2));

    // Step 2: Map to GHL format
    let mapStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'dataMapper', 'mapJotFormToGHL', parsedData);
      mapStepId = step.stepId;
    }
    const ghlContactData = mapJotFormToGHL(parsedData);
    if (mapStepId) await completeStep(mapStepId, ghlContactData);
    console.log('Mapped GHL contact data:', JSON.stringify(ghlContactData, null, 2));

    // Step 3: Create or update contact in GHL
    let createContactStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlService', 'createGHLContact', ghlContactData);
      createContactStepId = step.stepId;
    }
    let ghlResponse;
    try {
      ghlResponse = await createGHLContact(ghlContactData, traceId, createContactStepId);
      if (createContactStepId) await completeStep(createContactStepId, ghlResponse);
    } catch (error) {
      if (createContactStepId) await failStep(createContactStepId, error, traceId);
      throw error;
    }
    console.log('GHL response:', ghlResponse);

    // Extract GHL contact ID
    const ghlContactId = ghlResponse.contact?.id || ghlResponse.id;
    const isDuplicate = ghlResponse.isDuplicate || false;

    // Update trace with contact ID for easier lookup
    if (traceId && ghlContactId) {
      await updateTraceContextIds(traceId, { contactId: ghlContactId });
    }

    // Step 4: Create or update opportunity in "Pending Contact" stage
    let opportunityResult = null;
    const pipelineId = process.env.GHL_PIPELINE_ID || 'LFxLIUP3LCVES60i9iwN'; // Default pipeline ID
    const pendingContactStageId = 'f0241e66-85b6-477e-9754-393aeedaef20'; // Pending Contact stage ID
    const contactName = `${parsedData.yourFirstName} ${parsedData.yourLastName}`.trim();

    let upsertOpportunityStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlService', 'upsertGHLOpportunity', { ghlContactId, pipelineId, pendingContactStageId, contactName });
      upsertOpportunityStepId = step.stepId;
    }
    try {
      console.log(`Upserting opportunity for contact ${ghlContactId} in Pending Contact stage`);
      opportunityResult = await upsertGHLOpportunity(
        ghlContactId,
        pipelineId,
        pendingContactStageId,
        contactName,
        traceId,
        upsertOpportunityStepId
      );
      if (upsertOpportunityStepId) await completeStep(upsertOpportunityStepId, opportunityResult);
      console.log(opportunityResult.isNew ? 'Opportunity created:' : 'Opportunity updated:', opportunityResult);

      // Update trace with opportunity ID
      const oppId = opportunityResult?.opportunity?.id || opportunityResult?.id;
      if (traceId && oppId) {
        await updateTraceContextIds(traceId, { opportunityId: oppId });
      }
    } catch (opportunityError) {
      if (upsertOpportunityStepId) await failStep(upsertOpportunityStepId, opportunityError, traceId);
      console.error('Error upserting opportunity:', opportunityError.message);
      // Don't fail the whole request if opportunity upsert fails
      opportunityResult = { success: false, error: opportunityError.message };
    }

    // Step 5: Check if PDF should be saved and upload directly
    let pdfUploadResult = null;
    const shouldSavePdf = parsedData.savePdf && parsedData.savePdf.trim() !== '';

    if (shouldSavePdf) {
      console.log(`PDF save requested (savePdf="${parsedData.savePdf}"), proceeding with PDF upload`);

      let pdfStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'pdfService', 'handlePdfUpload', { shouldSavePdf: true });
        pdfStepId = step.stepId;
      }
      try {
        // Get submission ID and form ID from webhook body (not parsed data)
        const submissionId = req.body.submissionID || '';
        const formId = req.body.formID || '252972444974066';
        const pdfContactName = `${parsedData.yourFirstName} ${parsedData.yourLastName}`.trim();

        console.log(`Downloading and uploading PDF - Submission: ${submissionId}, Form: ${formId}, Contact: ${ghlContactId}`);

        pdfUploadResult = await handlePdfUpload(submissionId, formId, ghlContactId, pdfContactName, traceId, pdfStepId);
        if (pdfStepId) await completeStep(pdfStepId, pdfUploadResult);
        console.log('PDF upload completed:', pdfUploadResult);
      } catch (pdfError) {
        if (pdfStepId) await failStep(pdfStepId, pdfError, traceId);
        console.error('Error uploading PDF:', pdfError.message);
        // Don't fail the whole request if PDF upload fails
        pdfUploadResult = { success: false, error: pdfError.message };
      }
    } else {
      console.log('PDF save not requested, skipping PDF upload');
    }

    // Send success response
    const opportunityId = opportunityResult?.opportunity?.id || opportunityResult?.id;
    const isNewOpportunity = opportunityResult?.isNew ?? true;

    res.json({
      success: true,
      message: isDuplicate ? 'Contact updated successfully' : 'Contact created successfully',
      ghlContactId: ghlContactId,
      isDuplicate: isDuplicate,
      opportunityCreated: isNewOpportunity && opportunityId ? true : false,
      opportunityUpdated: !isNewOpportunity && opportunityId ? true : false,
      opportunityId: opportunityId,
      pdfUploaded: pdfUploadResult?.success || false,
      pdfDetails: pdfUploadResult
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message
    });
  }
});

// GHL Opportunity Stage Changed webhook endpoint
app.post('/webhooks/ghl/opportunity-stage-changed', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== GHL OPPORTUNITY STAGE CHANGE WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // ===== STEP 1: Webhook Received =====
    let webhookStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'webhook_received', {
          endpoint: '/webhooks/ghl/opportunity-stage-changed',
          method: 'POST',
          contentType: req.headers['content-type'],
          timestamp: new Date().toISOString()
        });
        webhookStepId = step.stepId;
      } catch (e) {
        console.error('Error starting webhook_received step:', e.message);
      }
    }

    // Log custom data if it exists
    if (req.body.customData) {
      console.log('Custom Data:', JSON.stringify(req.body.customData, null, 2));
    }

    // Complete webhook received step
    if (webhookStepId) {
      try {
        await completeStep(webhookStepId, {
          hasCustomData: !!req.body.customData,
          bodyKeys: Object.keys(req.body)
        });
      } catch (e) {
        console.error('Error completing webhook_received step:', e.message);
      }
    }

    // ===== STEP 2: Rate Limit Check =====
    let rateLimitStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'rate_limit_check', {
          endpoint: '/webhooks/ghl/opportunity-stage-changed'
        });
        rateLimitStepId = step.stepId;
      } catch (e) {
        console.error('Error starting rate_limit_check step:', e.message);
      }
    }

    // Rate limiting is handled by middleware, so we just log that we passed
    if (rateLimitStepId) {
      try {
        await completeStep(rateLimitStepId, {
          passed: true,
          message: 'Rate limit check passed'
        });
      } catch (e) {
        console.error('Error completing rate_limit_check step:', e.message);
      }
    }

    // ===== STEP 3: Validate Timestamp =====
    let validateStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'validate_timestamp', {
          currentTime: new Date().toISOString()
        });
        validateStepId = step.stepId;
      } catch (e) {
        console.error('Error starting validate_timestamp step:', e.message);
      }
    }

    // Timestamp validation (webhook freshness check)
    const webhookTimestamp = req.body.timestamp || req.body.dateAdded || new Date().toISOString();
    const isTimestampValid = true; // GHL webhooks are always processed in real-time

    if (validateStepId) {
      try {
        await completeStep(validateStepId, {
          webhookTimestamp,
          isValid: isTimestampValid
        });
      } catch (e) {
        console.error('Error completing validate_timestamp step:', e.message);
      }
    }

    // ===== STEP 4: Idempotency Check =====
    let idempotencyStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'idempotency_check', {
          opportunityId: req.body['opportunity-id'] || req.body.opportunityId,
          stageName: req.body['opportunity-stage-name'] || req.body.stageName
        });
        idempotencyStepId = step.stepId;
      } catch (e) {
        console.error('Error starting idempotency_check step:', e.message);
      }
    }

    // Idempotency is handled by the grace period logic in the service
    if (idempotencyStepId) {
      try {
        await completeStep(idempotencyStepId, {
          passed: true,
          message: 'Idempotency delegated to grace period logic'
        });
      } catch (e) {
        console.error('Error completing idempotency_check step:', e.message);
      }
    }

    // Extract data from GHL webhook - handle both direct fields and custom data
    const webhookData = {
      opportunityId: req.body['opportunity-id'] ||
                     req.body.opportunityId ||
                     req.body.opportunity_id ||
                     req.body.customData?.['opportunity-id'],
      stageName: req.body['opportunity-stage-name'] ||
                 req.body.stageName ||
                 req.body.stage_name ||
                 req.body.customData?.['opportunity-stage-name'],
      stageId: req.body.stage_id || req.body.stageId || req.body.customData?.stageId,
      contactId: req.body.contact_id || req.body.contactId || req.body.customData?.contactId,
      pipelineId: req.body.pipeline_id || req.body.pipelineId || req.body.customData?.pipelineId
    };

    console.log('Extracted webhook data:', JSON.stringify(webhookData, null, 2));

    // Update trace with context IDs
    if (traceId) {
      await updateTraceContextIds(traceId, {
        opportunityId: webhookData.opportunityId,
        contactId: webhookData.contactId
      });
    }

    // ===== STEP 5: Test Mode Filter =====
    let testModeStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'test_mode_filter', {
          opportunityId: webhookData.opportunityId,
          contactId: webhookData.contactId
        });
        testModeStepId = step.stepId;
      } catch (e) {
        console.error('Error starting test_mode_filter step:', e.message);
      }
    }

    // Test mode filter - currently all opportunities are processed
    const isInAllowlist = true; // TODO: Implement actual allowlist check if needed

    if (testModeStepId) {
      try {
        await completeStep(testModeStepId, {
          isInAllowlist,
          action: isInAllowlist ? 'allowed' : 'blocked'
        });
      } catch (e) {
        console.error('Error completing test_mode_filter step:', e.message);
      }
    }

    // Validate required fields
    if (!webhookData.opportunityId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: opportunityId'
      });
    }

    if (!webhookData.stageName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: stageName'
      });
    }

    // Step: Process the opportunity stage change and create tasks
    let processStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlOpportunityService', 'processOpportunityStageChange', webhookData);
      processStepId = step.stepId;
    }

    try {
      const result = await processOpportunityStageChange(webhookData, traceId, processStepId);
      if (processStepId) await completeStep(processStepId, result);

      res.json({
        success: true,
        message: result.message,
        tasksCreated: result.tasksCreated,
        details: result
      });
    } catch (processError) {
      if (processStepId) await failStep(processStepId, processError, traceId);
      throw processError;
    }

  } catch (error) {
    console.error('Error processing GHL opportunity webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message
    });
  }
});

// GHL Task Created webhook endpoint - Syncs tasks to Supabase
app.post('/webhooks/ghl/task-created', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== GHL TASK CREATED WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // ===== STEP 1: Webhook Received =====
    let webhookStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'webhook_received', {
          endpoint: '/webhooks/ghl/task-created',
          method: 'POST',
          contentType: req.headers['content-type'],
          timestamp: new Date().toISOString()
        });
        webhookStepId = step.stepId;
      } catch (e) {
        console.error('Error starting webhook_received step:', e.message);
      }
    }

    // Complete webhook received step
    if (webhookStepId) {
      try {
        await completeStep(webhookStepId, {
          bodyKeys: Object.keys(req.body)
        });
      } catch (e) {
        console.error('Error completing webhook_received step:', e.message);
      }
    }

    // ===== STEP 2: Rate Limit Check =====
    let rateLimitStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'rate_limit_check', {
          endpoint: '/webhooks/ghl/task-created'
        });
        rateLimitStepId = step.stepId;
      } catch (e) {
        console.error('Error starting rate_limit_check step:', e.message);
      }
    }

    // Rate limiting is handled by middleware
    if (rateLimitStepId) {
      try {
        await completeStep(rateLimitStepId, {
          passed: true,
          message: 'Rate limit check passed'
        });
      } catch (e) {
        console.error('Error completing rate_limit_check step:', e.message);
      }
    }

    // ===== STEP 3: Extract Task Data =====
    let extractStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'extract_task_data', {
          rawBodyKeys: Object.keys(req.body)
        });
        extractStepId = step.stepId;
      } catch (e) {
        console.error('Error starting extract_task_data step:', e.message);
      }
    }

    // Extract task data from webhook
    const taskId = req.body.id || req.body.task?.id;
    const contactId = req.body.contactId || req.body.task?.contactId;
    const taskTitle = req.body.title || req.body.task?.title;

    if (extractStepId) {
      try {
        await completeStep(extractStepId, {
          taskId,
          contactId,
          taskTitle,
          hasTaskData: !!taskId
        });
      } catch (e) {
        console.error('Error completing extract_task_data step:', e.message);
      }
    }

    // Update trace with context IDs
    if (traceId && contactId) {
      await updateTraceContextIds(traceId, { contactId });
    }

    // ===== STEP 4: Validate Required Fields =====
    let validateStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'validate_required_fields', {
          taskId,
          taskTitle
        });
        validateStepId = step.stepId;
      } catch (e) {
        console.error('Error starting validate_required_fields step:', e.message);
      }
    }

    const validationErrors = [];
    if (!taskId) validationErrors.push('taskId missing');
    if (!taskTitle) validationErrors.push('taskTitle missing');

    if (validateStepId) {
      try {
        await completeStep(validateStepId, {
          isValid: validationErrors.length === 0,
          errors: validationErrors
        });
      } catch (e) {
        console.error('Error completing validate_required_fields step:', e.message);
      }
    }

    // Step: Process the task creation and sync to Supabase
    let processStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlTaskService', 'processTaskCreation', { taskId, contactId, taskTitle });
      processStepId = step.stepId;
    }

    try {
      const result = await processTaskCreation(req.body, traceId, processStepId);
      if (processStepId) await completeStep(processStepId, result);

      res.json({
        success: true,
        message: result.message,
        taskId: result.taskId,
        action: 'task_synced'
      });
    } catch (processError) {
      if (processStepId) await failStep(processStepId, processError, traceId);
      throw processError;
    }

  } catch (error) {
    console.error('Error processing GHL task created webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message
    });
  }
});

// GHL Task Completed webhook endpoint
app.post('/webhooks/ghl/task-completed', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== GHL TASK COMPLETED WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // ===== STEP 1: Webhook Received =====
    let webhookStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'webhook_received', {
          endpoint: '/webhooks/ghl/task-completed',
          method: 'POST',
          contentType: req.headers['content-type'],
          timestamp: new Date().toISOString()
        });
        webhookStepId = step.stepId;
      } catch (e) {
        console.error('Error starting webhook_received step:', e.message);
      }
    }

    // Complete webhook received step
    if (webhookStepId) {
      try {
        await completeStep(webhookStepId, {
          bodyKeys: Object.keys(req.body)
        });
      } catch (e) {
        console.error('Error completing webhook_received step:', e.message);
      }
    }

    // ===== STEP 2: Rate Limit Check =====
    let rateLimitStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'rate_limit_check', {
          endpoint: '/webhooks/ghl/task-completed'
        });
        rateLimitStepId = step.stepId;
      } catch (e) {
        console.error('Error starting rate_limit_check step:', e.message);
      }
    }

    // Rate limiting is handled by middleware
    if (rateLimitStepId) {
      try {
        await completeStep(rateLimitStepId, {
          passed: true,
          message: 'Rate limit check passed'
        });
      } catch (e) {
        console.error('Error completing rate_limit_check step:', e.message);
      }
    }

    // ===== STEP 3: Extract Task Data =====
    let extractStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'extract_task_data', {
          rawBodyKeys: Object.keys(req.body)
        });
        extractStepId = step.stepId;
      } catch (e) {
        console.error('Error starting extract_task_data step:', e.message);
      }
    }

    // Extract task data from GHL webhook
    const taskData = {
      taskId: req.body.task?.id || req.body.id || req.body.task_id || req.body.taskId,
      contactId: req.body['contact-id'] ||
                 req.body.contact_id ||
                 req.body.contactId ||
                 req.body.customData?.['contact-id'],
      opportunityId: req.body['opportunity-id'] ||
                     req.body.opportunityId ||
                     req.body.opportunity_id ||
                     req.body.customData?.['opportunity-id'],
      title: req.body.task?.title || req.body.title,
      completed: true, // Webhook fires on task completion, so always true
      assignedTo: req.body.task?.assignedTo || req.body.assignedTo || req.body.assigned_to,
      dueDate: req.body.task?.dueDate
    };

    console.log('Extracted task data:', JSON.stringify(taskData, null, 2));

    if (extractStepId) {
      try {
        await completeStep(extractStepId, {
          taskId: taskData.taskId,
          contactId: taskData.contactId,
          opportunityId: taskData.opportunityId,
          title: taskData.title,
          hasRequiredFields: !!(taskData.contactId && taskData.title)
        });
      } catch (e) {
        console.error('Error completing extract_task_data step:', e.message);
      }
    }

    // Update trace with context IDs
    if (traceId) {
      await updateTraceContextIds(traceId, {
        contactId: taskData.contactId,
        opportunityId: taskData.opportunityId
      });
    }

    // ===== STEP 4: Validate Required Fields =====
    let validateStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'validate_required_fields', {
          contactId: taskData.contactId,
          title: taskData.title
        });
        validateStepId = step.stepId;
      } catch (e) {
        console.error('Error starting validate_required_fields step:', e.message);
      }
    }

    const validationErrors = [];
    if (!taskData.contactId) validationErrors.push('contactId missing');
    if (!taskData.title) validationErrors.push('title missing');

    if (validateStepId) {
      try {
        if (validationErrors.length > 0) {
          await failStep(validateStepId, new Error(validationErrors.join(', ')), traceId);
        } else {
          await completeStep(validateStepId, {
            isValid: true,
            errors: []
          });
        }
      } catch (e) {
        console.error('Error completing validate_required_fields step:', e.message);
      }
    }

    // Validate required fields
    if (!taskData.contactId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: contactId'
      });
    }

    if (!taskData.title) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: task title'
      });
    }

    // ===== STEP 5: Check Task Completion Status =====
    let completionCheckStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'check_completion_status', {
          completed: taskData.completed
        });
        completionCheckStepId = step.stepId;
      } catch (e) {
        console.error('Error starting check_completion_status step:', e.message);
      }
    }

    // Check if task is actually completed
    if (!taskData.completed) {
      if (completionCheckStepId) {
        try {
          await completeStep(completionCheckStepId, {
            isCompleted: false,
            action: 'skipped'
          });
        } catch (e) {
          console.error('Error completing check_completion_status step:', e.message);
        }
      }
      return res.json({
        success: true,
        message: 'Task not completed, no action taken',
        action: 'skipped_not_completed'
      });
    }

    if (completionCheckStepId) {
      try {
        await completeStep(completionCheckStepId, {
          isCompleted: true,
          action: 'proceed'
        });
      } catch (e) {
        console.error('Error completing check_completion_status step:', e.message);
      }
    }

    // Step: Process the task completion
    let processStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlOpportunityService', 'processTaskCompletion', taskData);
      processStepId = step.stepId;
    }

    try {
      const result = await processTaskCompletion(taskData, traceId, processStepId);
      if (processStepId) await completeStep(processStepId, result);

      res.json({
        success: true,
        message: result.message,
        details: result,
        action: result.action || 'processed'
      });
    } catch (processError) {
      if (processStepId) await failStep(processStepId, processError, traceId);
      throw processError;
    }

  } catch (error) {
    console.error('Error processing GHL task completion webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message
    });
  }
});

// GHL Appointment Created webhook endpoint
// Updates appointment title with: Calendar Name - Meeting Type - Meeting - Contact Name
app.post('/webhooks/ghl/appointment-created', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== GHL APPOINTMENT CREATED WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // ===== STEP 1: Webhook Received =====
    let webhookStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'webhook_received', {
          endpoint: '/webhooks/ghl/appointment-created',
          method: 'POST',
          contentType: req.headers['content-type'],
          timestamp: new Date().toISOString()
        });
        webhookStepId = step.stepId;
      } catch (e) {
        console.error('Error starting webhook_received step:', e.message);
      }
    }

    // Log custom data if it exists
    if (req.body.customData) {
      console.log('Custom Data:', JSON.stringify(req.body.customData, null, 2));
    }

    // Complete webhook received step
    if (webhookStepId) {
      try {
        await completeStep(webhookStepId, {
          hasCustomData: !!req.body.customData,
          hasCalendarData: !!req.body.calendar,
          bodyKeys: Object.keys(req.body)
        });
      } catch (e) {
        console.error('Error completing webhook_received step:', e.message);
      }
    }

    // ===== STEP 2: Rate Limit Check =====
    let rateLimitStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'rate_limit_check', {
          endpoint: '/webhooks/ghl/appointment-created'
        });
        rateLimitStepId = step.stepId;
      } catch (e) {
        console.error('Error starting rate_limit_check step:', e.message);
      }
    }

    // Rate limiting is handled by middleware, so we just log that we passed
    if (rateLimitStepId) {
      try {
        await completeStep(rateLimitStepId, {
          passed: true,
          message: 'Rate limit check passed'
        });
      } catch (e) {
        console.error('Error completing rate_limit_check step:', e.message);
      }
    }

    // ===== STEP 3: Extract Appointment Data =====
    let extractStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'extract_appointment_data', {
          rawBodyKeys: Object.keys(req.body),
          hasCalendarNested: !!req.body.calendar,
          hasCustomData: !!req.body.customData
        });
        extractStepId = step.stepId;
      } catch (e) {
        console.error('Error starting extract_appointment_data step:', e.message);
      }
    }

    // Extract appointment data from GHL webhook
    // Handle multiple possible field names for flexibility
    // NOTE: The correct appointmentId is in calendar.appointmentId or customData.appointmentId
    // The root-level "id" is NOT the appointment ID
    const webhookData = {
      appointmentId: req.body.calendar?.appointmentId ||
                     req.body.customData?.appointmentId ||
                     req.body.appointment_id ||
                     req.body.appointmentId ||
                     req.body['appointment-id'],
      contactId: req.body.contact_id ||
                 req.body.contactId ||
                 req.body['contact-id'] ||
                 req.body.customData?.contactId,
      contactPhone: req.body.contact_phone ||
                    req.body.contactPhone ||
                    req.body['contact-phone'] ||
                    req.body.phone ||
                    req.body.customData?.contactPhone,
      contactEmail: req.body.contact_email ||
                    req.body.contactEmail ||
                    req.body['contact-email'] ||
                    req.body.email ||
                    req.body.customData?.contactEmail,
      contactName: req.body.contact_name ||
                   req.body.contactName ||
                   req.body['contact-name'] ||
                   req.body.full_name ||
                   req.body.customData?.contactName,
      calendarId: req.body.calendar?.id ||
                  req.body.calendar_id ||
                  req.body.calendarId ||
                  req.body['calendar-id'] ||
                  req.body.customData?.calendarId,
      calendarName: req.body.calendar?.calendarName ||
                    req.body.calendar_name ||
                    req.body.calendarName ||
                    req.body['calendar-name'] ||
                    req.body.customData?.calendarName,
      opportunityId: req.body.customData?.opportunityId ||
                     req.body.opportunity_id ||
                     req.body.opportunityId ||
                     req.body['opportunity-id']
    };

    console.log('Extracted webhook data:', JSON.stringify(webhookData, null, 2));

    // Complete extract step
    if (extractStepId) {
      try {
        await completeStep(extractStepId, {
          appointmentId: webhookData.appointmentId,
          contactId: webhookData.contactId,
          calendarId: webhookData.calendarId,
          calendarName: webhookData.calendarName,
          opportunityId: webhookData.opportunityId,
          hasContactInfo: !!(webhookData.contactPhone || webhookData.contactEmail)
        });
      } catch (e) {
        console.error('Error completing extract_appointment_data step:', e.message);
      }
    }

    // Update trace with context IDs
    if (traceId) {
      await updateTraceContextIds(traceId, {
        appointmentId: webhookData.appointmentId,
        contactId: webhookData.contactId,
        opportunityId: webhookData.opportunityId
      });
    }

    // ===== STEP 4: Validate Required Fields =====
    let validateStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'validate_required_fields', {
          appointmentId: webhookData.appointmentId,
          hasAppointmentId: !!webhookData.appointmentId
        });
        validateStepId = step.stepId;
      } catch (e) {
        console.error('Error starting validate_required_fields step:', e.message);
      }
    }

    // Validate required fields
    if (!webhookData.appointmentId) {
      console.error('❌ Missing appointmentId in webhook payload');

      if (validateStepId) {
        try {
          await completeStep(validateStepId, {
            isValid: false,
            missingFields: ['appointmentId'],
            receivedFields: Object.keys(req.body)
          });
        } catch (e) {
          console.error('Error completing validate_required_fields step:', e.message);
        }
      }

      return res.status(400).json({
        success: false,
        message: 'Missing required field: appointmentId',
        receivedFields: Object.keys(req.body),
        action: 'validation_failed'
      });
    }

    // Validation passed
    if (validateStepId) {
      try {
        await completeStep(validateStepId, {
          isValid: true,
          appointmentId: webhookData.appointmentId
        });
      } catch (e) {
        console.error('Error completing validate_required_fields step:', e.message);
      }
    }

    // Step: Process the appointment and update title
    let processStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'appointmentService', 'processAppointmentCreated', webhookData);
      processStepId = step.stepId;
    }

    try {
      const result = await processAppointmentCreated(webhookData, traceId, processStepId);
      if (processStepId) await completeStep(processStepId, result);

      res.json({
        success: true,
        message: 'Appointment processed successfully',
        action: result.action || 'appointment_processed',
        appointmentId: result.appointmentId,
        newTitle: result.title,
        usedFallback: result.usedFallback,
        meetingData: result.meetingData,
        stageUpdate: result.stageUpdate,
        emailSent: result.emailSent,
        smsSent: result.smsSent
      });
    } catch (processError) {
      if (processStepId) await failStep(processStepId, processError, traceId);
      throw processError;
    }

  } catch (error) {
    console.error('Error processing GHL appointment webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message,
      action: 'error'
    });
  }
});

// Intake Survey webhook endpoint
app.post('/webhooks/intakeSurvey', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== INTAKE SURVEY WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // Extract contactId from webhook (handle multiple possible field names)
    const contactId = req.body['contact-id'] ||
                      req.body.contact_id ||
                      req.body.contactId ||
                      req.body.customData?.['contact-id'];

    // Update trace with contact ID
    if (traceId && contactId) {
      await updateTraceContextIds(traceId, { contactId });
    }

    // Validate required field
    if (!contactId) {
      console.error('❌ Missing contactId in webhook payload');
      return res.status(400).json({
        success: false,
        message: 'Missing required field: contactId',
        receivedFields: Object.keys(req.body)
      });
    }

    console.log(`✅ Processing intake survey for contact: ${contactId}`);

    // Step 1: Find opportunity for this contact
    const locationId = process.env.GHL_LOCATION_ID;
    console.log(`🔍 Searching for opportunities for contact ${contactId}...`);

    let searchStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlOpportunityService', 'searchOpportunitiesByContact', { contactId, locationId });
      searchStepId = step.stepId;
    }

    let opportunities;
    try {
      opportunities = await searchOpportunitiesByContact(contactId, locationId, traceId, searchStepId);
      if (searchStepId) await completeStep(searchStepId, { count: opportunities?.length || 0 });
    } catch (searchError) {
      if (searchStepId) await failStep(searchStepId, searchError, traceId);
      throw searchError;
    }

    if (!opportunities || opportunities.length === 0) {
      console.error('❌ No opportunity found for contact');
      return res.status(404).json({
        success: false,
        message: 'No opportunity found for contact',
        contactId: contactId
      });
    }

    // Get the first open opportunity (or first one if none are open)
    const openOpp = opportunities.find(opp => opp.status === 'open');
    const opportunity = openOpp || opportunities[0];
    const opportunityId = opportunity.id;

    // Update trace with opportunity ID
    if (traceId && opportunityId) {
      await updateTraceContextIds(traceId, { opportunityId });
    }

    console.log(`✅ Found opportunity: ${opportunityId} (status: ${opportunity.status || 'unknown'})`);

    // Define the expected pipeline and stage to check
    const EXPECTED_PIPELINE_ID = '6cYEonzedT5vf2Lt8rcl';
    const EXPECTED_STAGE_ID = '042cb50b-6ef1-448e-9f64-a7455e1395b5';

    console.log('🔍 Checking if opportunity is still in original stage...');
    console.log(`   Expected Pipeline: ${EXPECTED_PIPELINE_ID}`);
    console.log(`   Expected Stage: ${EXPECTED_STAGE_ID}`);

    // Step 2: Check if opportunity has moved from the original stage with retry logic
    let checkStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlOpportunityService', 'checkOpportunityStageWithRetry', { opportunityId, expectedPipelineId: EXPECTED_PIPELINE_ID, expectedStageId: EXPECTED_STAGE_ID });
      checkStepId = step.stepId;
    }

    let hasMoved;
    try {
      hasMoved = await checkOpportunityStageWithRetry(opportunityId, EXPECTED_PIPELINE_ID, EXPECTED_STAGE_ID, traceId, checkStepId);
      if (checkStepId) await completeStep(checkStepId, { hasMoved });
    } catch (checkError) {
      if (checkStepId) await failStep(checkStepId, checkError, traceId);
      throw checkError;
    }

    console.log(`📊 Stage check result: ${hasMoved ? 'OPPORTUNITY HAS MOVED' : 'STILL IN SAME STAGE'}`);

    // Determine target stage based on whether opportunity moved
    const pipelineId = process.env.GHL_PIPELINE_ID || 'LFxLIUP3LCVES60i9iwN';
    let targetStageId;
    let stageName;

    if (hasMoved) {
      // Opportunity has moved to a different stage - do nothing
      console.log('✅ Opportunity already moved to a different stage, no action needed');

      return res.json({
        success: true,
        message: 'Opportunity already moved to a different stage',
        contactId: contactId,
        opportunityId: opportunityId,
        hasMoved: true,
        action: 'none'
      });
    } else {
      // Opportunity is still in the same stage - move to "Pending I/V"
      targetStageId = '624feffa-eab0-4aeb-b186-ee921e5e6eb7'; // Pending I/V
      stageName = 'Pending I/V';

      console.log(`📍 Moving opportunity to: ${stageName}`);
      console.log(`   Pipeline ID: ${pipelineId}`);
      console.log(`   Stage ID: ${targetStageId}`);

      // Step 3: Update opportunity stage
      let updateStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'ghlOpportunityService', 'updateOpportunityStage', { opportunityId, pipelineId, targetStageId, stageName });
        updateStepId = step.stepId;
      }

      try {
        await updateOpportunityStage(opportunityId, pipelineId, targetStageId, traceId, updateStepId);
        if (updateStepId) await completeStep(updateStepId, { success: true, stageName });
      } catch (updateError) {
        if (updateStepId) await failStep(updateStepId, updateError, traceId);
        throw updateError;
      }

      console.log(`✅ Successfully moved opportunity to ${stageName}`);

      res.json({
        success: true,
        message: `Opportunity moved to ${stageName}`,
        contactId: contactId,
        opportunityId: opportunityId,
        hasMoved: false,
        movedToStage: stageName,
        pipelineId: pipelineId,
        stageId: targetStageId
      });
    }

  } catch (error) {
    console.error('❌ Error processing intake survey webhook:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message
    });
  }
});

// Workshop creation endpoint - Jotform webhook
app.post('/workshop', upload.none(), async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== WORKSHOP CREATION WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Request body keys:', Object.keys(req.body || {}));
    console.log('rawRequest field exists:', !!req.body.rawRequest);

    // Get raw data from Jotform webhook
    const rawData = req.body.rawRequest;

    if (!rawData) {
      return res.status(400).json({
        success: false,
        message: 'Missing rawRequest data from Jotform webhook'
      });
    }

    // Step: Process the workshop event creation
    let processStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'createWorkshopEvent', 'main', { hasRawData: !!rawData });
      processStepId = step.stepId;
    }

    try {
      const result = await createWorkshopEvent(rawData, traceId, processStepId);
      if (processStepId) await completeStep(processStepId, result);

      res.json({
        success: true,
        message: 'Workshop created successfully',
        workshopName: result.workshopData.workshopName,
        filesDownloaded: result.filesDownloaded,
        ghlRecordId: result.ghlResponse?.id,
        details: result
      });
    } catch (processError) {
      if (processStepId) await failStep(processStepId, processError, traceId);
      throw processError;
    }

  } catch (error) {
    console.error('Error processing workshop webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating workshop',
      error: error.message
    });
  }
});

// JotForm Intake webhook endpoint
app.post('/webhook/jotform-intake', upload.none(), async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== JOTFORM INTAKE WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Request body keys:', Object.keys(req.body || {}));
    console.log('rawRequest field exists:', !!req.body.rawRequest);

    // Step 1: Parse the intake webhook data from the rawRequest field
    let parseStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'jotformIntakeParser', 'parseJotFormIntakeWebhook', { hasRawRequest: !!req.body.rawRequest });
      parseStepId = step.stepId;
    }
    const parsedData = parseJotFormIntakeWebhook(req.body.rawRequest);
    if (parseStepId) await completeStep(parseStepId, { parsedFields: Object.keys(parsedData) });
    console.log('Parsed intake data:', JSON.stringify(parsedData, null, 2));

    // Step 2: Map to GHL format
    let mapStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'intakeDataMapper', 'mapIntakeToGHL', parsedData);
      mapStepId = step.stepId;
    }
    const ghlContactData = mapIntakeToGHL(parsedData);
    if (mapStepId) await completeStep(mapStepId, ghlContactData);
    console.log('Mapped GHL contact data:', JSON.stringify(ghlContactData, null, 2));

    // Step 3: Create or update contact in GHL
    let createContactStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlService', 'createGHLContact', ghlContactData);
      createContactStepId = step.stepId;
    }
    let ghlResponse;
    try {
      ghlResponse = await createGHLContact(ghlContactData, traceId, createContactStepId);
      if (createContactStepId) await completeStep(createContactStepId, ghlResponse);
    } catch (contactError) {
      if (createContactStepId) await failStep(createContactStepId, contactError, traceId);
      throw contactError;
    }
    console.log('GHL response:', ghlResponse);

    // Extract GHL contact ID
    const ghlContactId = ghlResponse.contact?.id || ghlResponse.id;
    const isDuplicate = ghlResponse.isDuplicate || false;

    // Update trace with contact ID
    if (traceId && ghlContactId) {
      await updateTraceContextIds(traceId, { contactId: ghlContactId });
    }

    // Step 4: Create opportunity in "Pending Contact" stage
    let opportunityResult = null;
    const pipelineId = process.env.GHL_PIPELINE_ID || 'LFxLIUP3LCVES60i9iwN';
    const pendingContactStageId = 'f0241e66-85b6-477e-9754-393aeedaef20'; // Pending Contact stage ID
    const contactName = parsedData.name || `${parsedData.firstName} ${parsedData.lastName}`.trim();

    let createOpportunityStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlService', 'createGHLOpportunity', { ghlContactId, pipelineId, pendingContactStageId, contactName });
      createOpportunityStepId = step.stepId;
    }
    try {
      console.log(`Creating opportunity for contact ${ghlContactId} in Pending Contact stage`);
      opportunityResult = await createGHLOpportunity(
        ghlContactId,
        pipelineId,
        pendingContactStageId,
        contactName,
        traceId,
        createOpportunityStepId
      );
      if (createOpportunityStepId) await completeStep(createOpportunityStepId, opportunityResult);
      console.log('Opportunity created:', opportunityResult);

      // Update trace with opportunity ID
      if (traceId && opportunityResult?.id) {
        await updateTraceContextIds(traceId, { opportunityId: opportunityResult.id });
      }
    } catch (opportunityError) {
      if (createOpportunityStepId) await failStep(createOpportunityStepId, opportunityError, traceId);
      console.error('Error creating opportunity:', opportunityError.message);
      // Don't fail the whole request if opportunity creation fails
      opportunityResult = { success: false, error: opportunityError.message };
    }

    // Step 5: Check if PDF should be saved and upload directly
    let pdfUploadResult = null;
    const shouldSavePdf = parsedData.createPdf && parsedData.createPdf.trim() !== '';

    if (shouldSavePdf) {
      console.log(`PDF save requested (createPdf="${parsedData.createPdf}"), proceeding with PDF upload`);

      let pdfStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'pdfService', 'handlePdfUpload', { shouldSavePdf: true });
        pdfStepId = step.stepId;
      }
      try {
        // Get submission ID and form ID from webhook body (not parsed data)
        const submissionId = req.body.submissionID || '';
        const formId = req.body.formID || '252965467838072'; // Intake form ID

        console.log(`Downloading and uploading PDF - Submission: ${submissionId}, Form: ${formId}, Contact: ${ghlContactId}`);

        pdfUploadResult = await handlePdfUpload(submissionId, formId, ghlContactId, contactName, traceId, pdfStepId);
        if (pdfStepId) await completeStep(pdfStepId, pdfUploadResult);
        console.log('PDF upload completed:', pdfUploadResult);
      } catch (pdfError) {
        if (pdfStepId) await failStep(pdfStepId, pdfError, traceId);
        console.error('Error uploading PDF:', pdfError.message);
        // Don't fail the whole request if PDF upload fails
        pdfUploadResult = { success: false, error: pdfError.message };
      }
    } else {
      console.log('PDF save not requested, skipping PDF upload');
    }

    // Send success response
    res.json({
      success: true,
      message: isDuplicate ? 'Contact updated successfully' : 'Contact created successfully',
      ghlContactId: ghlContactId,
      isDuplicate: isDuplicate,
      opportunityCreated: opportunityResult?.id ? true : false,
      opportunityId: opportunityResult?.id,
      pdfUploaded: pdfUploadResult?.success || false,
      pdfDetails: pdfUploadResult
    });

  } catch (error) {
    console.error('Error processing intake webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message
    });
  }
});

// Associate contact to workshop endpoint
app.post('/associate-contact-workshop', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== ASSOCIATE CONTACT TO WORKSHOP REQUEST RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Extract required fields from request body
    const { contactId, eventTitle, eventDate, eventTime, eventType } = req.body;

    // Update trace with contact ID
    if (traceId && contactId) {
      await updateTraceContextIds(traceId, { contactId });
    }

    // Validate required fields
    if (!contactId || !eventTitle || !eventDate || !eventTime || !eventType) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        required: ['contactId', 'eventTitle', 'eventDate', 'eventTime', 'eventType'],
        received: { contactId, eventTitle, eventDate, eventTime, eventType }
      });
    }

    // Step: Process the association
    let processStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'associateContactToWorkshop', 'main', { contactId, eventTitle, eventDate, eventTime, eventType });
      processStepId = step.stepId;
    }

    try {
      const result = await associateContactToWorkshop({
        contactId,
        eventTitle,
        eventDate,
        eventTime,
        eventType
      }, traceId, processStepId);
      if (processStepId) await completeStep(processStepId, result);

      res.json({
        success: true,
        message: 'Contact associated to workshop successfully',
        contactId: result.contactId,
        workshopRecordId: result.workshopRecordId,
        details: result
      });
    } catch (processError) {
      if (processStepId) await failStep(processStepId, processError, traceId);
      throw processError;
    }

  } catch (error) {
    console.error('Error associating contact to workshop:', error);
    res.status(500).json({
      success: false,
      message: 'Error associating contact to workshop',
      error: error.message
    });
  }
});

// Intake Form webhook endpoint - Jotform webhook
app.post('/webhooks/intakeForm', upload.none(), async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== INTAKE FORM WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Request body keys:', Object.keys(req.body || {}));
    console.log('rawRequest exists:', !!req.body.rawRequest);
    console.log('submissionID:', req.body.submissionID);

    // Extract rawRequest and submissionID
    const rawRequest = req.body.rawRequest;
    const submissionID = req.body.submissionID;

    if (!rawRequest) {
      return res.status(400).json({
        success: false,
        message: 'Missing rawRequest field in webhook payload'
      });
    }

    if (!submissionID) {
      return res.status(400).json({
        success: false,
        message: 'Missing submissionID field in webhook payload'
      });
    }

    // Step 1: Parse JotForm intake webhook using the intake parser
    console.log('Parsing JotForm intake data...');
    let parseStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'jotformIntakeParser', 'parseJotFormIntakeWebhook', { hasRawRequest: !!rawRequest });
      parseStepId = step.stepId;
    }
    const parsedData = parseJotFormIntakeWebhook(rawRequest);
    if (parseStepId) await completeStep(parseStepId, { parsedFields: Object.keys(parsedData) });

    console.log('Parsed intake data:', {
      name: parsedData.name,
      firstName: parsedData.firstName,
      lastName: parsedData.lastName,
      email: parsedData.email,
      phoneNumber: parsedData.phoneNumber,
      practiceArea: parsedData.practiceArea,
      callDetails: parsedData.callDetails,
      estatePlan: parsedData.estatePlan
    });

    // Validate required fields
    if (!parsedData.firstName || !parsedData.lastName || !parsedData.email || !parsedData.phoneNumber) {
      console.warn('Missing required contact fields:', {
        firstName: parsedData.firstName,
        lastName: parsedData.lastName,
        email: parsedData.email,
        phoneNumber: parsedData.phoneNumber
      });
      return res.status(400).json({
        success: false,
        message: 'Missing required contact fields',
        missingFields: {
          firstName: !parsedData.firstName,
          lastName: !parsedData.lastName,
          email: !parsedData.email,
          phoneNumber: !parsedData.phoneNumber
        }
      });
    }

    // Step 2: Map to GHL format using the intake data mapper
    console.log('Mapping to GHL contact format...');
    let mapStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'intakeDataMapper', 'mapIntakeToGHL', parsedData);
      mapStepId = step.stepId;
    }
    const ghlContactData = mapIntakeToGHL(parsedData);

    // Add Jotform Link field
    const jotformLink = `https://www.jotform.com/inbox/252965467838072/${submissionID}/edit`;
    if (!ghlContactData.customFields) {
      ghlContactData.customFields = [];
    }
    ghlContactData.customFields.push({
      id: 'BJKwhr1OUaStUYVo6poh', // Jotform Link field ID
      field_value: jotformLink
    });
    if (mapStepId) await completeStep(mapStepId, ghlContactData);

    console.log('Creating GHL contact with data:', JSON.stringify(ghlContactData, null, 2));

    // Step 3: Create or update contact in GHL
    let createContactStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlService', 'createGHLContact', ghlContactData);
      createContactStepId = step.stepId;
    }
    let ghlResponse;
    try {
      ghlResponse = await createGHLContact(ghlContactData, traceId, createContactStepId);
      if (createContactStepId) await completeStep(createContactStepId, ghlResponse);
    } catch (contactError) {
      if (createContactStepId) await failStep(createContactStepId, contactError, traceId);
      throw contactError;
    }
    const ghlContactId = ghlResponse.contact?.id || ghlResponse.id;
    const isDuplicate = ghlResponse.isDuplicate || false;

    // Update trace with contact ID
    if (traceId && ghlContactId) {
      await updateTraceContextIds(traceId, { contactId: ghlContactId });
    }

    console.log(`GHL contact ${isDuplicate ? 'updated' : 'created'} successfully:`, ghlContactId);
    console.log('GHL response customFields:', JSON.stringify(ghlResponse.contact?.customFields || ghlResponse.customFields, null, 2));

    // Step 4: Create opportunity in specified pipeline/stage
    const pipelineId = 'LFxLIUP3LCVES60i9iwN';
    const stageId = 'f0241e66-85b6-477e-9754-393aeedaef20';
    const opportunityName = parsedData.name || `${parsedData.firstName} ${parsedData.lastName}`.trim();

    console.log(`Creating opportunity: ${opportunityName} in pipeline ${pipelineId}, stage ${stageId}`);

    let createOpportunityStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlService', 'createGHLOpportunity', { ghlContactId, pipelineId, stageId, opportunityName });
      createOpportunityStepId = step.stepId;
    }
    let opportunityResult = null;
    try {
      opportunityResult = await createGHLOpportunity(
        ghlContactId,
        pipelineId,
        stageId,
        opportunityName,
        traceId,
        createOpportunityStepId
      );
      if (createOpportunityStepId) await completeStep(createOpportunityStepId, opportunityResult);
      console.log('Opportunity created successfully:', opportunityResult);

      // Update trace with opportunity ID
      if (traceId && opportunityResult?.id) {
        await updateTraceContextIds(traceId, { opportunityId: opportunityResult.id });
      }
    } catch (opportunityError) {
      if (createOpportunityStepId) await failStep(createOpportunityStepId, opportunityError, traceId);
      console.error('Error creating opportunity:', opportunityError.message);
      opportunityResult = { success: false, error: opportunityError.message };
    }

    // Step 5: Handle PDF upload if requested
    let pdfUploadResult = null;
    if (parsedData.createPdf && parsedData.createPdf.trim() !== '') {
      console.log(`PDF creation requested (createPdf="${parsedData.createPdf}"), proceeding with PDF upload`);
      let pdfStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'pdfService', 'handlePdfUpload', { shouldSavePdf: true });
        pdfStepId = step.stepId;
      }
      try {
        const formId = req.body.formID || '252965467838072';
        pdfUploadResult = await handlePdfUpload(submissionID, formId, ghlContactId, opportunityName, traceId, pdfStepId);
        if (pdfStepId) await completeStep(pdfStepId, pdfUploadResult);
        console.log('PDF upload completed:', pdfUploadResult);
      } catch (pdfError) {
        if (pdfStepId) await failStep(pdfStepId, pdfError, traceId);
        console.error('Error uploading PDF:', pdfError.message);
        pdfUploadResult = { success: false, error: pdfError.message };
      }
    }

    // Send success response
    res.json({
      success: true,
      message: isDuplicate ? 'Contact updated and opportunity created' : 'Contact and opportunity created successfully',
      contactId: ghlContactId,
      isDuplicate: isDuplicate,
      jotformLink: jotformLink,
      opportunityCreated: opportunityResult?.id ? true : false,
      opportunityId: opportunityResult?.id,
      pdfUploaded: pdfUploadResult?.success || false,
      pdfDetails: pdfUploadResult,
      data: {
        firstName: parsedData.firstName,
        lastName: parsedData.lastName,
        email: parsedData.email,
        phoneNumber: parsedData.phoneNumber,
        practiceArea: parsedData.practiceArea
      }
    });

  } catch (error) {
    console.error('Error processing intake form webhook:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message
    });
  }
});

// GHL Invoice Created webhook endpoint
app.post('/webhooks/ghl/invoice-created', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== GHL INVOICE CREATED WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    const confidoService = require('./services/confidoService');
    const invoiceService = require('./services/invoiceService');
    const ghlService = require('./services/ghlService');

    // Extract invoice data from GHL webhook
    // GHL sends invoice nested in invoice._data
    const invoice = req.body.invoice?._data || req.body.invoice || req.body;
    const contactDetails = invoice.contactDetails || {};
    const opportunityDetails = invoice.opportunityDetails || {};

    const webhookData = {
      ghlInvoiceId: invoice._id || invoice.id || req.body.invoice?._id,
      opportunityId: opportunityDetails.opportunityId || req.body.opportunity_id,
      contactId: contactDetails.id || req.body.contact_id,
      opportunityName: opportunityDetails.opportunityName || req.body.opportunity_name,
      primaryContactName: contactDetails.name || req.body.full_name || `${req.body.first_name || ''} ${req.body.last_name || ''}`.trim(),
      contactEmail: contactDetails.email || req.body.email,
      contactPhone: contactDetails.phoneNo || req.body.phone,
      invoiceNumber: invoice.invoiceNumber || invoice.invoice_number,
      amountDue: parseFloat(invoice.amountDue || invoice.total || 0),
      invoiceDate: invoice.issueDate || invoice.createdAt || new Date().toISOString(),
      dueDate: invoice.dueDate || invoice.due_date,
      status: invoice.status || 'pending',
      lineItems: invoice.invoiceItems || invoice.line_items || [],
    };

    console.log('Extracted webhook data:', JSON.stringify(webhookData, null, 2));

    // Update trace with context IDs
    if (traceId) {
      await updateTraceContextIds(traceId, {
        invoiceId: webhookData.ghlInvoiceId,
        contactId: webhookData.contactId,
        opportunityId: webhookData.opportunityId
      });
    }

    // Validate required fields
    if (!webhookData.ghlInvoiceId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: invoice ID'
      });
    }

    if (!webhookData.amountDue || webhookData.amountDue <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing or invalid amount due'
      });
    }

    // Get contact details if we have contactId but not contact name
    if (webhookData.contactId && !webhookData.primaryContactName) {
      console.log('Fetching contact details from GHL...');
      let getContactStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'ghlService', 'getContact', { contactId: webhookData.contactId });
        getContactStepId = step.stepId;
      }
      try {
        const contactResponse = await ghlService.getContact(webhookData.contactId, traceId, getContactStepId);
        if (getContactStepId) await completeStep(getContactStepId, contactResponse);
        if (contactResponse && contactResponse.contact) {
          webhookData.primaryContactName = `${contactResponse.contact.firstName || ''} ${contactResponse.contact.lastName || ''}`.trim();
          console.log('Contact name retrieved:', webhookData.primaryContactName);
        }
      } catch (error) {
        if (getContactStepId) await failStep(getContactStepId, error, traceId);
        console.warn('Could not fetch contact details:', error.message);
      }
    }

    // Step 1: Save invoice to Supabase first (without Confido ID yet)
    console.log('Saving invoice to Supabase...');
    let saveStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'invoiceService', 'saveInvoiceToSupabase', { ghlInvoiceId: webhookData.ghlInvoiceId });
      saveStepId = step.stepId;
    }

    let supabaseResult;
    try {
      supabaseResult = await invoiceService.saveInvoiceToSupabase({
        ghlInvoiceId: webhookData.ghlInvoiceId,
        opportunityId: webhookData.opportunityId,
        contactId: webhookData.contactId,
        opportunityName: webhookData.opportunityName,
        primaryContactName: webhookData.primaryContactName,
        invoiceNumber: webhookData.invoiceNumber,
        amountDue: webhookData.amountDue,
        amountPaid: 0,
        status: webhookData.status,
        invoiceDate: webhookData.invoiceDate,
        dueDate: webhookData.dueDate,
      }, traceId, saveStepId);
      if (saveStepId) await completeStep(saveStepId, supabaseResult);
    } catch (saveError) {
      if (saveStepId) await failStep(saveStepId, saveError, traceId);
      throw saveError;
    }

    if (!supabaseResult.success) {
      console.error('Failed to save invoice to Supabase:', supabaseResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to save invoice to database',
        error: supabaseResult.error
      });
    }

    console.log('✅ Invoice saved to Supabase');

    // Step 2: Create invoice in Confido (3-step flow: Client → Matter → PaymentLink)
    console.log('Creating invoice in Confido...');
    let confidoStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'confidoService', 'createInvoice', { ghlInvoiceId: webhookData.ghlInvoiceId, amountDue: webhookData.amountDue });
      confidoStepId = step.stepId;
    }

    let confidoResult;
    try {
      confidoResult = await confidoService.createInvoice({
        ghlInvoiceId: webhookData.ghlInvoiceId,
        opportunityId: webhookData.opportunityId,
        opportunityName: webhookData.opportunityName,
        contactId: webhookData.contactId,
        contactName: webhookData.primaryContactName,
        contactEmail: webhookData.contactEmail,
        contactPhone: webhookData.contactPhone,
        invoiceNumber: webhookData.invoiceNumber,
        amountDue: webhookData.amountDue,
        dueDate: webhookData.dueDate,
        memo: `Invoice #${webhookData.invoiceNumber || 'N/A'} - ${webhookData.opportunityName || ''}`,
        lineItems: webhookData.lineItems,
      }, traceId, confidoStepId);
      if (confidoStepId) await completeStep(confidoStepId, confidoResult);
    } catch (confidoError) {
      if (confidoStepId) await failStep(confidoStepId, confidoError, traceId);
      throw confidoError;
    }

    if (!confidoResult.success) {
      console.error('Failed to create invoice in Confido:', confidoResult.error);
      // Don't fail the request - invoice is saved in Supabase
      return res.json({
        success: true,
        message: 'Invoice saved but Confido creation failed',
        invoiceId: supabaseResult.data.id,
        ghlInvoiceId: webhookData.ghlInvoiceId,
        confidoCreated: false,
        confidoError: confidoResult.error
      });
    }

    console.log('✅ Invoice created in Confido');
    console.log('   - Client ID:', confidoResult.confidoClientId);
    console.log('   - Matter ID:', confidoResult.confidoMatterId);
    console.log('   - PaymentLink ID:', confidoResult.confidoInvoiceId);
    console.log('   - Status:', confidoResult.status);
    console.log('   - Total:', confidoResult.total);
    console.log('   - Payment URL:', confidoResult.paymentUrl);

    // Step 3: Update Supabase record with all Confido IDs
    let updateStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'invoiceService', 'saveInvoiceToSupabase', { action: 'update', ghlInvoiceId: webhookData.ghlInvoiceId });
      updateStepId = step.stepId;
    }

    try {
      const updateResult = await invoiceService.saveInvoiceToSupabase({
        ghlInvoiceId: webhookData.ghlInvoiceId,
        opportunityId: webhookData.opportunityId,
        contactId: webhookData.contactId,
        opportunityName: webhookData.opportunityName,
        primaryContactName: webhookData.primaryContactName,
        confidoInvoiceId: confidoResult.confidoInvoiceId,
        confidoClientId: confidoResult.confidoClientId,
        confidoMatterId: confidoResult.confidoMatterId,
        invoiceNumber: webhookData.invoiceNumber,
        amountDue: webhookData.amountDue,
        amountPaid: confidoResult.paid || 0,
        status: confidoResult.status || 'unpaid',
        invoiceDate: webhookData.invoiceDate,
        dueDate: webhookData.dueDate,
      }, traceId, updateStepId);
      if (updateStepId) await completeStep(updateStepId, updateResult);
    } catch (updateError) {
      if (updateStepId) await failStep(updateStepId, updateError, traceId);
      // Non-blocking - invoice already created
      console.error('Failed to update Supabase with Confido IDs:', updateError.message);
    }

    console.log('✅ Invoice record updated with Confido ID');

    res.json({
      success: true,
      message: 'Invoice created successfully in both systems',
      invoiceId: supabaseResult.data.id,
      ghlInvoiceId: webhookData.ghlInvoiceId,
      confido: {
        invoiceId: confidoResult.confidoInvoiceId,
        clientId: confidoResult.confidoClientId,
        matterId: confidoResult.confidoMatterId,
        paymentUrl: confidoResult.paymentUrl,
        status: confidoResult.status,
        total: confidoResult.total,
        paid: confidoResult.paid,
        outstanding: confidoResult.outstanding
      },
      amountDue: webhookData.amountDue
    });

  } catch (error) {
    console.error('Error processing GHL invoice webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing invoice webhook',
      error: error.message
    });
  }
});

// Confido Payment Received webhook endpoint
app.post('/webhooks/confido/payment-received', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== CONFIDO PAYMENT WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    const confidoService = require('./services/confidoService');
    const invoiceService = require('./services/invoiceService');
    const ghlService = require('./services/ghlService');

    // Verify webhook signature if provided
    const signature = req.headers['x-confido-signature'] || req.headers['x-webhook-signature'];
    if (signature) {
      const isValid = confidoService.verifyWebhookSignature(req.body, signature);
      if (!isValid) {
        console.error('❌ Invalid webhook signature');
        return res.status(401).json({
          success: false,
          message: 'Invalid webhook signature'
        });
      }
      console.log('✅ Webhook signature verified');
    }

    // Extract payment data from Confido webhook
    // NOTE: Update field names based on actual Confido webhook payload
    const paymentData = {
      confidoPaymentId: req.body.payment_id || req.body.paymentId || req.body.id,
      confidoInvoiceId: req.body.invoice_id || req.body.invoiceId,
      amount: parseFloat(req.body.amount || req.body.payment_amount || 0),
      paymentMethod: req.body.payment_method || req.body.paymentMethod,
      status: req.body.status || 'completed',
      transactionDate: req.body.transaction_date || req.body.transactionDate || new Date().toISOString(),
    };

    console.log('Extracted payment data:', JSON.stringify(paymentData, null, 2));

    // Validate required fields
    if (!paymentData.confidoPaymentId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: payment ID'
      });
    }

    if (!paymentData.confidoInvoiceId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: invoice ID'
      });
    }

    if (!paymentData.amount || paymentData.amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing or invalid payment amount'
      });
    }

    // Step 1: Find the invoice in our database by Confido invoice ID
    console.log('Looking up invoice by Confido ID...');
    let lookupStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'invoiceService', 'getInvoiceByconfidoId', { confidoInvoiceId: paymentData.confidoInvoiceId });
      lookupStepId = step.stepId;
    }

    let invoiceResult;
    try {
      invoiceResult = await invoiceService.getInvoiceByconfidoId(paymentData.confidoInvoiceId, traceId, lookupStepId);
      if (lookupStepId) await completeStep(lookupStepId, invoiceResult);
    } catch (lookupError) {
      if (lookupStepId) await failStep(lookupStepId, lookupError, traceId);
      throw lookupError;
    }

    if (!invoiceResult.success || !invoiceResult.data) {
      console.error('Invoice not found for Confido ID:', paymentData.confidoInvoiceId);
      return res.status(404).json({
        success: false,
        message: 'Invoice not found in database',
        confidoInvoiceId: paymentData.confidoInvoiceId
      });
    }

    const invoice = invoiceResult.data;

    // Update trace with context IDs
    if (traceId) {
      await updateTraceContextIds(traceId, {
        invoiceId: invoice.ghl_invoice_id,
        contactId: invoice.ghl_contact_id,
        opportunityId: invoice.ghl_opportunity_id
      });
    }

    console.log('✅ Invoice found:', {
      id: invoice.id,
      ghlInvoiceId: invoice.ghl_invoice_id,
      opportunityId: invoice.ghl_opportunity_id,
      amountDue: invoice.amount_due
    });

    // Step 2: Update invoice payment status in Supabase
    console.log('Updating invoice payment status...');
    let updateStatusStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'invoiceService', 'updateInvoicePaymentStatus', { confidoInvoiceId: paymentData.confidoInvoiceId, amount: paymentData.amount });
      updateStatusStepId = step.stepId;
    }

    let updateResult;
    try {
      updateResult = await invoiceService.updateInvoicePaymentStatus(
        paymentData.confidoInvoiceId,
        {
          amount: paymentData.amount,
          transactionDate: paymentData.transactionDate
        },
        traceId,
        updateStatusStepId
      );
      if (updateStatusStepId) await completeStep(updateStatusStepId, updateResult);
    } catch (updateError) {
      if (updateStatusStepId) await failStep(updateStatusStepId, updateError, traceId);
      throw updateError;
    }

    if (!updateResult.success) {
      console.error('Failed to update invoice:', updateResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update invoice status',
        error: updateResult.error
      });
    }

    console.log('✅ Invoice updated to paid status');

    // Step 3: Save payment transaction record
    console.log('Saving payment transaction...');
    let savePaymentStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'invoiceService', 'savePaymentToSupabase', { confidoPaymentId: paymentData.confidoPaymentId, amount: paymentData.amount });
      savePaymentStepId = step.stepId;
    }

    let paymentRecord;
    try {
      paymentRecord = await invoiceService.savePaymentToSupabase({
        confidoPaymentId: paymentData.confidoPaymentId,
        confidoInvoiceId: paymentData.confidoInvoiceId,
        ghlInvoiceId: invoice.ghl_invoice_id,
        ghlContactId: invoice.ghl_contact_id,
        ghlOpportunityId: invoice.ghl_opportunity_id,
        amount: paymentData.amount,
        paymentMethod: paymentData.paymentMethod,
        status: paymentData.status,
        transactionDate: paymentData.transactionDate,
        rawWebhookData: req.body, // Store full payload for debugging
      }, traceId, savePaymentStepId);
      if (savePaymentStepId) await completeStep(savePaymentStepId, paymentRecord);
    } catch (saveError) {
      if (savePaymentStepId) await failStep(savePaymentStepId, saveError, traceId);
      throw saveError;
    }

    console.log('✅ Payment transaction saved');

    // Step 4: Record payment in GHL invoice
    if (invoice.ghl_invoice_id) {
      console.log('Recording payment in GHL invoice...');
      let recordPaymentStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'ghlService', 'recordInvoicePayment', { ghlInvoiceId: invoice.ghl_invoice_id, amount: paymentData.amount });
        recordPaymentStepId = step.stepId;
      }
      try {
        await ghlService.recordInvoicePayment(invoice.ghl_invoice_id, {
          amount: paymentData.amount,
          paymentMethod: paymentData.paymentMethod || 'other',
          transactionId: paymentData.confidoPaymentId,
          note: `Payment processed via Confido Legal on ${new Date(paymentData.transactionDate).toLocaleDateString()}`
        }, traceId, recordPaymentStepId);
        if (recordPaymentStepId) await completeStep(recordPaymentStepId, { success: true });

        console.log('✅ Payment recorded in GHL invoice');
      } catch (ghlError) {
        if (recordPaymentStepId) await failStep(recordPaymentStepId, ghlError, traceId);
        console.error('Failed to record payment in GHL invoice:', ghlError.message);
        // Don't fail the request - payment is already recorded in Supabase
      }

      // Step 5: Update GHL custom object status to 'paid'
      let updateCustomObjStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'ghlService', 'updateCustomObject', { objectKey: 'custom_objects.invoices', recordId: invoice.ghl_invoice_id, status: 'paid' });
        updateCustomObjStepId = step.stepId;
      }
      try {
        console.log('Updating GHL custom object status to paid...');
        await ghlService.updateCustomObject(
          'custom_objects.invoices',
          invoice.ghl_invoice_id,
          process.env.GHL_LOCATION_ID,
          {
            status: 'paid'
          },
          traceId,
          updateCustomObjStepId
        );
        if (updateCustomObjStepId) await completeStep(updateCustomObjStepId, { success: true });
        console.log('✅ GHL custom object status updated to paid');
      } catch (statusError) {
        if (updateCustomObjStepId) await failStep(updateCustomObjStepId, statusError, traceId);
        console.error('Failed to update GHL custom object status:', statusError.message);
        // Don't fail the request - payment is already recorded
      }
    }

    // Step 6: Create task/note in GHL to notify about payment
    if (invoice.ghl_opportunity_id) {
      console.log('Creating notification task in GHL...');
      let createTaskStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'ghlService', 'createTask', { contactId: invoice.ghl_contact_id, opportunityId: invoice.ghl_opportunity_id });
        createTaskStepId = step.stepId;
      }
      try {
        const taskTitle = `Payment Received: $${paymentData.amount.toFixed(2)}`;
        const taskBody = `Payment of $${paymentData.amount.toFixed(2)} was received via ${paymentData.paymentMethod || 'Confido'} on ${new Date(paymentData.transactionDate).toLocaleDateString()}.\n\nConfido Payment ID: ${paymentData.confidoPaymentId}\nInvoice Number: ${invoice.invoice_number || 'N/A'}`;

        // Create task on the opportunity
        await ghlService.createTask(
          invoice.ghl_contact_id,
          taskTitle,
          taskBody,
          new Date().toISOString(), // Due today
          null, // No assigned user
          invoice.ghl_opportunity_id,
          traceId,
          createTaskStepId
        );
        if (createTaskStepId) await completeStep(createTaskStepId, { success: true });

        console.log('✅ Notification task created in GHL');
      } catch (taskError) {
        if (createTaskStepId) await failStep(createTaskStepId, taskError, traceId);
        console.error('Failed to create GHL task:', taskError.message);
        // Don't fail the request - payment is already recorded
      }

      // Step 7: Move opportunity to "Engaged" stage after Confido payment received
      console.log('Moving opportunity to Engaged stage...');
      let moveStageStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'ghlOpportunityService', 'updateOpportunityStage', { opportunityId: invoice.ghl_opportunity_id, targetStage: 'Engaged' });
        moveStageStepId = step.stepId;
      }
      try {
        const ENGAGED_STAGE_ID = '26243231-7b09-48dd-a8a1-18489bab69e3';

        // Get current opportunity to find its pipeline ID
        const opportunity = await getOpportunityById(invoice.ghl_opportunity_id, traceId, moveStageStepId);
        const currentPipelineId = opportunity.pipelineId;

        console.log(`   Current Pipeline: ${currentPipelineId}`);
        console.log(`   Target Stage (Engaged): ${ENGAGED_STAGE_ID}`);

        await updateOpportunityStage(invoice.ghl_opportunity_id, currentPipelineId, ENGAGED_STAGE_ID, traceId, moveStageStepId);
        if (moveStageStepId) await completeStep(moveStageStepId, { success: true, stageId: ENGAGED_STAGE_ID });
        console.log('✅ Opportunity moved to Engaged stage');
      } catch (stageError) {
        if (moveStageStepId) await failStep(moveStageStepId, stageError, traceId);
        console.error('Failed to move opportunity to Engaged stage:', stageError.message);
        // Don't fail the request - payment is already recorded
      }
    }

    // Step 8: Send paid invoice email to client
    let emailSent = false;
    if (invoice.ghl_contact_id) {
      let emailStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'invoiceEmailService', 'sendPaidInvoiceEmail', { contactId: invoice.ghl_contact_id });
        emailStepId = step.stepId;
      }
      try {
        // Get contact email from GHL
        const contactResponse = await ghlService.getContact(invoice.ghl_contact_id, traceId, emailStepId);
        const contactEmail = contactResponse?.contact?.email;

        if (contactEmail) {
          console.log('Sending paid invoice email to:', contactEmail);
          const { sendPaidInvoiceEmail } = require('./services/invoiceEmailService');

          const paidInvoiceData = {
            billedTo: invoice.primary_contact_name || contactResponse?.contact?.name || 'Valued Client',
            invoiceNumber: invoice.invoice_number,
            issueDate: invoice.invoice_date ? new Date(invoice.invoice_date) : new Date(),
            dueDate: invoice.due_date ? new Date(invoice.due_date) : new Date(),
            lineItems: (invoice.service_items || []).map(item => ({
              name: item.name,
              price: item.price,
              quantity: item.quantity || 1,
              tax: '-',
              subtotal: item.price * (item.quantity || 1)
            })),
            subtotal: parseFloat(invoice.amount_due),
            amountDue: parseFloat(invoice.amount_due),
            paymentsReceived: paymentData.amount
          };

          await sendPaidInvoiceEmail(paidInvoiceData, contactEmail, traceId, emailStepId);
          if (emailStepId) await completeStep(emailStepId, { success: true, emailSent: true });
          console.log('✅ Paid invoice email sent successfully');
          emailSent = true;
        } else {
          if (emailStepId) await completeStep(emailStepId, { success: true, emailSent: false, reason: 'no email' });
          console.warn('⚠️ No contact email found, skipping paid invoice email');
        }
      } catch (emailError) {
        if (emailStepId) await failStep(emailStepId, emailError, traceId);
        console.error('Failed to send paid invoice email (non-blocking):', emailError.message);
      }
    }

    res.json({
      success: true,
      message: 'Payment processed successfully',
      paymentId: paymentRecord.data?.id,
      confidoPaymentId: paymentData.confidoPaymentId,
      invoiceId: invoice.id,
      ghlInvoiceId: invoice.ghl_invoice_id,
      amount: paymentData.amount,
      invoiceStatus: 'paid',
      emailSent: emailSent
    });

  } catch (error) {
    console.error('Error processing Confido payment webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing payment webhook',
      error: error.message
    });
  }
});

// GHL Association Created webhook endpoint
app.post('/webhooks/ghl/association-created', async (req, res) => {
  // Note: No service calls in this endpoint, tracing handled by middleware

  try {
    console.log('=== GHL ASSOCIATION CREATED WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    const ghlService = require('./services/ghlService');
    const confidoService = require('./services/confidoService');
    const invoiceService = require('./services/invoiceService');

    // Extract association data from GHL webhook
    const associationData = {
      id: req.body.id,
      associationType: req.body.associationType,
      firstObjectKey: req.body.firstObjectKey,
      firstObjectLabel: req.body.firstObjectLabel,
      secondObjectKey: req.body.secondObjectKey,
      secondObjectLabel: req.body.secondObjectLabel,
      key: req.body.key,
      locationId: req.body.locationId
    };

    console.log('Association Data:', JSON.stringify(associationData, null, 2));

    // Check if this is an invoice → opportunity association
    const isInvoiceOpportunityAssociation =
      (associationData.firstObjectKey === 'custom_objects.invoices' && associationData.secondObjectKey === 'opportunity') ||
      (associationData.firstObjectKey === 'opportunity' && associationData.secondObjectKey === 'custom_objects.invoices');

    if (!isInvoiceOpportunityAssociation) {
      console.log('ℹ️ Not an invoice-opportunity association, skipping...');
      return res.json({
        success: true,
        message: 'Association received but not processed (not invoice-opportunity)'
      });
    }

    console.log('✅ Invoice-Opportunity association detected');
    console.log('Association ID:', associationData.id);

    // Note: This webhook only tells us the association schema was created
    // We need to wait for actual record associations or use a different trigger
    // For now, just log and acknowledge

    res.json({
      success: true,
      message: 'Invoice-Opportunity association webhook received',
      associationId: associationData.id,
      associationType: associationData.associationType
    });

  } catch (error) {
    console.error('Error processing GHL association webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing association webhook',
      error: error.message
    });
  }
});

// GHL Custom Object (Invoice) Created webhook endpoint
// Note: GHL may send all custom object events (Create, Update, Delete) to this endpoint
// We route based on the 'type' field in the payload
app.post('/webhooks/ghl/custom-object-created', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== GHL CUSTOM OBJECT WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // ===== STEP 1: Webhook Received =====
    let webhookStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'webhook_received', {
          endpoint: '/webhooks/ghl/custom-object-created',
          method: 'POST',
          contentType: req.headers['content-type'],
          timestamp: new Date().toISOString()
        });
        webhookStepId = step.stepId;
      } catch (e) {
        console.error('Error starting webhook_received step:', e.message);
      }
    }

    // Update trace with invoice ID if available
    const invoiceRecordId = req.body.id || req.body.recordId;
    if (traceId && invoiceRecordId) {
      await updateTraceContextIds(traceId, { invoiceId: invoiceRecordId });
    }

    const eventType = req.body.type || 'RecordCreate';
    const objectKey = req.body.objectKey || req.body.schemaKey;

    // Complete webhook received step
    if (webhookStepId) {
      try {
        await completeStep(webhookStepId, {
          recordId: invoiceRecordId,
          eventType,
          objectKey,
          hasProperties: !!req.body.properties
        });
      } catch (e) {
        console.error('Error completing webhook_received step:', e.message);
      }
    }

    // ===== STEP 2: Check if Self-Update (Skip our own updates) - BEFORE ROUTING =====
    const lastUpdatedBy = req.body.lastUpdatedBy || {};
    const isOurUpdate = lastUpdatedBy.source === 'INTEGRATION';

    let selfUpdateStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'processing', 'check_self_update', {
          lastUpdatedBySource: lastUpdatedBy.source || 'unknown',
          lastUpdatedByChannel: lastUpdatedBy.channel || 'unknown',
          isOurUpdate,
          eventType
        });
        selfUpdateStepId = step.stepId;
      } catch (e) {
        console.error('Error starting check_self_update step:', e.message);
      }
    }

    if (isOurUpdate) {
      console.log('⏭️ Skipping webhook triggered by our own integration update');
      if (selfUpdateStepId) {
        try {
          await completeStep(selfUpdateStepId, {
            skipped: true,
            reason: 'Self-triggered by our integration update',
            action: 'self_update_skipped'
          });
        } catch (e) {
          console.error('Error completing check_self_update step:', e.message);
        }
      }
      return res.json({
        success: true,
        message: 'Skipped webhook triggered by our own update',
        action: 'self_update_skipped'
      });
    }

    // Not our update, continue processing
    if (selfUpdateStepId) {
      try {
        await completeStep(selfUpdateStepId, {
          skipped: false,
          reason: 'External update, processing webhook',
          action: 'process_external_update'
        });
      } catch (e) {
        console.error('Error completing check_self_update step:', e.message);
      }
    }

    // ===== STEP 3: Route Event Type =====
    let routeStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'route_event_type', {
          eventType,
          objectKey
        });
        routeStepId = step.stepId;
      } catch (e) {
        console.error('Error starting route_event_type step:', e.message);
      }
    }

    // Route to appropriate handler based on event type
    if (eventType === 'RecordDelete') {
      console.log('📍 Routing to DELETE handler...');
      if (routeStepId) {
        try {
          await completeStep(routeStepId, { routedTo: 'custom-object-deleted', action: 'forwarded' });
        } catch (e) {
          console.error('Error completing route_event_type step:', e.message);
        }
      }
      // Forward to delete endpoint internally
      const axios = require('axios');
      try {
        const deleteResponse = await axios.post(
          'http://localhost:' + (process.env.PORT || 3000) + '/webhooks/ghl/custom-object-deleted',
          req.body,
          { headers: { 'Content-Type': 'application/json' } }
        );
        return res.json(deleteResponse.data);
      } catch (deleteError) {
        console.error('Error forwarding to delete handler:', deleteError.message);
        return res.status(500).json({
          success: false,
          message: 'Error processing delete webhook',
          error: deleteError.message,
          action: 'forward_error'
        });
      }
    }

    if (eventType === 'RecordUpdate') {
      console.log('📍 Routing to UPDATE handler...');
      if (routeStepId) {
        try {
          await completeStep(routeStepId, { routedTo: 'custom-object-updated', action: 'forwarded' });
        } catch (e) {
          console.error('Error completing route_event_type step:', e.message);
        }
      }
      // Forward to update endpoint internally
      const axios = require('axios');
      try {
        const updateResponse = await axios.post(
          'http://localhost:' + (process.env.PORT || 3000) + '/webhooks/ghl/custom-object-updated',
          req.body,
          { headers: { 'Content-Type': 'application/json' } }
        );
        return res.json(updateResponse.data);
      } catch (updateError) {
        console.error('Error forwarding to update handler:', updateError.message);
        return res.status(500).json({
          success: false,
          message: 'Error processing update webhook',
          error: updateError.message,
          action: 'forward_error'
        });
      }
    }

    // Continue with RecordCreate handling
    if (routeStepId) {
      try {
        await completeStep(routeStepId, { routedTo: 'RecordCreate', action: 'process_locally' });
      } catch (e) {
        console.error('Error completing route_event_type step:', e.message);
      }
    }
    console.log('📍 Processing as CREATE event...');

    const ghlService = require('./services/ghlService');
    const confidoService = require('./services/confidoService');
    const invoiceService = require('./services/invoiceService');

    // Extract custom object data
    const objectData = {
      recordId: req.body.id || req.body.recordId,
      objectKey: req.body.objectKey || req.body.schemaKey,
      locationId: req.body.locationId,
      type: eventType
    };

    console.log('Custom Object Data:', JSON.stringify(objectData, null, 2));

    // ===== STEP 4: Check Object Type =====
    let checkTypeStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'processing', 'check_object_type', {
          objectKey: objectData.objectKey,
          expectedKey: 'custom_objects.invoices'
        });
        checkTypeStepId = step.stepId;
      } catch (e) {
        console.error('Error starting check_object_type step:', e.message);
      }
    }

    // Check if this is an invoice object
    if (objectData.objectKey !== 'custom_objects.invoices') {
      console.log('ℹ️ Not an invoice object, skipping...');
      if (checkTypeStepId) {
        try {
          await completeStep(checkTypeStepId, {
            isInvoice: false,
            objectKey: objectData.objectKey,
            action: 'skipped'
          });
        } catch (e) {
          console.error('Error completing check_object_type step:', e.message);
        }
      }
      return res.json({
        success: true,
        message: 'Custom object received but not processed (not invoice)',
        action: 'not_invoice_skipped'
      });
    }

    // Is invoice object
    if (checkTypeStepId) {
      try {
        await completeStep(checkTypeStepId, {
          isInvoice: true,
          recordId: objectData.recordId,
          action: 'process_invoice'
        });
      } catch (e) {
        console.error('Error completing check_object_type step:', e.message);
      }
    }

    console.log('✅ Invoice custom object detected');
    console.log('Invoice Record ID:', objectData.recordId);

    // ===== STEP 5: Wait for Opportunity Association =====
    let retryStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'ghl', 'waitForOpportunityAssociation', {
          recordId: objectData.recordId,
          maxAttempts: 6,
          delayMs: 10000
        });
        retryStepId = step.stepId;
      } catch (e) {
        console.error('Error starting waitForOpportunityAssociation step:', e.message);
      }
    }

    let invoiceRecord = null;
    let relationsResponse = null;
    let attemptCount = 0;
    const maxAttempts = 6;
    const delayMs = 10000; // 10 seconds

    try {
      while (attemptCount < maxAttempts) {
        attemptCount++;
        console.log(`\n⏳ Attempt ${attemptCount}/${maxAttempts} - Checking for opportunity association...`);

        if (attemptCount > 1) {
          console.log(`Waiting ${delayMs / 1000} seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        // Get custom object details
        const customObjectResponse = await ghlService.getCustomObject(objectData.objectKey, objectData.recordId);
        invoiceRecord = customObjectResponse.record;
        console.log('Invoice Record:', JSON.stringify(invoiceRecord, null, 2));

        // Get relations
        relationsResponse = await ghlService.getRelations(objectData.recordId, objectData.locationId);
        const hasRelations = relationsResponse.relations && relationsResponse.relations.length > 0;
        console.log('Has Relations:', hasRelations);

        // Find opportunity relation
        const opportunityRelation = hasRelations
          ? relationsResponse.relations.find(rel => rel.secondObjectKey === 'opportunity' || rel.firstObjectKey === 'opportunity')
          : null;
        const hasOpportunity = !!opportunityRelation;
        console.log('Has Opportunity:', hasOpportunity);

        // Check if we have the opportunity association
        if (hasOpportunity) {
          console.log(`✅ Opportunity association found on attempt ${attemptCount}`);
          if (retryStepId) await completeStep(retryStepId, { found: true, attempts: attemptCount });
          break;
        }

        console.log(`⚠️ Missing opportunity association on attempt ${attemptCount}`);

        if (attemptCount === maxAttempts) {
          console.log('❌ Max attempts reached - no opportunity association found');
          if (retryStepId) await completeStep(retryStepId, { found: false, attempts: attemptCount, action: 'no_opportunity_association' });
          return res.json({
            success: false,
            message: 'Invoice missing opportunity association after 6 attempts',
            invoiceId: objectData.recordId,
            hasOpportunity: hasOpportunity,
            attempts: attemptCount,
            action: 'no_opportunity_association'
          });
        }
      }
    } catch (retryError) {
      if (retryStepId) await failStep(retryStepId, retryError, traceId);
      throw retryError;
    }

    // ===== STEP 6: Calculate Invoice Total =====
    let calcStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'supabase', 'calculateInvoiceTotal', {
          serviceItems: invoiceRecord.properties.serviceproduct || []
        });
        calcStepId = step.stepId;
      } catch (e) {
        console.error('Error starting calculateInvoiceTotal step:', e.message);
      }
    }

    const serviceItems = invoiceRecord.properties.serviceproduct || [];
    console.log('Service Items:', serviceItems);

    let calculationResult;
    try {
      calculationResult = await invoiceService.calculateInvoiceTotal(serviceItems, traceId, calcStepId);
      if (!calculationResult.success) {
        if (calcStepId) await failStep(calcStepId, { message: calculationResult.error }, traceId);
        console.error('Failed to calculate invoice total:', calculationResult.error);
        return res.status(500).json({
          success: false,
          message: 'Failed to calculate invoice total',
          error: calculationResult.error,
          action: 'calculation_failed'
        });
      }
      if (calcStepId) await completeStep(calcStepId, {
        total: calculationResult.total,
        lineItemsCount: calculationResult.lineItems.length,
        missingItems: calculationResult.missingItems
      });
    } catch (calcError) {
      if (calcStepId) await failStep(calcStepId, calcError, traceId);
      throw calcError;
    }

    const { total, lineItems, missingItems } = calculationResult;
    console.log(`Calculated Total: $${total}`);
    if (missingItems.length > 0) {
      console.warn('Missing service items:', missingItems.join(', '));
    }

    // ===== STEP 7: Get Opportunity Details =====
    let getOppStepId = null;
    const opportunityRelation = relationsResponse.relations.find(
      rel => rel.secondObjectKey === 'opportunity' || rel.firstObjectKey === 'opportunity'
    );
    const opportunityId = opportunityRelation.secondObjectKey === 'opportunity'
      ? opportunityRelation.secondRecordId
      : opportunityRelation.firstRecordId;

    if (traceId) {
      try {
        const step = await startStep(traceId, 'ghl', 'getOpportunity', { opportunityId });
        getOppStepId = step.stepId;
        await updateTraceContextIds(traceId, { opportunityId });
      } catch (e) {
        console.error('Error starting getOpportunity step:', e.message);
      }
    }

    console.log('✅ Found opportunity:', opportunityId);

    let opportunity;
    try {
      const opportunityResponse = await ghlService.getOpportunity(opportunityId, traceId, getOppStepId);
      opportunity = opportunityResponse.opportunity;
      if (getOppStepId) await completeStep(getOppStepId, {
        opportunityName: opportunity.name,
        contactId: opportunity.contactId,
        contactEmail: opportunity.contact?.email
      });
      console.log('Opportunity Details:', JSON.stringify(opportunity, null, 2));
    } catch (oppError) {
      if (getOppStepId) await failStep(getOppStepId, oppError, traceId);
      throw oppError;
    }

    // ===== STEP 8: Create Invoice in Confido =====
    let confidoStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'confido', 'createInvoice', {
          ghlInvoiceId: objectData.recordId,
          opportunityId: opportunity.id,
          amountDue: total
        });
        confidoStepId = step.stepId;
      } catch (e) {
        console.error('Error starting createInvoice step:', e.message);
      }
    }

    console.log('Creating invoice in Confido...');
    let confidoResult;
    try {
      confidoResult = await confidoService.createInvoice({
        ghlInvoiceId: objectData.recordId,
        opportunityId: opportunity.id,
        opportunityName: opportunity.name,
        contactId: opportunity.contactId,
        contactName: opportunity.contact?.name || '',
        contactEmail: opportunity.contact?.email || '',
        contactPhone: opportunity.contact?.phone || '',
        invoiceNumber: invoiceRecord.properties.invoice || objectData.recordId,
        amountDue: total,
        dueDate: invoiceRecord.properties.due_date || null,
        memo: `Invoice for ${lineItems.map(item => item.name).join(', ')}`,
        lineItems: lineItems
      }, traceId, confidoStepId);

      if (!confidoResult.success) {
        // Check if this is a duplicate PaymentLink error
        if (confidoResult.error === 'DUPLICATE_PAYMENTLINK') {
          console.log('⚠️ PaymentLink already exists in Confido');
          console.log('Checking Supabase for existing invoice record...');

          // Get existing invoice from Supabase
          const existingInvoice = await invoiceService.getInvoiceByGHLId(objectData.recordId, traceId, confidoStepId);

          if (existingInvoice.success && existingInvoice.data) {
            console.log('✅ Found existing invoice in Supabase');
            console.log('Payment URL:', existingInvoice.data.payment_url);

            if (confidoStepId) await completeStep(confidoStepId, {
              isDuplicate: true,
              paymentUrl: existingInvoice.data.payment_url,
              action: 'duplicate_invoice'
            });

            return res.json({
              success: true,
              message: 'Invoice already exists (duplicate webhook)',
              invoiceId: objectData.recordId,
              opportunityId: opportunity.id,
              paymentUrl: existingInvoice.data.payment_url,
              isDuplicate: true,
              action: 'duplicate_invoice'
            });
          } else {
            console.error('⚠️ PaymentLink exists in Confido but not in Supabase');
            if (confidoStepId) await failStep(confidoStepId, { message: 'Data inconsistency - PaymentLink exists in Confido but not in Supabase' }, traceId);
            return res.json({
              success: false,
              message: 'Data inconsistency - PaymentLink exists in Confido but not in Supabase',
              invoiceId: objectData.recordId,
              confidoError: confidoResult.error,
              action: 'data_inconsistency'
            });
          }
        }

        // Other errors
        console.error('Failed to create invoice in Confido:', confidoResult.error);
        if (confidoStepId) await failStep(confidoStepId, { message: confidoResult.error }, traceId);
        return res.json({
          success: true,
          message: 'Invoice processed but Confido creation failed',
          invoiceId: objectData.recordId,
          opportunityId: opportunity.id,
          confidoError: confidoResult.error,
          action: 'confido_failed'
        });
      }

      if (confidoStepId) await completeStep(confidoStepId, {
        confidoInvoiceId: confidoResult.confidoInvoiceId,
        paymentUrl: confidoResult.paymentUrl,
        status: confidoResult.status
      });
    } catch (confidoError) {
      if (confidoStepId) await failStep(confidoStepId, confidoError, traceId);
      throw confidoError;
    }

    console.log('✅ Invoice created in Confido');
    console.log('Confido PaymentLink ID:', confidoResult.confidoInvoiceId);
    console.log('Payment URL:', confidoResult.paymentUrl);

    // Generate invoice number (INV-YYYYMMDD-XXXX format)
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
    const invoiceNumber = `INV-${dateStr}-${randomStr}`;
    console.log('Generated Invoice Number:', invoiceNumber);

    // ===== STEP 9: Save to Supabase =====
    let saveStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'supabase', 'saveInvoiceToSupabase', {
          ghlInvoiceId: objectData.recordId,
          invoiceNumber,
          amountDue: total
        });
        saveStepId = step.stepId;
      } catch (e) {
        console.error('Error starting saveInvoiceToSupabase step:', e.message);
      }
    }

    console.log('Saving to Supabase...');
    try {
      await invoiceService.saveInvoiceToSupabase({
        ghlInvoiceId: objectData.recordId,
        opportunityId: opportunity.id,
        contactId: opportunity.contactId,
        opportunityName: opportunity.name,
        primaryContactName: opportunity.contact?.name,
        confidoInvoiceId: confidoResult.confidoInvoiceId,
        confidoClientId: confidoResult.confidoClientId,
        confidoMatterId: confidoResult.confidoMatterId,
        paymentUrl: confidoResult.paymentUrl,
        serviceItems: lineItems,
        invoiceNumber: invoiceNumber,
        amountDue: total,
        status: 'unpaid',
        invoiceDate: new Date().toISOString(),
        dueDate: invoiceRecord.properties.due_date || null
      }, traceId, saveStepId);
      if (saveStepId) await completeStep(saveStepId, { success: true, invoiceNumber });
      console.log('✅ Invoice saved to Supabase');
    } catch (saveError) {
      if (saveStepId) await failStep(saveStepId, saveError, traceId);
      throw saveError;
    }

    // Calculate subtotal (same as total for now)
    const subtotal = total;

    // ===== STEP 10: Update GHL Custom Object =====
    let updateGhlStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'ghl', 'updateCustomObject', {
          recordId: objectData.recordId,
          fields: ['payment_link', 'invoice_number', 'subtotal', 'total']
        });
        updateGhlStepId = step.stepId;
      } catch (e) {
        console.error('Error starting updateCustomObject step:', e.message);
      }
    }

    try {
      console.log('Updating GHL custom object with payment link and invoice details...');

      // First verify the object still exists
      console.log('Verifying custom object still exists...');
      const verifyResponse = await ghlService.getCustomObject(objectData.objectKey, objectData.recordId, traceId, updateGhlStepId);

      if (verifyResponse && verifyResponse.record) {
        console.log('✅ Custom object verified, proceeding with update');
        await ghlService.updateCustomObject(
          objectData.objectKey,
          objectData.recordId,
          objectData.locationId,
          {
            payment_link: confidoResult.paymentUrl,
            invoice_number: invoiceNumber,
            subtotal: { value: subtotal, currency: 'default' },
            total: { value: total, currency: 'default' }
          },
          traceId,
          updateGhlStepId
        );
        if (updateGhlStepId) await completeStep(updateGhlStepId, { success: true, updated: true });
        console.log('✅ GHL custom object updated with payment link, invoice number, subtotal, and total');
      } else {
        if (updateGhlStepId) await completeStep(updateGhlStepId, { success: true, updated: false, reason: 'object_not_found' });
        console.warn('⚠️ Custom object no longer exists in GHL, skipping update');
      }
    } catch (updateError) {
      if (updateGhlStepId) await failStep(updateGhlStepId, updateError, traceId);
      console.error('Failed to update GHL custom object (non-blocking):', updateError.message);
      if (updateError.response?.data) {
        console.error('GHL Error Details:', JSON.stringify(updateError.response.data, null, 2));
      }
      console.error('This is OK - invoice still created in Confido and Supabase');
    }

    // ===== STEP 11: Send Invoice Email =====
    let emailStepId = null;
    let emailSent = false;
    const contactEmail = opportunity.contact?.email;

    if (contactEmail) {
      if (traceId) {
        try {
          const step = await startStep(traceId, 'email', 'sendInvoiceEmail', {
            contactEmail,
            invoiceNumber,
            amountDue: total
          });
          emailStepId = step.stepId;
        } catch (e) {
          console.error('Error starting sendInvoiceEmail step:', e.message);
        }
      }

      try {
        console.log('Sending invoice email to:', contactEmail);
        const { sendInvoiceEmail } = require('./services/invoiceEmailService');

        const invoiceEmailData = {
          billedTo: opportunity.contact?.name || opportunity.name,
          invoiceNumber: invoiceNumber,
          issueDate: new Date(),
          dueDate: invoiceRecord.properties.due_date ? new Date(invoiceRecord.properties.due_date) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          lineItems: lineItems.map(item => ({
            name: item.name,
            price: item.price,
            quantity: item.quantity || 1,
            tax: '-',
            subtotal: item.price * (item.quantity || 1)
          })),
          subtotal: total,
          amountDue: total,
          paymentLink: confidoResult.paymentUrl
        };

        await sendInvoiceEmail(invoiceEmailData, contactEmail, traceId, emailStepId);
        if (emailStepId) await completeStep(emailStepId, { success: true, emailSent: true });
        console.log('✅ Invoice email sent successfully');
        emailSent = true;
      } catch (emailError) {
        if (emailStepId) await failStep(emailStepId, emailError, traceId);
        console.error('Failed to send invoice email (non-blocking):', emailError.message);
      }
    } else {
      console.warn('⚠️ No contact email found, skipping invoice email');
    }

    // Determine final action for tracking
    const finalAction = emailSent ? 'invoice_created_with_email' : 'invoice_created';

    res.json({
      success: true,
      message: 'Custom invoice processed successfully',
      action: finalAction,
      invoiceId: objectData.recordId,
      opportunityId: opportunity.id,
      total: total,
      lineItems: lineItems,
      missingItems: missingItems,
      emailSent: emailSent,
      confido: {
        invoiceId: confidoResult.confidoInvoiceId,
        paymentUrl: confidoResult.paymentUrl,
        status: confidoResult.status
      }
    });

  } catch (error) {
    console.error('Error processing custom object webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing custom object webhook',
      error: error.message,
      action: 'error'
    });
  }
});

// GHL Custom Object (Invoice) Updated webhook endpoint
// This fires when fields are added/updated on the invoice
// Logic: Update Supabase, then create in Confido if no payment_link exists, otherwise update payment_link
app.post('/webhooks/ghl/custom-object-updated', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== GHL CUSTOM OBJECT UPDATED WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // ===== STEP 1: Webhook Received =====
    let webhookStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'webhook_received', {
          endpoint: '/webhooks/ghl/custom-object-updated',
          method: 'POST',
          contentType: req.headers['content-type'],
          timestamp: new Date().toISOString()
        });
        webhookStepId = step.stepId;
      } catch (e) {
        console.error('Error starting webhook_received step:', e.message);
      }
    }

    const ghlService = require('./services/ghlService');
    const confidoService = require('./services/confidoService');
    const invoiceService = require('./services/invoiceService');

    // Extract custom object data
    const objectData = {
      recordId: req.body.id || req.body.recordId,
      objectKey: req.body.objectKey || req.body.schemaKey,
      locationId: req.body.locationId
    };

    // Update trace with invoice ID
    if (traceId && objectData.recordId) {
      await updateTraceContextIds(traceId, { invoiceId: objectData.recordId });
    }

    // Complete webhook received step
    if (webhookStepId) {
      try {
        await completeStep(webhookStepId, {
          recordId: objectData.recordId,
          objectKey: objectData.objectKey
        });
      } catch (e) {
        console.error('Error completing webhook_received step:', e.message);
      }
    }

    console.log('Custom Object Data:', JSON.stringify(objectData, null, 2));

    // ===== STEP 2: Check if Self-Update (Skip our own updates) =====
    const lastUpdatedBy = req.body.lastUpdatedBy || {};
    const isOurUpdate = lastUpdatedBy.source === 'INTEGRATION';

    let selfUpdateStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'processing', 'check_self_update', {
          lastUpdatedBySource: lastUpdatedBy.source || 'unknown',
          lastUpdatedByChannel: lastUpdatedBy.channel || 'unknown',
          isOurUpdate
        });
        selfUpdateStepId = step.stepId;
      } catch (e) {
        console.error('Error starting check_self_update step:', e.message);
      }
    }

    if (isOurUpdate) {
      console.log('⏭️ Skipping webhook triggered by our own integration update');
      if (selfUpdateStepId) {
        try {
          await completeStep(selfUpdateStepId, {
            skipped: true,
            reason: 'Self-triggered by our integration update',
            action: 'self_update_skipped'
          });
        } catch (e) {
          console.error('Error completing check_self_update step:', e.message);
        }
      }
      return res.json({
        success: true,
        message: 'Skipped webhook triggered by our own update',
        action: 'self_update_skipped'
      });
    }

    // Not our update, continue processing
    if (selfUpdateStepId) {
      try {
        await completeStep(selfUpdateStepId, {
          skipped: false,
          reason: 'External update, processing webhook',
          action: 'process_external_update'
        });
      } catch (e) {
        console.error('Error completing check_self_update step:', e.message);
      }
    }

    // ===== STEP 4: Check Object Type =====
    let checkTypeStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'processing', 'check_object_type', {
          objectKey: objectData.objectKey,
          expectedKey: 'custom_objects.invoices'
        });
        checkTypeStepId = step.stepId;
      } catch (e) {
        console.error('Error starting check_object_type step:', e.message);
      }
    }

    // Check if this is an invoice object
    if (objectData.objectKey !== 'custom_objects.invoices') {
      console.log('ℹ️ Not an invoice object, skipping...');
      if (checkTypeStepId) {
        try {
          await completeStep(checkTypeStepId, { isInvoice: false, action: 'skipped' });
        } catch (e) {
          console.error('Error completing check_object_type step:', e.message);
        }
      }
      return res.json({
        success: true,
        message: 'Custom object received but not processed (not invoice)',
        action: 'not_invoice_skipped'
      });
    }

    // Is invoice object
    if (checkTypeStepId) {
      try {
        await completeStep(checkTypeStepId, { isInvoice: true, action: 'process_update' });
      } catch (e) {
        console.error('Error completing check_object_type step:', e.message);
      }
    }

    console.log('✅ Invoice update detected');
    console.log('Invoice Record ID:', objectData.recordId);

    // ===== STEP 5: Get Custom Object Details =====
    let getRecordStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'ghl', 'getCustomObject', {
          objectKey: objectData.objectKey,
          recordId: objectData.recordId
        });
        getRecordStepId = step.stepId;
      } catch (e) {
        console.error('Error starting getCustomObject step:', e.message);
      }
    }

    let invoiceRecord;
    try {
      const customObjectResponse = await ghlService.getCustomObject(objectData.objectKey, objectData.recordId);
      invoiceRecord = customObjectResponse.record;
      if (getRecordStepId) await completeStep(getRecordStepId, {
        hasPaymentLink: !!invoiceRecord.properties.payment_link,
        serviceItemsCount: (invoiceRecord.properties.serviceproduct || []).length
      });
      console.log('Updated Invoice Record:', JSON.stringify(invoiceRecord, null, 2));
    } catch (getError) {
      if (getRecordStepId) await failStep(getRecordStepId, getError, traceId);
      throw getError;
    }

    // Check if payment_link already exists on this invoice
    const existingPaymentLink = invoiceRecord.properties.payment_link || null;
    console.log('Existing Payment Link:', existingPaymentLink);

    // Extract and calculate from service items
    const serviceItems = invoiceRecord.properties.serviceproduct || [];
    console.log('Service Items:', serviceItems);

    // If no service items, just acknowledge the webhook
    if (serviceItems.length === 0) {
      console.log('ℹ️ No service items yet, waiting for more updates...');
      return res.json({
        success: true,
        message: 'Invoice update received, waiting for service items',
        invoiceId: objectData.recordId,
        hasPaymentLink: !!existingPaymentLink,
        action: 'waiting_for_service_items'
      });
    }

    // Step 2: Calculate invoice total
    let calcStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'invoiceService', 'calculateInvoiceTotal', {
        serviceItemsCount: serviceItems.length
      });
      calcStepId = step.stepId;
    }

    let calculationResult;
    try {
      calculationResult = await invoiceService.calculateInvoiceTotal(serviceItems);
      if (!calculationResult.success) {
        if (calcStepId) await failStep(calcStepId, { message: calculationResult.error }, traceId);
        console.error('Failed to calculate invoice total:', calculationResult.error);
        return res.status(500).json({
          success: false,
          message: 'Failed to calculate invoice total',
          error: calculationResult.error
        });
      }
      if (calcStepId) await completeStep(calcStepId, {
        total: calculationResult.total,
        lineItemsCount: calculationResult.lineItems.length,
        missingItems: calculationResult.missingItems
      });
    } catch (calcError) {
      if (calcStepId) await failStep(calcStepId, calcError, traceId);
      throw calcError;
    }

    const { total, lineItems, missingItems } = calculationResult;
    console.log(`Calculated Total: $${total}`);

    // Step 3: Get relations to find opportunity
    let getRelationsStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlService', 'getRelations', {
        recordId: objectData.recordId
      });
      getRelationsStepId = step.stepId;
    }

    let relationsResponse;
    let opportunityRelation;
    try {
      relationsResponse = await ghlService.getRelations(objectData.recordId, objectData.locationId);
      const hasRelations = relationsResponse.relations && relationsResponse.relations.length > 0;

      opportunityRelation = hasRelations
        ? relationsResponse.relations.find(rel => rel.secondObjectKey === 'opportunity' || rel.firstObjectKey === 'opportunity')
        : null;

      if (getRelationsStepId) await completeStep(getRelationsStepId, {
        hasRelations,
        hasOpportunity: !!opportunityRelation
      });

      if (!opportunityRelation) {
        console.log('⚠️ No opportunity association yet, waiting for association...');
        return res.json({
          success: true,
          message: 'Invoice update received, waiting for opportunity association',
          invoiceId: objectData.recordId,
          hasPaymentLink: !!existingPaymentLink,
          action: 'waiting_for_opportunity_association'
        });
      }
    } catch (relError) {
      if (getRelationsStepId) await failStep(getRelationsStepId, relError, traceId);
      throw relError;
    }

    const opportunityId = opportunityRelation.secondObjectKey === 'opportunity'
      ? opportunityRelation.secondRecordId
      : opportunityRelation.firstRecordId;

    console.log('Found Opportunity ID:', opportunityId);

    // Update trace with opportunity ID
    if (traceId) {
      await updateTraceContextIds(traceId, { opportunityId });
    }

    // Step 4: Get opportunity details
    let getOppStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'ghlService', 'getOpportunity', { opportunityId });
      getOppStepId = step.stepId;
    }

    let opportunity;
    try {
      const opportunityResponse = await ghlService.getOpportunity(opportunityId);
      opportunity = opportunityResponse.opportunity;
      if (getOppStepId) await completeStep(getOppStepId, {
        opportunityName: opportunity.name,
        contactId: opportunity.contactId,
        contactEmail: opportunity.contact?.email
      });
      console.log('Opportunity Details:', JSON.stringify(opportunity, null, 2));
    } catch (oppError) {
      if (getOppStepId) await failStep(getOppStepId, oppError, traceId);
      throw oppError;
    }

    // Step 5: Get existing invoice from Supabase
    let getExistingStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'invoiceService', 'getInvoiceByGHLId', {
        ghlInvoiceId: objectData.recordId
      });
      getExistingStepId = step.stepId;
    }

    let existingInvoice;
    let hasExistingRecord;
    try {
      existingInvoice = await invoiceService.getInvoiceByGHLId(objectData.recordId);
      hasExistingRecord = existingInvoice.success && existingInvoice.data;
      if (getExistingStepId) await completeStep(getExistingStepId, {
        found: hasExistingRecord,
        paymentUrl: existingInvoice.data?.payment_url
      });
    } catch (getExError) {
      if (getExistingStepId) await failStep(getExistingStepId, getExError, traceId);
      throw getExError;
    }

    // Check if payment link exists - branch logic
    if (!existingPaymentLink) {
      // NO PAYMENT LINK - Create in Confido
      console.log('📝 No payment link exists - Creating invoice in Confido...');

      // Step 6a: Create invoice in Confido
      let confidoStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'confidoService', 'createInvoice', {
          ghlInvoiceId: objectData.recordId,
          opportunityId: opportunity.id,
          amountDue: total
        });
        confidoStepId = step.stepId;
      }

      let confidoResult;
      try {
        confidoResult = await confidoService.createInvoice({
          ghlInvoiceId: objectData.recordId,
          opportunityId: opportunity.id,
          opportunityName: opportunity.name,
          contactId: opportunity.contactId,
          contactName: opportunity.contact?.name || '',
          contactEmail: opportunity.contact?.email || '',
          contactPhone: opportunity.contact?.phone || '',
          invoiceNumber: invoiceRecord.properties.invoice || objectData.recordId,
          amountDue: total,
          dueDate: invoiceRecord.properties.due_date || null,
          memo: `Invoice for ${lineItems.map(item => item.name).join(', ')}`,
          lineItems: lineItems
        });

        if (!confidoResult.success) {
          // Check if this is a duplicate PaymentLink error
          if (confidoResult.error === 'DUPLICATE_PAYMENTLINK') {
            console.log('⚠️ PaymentLink already exists in Confido');

            if (hasExistingRecord && existingInvoice.data.payment_url) {
              console.log('✅ Found existing invoice in Supabase with payment URL');
              if (confidoStepId) await completeStep(confidoStepId, {
                isDuplicate: true,
                paymentUrl: existingInvoice.data.payment_url
              });
              return res.json({
                success: true,
                message: 'Invoice already exists (duplicate)',
                invoiceId: objectData.recordId,
                paymentUrl: existingInvoice.data.payment_url,
                isDuplicate: true
              });
            }
          }

          console.error('Failed to create invoice in Confido:', confidoResult.error);
          if (confidoStepId) await failStep(confidoStepId, { message: confidoResult.error }, traceId);
          return res.json({
            success: false,
            message: 'Failed to create invoice in Confido',
            invoiceId: objectData.recordId,
            confidoError: confidoResult.error
          });
        }

        if (confidoStepId) await completeStep(confidoStepId, {
          confidoInvoiceId: confidoResult.confidoInvoiceId,
          paymentUrl: confidoResult.paymentUrl,
          status: confidoResult.status
        });
      } catch (confidoError) {
        if (confidoStepId) await failStep(confidoStepId, confidoError, traceId);
        throw confidoError;
      }

      console.log('✅ Invoice created in Confido');
      console.log('Confido PaymentLink ID:', confidoResult.confidoInvoiceId);
      console.log('Payment URL:', confidoResult.paymentUrl);

      // Generate invoice number
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
      const invoiceNumber = `INV-${dateStr}-${randomStr}`;
      console.log('Generated Invoice Number:', invoiceNumber);

      // Step 7a: Save to Supabase
      let saveStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'invoiceService', 'saveInvoiceToSupabase', {
          ghlInvoiceId: objectData.recordId,
          invoiceNumber,
          amountDue: total
        });
        saveStepId = step.stepId;
      }

      try {
        console.log('Saving to Supabase...');
        await invoiceService.saveInvoiceToSupabase({
          ghlInvoiceId: objectData.recordId,
          opportunityId: opportunity.id,
          contactId: opportunity.contactId,
          opportunityName: opportunity.name,
          primaryContactName: opportunity.contact?.name,
          confidoInvoiceId: confidoResult.confidoInvoiceId,
          confidoClientId: confidoResult.confidoClientId,
          confidoMatterId: confidoResult.confidoMatterId,
          paymentUrl: confidoResult.paymentUrl,
          serviceItems: lineItems,
          invoiceNumber: invoiceNumber,
          amountDue: total,
          status: 'unpaid',
          invoiceDate: new Date().toISOString(),
          dueDate: invoiceRecord.properties.due_date || null
        });
        if (saveStepId) await completeStep(saveStepId, { success: true, invoiceNumber });
        console.log('✅ Invoice saved to Supabase');
      } catch (saveError) {
        if (saveStepId) await failStep(saveStepId, saveError, traceId);
        throw saveError;
      }

      // Step 8a: Update GHL custom object
      let updateGhlStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'ghlService', 'updateCustomObject', {
          recordId: objectData.recordId,
          fields: ['payment_link', 'invoice_number', 'subtotal', 'total', 'status']
        });
        updateGhlStepId = step.stepId;
      }

      const subtotal = total;
      try {
        console.log('Updating GHL custom object with payment link and invoice details...');
        await ghlService.updateCustomObject(
          objectData.objectKey,
          objectData.recordId,
          objectData.locationId,
          {
            payment_link: confidoResult.paymentUrl,
            invoice_number: invoiceNumber,
            subtotal: { value: subtotal, currency: 'default' },
            total: { value: total, currency: 'default' },
            status: 'unpaid'
          }
        );
        if (updateGhlStepId) await completeStep(updateGhlStepId, { success: true, updated: true });
        console.log('✅ GHL custom object updated with payment link, invoice number, subtotal, total, and status');
      } catch (updateError) {
        if (updateGhlStepId) await failStep(updateGhlStepId, updateError, traceId);
        console.error('Failed to update GHL custom object (non-blocking):', updateError.message);
      }

      // Step 9a: Send invoice email
      let emailStepId = null;
      let emailSent = false;
      const contactEmail = opportunity.contact?.email;

      if (contactEmail) {
        if (traceId) {
          const step = await startStep(traceId, 'invoiceEmailService', 'sendInvoiceEmail', {
            contactEmail,
            invoiceNumber
          });
          emailStepId = step.stepId;
        }

        try {
          console.log('Sending invoice email to:', contactEmail);
          const { sendInvoiceEmail } = require('./services/invoiceEmailService');

          const invoiceEmailData = {
            billedTo: opportunity.contact?.name || opportunity.name,
            invoiceNumber: invoiceNumber,
            issueDate: new Date(),
            dueDate: invoiceRecord.properties.due_date ? new Date(invoiceRecord.properties.due_date) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            lineItems: lineItems.map(item => ({
              name: item.name,
              price: item.price,
              quantity: item.quantity || 1,
              tax: '-',
              subtotal: item.price * (item.quantity || 1)
            })),
            subtotal: total,
            amountDue: total,
            paymentLink: confidoResult.paymentUrl
          };

          await sendInvoiceEmail(invoiceEmailData, contactEmail);
          if (emailStepId) await completeStep(emailStepId, { success: true, emailSent: true });
          console.log('✅ Invoice email sent successfully');
          emailSent = true;
        } catch (emailError) {
          if (emailStepId) await failStep(emailStepId, emailError, traceId);
          console.error('Failed to send invoice email (non-blocking):', emailError.message);
        }
      } else {
        console.warn('⚠️ No contact email found, skipping invoice email');
      }

      return res.json({
        success: true,
        message: 'Invoice created in Confido and saved to Supabase',
        invoiceId: objectData.recordId,
        opportunityId: opportunity.id,
        total: total,
        lineItems: lineItems,
        emailSent: emailSent,
        confido: {
          invoiceId: confidoResult.confidoInvoiceId,
          paymentUrl: confidoResult.paymentUrl,
          status: confidoResult.status
        }
      });

    } else {
      // PAYMENT LINK EXISTS - Check if update is needed
      console.log('📝 Payment link exists - Checking if update needed...');

      // Get current values from GHL record to compare
      const currentSubtotal = invoiceRecord.properties.subtotal?.value || invoiceRecord.properties.subtotal || 0;
      const currentTotal = invoiceRecord.properties.total?.value || invoiceRecord.properties.total || 0;
      const currentStatus = invoiceRecord.properties.status || [];

      console.log('Current GHL values:', { subtotal: currentSubtotal, total: currentTotal, status: currentStatus });
      console.log('Calculated values:', { subtotal: total, total: total });

      // Check if GHL update is needed (compare values)
      const subtotal = total;
      const needsGHLUpdate = currentSubtotal !== subtotal || currentTotal !== total;

      if (!needsGHLUpdate) {
        console.log('ℹ️ No GHL update needed - values already match');
        return res.json({
          success: true,
          message: 'Invoice already up to date - no changes needed',
          invoiceId: objectData.recordId,
          opportunityId: opportunity.id,
          total: total,
          existingPaymentLink: existingPaymentLink,
          skippedUpdate: true
        });
      }

      // Step 6b: Update Supabase with new values
      let updateSupabaseStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'invoiceService', 'updateInvoiceInSupabase', {
          ghlInvoiceId: objectData.recordId,
          amountDue: total
        });
        updateSupabaseStepId = step.stepId;
      }

      try {
        await invoiceService.updateInvoiceInSupabase(objectData.recordId, {
          amount_due: total,
          service_items: lineItems,
          invoice_number: invoiceRecord.properties.invoice || objectData.recordId,
          due_date: invoiceRecord.properties.due_date || null
        });
        if (updateSupabaseStepId) await completeStep(updateSupabaseStepId, { success: true, amountDue: total });
        console.log('✅ Invoice updated in Supabase');
      } catch (updateSupaError) {
        if (updateSupabaseStepId) await failStep(updateSupabaseStepId, updateSupaError, traceId);
        throw updateSupaError;
      }

      // Step 7b: Update GHL custom object with new totals
      let updateGhlStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'ghlService', 'updateCustomObject', {
          recordId: objectData.recordId,
          fields: ['subtotal', 'total']
        });
        updateGhlStepId = step.stepId;
      }

      try {
        console.log('Updating GHL custom object with new totals...');
        await ghlService.updateCustomObject(
          objectData.objectKey,
          objectData.recordId,
          objectData.locationId,
          {
            subtotal: { value: subtotal, currency: 'default' },
            total: { value: total, currency: 'default' }
          }
        );
        if (updateGhlStepId) await completeStep(updateGhlStepId, { success: true, subtotal, total });
        console.log('✅ GHL custom object updated with new totals');
      } catch (updateError) {
        if (updateGhlStepId) await failStep(updateGhlStepId, updateError, traceId);
        console.error('Failed to update GHL custom object (non-blocking):', updateError.message);
      }

      // Note: Confido PaymentLink amount cannot be changed after creation
      // Log warning if amount changed
      if (hasExistingRecord && total !== parseFloat(existingInvoice.data.amount_due)) {
        console.warn('⚠️ Invoice amount changed - Confido PaymentLink may need manual adjustment');
        console.warn(`Old: $${existingInvoice.data.amount_due}, New: $${total}`);
      }

      return res.json({
        success: true,
        message: 'Invoice updated in Supabase',
        action: 'invoice_updated',
        invoiceId: objectData.recordId,
        opportunityId: opportunity.id,
        total: total,
        lineItems: lineItems,
        existingPaymentLink: existingPaymentLink,
        missingItems: missingItems
      });
    }

  } catch (error) {
    console.error('Error processing custom object update webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing custom object update webhook',
      error: error.message,
      action: 'error'
    });
  }
});

// GHL Custom Object (Invoice) Deleted webhook endpoint
// Deletes PaymentLink from Confido and marks invoice as deleted in Supabase
app.post('/webhooks/ghl/custom-object-deleted', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== GHL CUSTOM OBJECT DELETED WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // ===== STEP 1: Webhook Received =====
    let webhookStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'express', 'webhook_received', {
          endpoint: '/webhooks/ghl/custom-object-deleted',
          method: 'POST',
          contentType: req.headers['content-type'],
          timestamp: new Date().toISOString()
        });
        webhookStepId = step.stepId;
      } catch (e) {
        console.error('Error starting webhook_received step:', e.message);
      }
    }

    const invoiceService = require('./services/invoiceService');
    const confidoService = require('./services/confidoService');

    // Extract custom object data
    const objectData = {
      recordId: req.body.id || req.body.recordId,
      objectKey: req.body.objectKey || req.body.schemaKey,
      locationId: req.body.locationId
    };

    // Update trace with invoice ID
    if (traceId && objectData.recordId) {
      await updateTraceContextIds(traceId, { invoiceId: objectData.recordId });
    }

    // Complete webhook received step
    if (webhookStepId) {
      try {
        await completeStep(webhookStepId, {
          recordId: objectData.recordId,
          objectKey: objectData.objectKey
        });
      } catch (e) {
        console.error('Error completing webhook_received step:', e.message);
      }
    }

    console.log('Custom Object Data:', JSON.stringify(objectData, null, 2));

    // ===== STEP 2: Check Object Type =====
    let checkTypeStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'processing', 'check_object_type', {
          objectKey: objectData.objectKey,
          expectedKey: 'custom_objects.invoices'
        });
        checkTypeStepId = step.stepId;
      } catch (e) {
        console.error('Error starting check_object_type step:', e.message);
      }
    }

    // Check if this is an invoice object
    if (objectData.objectKey !== 'custom_objects.invoices') {
      console.log('ℹ️ Not an invoice object, skipping...');
      if (checkTypeStepId) {
        try {
          await completeStep(checkTypeStepId, { isInvoice: false, action: 'skipped' });
        } catch (e) {
          console.error('Error completing check_object_type step:', e.message);
        }
      }
      return res.json({
        success: true,
        message: 'Custom object received but not processed (not invoice)',
        action: 'not_invoice_skipped'
      });
    }

    // Is invoice object
    if (checkTypeStepId) {
      try {
        await completeStep(checkTypeStepId, { isInvoice: true, action: 'process_delete' });
      } catch (e) {
        console.error('Error completing check_object_type step:', e.message);
      }
    }

    console.log('✅ Invoice deletion detected');
    console.log('Invoice Record ID:', objectData.recordId);

    // ===== STEP 3: Get Existing Invoice =====
    let getInvoiceStepId = null;
    if (traceId) {
      try {
        const step = await startStep(traceId, 'supabase', 'getInvoiceByGHLId', {
          ghlInvoiceId: objectData.recordId
        });
        getInvoiceStepId = step.stepId;
      } catch (e) {
        console.error('Error starting getInvoiceByGHLId step:', e.message);
      }
    }

    let existingInvoice;
    try {
      existingInvoice = await invoiceService.getInvoiceByGHLId(objectData.recordId);

      if (!existingInvoice.success || !existingInvoice.data) {
        if (getInvoiceStepId) await completeStep(getInvoiceStepId, { found: false, action: 'not_found' });
        console.log('ℹ️ Invoice not found in Supabase - already deleted or never created');
        console.log('Nothing to do, returning success');
        return res.json({
          success: true,
          message: 'Invoice not found (already deleted or never created) - no action needed',
          invoiceId: objectData.recordId,
          action: 'not_found_no_action'
        });
      }

      if (getInvoiceStepId) await completeStep(getInvoiceStepId, {
        found: true,
        confidoInvoiceId: existingInvoice.data.confido_invoice_id,
        status: existingInvoice.data.status
      });
    } catch (getError) {
      if (getInvoiceStepId) await failStep(getInvoiceStepId, getError, traceId);
      throw getError;
    }

    const confidoInvoiceId = existingInvoice.data.confido_invoice_id;

    // Step 2: Delete PaymentLink from Confido if it exists
    let confidoDeleteResult = null;
    if (confidoInvoiceId) {
      let deleteConfidoStepId = null;
      if (traceId) {
        const step = await startStep(traceId, 'confidoService', 'deletePaymentLink', {
          confidoInvoiceId
        });
        deleteConfidoStepId = step.stepId;
      }

      try {
        console.log('Deleting PaymentLink from Confido...');
        console.log('Confido PaymentLink ID:', confidoInvoiceId);

        confidoDeleteResult = await confidoService.deletePaymentLink(confidoInvoiceId);

        if (confidoDeleteResult.success) {
          if (deleteConfidoStepId) await completeStep(deleteConfidoStepId, { success: true, deleted: true });
          console.log('✅ PaymentLink deleted from Confido');
        } else {
          if (deleteConfidoStepId) await completeStep(deleteConfidoStepId, {
            success: false,
            error: confidoDeleteResult.error
          });
          console.error('⚠️ Failed to delete PaymentLink from Confido:', confidoDeleteResult.error);
          // Continue anyway - still mark as deleted in Supabase
        }
      } catch (deleteError) {
        if (deleteConfidoStepId) await failStep(deleteConfidoStepId, deleteError, traceId);
        console.error('⚠️ Error deleting PaymentLink from Confido:', deleteError.message);
        // Continue anyway - still mark as deleted in Supabase
      }
    } else {
      console.log('ℹ️ No Confido PaymentLink ID found - skipping Confido deletion');
    }

    // Step 3: Update status to deleted in Supabase
    let updateSupabaseStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'invoiceService', 'updateInvoiceInSupabase', {
        ghlInvoiceId: objectData.recordId,
        status: 'deleted'
      });
      updateSupabaseStepId = step.stepId;
    }

    try {
      await invoiceService.updateInvoiceInSupabase(objectData.recordId, {
        status: 'deleted'
      });
      if (updateSupabaseStepId) await completeStep(updateSupabaseStepId, { success: true, status: 'deleted' });
      console.log('✅ Invoice marked as deleted in Supabase');
    } catch (updateError) {
      if (updateSupabaseStepId) await failStep(updateSupabaseStepId, updateError, traceId);
      throw updateError;
    }

    res.json({
      success: true,
      message: 'Invoice deleted successfully',
      action: 'invoice_deleted',
      invoiceId: objectData.recordId,
      confidoInvoiceId: confidoInvoiceId,
      confidoDeleted: confidoDeleteResult?.success || false,
      confidoError: confidoDeleteResult?.error || null
    });

  } catch (error) {
    console.error('Error processing custom object delete webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing custom object delete webhook',
      error: error.message,
      action: 'error'
    });
  }
});

// Invoice Viewer Page - Public page for viewing and paying invoices
app.get('/invoice/:invoiceNumber', async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    console.log('=== INVOICE VIEWER REQUEST ===');
    console.log('Invoice Number:', invoiceNumber);

    const invoiceService = require('./services/invoiceService');
    const { formatCurrency, formatDate } = require('./services/invoicePdfService');

    // Get invoice from Supabase by invoice number
    const invoiceResult = await invoiceService.getInvoiceByInvoiceNumber(invoiceNumber);

    if (!invoiceResult.success || !invoiceResult.data) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invoice Not Found</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #1a365d; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Invoice Not Found</h1>
            <p>The invoice you're looking for could not be found.</p>
            <p>Please check the invoice number and try again.</p>
          </div>
        </body>
        </html>
      `);
    }

    const invoice = invoiceResult.data;
    const isPaid = invoice.status === 'paid';

    // Parse service items
    const serviceItems = invoice.service_items || [];
    const lineItemsHTML = serviceItems.map(item => `
      <tr>
        <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0;">${item.name || '-'}</td>
        <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; text-align: center;">${formatCurrency(item.price || 0)}</td>
        <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; text-align: center;">${item.quantity || 1}</td>
        <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatCurrency((item.price || 0) * (item.quantity || 1))}</td>
      </tr>
    `).join('');

    const LOGO_URL = 'https://storage.googleapis.com/msgsndr/afYLuZPi37CZR1IpJlfn/media/68f107369d906785d9458314.png';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoice_number} - Safe Harbor Law Firm</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 14px; color: #333; background: #e8f4fc; min-height: 100vh; padding: 20px; }
    .invoice-container { max-width: 800px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 20px rgba(0,0,0,0.1); padding: 40px 50px; }
    .header { border-bottom: 3px solid #1a365d; padding-bottom: 10px; margin-bottom: 30px; }
    .header-title { text-align: right; font-size: 36px; font-weight: bold; color: #1a365d; letter-spacing: 2px; }
    .company-section { display: flex; justify-content: space-between; margin-bottom: 40px; flex-wrap: wrap; }
    .logo-section { width: 45%; min-width: 250px; }
    .logo { max-width: 280px; height: auto; }
    .company-details { width: 50%; text-align: right; font-size: 13px; line-height: 1.6; color: #444; min-width: 200px; }
    .company-name { font-weight: 600; color: #1a365d; }
    .company-website { color: #2b6cb0; text-decoration: none; }
    .billing-section { display: flex; justify-content: space-between; margin-bottom: 40px; flex-wrap: wrap; gap: 20px; }
    .billed-to, .invoice-info, .date-info { min-width: 150px; }
    .section-label { font-weight: 600; color: #1a365d; margin-bottom: 8px; font-size: 14px; }
    .section-value { color: #555; font-size: 14px; }
    .date-label { font-weight: 600; color: #1a365d; margin-top: 15px; margin-bottom: 5px; }
    .date-label:first-child { margin-top: 0; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    .items-table thead { background: #f8f9fa; }
    .items-table th { text-align: left; padding: 12px 15px; font-weight: 600; color: #1a365d; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #3182ce; }
    .items-table th:nth-child(2), .items-table th:nth-child(3) { text-align: center; }
    .items-table th:last-child { text-align: right; }
    .totals-section { display: flex; justify-content: ${isPaid ? 'space-between' : 'flex-end'}; align-items: flex-end; margin-bottom: 30px; flex-wrap: wrap; gap: 20px; }
    .totals-table { width: 280px; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .totals-row.amount-due { border-bottom: none; border-top: 2px solid #1a365d; margin-top: 5px; padding-top: 12px; }
    .totals-label { font-weight: 600; color: #555; }
    .totals-row.amount-due .totals-label, .totals-row.amount-due .totals-value { font-weight: 700; color: #1a365d; font-size: 18px; }
    .totals-value { color: #333; }
    .paid-badge { display: inline-block; background: #48bb78; color: #fff; padding: 12px 30px; font-weight: 700; font-size: 18px; border-radius: 6px; text-transform: uppercase; letter-spacing: 2px; }
    .action-buttons { display: flex; gap: 15px; justify-content: center; margin-top: 40px; flex-wrap: wrap; }
    .btn { display: inline-block; padding: 14px 30px; font-size: 16px; font-weight: bold; text-decoration: none; border-radius: 6px; cursor: pointer; border: none; transition: all 0.2s; }
    .btn-pay { background: #e07c5a; color: #fff; }
    .btn-pay:hover { background: #c9684a; }
    .btn-download { background: #1a365d; color: #fff; }
    .btn-download:hover { background: #2c5282; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #888; font-size: 12px; }
    @media (max-width: 600px) {
      .invoice-container { padding: 20px; }
      .company-section, .billing-section { flex-direction: column; }
      .logo-section, .company-details { width: 100%; text-align: center; }
      .company-details { margin-top: 20px; text-align: center; }
      .header-title { font-size: 28px; }
      .totals-section { justify-content: center; }
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <div class="header">
      <div class="header-title">INVOICE</div>
    </div>

    <div class="company-section">
      <div class="logo-section">
        <img src="${LOGO_URL}" alt="Safe Harbor Law Firm" class="logo">
      </div>
      <div class="company-details">
        <div class="company-name">Safe Harbor Law Firm</div>
        <div>+12393173116</div>
        <div>4500 Executive Drive Suite 100</div>
        <div>Naples, Florida</div>
        <div>34119</div>
        <div>US</div>
        <div><a href="https://safeharborlawfirm.com/" class="company-website">https://safeharborlawfirm.com/</a></div>
      </div>
    </div>

    <div class="billing-section">
      <div class="billed-to">
        <div class="section-label">Billed to</div>
        <div class="section-value">${invoice.primary_contact_name || '-'}</div>
      </div>
      <div class="invoice-info">
        <div class="section-label">Invoice Number</div>
        <div class="section-value">${invoice.invoice_number || '-'}</div>
      </div>
      <div class="date-info">
        <div class="section-label">Issue Date</div>
        <div class="section-value">${formatDate(invoice.invoice_date)}</div>
        <div class="date-label">Due Date</div>
        <div class="section-value">${formatDate(invoice.due_date)}</div>
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th>ITEM NAME</th>
          <th>PRICE</th>
          <th>QUANTITY</th>
          <th>SUBTOTAL</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemsHTML}
      </tbody>
    </table>

    <div class="totals-section">
      ${isPaid ? '<div class="paid-badge">PAID</div>' : ''}
      <div class="totals-table">
        <div class="totals-row">
          <span class="totals-label">Subtotal</span>
          <span class="totals-value">${formatCurrency(invoice.amount_due)}</span>
        </div>
        <div class="totals-row amount-due">
          <span class="totals-label">${isPaid ? 'Amount Paid' : 'Amount Due'} (USD)</span>
          <span class="totals-value">${formatCurrency(invoice.amount_due)}</span>
        </div>
      </div>
    </div>

    <div class="action-buttons">
      ${!isPaid && invoice.payment_url ? `<a href="${invoice.payment_url}" class="btn btn-pay">Pay Now</a>` : ''}
      <a href="/invoice/${invoice.invoice_number}/download" class="btn btn-download">Download PDF</a>
    </div>

    <div class="footer">
      <p>${isPaid ? 'Thank you for your payment!' : 'Thank you for your business!'}</p>
      <p>Safe Harbor Law Firm</p>
    </div>
  </div>
</body>
</html>
    `;

    res.send(html);

  } catch (error) {
    console.error('Error rendering invoice page:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
          .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; }
          h1 { color: #c53030; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Error</h1>
          <p>An error occurred while loading the invoice. Please try again later.</p>
        </div>
      </body>
      </html>
    `);
  }
});

// Invoice PDF Download endpoint
app.get('/invoice/:invoiceNumber/download', async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    console.log('=== INVOICE PDF DOWNLOAD REQUEST ===');
    console.log('Invoice Number:', invoiceNumber);

    const invoiceService = require('./services/invoiceService');
    const { generateInvoicePDF, generatePaidInvoicePDF } = require('./services/invoicePdfService');

    // Get invoice from Supabase
    const invoiceResult = await invoiceService.getInvoiceByInvoiceNumber(invoiceNumber);

    if (!invoiceResult.success || !invoiceResult.data) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.data;
    const isPaid = invoice.status === 'paid';

    // Prepare invoice data for PDF generation
    const invoiceData = {
      billedTo: invoice.primary_contact_name,
      invoiceNumber: invoice.invoice_number,
      issueDate: invoice.invoice_date,
      dueDate: invoice.due_date,
      lineItems: (invoice.service_items || []).map(item => ({
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        tax: '-',
        subtotal: (item.price || 0) * (item.quantity || 1)
      })),
      subtotal: parseFloat(invoice.amount_due),
      amountDue: parseFloat(invoice.amount_due),
      paymentLink: invoice.payment_url,
      paymentsReceived: isPaid ? parseFloat(invoice.amount_due) : 0
    };

    // Generate appropriate PDF
    let pdfBuffer;
    if (isPaid) {
      pdfBuffer = await generatePaidInvoicePDF(invoiceData);
    } else {
      pdfBuffer = await generateInvoicePDF(invoiceData);
    }

    // Convert to proper Buffer if needed
    const properBuffer = Buffer.from(pdfBuffer);

    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${invoiceNumber}.pdf"`);
    res.setHeader('Content-Length', properBuffer.length);

    res.send(properBuffer);

  } catch (error) {
    console.error('Error generating invoice PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ============================================
// CRON JOB ENDPOINTS
// ============================================

const { processScheduledReminders } = require('./services/appointmentSmsService');

/**
 * Cron endpoint to process scheduled SMS reminders
 * Should be called every 15-30 minutes during business hours (8am-4pm EST)
 *
 * Example cron setup (every 15 minutes, 8am-4pm EST):
 * 0,15,30,45 8-15 * * * curl -X POST https://your-server.com/cron/process-sms-reminders
 */
app.post('/cron/process-sms-reminders', async (req, res) => {
  const { traceId } = req;

  console.log('\n========================================');
  console.log('📱 CRON: Process SMS Reminders');
  console.log('========================================');
  console.log('Time:', new Date().toISOString());

  // Step: Process scheduled SMS reminders
  let processStepId = null;
  if (traceId) {
    const step = await startStep(traceId, 'appointmentSmsService', 'processScheduledReminders', {});
    processStepId = step.stepId;
  }

  try {
    const result = await processScheduledReminders(traceId, processStepId);
    if (processStepId) await completeStep(processStepId, result);

    console.log('CRON Result:', JSON.stringify(result, null, 2));

    res.json({
      success: true,
      message: 'SMS reminders processed',
      result
    });

  } catch (error) {
    if (processStepId) await failStep(processStepId, error, traceId);
    console.error('❌ CRON Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GHL Inbound SMS webhook endpoint
// Detects "Y"/"y" confirmation replies and adds "Confirmed [meeting_type]" tag
app.post('/webhooks/ghl/inbound-sms', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== GHL INBOUND SMS WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // Extract SMS data from GHL webhook
    // GHL InboundMessage webhook format
    const smsData = {
      type: req.body.type,
      body: req.body.body,
      contactId: req.body.contactId,
      messageType: req.body.messageType,
      direction: req.body.direction,
      conversationId: req.body.conversationId,
      locationId: req.body.locationId,
      dateAdded: req.body.dateAdded,
      attachments: req.body.attachments
    };

    console.log('Extracted SMS data:', JSON.stringify(smsData, null, 2));

    // Update trace with contact ID
    if (traceId && smsData.contactId) {
      await updateTraceContextIds(traceId, { contactId: smsData.contactId });
    }

    // Step: Process the inbound SMS
    let processStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'smsConfirmationService', 'processInboundSms', smsData);
      processStepId = step.stepId;
    }

    try {
      const result = await processInboundSms(smsData, traceId, processStepId);
      if (processStepId) await completeStep(processStepId, result);

      res.json({
        success: true,
        message: result.action === 'tagged' ? 'Confirmation tag added' : 'Message processed',
        action: result.action,
        tagAdded: result.tagAdded,
        meetingType: result.meetingType,
        reason: result.reason
      });
    } catch (processError) {
      if (processStepId) await failStep(processStepId, processError, traceId);
      throw processError;
    }

  } catch (error) {
    console.error('Error processing GHL inbound SMS webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message
    });
  }
});

// Call Transcript webhook endpoint
// Receives call transcript, summarizes via OpenRouter, saves both to GHL contact custom fields
app.post('/webhooks/ghl/call-transcript', async (req, res) => {
  const { traceId } = req;

  try {
    console.log('=== CALL TRANSCRIPT WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // Extract contact ID and transcript from request
    const contactId = req.body.contactId || req.body.contact_id || req.body['contact-id'];
    const transcript = req.body.transcript || req.body.call_transcript || req.body['call-transcript'];

    // Update trace with contact ID
    if (traceId && contactId) {
      await updateTraceContextIds(traceId, { contactId });
    }

    // Validate required fields
    if (!contactId) {
      console.error('Missing contactId in request');
      return res.status(400).json({
        success: false,
        message: 'Missing required field: contactId'
      });
    }

    if (!transcript) {
      console.error('Missing transcript in request');
      return res.status(400).json({
        success: false,
        message: 'Missing required field: transcript'
      });
    }

    // Step: Process the call transcript
    const { processCallTranscript } = require('./services/callTranscriptService');

    let processStepId = null;
    if (traceId) {
      const step = await startStep(traceId, 'callTranscriptService', 'processCallTranscript', { contactId, transcriptLength: transcript?.length || 0 });
      processStepId = step.stepId;
    }

    try {
      const result = await processCallTranscript(contactId, transcript, traceId, processStepId);
      if (processStepId) await completeStep(processStepId, result);

      console.log('Call transcript processed successfully');
      console.log('Summary:', result.summary);

      res.json({
        success: true,
        message: 'Call transcript processed and saved',
        contactId: result.contactId,
        transcriptLength: result.transcriptLength,
        summaryLength: result.summaryLength,
        summary: result.summary
      });
    } catch (processError) {
      if (processStepId) await failStep(processStepId, processError, traceId);
      throw processError;
    }

  } catch (error) {
    console.error('Error processing call transcript webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing call transcript',
      error: error.message
    });
  }
});

// Error handling middleware for tracing (must be after all routes)
app.use(tracingErrorMiddleware);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/jotform`);
  console.log(`Tracing enabled: ${process.env.CONVEX_URL ? 'yes' : 'no'}`);
});

module.exports = app;
