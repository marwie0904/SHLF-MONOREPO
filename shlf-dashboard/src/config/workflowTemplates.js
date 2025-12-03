/**
 * Workflow Templates - Defines all possible paths for each webhook type
 *
 * Each node has:
 * - id: Unique identifier
 * - name: Display name
 * - layer: Layer type for color coding
 * - type: 'step' | 'decision' | 'outcome'
 * - condition: For decisions, the condition being evaluated
 * - children: Array of possible next nodes (for steps) or branches (for decisions)
 * - matchStep: Step name to match from actual trace data
 * - matchAction: Result action to match for outcomes
 */

// ============================================================================
// MATTER STAGE CHANGE WORKFLOW
// ============================================================================
export const matterStageChangeWorkflow = {
  id: 'matter-stage-change',
  name: 'Matter Stage Change',
  trigger: '/webhooks/matters',
  triggerName: 'matter-stage-change',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'webhook_received',
    children: [{
      id: 'validation',
      name: 'Validate Timestamp',
      layer: 'processing',
      type: 'step',
      matchStep: 'validation',
      children: [{
        id: 'idempotency',
        name: 'Idempotency Check',
        layer: 'processing',
        type: 'step',
        matchStep: 'idempotency_check',
        children: [{
          id: 'test_mode',
          name: 'Test Mode Filter',
          layer: 'decision',
          type: 'decision',
          condition: 'Is matter in test mode allowlist?',
          children: [
            {
              label: 'Blocked',
              value: false,
              node: { id: 'test_blocked', name: 'Test Mode Blocked', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_test_mode', children: [] }
            },
            {
              label: 'Allowed',
              value: true,
              node: {
                id: 'fetch_matter',
                name: 'Fetch Matter',
                layer: 'service',
                type: 'step',
                matchStep: 'fetch_matter',
                children: [{
                  id: 'matter_closed',
                  name: 'Matter Closed?',
                  layer: 'decision',
                  type: 'decision',
                  condition: 'Check current matter status',
                  children: [
                    {
                      label: 'Yes',
                      value: true,
                      node: { id: 'closed', name: 'Matter Closed', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_closed_matter', children: [] }
                    },
                    {
                      label: 'No',
                      value: false,
                      node: {
                        id: 'has_stage',
                        name: 'Has Stage?',
                        layer: 'decision',
                        type: 'decision',
                        condition: 'Check if matter has stage info',
                        children: [
                          {
                            label: 'No',
                            value: false,
                            node: { id: 'no_stage', name: 'No Stage', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'missing_stage', children: [] }
                          },
                          {
                            label: 'Yes',
                            value: true,
                            node: {
                              id: 'stage_change',
                              name: 'Detect Stage Change',
                              layer: 'automation',
                              type: 'step',
                              matchStep: 'stage_change_detected',
                              children: [{
                                id: 'generate_tasks',
                                name: 'Generate Tasks',
                                layer: 'automation',
                                type: 'step',
                                matchStep: 'generate_tasks',
                                children: [{
                                  id: 'task_result',
                                  name: 'Task Creation Result',
                                  layer: 'decision',
                                  type: 'decision',
                                  condition: 'Check task creation outcomes',
                                  children: [
                                    { label: 'All Success', value: 'success', node: { id: 'tasks_created', name: 'Tasks Created', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'created_tasks', children: [] } },
                                    { label: 'Updated', value: 'updated', node: { id: 'tasks_updated', name: 'Tasks Updated', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'updated_tasks', children: [] } },
                                    { label: 'Partial', value: 'partial', node: { id: 'partial', name: 'Partial Failure', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'partial_failure', children: [] } },
                                    { label: 'Error', value: 'error', node: { id: 'error', name: 'Error', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'error', children: [] } }
                                  ]
                                }]
                              }]
                            }
                          }
                        ]
                      }
                    }
                  ]
                }]
              }
            }
          ]
        }]
      }]
    }]
  }
};

// ============================================================================
// TASK COMPLETION WORKFLOW
// ============================================================================
export const taskCompletionWorkflow = {
  id: 'task-completion',
  name: 'Task Completion',
  trigger: '/webhooks/tasks',
  triggerName: 'task-completion',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'webhook_received',
    children: [{
      id: 'validation',
      name: 'Validate Timestamp',
      layer: 'processing',
      type: 'step',
      matchStep: 'validation',
      children: [{
        id: 'idempotency',
        name: 'Idempotency Check',
        layer: 'processing',
        type: 'step',
        matchStep: 'idempotency_check',
        children: [{
          id: 'test_mode',
          name: 'Test Mode Filter',
          layer: 'decision',
          type: 'decision',
          condition: 'Is task matter in allowlist?',
          children: [
            {
              label: 'Blocked',
              value: false,
              node: { id: 'test_blocked', name: 'Test Mode Blocked', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_test_mode', children: [] }
            },
            {
              label: 'Allowed',
              value: true,
              node: {
                id: 'fetch_task',
                name: 'Fetch Task',
                layer: 'service',
                type: 'step',
                matchStep: 'fetch_task',
                children: [{
                  id: 'task_exists',
                  name: 'Task Exists?',
                  layer: 'decision',
                  type: 'decision',
                  condition: 'Check if task exists in Clio',
                  children: [
                    { label: 'Deleted', value: false, node: { id: 'task_deleted', name: 'Task Deleted', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'task_deleted', children: [] } },
                    {
                      label: 'Exists',
                      value: true,
                      node: {
                        id: 'is_completed',
                        name: 'Task Completed?',
                        layer: 'decision',
                        type: 'decision',
                        condition: 'Check task status in Clio',
                        children: [
                          { label: 'Not Complete', value: false, node: { id: 'not_complete', name: 'Not Completed', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_not_completed', children: [] } },
                          {
                            label: 'Completed',
                            value: true,
                            node: {
                              id: 'task_type',
                              name: 'Task Type Check',
                              layer: 'decision',
                              type: 'decision',
                              condition: 'Check for special task patterns',
                              children: [
                                { label: 'Attempt Seq', value: 'attempt', node: { id: 'attempt_created', name: 'Attempt Task Created', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'attempt_sequence', children: [] } },
                                { label: 'Error Task', value: 'error', node: { id: 'regenerated', name: 'Tasks Regenerated', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'error_task_regenerated', children: [] } },
                                {
                                  label: 'Regular',
                                  value: 'regular',
                                  node: {
                                    id: 'has_dependents',
                                    name: 'Has Dependent Tasks?',
                                    layer: 'decision',
                                    type: 'decision',
                                    condition: 'Check for "after task X" relations',
                                    children: [
                                      { label: 'No', value: false, node: { id: 'no_action', name: 'No Follow-up', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'none', children: [] } },
                                      { label: 'Yes', value: true, node: { id: 'dependents_updated', name: 'Dependents Updated', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'dependent_tasks', children: [] } }
                                    ]
                                  }
                                }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  ]
                }]
              }
            }
          ]
        }]
      }]
    }]
  }
};

// ============================================================================
// TASK DELETED WORKFLOW
// ============================================================================
export const taskDeletedWorkflow = {
  id: 'task-deleted',
  name: 'Task Deleted',
  trigger: '/webhooks/tasks',
  triggerName: 'task-deleted',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'webhook_received',
    children: [{
      id: 'idempotency',
      name: 'Idempotency Check',
      layer: 'processing',
      type: 'step',
      matchStep: 'idempotency_check',
      children: [{
        id: 'test_mode',
        name: 'Test Mode Filter',
        layer: 'decision',
        type: 'decision',
        condition: 'Is task matter in allowlist?',
        children: [
          { label: 'Blocked', value: false, node: { id: 'test_blocked', name: 'Test Mode Blocked', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_test_mode', children: [] } },
          {
            label: 'Allowed',
            value: true,
            node: {
              id: 'update_status',
              name: 'Update Task Status',
              layer: 'service',
              type: 'step',
              matchStep: 'update_task_status',
              children: [{
                id: 'task_found',
                name: 'Task in Database?',
                layer: 'decision',
                type: 'decision',
                condition: 'Check if task exists in Supabase',
                children: [
                  { label: 'No', value: false, node: { id: 'not_found', name: 'Task Not Found', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'task_not_found', children: [] } },
                  { label: 'Yes', value: true, node: { id: 'marked_deleted', name: 'Marked as Deleted', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'task_marked_deleted', children: [] } }
                ]
              }]
            }
          }
        ]
      }]
    }]
  }
};

// ============================================================================
// MATTER CLOSED WORKFLOW
// ============================================================================
export const matterClosedWorkflow = {
  id: 'matter-closed',
  name: 'Matter Closed',
  trigger: '/webhooks/matters',
  triggerName: 'matter-closed',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'webhook_received',
    children: [{
      id: 'validation',
      name: 'Validate Timestamp',
      layer: 'processing',
      type: 'step',
      matchStep: 'validation',
      children: [{
        id: 'idempotency',
        name: 'Idempotency Check',
        layer: 'processing',
        type: 'step',
        matchStep: 'idempotency_check',
        children: [{
          id: 'test_mode',
          name: 'Test Mode Filter',
          layer: 'decision',
          type: 'decision',
          condition: 'Is matter in allowlist?',
          children: [
            { label: 'Blocked', value: false, node: { id: 'test_blocked', name: 'Test Mode Blocked', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_test_mode', children: [] } },
            {
              label: 'Allowed',
              value: true,
              node: {
                id: 'fetch_matter',
                name: 'Fetch Matter',
                layer: 'service',
                type: 'step',
                matchStep: 'fetch_matter',
                children: [{
                  id: 'still_closed',
                  name: 'Still Closed?',
                  layer: 'decision',
                  type: 'decision',
                  condition: 'Verify matter status from Clio',
                  children: [
                    { label: 'No', value: false, node: { id: 'not_closed', name: 'Not Closed Anymore', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_not_closed', children: [] } },
                    {
                      label: 'Yes',
                      value: true,
                      node: {
                        id: 'check_payments',
                        name: 'Check Payments',
                        layer: 'service',
                        type: 'step',
                        matchStep: 'check_payments',
                        children: [{
                          id: 'has_payments',
                          name: 'Has Payments?',
                          layer: 'decision',
                          type: 'decision',
                          condition: 'Query Clio Bills API',
                          children: [
                            { label: 'Yes', value: true, node: { id: 'has_payments_outcome', name: 'Has Payments', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_has_payments', children: [] } },
                            { label: 'No', value: false, node: { id: 'task_created', name: 'Task Created', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'task_created', children: [] } }
                          ]
                        }]
                      }
                    }
                  ]
                }]
              }
            }
          ]
        }]
      }]
    }]
  }
};

// ============================================================================
// MEETING SCHEDULED WORKFLOW
// ============================================================================
export const meetingScheduledWorkflow = {
  id: 'meeting-scheduled',
  name: 'Meeting Scheduled',
  trigger: '/webhooks/calendar',
  triggerName: 'meeting-scheduled',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'webhook_received',
    children: [{
      id: 'validation',
      name: 'Validate Timestamp',
      layer: 'processing',
      type: 'step',
      matchStep: 'validation',
      children: [{
        id: 'idempotency',
        name: 'Idempotency Check',
        layer: 'processing',
        type: 'step',
        matchStep: 'idempotency_check',
        children: [{
          id: 'has_date',
          name: 'Has Meeting Date?',
          layer: 'decision',
          type: 'decision',
          condition: 'Check start_at field',
          children: [
            { label: 'No', value: false, node: { id: 'no_date', name: 'Missing Meeting Date', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'missing_meeting_date', children: [] } },
            {
              label: 'Yes',
              value: true,
              node: {
                id: 'test_mode',
                name: 'Test Mode Filter',
                layer: 'decision',
                type: 'decision',
                condition: 'Is matter in allowlist?',
                children: [
                  { label: 'Blocked', value: false, node: { id: 'test_blocked', name: 'Test Mode Blocked', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_test_mode', children: [] } },
                  {
                    label: 'Allowed',
                    value: true,
                    node: {
                      id: 'has_event_type',
                      name: 'Has Event Type?',
                      layer: 'decision',
                      type: 'decision',
                      condition: 'Check calendar_entry_event_type',
                      children: [
                        { label: 'No', value: false, node: { id: 'no_event', name: 'No Event Type', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_no_event_type', children: [] } },
                        {
                          label: 'Yes',
                          value: true,
                          node: {
                            id: 'is_mapped',
                            name: 'Event Mapped?',
                            layer: 'decision',
                            type: 'decision',
                            condition: 'Lookup in calendar_event mapping table',
                            children: [
                              { label: 'No', value: false, node: { id: 'not_mapped', name: 'Event Not Mapped', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'not_mapped', children: [] } },
                              {
                                label: 'Yes',
                                value: true,
                                node: {
                                  id: 'existing_tasks',
                                  name: 'Existing Tasks?',
                                  layer: 'decision',
                                  type: 'decision',
                                  condition: 'Check for existing tasks',
                                  children: [
                                    { label: 'Calendar Tasks', value: 'calendar', node: { id: 'tasks_updated', name: 'Tasks Updated', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'tasks_updated', children: [] } },
                                    { label: 'Stage Tasks', value: 'stage', node: { id: 'tasks_linked', name: 'Tasks Linked', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'tasks_linked_and_updated', children: [] } },
                                    { label: 'None', value: 'none', node: { id: 'tasks_created', name: 'Tasks Created', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'tasks_created', children: [] } }
                                  ]
                                }
                              }
                            ]
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            }
          ]
        }]
      }]
    }]
  }
};

// ============================================================================
// CALENDAR ENTRY DELETED WORKFLOW
// ============================================================================
export const calendarEntryDeletedWorkflow = {
  id: 'calendar-entry-deleted',
  name: 'Calendar Entry Deleted',
  trigger: '/webhooks/calendar',
  triggerName: 'calendar-entry-deleted',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'webhook_received',
    children: [{
      id: 'idempotency',
      name: 'Idempotency Check',
      layer: 'processing',
      type: 'step',
      matchStep: 'idempotency_check',
      children: [{
        id: 'process_deletion',
        name: 'Process Deletion',
        layer: 'automation',
        type: 'step',
        matchStep: 'process_deletion',
        children: [
          { id: 'deleted', name: 'Deletion Logged', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'calendar_entry_deleted', children: [] }
        ]
      }]
    }]
  }
};

// ============================================================================
// DOCUMENT CREATED WORKFLOW
// ============================================================================
export const documentCreatedWorkflow = {
  id: 'document-created',
  name: 'Document Created',
  trigger: '/webhooks/documents',
  triggerName: 'document-created',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'webhook_received',
    children: [{
      id: 'validation',
      name: 'Validate Timestamp',
      layer: 'processing',
      type: 'step',
      matchStep: 'validation',
      children: [{
        id: 'idempotency',
        name: 'Idempotency Check',
        layer: 'processing',
        type: 'step',
        matchStep: 'idempotency_check',
        children: [{
          id: 'has_matter',
          name: 'Has Matter?',
          layer: 'decision',
          type: 'decision',
          condition: 'Check matter association',
          children: [
            { label: 'No', value: false, node: { id: 'no_matter', name: 'Missing Matter', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'missing_matter', children: [] } },
            {
              label: 'Yes',
              value: true,
              node: {
                id: 'test_mode',
                name: 'Test Mode Filter',
                layer: 'decision',
                type: 'decision',
                condition: 'Is matter in allowlist?',
                children: [
                  { label: 'Blocked', value: false, node: { id: 'test_blocked', name: 'Test Mode Blocked', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_test_mode', children: [] } },
                  {
                    label: 'Allowed',
                    value: true,
                    node: {
                      id: 'fetch_matter',
                      name: 'Fetch Matter',
                      layer: 'service',
                      type: 'step',
                      matchStep: 'fetch_matter',
                      children: [{
                        id: 'matter_closed',
                        name: 'Matter Closed?',
                        layer: 'decision',
                        type: 'decision',
                        condition: 'Check matter status',
                        children: [
                          { label: 'Yes', value: true, node: { id: 'closed', name: 'Matter Closed', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_closed_matter', children: [] } },
                          {
                            label: 'No',
                            value: false,
                            node: {
                              id: 'fetch_document',
                              name: 'Fetch Document',
                              layer: 'service',
                              type: 'step',
                              matchStep: 'fetch_document',
                              children: [{
                                id: 'in_root',
                                name: 'In Root Folder?',
                                layer: 'decision',
                                type: 'decision',
                                condition: 'Check if document in matter root',
                                children: [
                                  { label: 'Subfolder', value: false, node: { id: 'in_folder', name: 'In Subfolder', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'skipped_in_folder', children: [] } },
                                  { label: 'Root', value: true, node: { id: 'task_created', name: 'Task Created', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'task_created', children: [] } }
                                ]
                              }]
                            }
                          }
                        ]
                      }]
                    }
                  }
                ]
              }
            }
          ]
        }]
      }]
    }]
  }
};

// ============================================================================
// WORKFLOW REGISTRY
// ============================================================================
export const workflowRegistry = {
  'matter-stage-change': matterStageChangeWorkflow,
  'matter-closed': matterClosedWorkflow,
  'task-completion': taskCompletionWorkflow,
  'task-deleted': taskDeletedWorkflow,
  'meeting-scheduled': meetingScheduledWorkflow,
  'calendar-entry-deleted': calendarEntryDeletedWorkflow,
  'document-created': documentCreatedWorkflow,
};

/**
 * Get workflow template by trigger name
 */
export function getWorkflowTemplate(triggerName) {
  return workflowRegistry[triggerName] || null;
}

/**
 * Match trace data to workflow template and determine taken path
 * Returns the workflow with each node marked as: 'taken', 'not-taken', or 'current'
 */
export function matchTraceToWorkflow(workflow, trace, steps) {
  if (!workflow) return null;

  // Normalize data for matching
  const resultAction = trace?.resultAction?.toLowerCase() || '';
  const traceStatus = trace?.status?.toLowerCase() || '';

  // Get all step names (case-insensitive)
  const stepNames = new Set(steps.map(s => s.stepName?.toLowerCase()).filter(Boolean));

  // Get all operations from details for more granular matching
  const operations = new Set();
  steps.forEach(step => {
    if (step.details && Array.isArray(step.details)) {
      step.details.forEach(detail => {
        if (detail.operation) {
          operations.add(detail.operation.toLowerCase());
        }
      });
    }
  });

  // Debug logging
  console.log('[WorkflowMatch] Step names:', Array.from(stepNames));
  console.log('[WorkflowMatch] Operations:', Array.from(operations));
  console.log('[WorkflowMatch] Result action:', resultAction);
  console.log('[WorkflowMatch] Trace status:', traceStatus);

  // Track the last step in the chain to mark as "current"
  let lastMatchedStep = null;
  let lastMatchedDepth = -1;

  // First pass: find all taken nodes and determine the last one
  function findTakenNodes(node, depth = 0) {
    let taken = false;

    if (node.type === 'step' && node.matchStep) {
      taken = stepNames.has(node.matchStep.toLowerCase());
      if (taken && depth > lastMatchedDepth) {
        lastMatchedStep = node.id;
        lastMatchedDepth = depth;
      }
    } else if (node.type === 'outcome' && node.matchAction) {
      // Check if result action matches this outcome
      const matchAction = node.matchAction.toLowerCase();
      taken = resultAction.includes(matchAction) || resultAction === matchAction;
      if (taken) {
        lastMatchedStep = node.id;
        lastMatchedDepth = depth + 100; // Outcomes are always "last"
      }
    } else if (node.type === 'decision') {
      // Decisions are taken if any child branch was taken
      node.children.forEach(branch => {
        if (branch.node && findTakenNodes(branch.node, depth + 1)) {
          taken = true;
        }
      });
    }

    // Check children for steps
    if (node.children) {
      node.children.forEach(child => {
        if (child.node) {
          // Branch child
          if (findTakenNodes(child.node, depth + 1)) {
            taken = true;
          }
        } else if (child.id) {
          // Direct child node
          if (findTakenNodes(child, depth + 1)) {
            taken = true;
          }
        }
      });
    }

    return taken;
  }

  // Find taken nodes first
  findTakenNodes(workflow.root);

  // Second pass: mark all nodes with status
  function markNode(node, depth = 0, parentTaken = true) {
    let taken = false;
    let current = false;

    if (node.type === 'step' && node.matchStep) {
      taken = stepNames.has(node.matchStep.toLowerCase());
    } else if (node.type === 'outcome' && node.matchAction) {
      const matchAction = node.matchAction.toLowerCase();
      taken = resultAction.includes(matchAction) || resultAction === matchAction;
      // Mark as current if this is the final outcome
      if (taken) {
        current = true;
      }
    } else if (node.type === 'decision') {
      // Decisions are taken if any child branch leads to a taken node
      taken = node.children.some(branch => {
        if (branch.node) {
          const markedChild = markNode(branch.node, depth + 1, taken);
          return markedChild.status === 'taken' || markedChild.status === 'current';
        }
        return false;
      });
    }

    // For steps, mark as taken if we have matching step AND check if it's current
    if (node.type === 'step' && taken) {
      // Check if this is the last matched step (current)
      if (node.id === lastMatchedStep) {
        current = true;
      }
    }

    // Mark children
    const markedChildren = node.children.map(child => {
      if (child.node) {
        // Decision branch
        return {
          ...child,
          node: markNode(child.node, depth + 1, taken),
        };
      } else if (child.id) {
        // Direct child node
        return markNode(child, depth + 1, taken);
      }
      return child;
    });

    return {
      ...node,
      status: current ? 'current' : (taken ? 'taken' : 'not-taken'),
      children: markedChildren,
    };
  }

  return {
    ...workflow,
    root: markNode(workflow.root),
  };
}
