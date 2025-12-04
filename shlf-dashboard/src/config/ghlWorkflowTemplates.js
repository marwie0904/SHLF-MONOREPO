/**
 * GHL Workflow Templates - Defines all possible paths for each GHL webhook type
 *
 * Each node has:
 * - id: Unique identifier
 * - name: Display name
 * - layer: Layer type for color coding (webhook, processing, service, external, automation)
 * - type: 'step' | 'decision' | 'outcome'
 * - condition: For decisions, the condition being evaluated
 * - children: Array of possible next nodes (for steps) or branches (for decisions)
 * - matchStep: ServiceName:FunctionName to match from actual trace data
 * - matchAction: Result action to match for outcomes
 */

// ============================================================================
// OPPORTUNITY STAGE CHANGED WORKFLOW
// ============================================================================
export const opportunityStageChangedWorkflow = {
  id: 'opportunity-stage-changed',
  name: 'Opportunity Stage Changed',
  trigger: '/webhooks/ghl/opportunity-stage-changed',
  triggerName: 'opportunity-stage-changed',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'express:webhook_received',
    children: [{
      id: 'rate_limit',
      name: 'Rate Limit Queue',
      layer: 'processing',
      type: 'step',
      matchStep: 'express:rate_limit_check',
      children: [{
        id: 'validate',
        name: 'Validate Timestamp',
        layer: 'processing',
        type: 'step',
        matchStep: 'express:validate_timestamp',
        children: [{
          id: 'idempotency',
          name: 'Idempotency Check',
          layer: 'processing',
          type: 'step',
          matchStep: 'express:idempotency_check',
          children: [{
            id: 'test_mode',
            name: 'Test Mode Filter',
            layer: 'processing',
            type: 'step',
            matchStep: 'express:test_mode_filter',
            children: [{
              id: 'test_mode_decision',
              name: 'Is matter in allowlist?',
              layer: 'decision',
              type: 'decision',
              condition: 'Check if opportunity is in test mode allowlist',
              matchStepOutput: { stepName: 'express:test_mode_filter', outputField: 'isInAllowlist' },
              children: [
                {
                  label: 'Blocked',
                  value: false,
                  matchValue: false,
                  node: {
                    id: 'test_blocked',
                    name: 'Test Mode Blocked',
                    layer: 'outcome',
                    type: 'outcome',
                    status: 'skipped',
                    matchAction: 'skipped_test_mode',
                    children: []
                  }
                },
                {
                  label: 'Allowed',
                  value: true,
                  matchValue: true,
                  node: {
                    id: 'process_stage_change',
                    name: 'Process Stage Change',
                    layer: 'service',
                    type: 'step',
                    matchStep: 'ghlOpportunityService:processOpportunityStageChange',
                    children: [{
                      id: 'check_grace_period',
                      name: 'Check Grace Period',
                      layer: 'service',
                      type: 'step',
                      matchStep: 'ghlOpportunityService:checkGracePeriod',
                      children: [{
                        id: 'grace_period_decision',
                        name: 'Recent Stage Change?',
                        layer: 'decision',
                        type: 'decision',
                        condition: 'Check if stage changed within 2-minute grace period',
                        matchStepOutput: { stepName: 'ghlOpportunityService:checkGracePeriod', outputField: 'recentChangesFound' },
                        children: [
                          {
                            label: 'Yes',
                            value: true,
                            matchValue: true,
                            node: {
                              id: 'delete_previous_tasks',
                              name: 'Delete Previous Tasks',
                              layer: 'service',
                              type: 'step',
                              matchStep: 'ghlOpportunityService:deletePreviousStageTasks',
                              children: [{
                                id: 'get_templates_after_delete',
                                name: 'Get Task Templates',
                                layer: 'service',
                                type: 'step',
                                matchStep: 'supabase:getTaskTemplates',
                                children: [{
                                  id: 'tasks_found_decision_after_delete',
                                  name: 'Tasks Found?',
                                  layer: 'decision',
                                  type: 'decision',
                                  condition: 'Check if tasks are configured for this stage',
                                  children: [
                                    {
                                      label: 'No',
                                      value: false,
                                      node: {
                                        id: 'no_tasks_after_delete',
                                        name: 'No Tasks Configured',
                                        layer: 'outcome',
                                        type: 'outcome',
                                        status: 'success',
                                        matchAction: 'no_tasks',
                                        children: []
                                      }
                                    },
                                    {
                                      label: 'Yes',
                                      value: true,
                                      node: {
                                        id: 'record_stage_change_after_delete',
                                        name: 'Record Stage Change',
                                        layer: 'service',
                                        type: 'step',
                                        matchStep: 'supabase:recordStageChange',
                                        children: [{
                                          id: 'create_tasks_after_delete',
                                          name: 'Create GHL Tasks',
                                          layer: 'external',
                                          type: 'step',
                                          matchStep: 'ghl:createTasks',
                                          children: [{
                                            id: 'update_task_ids_after_delete',
                                            name: 'Update Task IDs',
                                            layer: 'service',
                                            type: 'step',
                                            matchStep: 'supabase:updateStageChangeTaskIds',
                                            children: [{
                                              id: 'outcome_after_delete',
                                              name: 'Task Creation Result',
                                              layer: 'decision',
                                              type: 'decision',
                                              condition: 'Final outcome',
                                              matchTraceStatus: true, // Match based on trace status
                                              children: [
                                                { label: 'Success', value: 'success', matchValue: 'tasks_created', node: { id: 'tasks_created_after_delete', name: 'Tasks Created', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'tasks_created', children: [] } },
                                                { label: 'Error', value: 'error', matchValue: 'error', node: { id: 'error_after_delete', name: 'Error', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'error', children: [] } }
                                              ]
                                            }]
                                          }]
                                        }]
                                      }
                                    }
                                  ]
                                }]
                              }]
                            }
                          },
                          {
                            label: 'No',
                            value: false,
                            matchValue: false,
                            node: {
                              id: 'get_templates',
                              name: 'Get Task Templates',
                              layer: 'service',
                              type: 'step',
                              matchStep: 'supabase:getTaskTemplates',
                              children: [{
                                id: 'tasks_found_decision',
                                name: 'Tasks Found?',
                                layer: 'decision',
                                type: 'decision',
                                condition: 'Check if tasks are configured for this stage',
                                matchStepOutput: { stepName: 'supabase:getTaskTemplates', outputField: 'tasksFound' },
                                children: [
                                  {
                                    label: 'No',
                                    value: false,
                                    matchValue: 0,
                                    node: {
                                      id: 'no_tasks',
                                      name: 'No Tasks Configured',
                                      layer: 'outcome',
                                      type: 'outcome',
                                      status: 'success',
                                      matchAction: 'no_tasks',
                                      children: []
                                    }
                                  },
                                  {
                                    label: 'Yes',
                                    value: true,
                                    node: {
                                      id: 'record_stage_change',
                                      name: 'Record Stage Change',
                                      layer: 'service',
                                      type: 'step',
                                      matchStep: 'supabase:recordStageChange',
                                      children: [{
                                        id: 'create_tasks',
                                        name: 'Create GHL Tasks',
                                        layer: 'external',
                                        type: 'step',
                                        matchStep: 'ghl:createTasks',
                                        children: [{
                                          id: 'update_task_ids',
                                          name: 'Update Task IDs',
                                          layer: 'service',
                                          type: 'step',
                                          matchStep: 'supabase:updateStageChangeTaskIds',
                                          children: [{
                                            id: 'outcome',
                                            name: 'Task Creation Result',
                                            layer: 'decision',
                                            type: 'decision',
                                            condition: 'Final outcome',
                                            matchTraceStatus: true, // Match based on trace status
                                            children: [
                                              { label: 'Success', value: 'success', matchValue: 'tasks_created', node: { id: 'tasks_created', name: 'Tasks Created', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'tasks_created', children: [] } },
                                              { label: 'Error', value: 'error', matchValue: 'error', node: { id: 'error', name: 'Error', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'error', children: [] } }
                                            ]
                                          }]
                                        }]
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
                  }
                }
              ]
            }]
          }]
        }]
      }]
    }]
  }
};

// ============================================================================
// TASK CREATED WORKFLOW
// ============================================================================
export const taskCreatedWorkflow = {
  id: 'task-created',
  name: 'Task Created',
  trigger: '/webhooks/ghl/task-created',
  triggerName: 'task-created',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'webhook_received',
    children: [{
      id: 'process_task',
      name: 'Process Task Creation',
      layer: 'service',
      type: 'step',
      matchStep: 'ghlTaskService:processTaskCreation',
      children: [{
        id: 'sync_to_supabase',
        name: 'Sync to Supabase',
        layer: 'service',
        type: 'step',
        matchStep: 'supabase:syncTask',
        children: [{
          id: 'outcome',
          name: 'Sync Result',
          layer: 'decision',
          type: 'decision',
          condition: 'Final outcome',
          children: [
            { label: 'Success', value: 'success', node: { id: 'synced', name: 'Task Synced', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'task_synced', children: [] } },
            { label: 'Error', value: 'error', node: { id: 'error', name: 'Sync Error', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'error', children: [] } }
          ]
        }]
      }]
    }]
  }
};

// ============================================================================
// TASK COMPLETED WORKFLOW
// ============================================================================
export const taskCompletedWorkflow = {
  id: 'task-completed',
  name: 'Task Completed',
  trigger: '/webhooks/ghl/task-completed',
  triggerName: 'task-completed',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'webhook_received',
    children: [{
      id: 'fetch_task',
      name: 'Fetch Task from Clio',
      layer: 'service',
      type: 'step',
      matchStep: 'clio:fetchTask',
      children: [{
        id: 'task_exists_decision',
        name: 'Task Exists in Clio?',
        layer: 'decision',
        type: 'decision',
        condition: 'Check if task exists in Clio',
        children: [
          {
            label: 'No',
            value: false,
            node: {
              id: 'search_supabase',
              name: 'Search Task in Supabase',
              layer: 'service',
              type: 'step',
              matchStep: 'supabase:searchTask',
              children: [{
                id: 'found_in_supabase',
                name: 'Task Found?',
                layer: 'decision',
                type: 'decision',
                condition: 'Check if task found in Supabase',
                children: [
                  {
                    label: 'No',
                    value: false,
                    node: { id: 'not_found', name: 'Not Found in Supabase', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'not_found', children: [] }
                  },
                  {
                    label: 'Yes',
                    value: true,
                    node: {
                      id: 'delete_from_supabase',
                      name: 'Delete Task in Supabase',
                      layer: 'service',
                      type: 'step',
                      matchStep: 'supabase:deleteTask',
                      children: [{
                        id: 'deleted',
                        name: 'Task Deleted',
                        layer: 'outcome',
                        type: 'outcome',
                        status: 'success',
                        matchAction: 'deleted_in_supabase',
                        children: []
                      }]
                    }
                  }
                ]
              }]
            }
          },
          {
            label: 'Yes',
            value: true,
            node: {
              id: 'check_completed',
              name: 'Task Completed?',
              layer: 'decision',
              type: 'decision',
              condition: 'Check if task is marked complete',
              children: [
                {
                  label: 'No',
                  value: false,
                  node: { id: 'not_completed', name: 'Not Completed', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'not_completed', children: [] }
                },
                {
                  label: 'Yes',
                  value: true,
                  node: {
                    id: 'attempt_seq',
                    name: 'Attempt Sequence',
                    layer: 'automation',
                    type: 'step',
                    matchStep: 'automation:attemptSequence',
                    children: [{
                      id: 'task_created',
                      name: 'Attempt Task Created',
                      layer: 'outcome',
                      type: 'outcome',
                      status: 'success',
                      matchAction: 'attempt_task_created',
                      children: []
                    }]
                  }
                }
              ]
            }
          }
        ]
      }]
    }]
  }
};

// ============================================================================
// WORKFLOW REGISTRY
// ============================================================================
export const ghlWorkflowTemplates = {
  'opportunity-stage-changed': opportunityStageChangedWorkflow,
  'task-created': taskCreatedWorkflow,
  'task-completed': taskCompletedWorkflow,
};

/**
 * Get workflow template for a GHL endpoint
 */
export function getGHLWorkflowTemplate(endpoint) {
  // Extract the trigger name from the endpoint
  const triggerName = endpoint?.split('/').pop();
  return ghlWorkflowTemplates[triggerName] || null;
}

/**
 * Match GHL trace data to workflow template
 * Returns the workflow with nodes marked as taken/not-taken/current
 * Also attaches matching step data and details to each node
 */
export function matchGHLTraceToWorkflow(workflow, trace, steps) {
  if (!workflow || !workflow.root) return null;

  // Build a map of step matches for quick lookup
  // GHL steps use serviceName:functionName format
  const stepMap = new Map();
  const stepOutputMap = new Map();

  console.log('[GHL WorkflowMatch] Processing steps:', steps.length);

  steps.forEach(step => {
    const key = `${step.serviceName}:${step.functionName}`;
    stepMap.set(key, step);
    stepOutputMap.set(key, step.output || {});

    // Also add without the service prefix for simpler matching
    if (step.functionName) {
      stepMap.set(step.functionName, step);
      stepOutputMap.set(step.functionName, step.output || {});
    }

    console.log(`[GHL WorkflowMatch] Step registered: ${key}`);
  });

  // Get all step names for debugging
  const stepNames = Array.from(stepMap.keys());
  console.log('[GHL WorkflowMatch] All step keys:', stepNames);

  // Get result action for outcome matching
  // GHL traces don't have resultAction, so derive it from status and responseBody
  const traceStatus = trace?.status?.toLowerCase() || '';
  const responseBody = trace?.responseBody || {};

  // Derive resultAction from trace data
  let resultAction = '';
  if (traceStatus === 'completed' && responseBody.success) {
    if (responseBody.tasksCreated > 0) {
      resultAction = 'tasks_created';
    } else if (responseBody.tasksCreated === 0) {
      resultAction = 'no_tasks';
    } else {
      resultAction = 'success';
    }
  } else if (traceStatus === 'failed' || responseBody.success === false) {
    resultAction = 'error';
  } else if (traceStatus === 'partial') {
    resultAction = 'partial';
  }

  console.log('[GHL WorkflowMatch] Derived resultAction:', resultAction, 'Status:', traceStatus, 'ResponseBody:', responseBody);

  // Build a map of all details
  const allDetails = [];
  steps.forEach(step => {
    if (step.details && Array.isArray(step.details)) {
      step.details.forEach(detail => {
        allDetails.push({
          ...detail,
          parentStepName: `${step.serviceName}:${step.functionName}`,
          parentStepId: step.stepId,
        });
      });
    }
  });

  // Track the last matched node for "current" marking
  let lastMatchedNodeId = null;
  let lastMatchedDepth = -1;

  // First pass: find all taken nodes and determine the last one
  function findTakenNodes(node, depth = 0) {
    let taken = false;

    if (node.type === 'step' && node.matchStep) {
      if (stepMap.has(node.matchStep)) {
        taken = true;
        if (depth > lastMatchedDepth) {
          lastMatchedNodeId = node.id;
          lastMatchedDepth = depth;
        }
      }
    } else if (node.type === 'outcome' && node.matchAction) {
      const matchAction = node.matchAction.toLowerCase();
      if (resultAction.includes(matchAction) || resultAction === matchAction) {
        taken = true;
        lastMatchedNodeId = node.id;
        lastMatchedDepth = depth + 100; // Outcomes are always "last"
      }
    } else if (node.type === 'decision') {
      // For decisions, check if any child branch leads to a taken node
      if (node.children) {
        node.children.forEach(branch => {
          if (branch.node && findTakenNodes(branch.node, depth + 1)) {
            taken = true;
          }
        });
      }
    }

    // Check children for step nodes
    if (node.children && node.type !== 'decision') {
      node.children.forEach(child => {
        if (findTakenNodes(child, depth + 1)) {
          taken = true;
        }
      });
    }

    return taken;
  }

  findTakenNodes(workflow.root);

  // Second pass: mark all nodes with status and attach step data
  function markNode(node, depth = 0, branchActive = true) {
    const markedNode = { ...node };
    let isTaken = false;
    let isCurrent = false;
    let stepData = null;
    let nodeDetails = [];

    // Check if this node was executed
    if (node.type === 'step' && node.matchStep) {
      stepData = stepMap.get(node.matchStep);
      if (stepData && branchActive) {
        isTaken = true;
        markedNode.stepData = stepData;
        nodeDetails = stepData.details || [];
      }
    }

    // Check for outcome matching
    if (node.type === 'outcome' && node.matchAction && branchActive) {
      const matchAction = node.matchAction.toLowerCase();
      if (resultAction.includes(matchAction) || resultAction === matchAction) {
        isTaken = true;
        isCurrent = true;
      }
    }

    // Check if this is the current (last) node
    if (node.id === lastMatchedNodeId) {
      isCurrent = true;
    }

    markedNode.matchStatus = isCurrent ? 'current' : (isTaken ? 'taken' : 'not-taken');
    markedNode.details = nodeDetails;

    // Process children
    if (node.type === 'decision' && node.children) {
      // For decisions with matchStepOutput, determine which branch is active
      let activeBranchValue = null;
      if (node.matchStepOutput) {
        const stepOutput = stepOutputMap.get(node.matchStepOutput.stepName);
        if (stepOutput) {
          activeBranchValue = stepOutput[node.matchStepOutput.outputField];
          console.log(`[GHL WorkflowMatch] Decision ${node.id}: outputField=${node.matchStepOutput.outputField}, value=${activeBranchValue}`);
        }
      }

      // For decisions that match on trace status (final outcome decisions)
      if (node.matchTraceStatus) {
        activeBranchValue = resultAction;
        console.log(`[GHL WorkflowMatch] Decision ${node.id}: matchTraceStatus=true, resultAction=${resultAction}`);
      }

      markedNode.children = node.children.map(branch => {
        const markedBranch = { ...branch };

        // Determine if this branch is active
        let isBranchActive = branchActive;
        if ((node.matchStepOutput || node.matchTraceStatus) && branch.matchValue !== undefined) {
          isBranchActive = branchActive && (branch.matchValue === activeBranchValue);
        }

        markedBranch.node = markNode(branch.node, depth + 1, isBranchActive);

        // Mark branch as taken if its node is taken
        const branchStatus = markedBranch.node.matchStatus;
        markedBranch.taken = branchStatus === 'taken' || branchStatus === 'current';

        return markedBranch;
      });

      // Decision is taken if any branch is taken
      const anyBranchTaken = markedNode.children.some(branch => branch.taken);
      if (anyBranchTaken) {
        markedNode.matchStatus = 'taken';
      }
    } else if (node.children) {
      // For regular steps, process children
      markedNode.children = node.children.map(child => markNode(child, depth + 1, branchActive && isTaken));
    }

    return markedNode;
  }

  return {
    ...workflow,
    root: markNode(workflow.root),
    trace,
    allSteps: steps,
    allDetails,
  };
}

export default ghlWorkflowTemplates;
