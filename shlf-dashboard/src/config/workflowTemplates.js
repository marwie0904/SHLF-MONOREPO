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
          layer: 'processing',
          type: 'step',
          matchStep: 'test_mode_filter',
          children: [{
            id: 'test_mode_decision',
            name: 'In Allowlist?',
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
                                matchStep: 'detect_stage_change',
                                children: [{
                                  id: 'rollback_check',
                                  name: 'Check Rollback Window',
                                  layer: 'processing',
                                  type: 'step',
                                  matchStep: 'check_rollback_window',
                                  children: [{
                                    id: 'rollback_decision',
                                    name: 'Within Grace Period?',
                                    layer: 'decision',
                                    type: 'decision',
                                    condition: 'Check if stage changed within rollback window',
                                    // Match based on check_rollback_window step output
                                    matchStepOutput: { stepName: 'check_rollback_window', outputField: 'withinRollbackWindow' },
                                    children: [
                                      {
                                        label: 'Yes',
                                        value: true,
                                        matchValue: true, // Match when withinRollbackWindow === true
                                        node: {
                                          id: 'delete_previous',
                                          name: 'Delete Previous Tasks',
                                          layer: 'automation',
                                          type: 'step',
                                          // No matchStep - this is a virtual node that shows when rollback happens
                                          children: [{
                                            id: 'generate_tasks_after_rollback',
                                            name: 'Generate Tasks',
                                            layer: 'automation',
                                            type: 'step',
                                            matchStep: 'generate_tasks',
                                            children: [{
                                              id: 'verify_tasks_after_rollback',
                                              name: 'Verify Tasks',
                                              layer: 'automation',
                                              type: 'step',
                                              matchStep: 'verify_tasks',
                                              children: [{
                                                id: 'task_result_after_rollback',
                                                name: 'Task Creation Result',
                                                layer: 'decision',
                                                type: 'decision',
                                                condition: 'Check task creation outcomes',
                                                children: [
                                                  { label: 'All Success', value: 'success', node: { id: 'tasks_created_rb', name: 'Tasks Created', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'created_tasks', children: [] } },
                                                  { label: 'Updated', value: 'updated', node: { id: 'tasks_updated_rb', name: 'Tasks Updated', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'updated_tasks', children: [] } },
                                                  { label: 'Partial', value: 'partial', node: { id: 'partial_rb', name: 'Partial Failure', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'partial_failure', children: [] } },
                                                  { label: 'Error', value: 'error', node: { id: 'error_rb', name: 'Error', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'error', children: [] } }
                                                ]
                                              }]
                                            }]
                                          }]
                                        }
                                      },
                                      {
                                        label: 'No',
                                        value: false,
                                        matchValue: false, // Match when withinRollbackWindow === false
                                        node: {
                                          id: 'generate_tasks',
                                          name: 'Generate Tasks',
                                          layer: 'automation',
                                          type: 'step',
                                          matchStep: 'generate_tasks',
                                          children: [{
                                            id: 'verify_tasks',
                                            name: 'Verify Tasks',
                                            layer: 'automation',
                                            type: 'step',
                                            matchStep: 'verify_tasks',
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
    }]
  }
};

// ============================================================================
// TASK COMPLETED WORKFLOW
// ============================================================================
export const taskCompletedWorkflow = {
  id: 'task-completed',
  name: 'Task Completed',
  trigger: '/webhooks/tasks',
  triggerName: 'task-completed',
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
                name: 'Fetch Task from Clio',
                layer: 'service',
                type: 'step',
                matchStep: 'fetch_task',
                children: [{
                  id: 'task_exists',
                  name: 'Task Exists in Clio?',
                  layer: 'decision',
                  type: 'decision',
                  condition: 'Check if task exists in Clio',
                  children: [
                    {
                      label: 'Deleted',
                      value: false,
                      node: {
                        id: 'search_supabase_deleted',
                        name: 'Search Task in Supabase',
                        layer: 'service',
                        type: 'step',
                        matchStep: 'search_task_in_supabase',
                        children: [{
                          id: 'task_found_deleted',
                          name: 'Task Found?',
                          layer: 'decision',
                          type: 'decision',
                          condition: 'Check if task exists in database',
                          children: [
                            {
                              label: 'No',
                              value: false,
                              node: {
                                id: 'not_found_deleted',
                                name: 'Not Found in Supabase',
                                layer: 'outcome',
                                type: 'outcome',
                                status: 'skipped',
                                matchAction: 'not_found',
                                children: []
                              }
                            },
                            {
                              label: 'Yes',
                              value: true,
                              node: {
                                id: 'delete_supabase_deleted',
                                name: 'Delete Task in Supabase',
                                layer: 'service',
                                type: 'step',
                                matchStep: 'delete_task_in_supabase',
                                children: [{
                                  id: 'deleted_in_supabase',
                                  name: 'Task Deleted in Supabase',
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
                      label: 'Exists',
                      value: true,
                      node: {
                        id: 'check_supabase',
                        name: 'Check Task in Supabase',
                        layer: 'service',
                        type: 'step',
                        matchStep: 'check_task_in_supabase',
                        children: [{
                          id: 'task_in_supabase',
                          name: 'Task Found in Supabase?',
                          layer: 'decision',
                          type: 'decision',
                          condition: 'Check if task exists in database',
                          children: [
                            { label: 'No', value: false, node: { id: 'not_found_supabase', name: 'Not Found in Supabase', layer: 'outcome', type: 'outcome', status: 'skipped', matchAction: 'not_found', children: [] } },
                            {
                              label: 'Yes',
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
                                      id: 'update_supabase',
                                      name: 'Update Status in Supabase',
                                      layer: 'service',
                                      type: 'step',
                                      matchStep: 'update_task_status_supabase',
                                      children: [{
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
                                                { label: 'No', value: false, node: { id: 'no_action', name: 'Completed in Supabase', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'none', children: [] } },
                                                { label: 'Yes', value: true, node: { id: 'dependents_updated', name: 'Dependents Updated', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'dependent_tasks', children: [] } }
                                              ]
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
        id: 'search_supabase',
        name: 'Search Task in Supabase',
        layer: 'service',
        type: 'step',
        matchStep: 'search_task_in_supabase',
        children: [{
          id: 'task_found',
          name: 'Task Found?',
          layer: 'decision',
          type: 'decision',
          condition: 'Check if task exists in database',
          children: [
            {
              label: 'No',
              value: false,
              node: {
                id: 'not_found',
                name: 'Not Found in Supabase',
                layer: 'outcome',
                type: 'outcome',
                status: 'skipped',
                matchAction: 'task_not_found',
                children: []
              }
            },
            {
              label: 'Yes',
              value: true,
              node: {
                id: 'test_mode',
                name: 'Test Mode Filter',
                layer: 'decision',
                type: 'decision',
                condition: 'Is task matter in allowlist?',
                children: [
                  {
                    label: 'Blocked',
                    value: false,
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
                    node: {
                      id: 'delete_supabase',
                      name: 'Delete Task in Supabase',
                      layer: 'service',
                      type: 'step',
                      matchStep: 'delete_task_in_supabase',
                      children: [{
                        id: 'deleted',
                        name: 'Task Deleted in Supabase',
                        layer: 'outcome',
                        type: 'outcome',
                        status: 'success',
                        matchAction: 'deleted_in_supabase',
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
                            {
                              label: 'No',
                              value: false,
                              node: {
                                id: 'create_task',
                                name: 'Create Task',
                                layer: 'automation',
                                type: 'step',
                                matchStep: 'create_task',
                                children: [{
                                  id: 'task_created',
                                  name: 'Task Created',
                                  layer: 'outcome',
                                  type: 'outcome',
                                  status: 'success',
                                  matchAction: 'task_created',
                                  children: []
                                }]
                              }
                            }
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
  'task-completed': taskCompletedWorkflow,
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
 * Also attaches matching step data and details to each node
 */
export function matchTraceToWorkflow(workflow, trace, steps) {
  if (!workflow) return null;

  // Normalize data for matching
  const resultAction = trace?.resultAction?.toLowerCase() || '';
  const traceStatus = trace?.status?.toLowerCase() || '';

  // Build a map of step names to their full step data
  const stepsByName = {};
  steps.forEach(step => {
    if (step.stepName) {
      stepsByName[step.stepName.toLowerCase()] = step;
    }
  });

  // Get all step names (case-insensitive)
  const stepNames = new Set(Object.keys(stepsByName));

  // Build a map of all details/operations across all steps
  const allDetails = [];
  steps.forEach(step => {
    if (step.details && Array.isArray(step.details)) {
      step.details.forEach(detail => {
        allDetails.push({
          ...detail,
          parentStepName: step.stepName,
          parentStepId: step.stepId,
        });
      });
    }
  });

  // Debug logging
  console.log('[WorkflowMatch] Step names:', Array.from(stepNames));
  console.log('[WorkflowMatch] All details count:', allDetails.length);
  console.log('[WorkflowMatch] Result action:', resultAction);

  // Helper: Check if a node's matchStepOutput condition is satisfied
  function checkStepOutputMatch(node) {
    if (!node.matchStepOutput) return true; // No condition = always match

    const { stepName, outputField, expectedValue } = node.matchStepOutput;
    const step = stepsByName[stepName?.toLowerCase()];
    if (!step || !step.output) return false;

    const actualValue = step.output[outputField];

    // If expectedValue is specified, check equality
    if (expectedValue !== undefined) {
      return actualValue === expectedValue;
    }

    // Otherwise just check if the field exists and is truthy
    return !!actualValue;
  }

  // Track the last step in the chain to mark as "current"
  let lastMatchedStep = null;
  let lastMatchedDepth = -1;

  // First pass: find all taken nodes and determine the last one
  function findTakenNodes(node, depth = 0) {
    let taken = false;

    // Check matchStepOutput constraint first
    const stepOutputMatch = checkStepOutputMatch(node);

    if (node.type === 'step' && node.matchStep) {
      taken = stepNames.has(node.matchStep.toLowerCase()) && stepOutputMatch;
      if (taken && depth > lastMatchedDepth) {
        lastMatchedStep = node.id;
        lastMatchedDepth = depth;
      }
    } else if (node.type === 'step' && node.matchStepOutput && !node.matchStep) {
      // Step that only matches based on step output (like "Delete Previous Tasks")
      taken = stepOutputMatch;
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
      // For decisions with matchStepOutput, check which branch matches
      if (node.matchStepOutput) {
        const { stepName, outputField } = node.matchStepOutput;
        const step = stepsByName[stepName?.toLowerCase()];
        const actualValue = step?.output?.[outputField];

        // Find the branch that matches the actual value
        node.children.forEach(branch => {
          if (branch.matchValue !== undefined && branch.matchValue === actualValue) {
            if (branch.node && findTakenNodes(branch.node, depth + 1)) {
              taken = true;
            }
          }
        });
      } else {
        // Decisions are taken if any child branch was taken
        node.children.forEach(branch => {
          if (branch.node && findTakenNodes(branch.node, depth + 1)) {
            taken = true;
          }
        });
      }
    }

    // Check children for steps (only if not a decision with matchStepOutput)
    if (node.children && !(node.type === 'decision' && node.matchStepOutput)) {
      node.children.forEach(child => {
        if (child.node) {
          if (findTakenNodes(child.node, depth + 1)) {
            taken = true;
          }
        } else if (child.id) {
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

  // Second pass: mark all nodes with status and attach step data
  // branchActive: whether this node is in an active branch (for decision matching)
  function markNode(node, depth = 0, branchActive = true) {
    let taken = false;
    let current = false;
    let stepData = null;
    let nodeDetails = [];

    // Check matchStepOutput constraint
    const stepOutputMatch = checkStepOutputMatch(node);

    if (node.type === 'step' && node.matchStep) {
      const matchKey = node.matchStep.toLowerCase();
      // Only match if branch is active AND step exists AND stepOutput matches
      taken = branchActive && stepNames.has(matchKey) && stepOutputMatch;
      if (taken) {
        // Attach the matching step data
        stepData = stepsByName[matchKey];
        // Get details from this step
        if (stepData?.details) {
          nodeDetails = stepData.details;
        }
      }
    } else if (node.type === 'step' && !node.matchStep) {
      // Step without matchStep (like "Delete Previous Tasks") - taken if branch is active
      taken = branchActive && stepOutputMatch;
      if (taken && node.matchStepOutput) {
        // Get step data from the referenced step
        const { stepName } = node.matchStepOutput;
        stepData = stepsByName[stepName?.toLowerCase()];
      }
    } else if (node.type === 'outcome' && node.matchAction) {
      const matchAction = node.matchAction.toLowerCase();
      // Only match outcomes in active branches
      taken = branchActive && (resultAction.includes(matchAction) || resultAction === matchAction);
      if (taken) {
        current = true;
        // For outcomes, find any details that match the action
        nodeDetails = allDetails.filter(d =>
          d.operation?.toLowerCase().includes(matchAction) ||
          d.output?.action?.toLowerCase() === matchAction
        );
      }
    } else if (node.type === 'decision') {
      // For decisions, mark children FIRST, then check if any are taken
      // This prevents double-processing children
    }

    // For steps, check if it's current
    if (node.type === 'step' && taken) {
      if (node.id === lastMatchedStep) {
        current = true;
      }
    }

    // Mark children (do this first for all node types)
    // For decisions with matchStepOutput, only mark the matching branch as active
    let markedChildren;
    if (node.type === 'decision' && node.matchStepOutput) {
      const { stepName, outputField } = node.matchStepOutput;
      const step = stepsByName[stepName?.toLowerCase()];
      const actualValue = step?.output?.[outputField];

      // Debug logging
      console.log(`[WorkflowMatch] Decision ${node.id}: stepName=${stepName}, outputField=${outputField}, actualValue=${actualValue}, step exists=${!!step}`);

      // If step doesn't exist or output is undefined, default to false (no rollback)
      const valueToMatch = actualValue !== undefined ? actualValue : false;

      markedChildren = node.children.map(child => {
        if (child.node) {
          // Branch is active only if its matchValue matches the actual value
          const isBranchActive = branchActive && (child.matchValue === valueToMatch);
          console.log(`[WorkflowMatch] Branch ${child.label}: matchValue=${child.matchValue}, valueToMatch=${valueToMatch}, isBranchActive=${isBranchActive}`);
          return {
            ...child,
            node: markNode(child.node, depth + 1, isBranchActive),
          };
        }
        return child;
      });
    } else {
      markedChildren = node.children.map(child => {
        if (child.node) {
          return {
            ...child,
            node: markNode(child.node, depth + 1, branchActive),
          };
        } else if (child.id) {
          return markNode(child, depth + 1, branchActive);
        }
        return child;
      });
    }

    // For decisions, check if any marked child branch is taken
    if (node.type === 'decision') {
      taken = markedChildren.some(branch => {
        if (branch.node) {
          const ms = branch.node.matchStatus;
          return ms === 'taken' || ms === 'current';
        }
        return false;
      });

      // For decisions, try to find relevant details
      if (taken && node.matchStep) {
        const matchKey = node.matchStep.toLowerCase();
        stepData = stepsByName[matchKey];
        if (stepData?.details) {
          nodeDetails = stepData.details;
        }
      }

      // For decisions with matchStepOutput, attach the step data
      if (taken && node.matchStepOutput) {
        const { stepName } = node.matchStepOutput;
        stepData = stepsByName[stepName?.toLowerCase()];
        if (stepData?.details) {
          nodeDetails = stepData.details;
        }
      }
    }

    return {
      ...node,
      matchStatus: current ? 'current' : (taken ? 'taken' : 'not-taken'),
      // Preserve original template status for outcome nodes (success, error, skipped)
      // but update it for taken outcomes to reflect actual result
      status: node.type === 'outcome' && taken ? (node.status || 'success') : node.status,
      stepData,
      details: nodeDetails,
      children: markedChildren,
    };
  }

  return {
    ...workflow,
    root: markNode(workflow.root),
    trace,
    allSteps: steps,
    allDetails,
  };
}
