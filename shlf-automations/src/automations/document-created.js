import { ClioService } from '../services/clio.js';
import { SupabaseService } from '../services/supabase.js';
import { addBusinessDays, formatForClio } from '../utils/date-helpers.js';
import { config } from '../config/index.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { EventTracker } from '../services/event-tracker.js';

/**
 * AUTOMATION: Document Created in Clio Drive
 *
 * Triggers: When a document is created in Clio Drive
 *
 * Process:
 * 1. Validate document has matter association
 * 2. Create "New Clio Drive Document Save to OD" task
 * 3. Assign to user 357379471
 * 4. Set due date to 1 business day from now
 */
export class DocumentCreatedAutomation {
  static ASSIGNEE_ID = 357379471;
  static TASK_NAME = 'New Clio Drive Document Save to OD';
  static TASK_DESCRIPTION = 'New Clio Drive Document Save to OD';
  static DUE_DAYS = 1;

  /**
   * Main entry point for document creation automation
   *
   * @param {Object} webhookData - The webhook payload from Clio
   * @param {string} [traceId] - Optional trace ID for event tracking
   */
  static async process(webhookData, traceId = null) {
    const documentId = webhookData.data.id;
    const timestamp = webhookData.data.created_at;

    console.log(`[DOCUMENT] ${documentId} CREATED`);

    // Step: Validation
    const validationStepId = await EventTracker.startStep(traceId, {
      layerName: 'automation',
      stepName: 'validation',
      metadata: { documentId },
    });

    // Validate timestamp exists (required for idempotency)
    if (!timestamp) {
      const error = `Webhook missing required timestamp field (created_at)`;
      console.error(`[DOCUMENT] ${documentId} ${error}`);

      await SupabaseService.logError(
        ERROR_CODES.CLIO_API_FAILED,
        error,
        {
          document_id: documentId,
          webhook_id: webhookData.id,
          webhook_data: webhookData.data,
        }
      );

      await EventTracker.endStep(validationStepId, { status: 'error', errorMessage: error });
      throw new Error(error);
    }

    await EventTracker.endStep(validationStepId, { status: 'success' });

    // Step: Idempotency check
    const idempotencyStepId = await EventTracker.startStep(traceId, {
      layerName: 'processing',
      stepName: 'idempotency_check',
      metadata: { documentId },
    });

    const idempotencyKey = SupabaseService.generateIdempotencyKey(
      'document.created',
      documentId,
      timestamp
    );

    const existing = await SupabaseService.checkWebhookProcessed(idempotencyKey);
    if (existing) {
      // Check if webhook is still processing
      if (existing.success === null) {
        console.log(`[DOCUMENT] ${documentId} Still processing (concurrent request)`);
        await EventTracker.endStep(idempotencyStepId, { status: 'skipped', metadata: { reason: 'still_processing' } });
        return {
          success: null,
          action: 'still_processing',
          processing_started_at: existing.created_at,
        };
      }

      console.log(`[DOCUMENT] ${documentId} Already processed (idempotency) at ${existing.processed_at}`);
      await EventTracker.endStep(idempotencyStepId, { status: 'skipped', metadata: { reason: 'already_processed' } });
      return {
        success: existing.success,
        action: existing.action,
        processed_at: existing.processed_at,
        cached: true,
      };
    }

    await EventTracker.endStep(idempotencyStepId, { status: 'success' });

    // Step 0.5: Reserve webhook immediately (prevents duplicate processing)
    await SupabaseService.recordWebhookProcessed({
      idempotency_key: idempotencyKey,
      webhook_id: webhookData.id,
      event_type: 'document.created',
      resource_type: 'document',
      resource_id: documentId,
      success: null, // NULL = processing
      action: 'processing',
      webhook_payload: webhookData,
    });

    const startTime = Date.now();

    try {
      // Step 1: Validate document has matter
      const matterId = webhookData.data.matter?.id;
      if (!matterId) {
        const error = `Document missing required matter association`;
        console.error(`[DOCUMENT] ${documentId} ${error}`);

        await SupabaseService.logError(
          ERROR_CODES.VALIDATION_MISSING_MATTER,
          error,
          {
            document_id: documentId,
            document_data: webhookData.data,
          }
        );

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: false,
          action: 'missing_matter',
        });

        console.log(`[DOCUMENT] ${documentId} COMPLETED (missing matter)\n`);
        return { success: false, action: 'missing_matter' };
      }

      // TEMPORARY: Test mode filter - only process documents from specific matter
      if (config.testing.testMode && matterId !== config.testing.testMatterId) {
        console.log(`[DOCUMENT] ${documentId} SKIPPED (test mode - matter ${matterId} !== ${config.testing.testMatterId})`);

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_test_mode',
        });

        return { success: true, action: 'skipped_test_mode' };
      }

      console.log(`[DOCUMENT] ${documentId} Creating task for matter ${matterId}`);

      // Step: Fetch matter details
      const fetchMatterStepId = await EventTracker.startStep(traceId, {
        layerName: 'automation',
        stepName: 'fetch_matter',
        metadata: { matterId },
      });
      const fetchMatterCtx = EventTracker.createContext(traceId, fetchMatterStepId);

      const matterDetails = await ClioService.getMatter(matterId, fetchMatterCtx);

      // Filter out closed matters
      if (matterDetails.status === 'Closed') {
        console.log(`[DOCUMENT] ${documentId} SKIPPED (matter is closed)`);
        await EventTracker.endStep(fetchMatterStepId, { status: 'skipped', metadata: { reason: 'matter_closed' } });

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_closed_matter',
        });

        return { success: true, action: 'skipped_closed_matter' };
      }

      await EventTracker.endStep(fetchMatterStepId, { status: 'success' });

      // Step: Fetch document details
      const fetchDocumentStepId = await EventTracker.startStep(traceId, {
        layerName: 'automation',
        stepName: 'fetch_document',
        metadata: { documentId },
      });
      const fetchDocumentCtx = EventTracker.createContext(traceId, fetchDocumentStepId);

      const document = await ClioService.getDocument(documentId, fetchDocumentCtx);
      const documentName = document.name || 'Unknown Document';
      const parentFolder = document.parent;
      const matterDisplayNumber = document.matter.display_number;

      console.log(`[DOCUMENT] ${documentId} Document name: ${documentName}`);
      console.log(`[DOCUMENT] ${documentId} Parent: ${parentFolder ? `${parentFolder.name} (${parentFolder.type})` : 'None'}`);
      console.log(`[DOCUMENT] ${documentId} Matter: ${matterDisplayNumber}`);

      // Check if document is in a subfolder
      // Root folder has the same name as the matter display number
      // Only generate tasks for documents in root (parent name = matter display number)
      if (parentFolder && parentFolder.name !== matterDisplayNumber) {
        console.log(`[DOCUMENT] ${documentId} SKIPPED - Document in subfolder: ${parentFolder.name}`);
        await EventTracker.endStep(fetchDocumentStepId, { status: 'skipped', metadata: { reason: 'in_subfolder', folder: parentFolder.name } });

        await SupabaseService.updateWebhookProcessed(idempotencyKey, {
          processing_duration_ms: Date.now() - startTime,
          success: true,
          action: 'skipped_in_folder',
        });

        return { success: true, action: 'skipped_in_folder', folder: parentFolder.name };
      }

      await EventTracker.endStep(fetchDocumentStepId, { status: 'success' });

      console.log(`[DOCUMENT] ${documentId} Document is in root - proceeding with task creation`);

      // Step: Create task
      const createTaskStepId = await EventTracker.startStep(traceId, {
        layerName: 'automation',
        stepName: 'create_task',
        metadata: { matterId, documentId },
      });
      const createTaskCtx = EventTracker.createContext(traceId, createTaskStepId);

      // Calculate due date (1 business day from now)
      const dueDate = addBusinessDays(new Date(), this.DUE_DAYS);
      const dueDateFormatted = formatForClio(dueDate);

      console.log(`[DOCUMENT] ${documentId} Due date: ${dueDateFormatted}`);

      // Create task description with document name
      const taskDescription = `New document: ${documentName}`;

      // Create task in Clio
      const newTask = await ClioService.createTask({
        name: this.TASK_NAME,
        description: taskDescription,
        matter: { id: matterId },
        assignee: { id: this.ASSIGNEE_ID, type: 'User' },
        due_at: dueDateFormatted,
      }, createTaskCtx);

      console.log(`[DOCUMENT] ${documentId} Task created: ${newTask.id}`);

      // Record task in Supabase
      await SupabaseService.insertTask({
        task_id: newTask.id,
        task_name: newTask.name,
        task_desc: newTask.description,
        matter_id: matterId,
        assigned_user_id: this.ASSIGNEE_ID,
        assigned_user: 'Auto-assigned',
        due_date: dueDateFormatted,
        stage_id: null,
        stage_name: null,
        task_number: null,
        completed: false,
        status: 'pending',
        task_date_generated: new Date().toISOString(),
        due_date_generated: new Date().toISOString(),
      }, createTaskCtx);

      await EventTracker.endStep(createTaskStepId, { status: 'success', metadata: { taskId: newTask.id } });

      // Update webhook to success
      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: true,
        action: 'task_created',
        tasks_created: 1,
      });

      console.log(`[DOCUMENT] ${documentId} COMPLETED\n`);

      return {
        success: true,
        action: 'task_created',
        taskId: newTask.id,
        matterId,
      };

    } catch (error) {
      console.error(`[DOCUMENT] ${documentId} ERROR: ${error.message}`);

      await SupabaseService.updateWebhookProcessed(idempotencyKey, {
        processing_duration_ms: Date.now() - startTime,
        success: false,
        action: 'error',
      });

      throw error;
    }
  }
}
