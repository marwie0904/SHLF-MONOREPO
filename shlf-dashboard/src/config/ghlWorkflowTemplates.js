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
    matchStep: 'express:webhook_received',
    children: [{
      id: 'rate_limit',
      name: 'Rate Limit Check',
      layer: 'processing',
      type: 'step',
      matchStep: 'express:rate_limit_check',
      children: [{
        id: 'extract_data',
        name: 'Extract Task Data',
        layer: 'processing',
        type: 'step',
        matchStep: 'express:extract_task_data',
        children: [{
          id: 'validate',
          name: 'Validate Required Fields',
          layer: 'processing',
          type: 'step',
          matchStep: 'express:validate_required_fields',
          children: [{
            id: 'process_task',
            name: 'Process Task Creation',
            layer: 'service',
            type: 'step',
            matchStep: 'ghlTaskService:processTaskCreation',
            children: [{
              id: 'outcome',
              name: 'Sync Result',
              layer: 'decision',
              type: 'decision',
              condition: 'Final outcome',
              matchTraceStatus: true,
              children: [
                { label: 'Success', value: 'success', matchValue: 'task_synced', node: { id: 'synced', name: 'Task Synced', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'task_synced', children: [] } },
                { label: 'Error', value: 'error', matchValue: 'error', node: { id: 'error', name: 'Sync Error', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'error', children: [] } }
              ]
            }]
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
  trigger: '/webhooks/ghl/task-completed',
  triggerName: 'task-completed',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'express:webhook_received',
    children: [{
      id: 'rate_limit',
      name: 'Rate Limit Check',
      layer: 'processing',
      type: 'step',
      matchStep: 'express:rate_limit_check',
      children: [{
        id: 'extract_data',
        name: 'Extract Task Data',
        layer: 'processing',
        type: 'step',
        matchStep: 'express:extract_task_data',
        children: [{
          id: 'validate',
          name: 'Validate Required Fields',
          layer: 'processing',
          type: 'step',
          matchStep: 'express:validate_required_fields',
          children: [{
            id: 'check_completion',
            name: 'Check Completion Status',
            layer: 'processing',
            type: 'step',
            matchStep: 'express:check_completion_status',
            children: [{
              id: 'completion_decision',
              name: 'Is Task Completed?',
              layer: 'decision',
              type: 'decision',
              condition: 'Check if task is marked as completed',
              matchStepOutput: { stepName: 'express:check_completion_status', outputField: 'isCompleted' },
              children: [
                {
                  label: 'No',
                  value: false,
                  matchValue: false,
                  node: {
                    id: 'not_completed',
                    name: 'Not Completed',
                    layer: 'outcome',
                    type: 'outcome',
                    status: 'skipped',
                    matchAction: 'skipped_not_completed',
                    children: []
                  }
                },
                {
                  label: 'Yes',
                  value: true,
                  matchValue: true,
                  node: {
                    id: 'process_completion',
                    name: 'Process Task Completion',
                    layer: 'service',
                    type: 'step',
                    matchStep: 'ghlOpportunityService:processTaskCompletion',
                    children: [{
                      id: 'search_opportunity',
                      name: 'Search Opportunity',
                      layer: 'external',
                      type: 'step',
                      matchStep: 'ghl:searchOpportunity',
                      children: [{
                        id: 'opp_found_decision',
                        name: 'Opportunity Found?',
                        layer: 'decision',
                        type: 'decision',
                        condition: 'Check if opportunity was found for contact',
                        matchStepOutput: { stepName: 'ghl:searchOpportunity', outputField: 'opportunitiesFound' },
                        children: [
                          {
                            label: 'No',
                            value: 0,
                            matchValue: 0,
                            node: {
                              id: 'no_opportunity',
                              name: 'No Opportunity Found',
                              layer: 'outcome',
                              type: 'outcome',
                              status: 'skipped',
                              matchAction: 'no_opportunity_found',
                              children: []
                            }
                          },
                          {
                            label: 'Yes',
                            value: true,
                            node: {
                              id: 'get_opp_details',
                              name: 'Get Opportunity Details',
                              layer: 'external',
                              type: 'step',
                              matchStep: 'ghl:getOpportunityDetails',
                              children: [{
                                id: 'check_final_task',
                                name: 'Check Final Task',
                                layer: 'processing',
                                type: 'step',
                                matchStep: 'processing:checkFinalTask',
                                children: [{
                                  id: 'is_final_task_decision',
                                  name: 'Is Final Task?',
                                  layer: 'decision',
                                  type: 'decision',
                                  condition: 'Check if this is the final task for the stage',
                                  matchStepOutput: { stepName: 'processing:checkFinalTask', outputField: 'isFinalTask' },
                                  children: [
                                    {
                                      label: 'No',
                                      value: false,
                                      matchValue: false,
                                      matchTraceAction: 'not_final_task',
                                      node: {
                                        id: 'not_final_task',
                                        name: 'Not Final Task',
                                        layer: 'outcome',
                                        type: 'outcome',
                                        status: 'skipped',
                                        matchAction: 'not_final_task',
                                        children: []
                                      }
                                    },
                                    {
                                      label: 'Yes',
                                      value: true,
                                      matchValue: true,
                                      node: {
                                        id: 'get_stage_mapping',
                                        name: 'Get Stage Mapping',
                                        layer: 'service',
                                        type: 'step',
                                        matchStep: 'supabase:getStageMapping',
                                        children: [{
                                          id: 'mapping_found_decision',
                                          name: 'Mapping Found?',
                                          layer: 'decision',
                                          type: 'decision',
                                          condition: 'Check if stage completion mapping exists',
                                          matchStepOutput: { stepName: 'supabase:getStageMapping', outputField: 'mappingFound' },
                                          children: [
                                            {
                                              label: 'No',
                                              value: false,
                                              matchValue: false,
                                              matchTraceAction: 'no_mapping',
                                              node: {
                                                id: 'no_mapping',
                                                name: 'No Stage Mapping',
                                                layer: 'outcome',
                                                type: 'outcome',
                                                status: 'skipped',
                                                matchAction: 'no_mapping',
                                                children: []
                                              }
                                            },
                                            {
                                              label: 'Yes',
                                              value: true,
                                              matchValue: true,
                                              node: {
                                                id: 'update_stage',
                                                name: 'Update Opportunity Stage',
                                                layer: 'external',
                                                type: 'step',
                                                matchStep: 'ghl:updateOpportunityStage',
                                                children: [{
                                                  id: 'outcome',
                                                  name: 'Stage Update Result',
                                                  layer: 'decision',
                                                  type: 'decision',
                                                  condition: 'Final outcome',
                                                  matchTraceStatus: true,
                                                  children: [
                                                    { label: 'Success', value: 'success', matchValue: 'opportunity_moved', node: { id: 'stage_updated', name: 'Opportunity Moved', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'opportunity_moved', children: [] } },
                                                    { label: 'Error', value: 'error', matchValue: 'error', node: { id: 'error', name: 'Update Error', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'error', children: [] } }
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
// APPOINTMENT CREATED WORKFLOW
// ============================================================================
export const appointmentCreatedWorkflow = {
  id: 'appointment-created',
  name: 'Appointment Created',
  trigger: '/webhooks/ghl/appointment-created',
  triggerName: 'appointment-created',
  root: {
    id: 'webhook',
    name: 'Webhook Received',
    layer: 'webhook',
    type: 'step',
    matchStep: 'express:webhook_received',
    children: [{
      id: 'rate_limit',
      name: 'Rate Limit Check',
      layer: 'processing',
      type: 'step',
      matchStep: 'express:rate_limit_check',
      children: [{
        id: 'extract_data',
        name: 'Extract Appointment Data',
        layer: 'processing',
        type: 'step',
        matchStep: 'express:extract_appointment_data',
        children: [{
          id: 'validate',
          name: 'Validate Required Fields',
          layer: 'processing',
          type: 'step',
          matchStep: 'express:validate_required_fields',
          children: [{
            id: 'validate_decision',
            name: 'Validation Passed?',
            layer: 'decision',
            type: 'decision',
            condition: 'Check if appointmentId is present',
            matchStepOutput: { stepName: 'express:validate_required_fields', outputField: 'isValid' },
            children: [
              {
                label: 'No',
                value: false,
                matchValue: false,
                node: {
                  id: 'validation_failed',
                  name: 'Validation Failed',
                  layer: 'outcome',
                  type: 'outcome',
                  status: 'error',
                  matchAction: 'validation_failed',
                  children: []
                }
              },
              {
                label: 'Yes',
                value: true,
                matchValue: true,
                node: {
                  id: 'process_appointment',
                  name: 'Process Appointment',
                  layer: 'service',
                  type: 'step',
                  matchStep: 'appointmentService:processAppointmentCreated',
                  children: [{
                    id: 'get_form_submission',
                    name: 'Get Form Submission',
                    layer: 'external',
                    type: 'step',
                    matchStep: 'ghl:getFormSubmission',
                    children: [{
                      id: 'form_found_decision',
                      name: 'Form Submission Found?',
                      layer: 'decision',
                      type: 'decision',
                      condition: 'Check if booking form submission was found',
                      matchStepOutput: { stepName: 'ghl:getFormSubmission', outputField: 'submissionFound' },
                      children: [
                        {
                          label: 'No',
                          value: false,
                          matchValue: false,
                          node: {
                            id: 'get_calendar_fallback',
                            name: 'Get Calendar Name (Fallback)',
                            layer: 'external',
                            type: 'step',
                            matchStep: 'ghl:getCalendarName',
                            children: [{
                              id: 'build_title_fallback',
                              name: 'Build Title (Fallback Format)',
                              layer: 'processing',
                              type: 'step',
                              matchStep: 'processing:buildTitle',
                              children: [{
                                id: 'update_title_fallback',
                                name: 'Update Appointment Title',
                                layer: 'external',
                                type: 'step',
                                matchStep: 'ghl:updateAppointmentTitle',
                                children: [{
                                  id: 'check_stage_mapping_fallback',
                                  name: 'Check Stage Mapping',
                                  layer: 'processing',
                                  type: 'step',
                                  matchStep: 'processing:checkStageMapping',
                                  children: [{
                                    id: 'outcome_no_email',
                                    name: 'Appointment Result',
                                    layer: 'decision',
                                    type: 'decision',
                                    condition: 'Final outcome (no email - no meeting type)',
                                    matchTraceStatus: true,
                                    children: [
                                      { label: 'Success', value: 'success', matchValue: 'appointment_processed', node: { id: 'processed_no_email', name: 'Appointment Processed', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'appointment_processed', children: [] } },
                                      { label: 'With Stage Update', value: 'success', matchValue: 'appointment_processed_with_stage_update', node: { id: 'processed_with_stage', name: 'Processed + Stage Updated', layer: 'outcome', type: 'outcome', status: 'success', matchAction: 'appointment_processed_with_stage_update', children: [] } },
                                      { label: 'Error', value: 'error', matchValue: 'error', node: { id: 'error_fallback', name: 'Error', layer: 'outcome', type: 'outcome', status: 'error', matchAction: 'error', children: [] } }
                                    ]
                                  }]
                                }]
                              }]
                            }]
                          }
                        },
                        {
                          label: 'Yes',
                          value: true,
                          matchValue: true,
                          node: {
                            id: 'build_title_full',
                            name: 'Build Title (Full Format)',
                            layer: 'processing',
                            type: 'step',
                            matchStep: 'processing:buildTitle',
                            children: [{
                              id: 'update_title',
                              name: 'Update Appointment Title',
                              layer: 'external',
                              type: 'step',
                              matchStep: 'ghl:updateAppointmentTitle',
                              children: [{
                                id: 'search_opportunity',
                                name: 'Search Opportunity',
                                layer: 'external',
                                type: 'step',
                                matchStep: 'ghl:searchOpportunity',
                                children: [{
                                  id: 'check_stage_mapping',
                                  name: 'Check Stage Mapping',
                                  layer: 'processing',
                                  type: 'step',
                                  matchStep: 'processing:checkStageMapping',
                                  children: [{
                                    id: 'should_update_stage_decision',
                                    name: 'Should Update Stage?',
                                    layer: 'decision',
                                    type: 'decision',
                                    condition: 'Check if meeting type has stage mapping',
                                    matchStepOutput: { stepName: 'processing:checkStageMapping', outputField: 'shouldUpdateStage' },
                                    children: [
                                      {
                                        label: 'No',
                                        value: false,
                                        matchValue: false,
                                        node: {
                                          id: 'check_email_no_stage',
                                          name: 'Check Email Requirements',
                                          layer: 'processing',
                                          type: 'step',
                                          matchStep: 'processing:checkEmailRequirements',
                                          children: [{
                                            id: 'email_required_decision_no_stage',
                                            name: 'Email Required?',
                                            layer: 'decision',
                                            type: 'decision',
                                            condition: 'Check if meeting type requires confirmation email',
                                            matchStepOutput: { stepName: 'processing:checkEmailRequirements', outputField: 'requiresEmail' },
                                            children: [
                                              {
                                                label: 'No',
                                                value: false,
                                                matchValue: false,
                                                node: {
                                                  id: 'outcome_no_stage_no_email',
                                                  name: 'Appointment Processed',
                                                  layer: 'outcome',
                                                  type: 'outcome',
                                                  status: 'success',
                                                  matchAction: 'appointment_processed',
                                                  children: []
                                                }
                                              },
                                              {
                                                label: 'Yes',
                                                value: true,
                                                matchValue: true,
                                                node: {
                                                  id: 'get_appt_details_no_stage',
                                                  name: 'Get Appointment Details',
                                                  layer: 'external',
                                                  type: 'step',
                                                  matchStep: 'ghl:getAppointmentDetails',
                                                  children: [{
                                                    id: 'get_contact_no_stage',
                                                    name: 'Get Contact Details',
                                                    layer: 'external',
                                                    type: 'step',
                                                    matchStep: 'ghl:getContactDetails',
                                                    children: [{
                                                      id: 'send_email_no_stage',
                                                      name: 'Send Confirmation Email',
                                                      layer: 'external',
                                                      type: 'step',
                                                      matchStep: 'email:sendConfirmationEmail',
                                                      children: [{
                                                        id: 'email_sent_decision_no_stage',
                                                        name: 'Email Sent?',
                                                        layer: 'decision',
                                                        type: 'decision',
                                                        condition: 'Check if email was sent successfully',
                                                        matchStepOutput: { stepName: 'email:sendConfirmationEmail', outputField: 'success' },
                                                        children: [
                                                          {
                                                            label: 'No',
                                                            value: false,
                                                            matchValue: false,
                                                            node: {
                                                              id: 'outcome_no_stage_email_failed',
                                                              name: 'Processed (Email Failed)',
                                                              layer: 'outcome',
                                                              type: 'outcome',
                                                              status: 'success',
                                                              matchAction: 'appointment_processed',
                                                              children: []
                                                            }
                                                          },
                                                          {
                                                            label: 'Yes',
                                                            value: true,
                                                            matchValue: true,
                                                            node: {
                                                              id: 'send_sms_no_stage',
                                                              name: 'Send SMS Notifications',
                                                              layer: 'external',
                                                              type: 'step',
                                                              matchStep: 'sms:sendConfirmationSms',
                                                              children: [{
                                                                id: 'outcome_no_stage_with_notifications',
                                                                name: 'Processed with Notifications',
                                                                layer: 'outcome',
                                                                type: 'outcome',
                                                                status: 'success',
                                                                matchAction: 'appointment_processed_with_notifications',
                                                                children: []
                                                              }]
                                                            }
                                                          }
                                                        ]
                                                      }]
                                                    }]
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
                                        matchValue: true,
                                        node: {
                                          id: 'update_stage',
                                          name: 'Update Opportunity Stage',
                                          layer: 'external',
                                          type: 'step',
                                          matchStep: 'ghl:updateOpportunityStage',
                                          children: [{
                                            id: 'check_email_with_stage',
                                            name: 'Check Email Requirements',
                                            layer: 'processing',
                                            type: 'step',
                                            matchStep: 'processing:checkEmailRequirements',
                                            children: [{
                                              id: 'email_required_decision',
                                              name: 'Email Required?',
                                              layer: 'decision',
                                              type: 'decision',
                                              condition: 'Check if meeting type requires confirmation email',
                                              matchStepOutput: { stepName: 'processing:checkEmailRequirements', outputField: 'requiresEmail' },
                                              children: [
                                                {
                                                  label: 'No',
                                                  value: false,
                                                  matchValue: false,
                                                  node: {
                                                    id: 'outcome_stage_no_email',
                                                    name: 'Processed + Stage Updated',
                                                    layer: 'outcome',
                                                    type: 'outcome',
                                                    status: 'success',
                                                    matchAction: 'appointment_processed_with_stage_update',
                                                    children: []
                                                  }
                                                },
                                                {
                                                  label: 'Yes',
                                                  value: true,
                                                  matchValue: true,
                                                  node: {
                                                    id: 'get_appt_details',
                                                    name: 'Get Appointment Details',
                                                    layer: 'external',
                                                    type: 'step',
                                                    matchStep: 'ghl:getAppointmentDetails',
                                                    children: [{
                                                      id: 'get_contact',
                                                      name: 'Get Contact Details',
                                                      layer: 'external',
                                                      type: 'step',
                                                      matchStep: 'ghl:getContactDetails',
                                                      children: [{
                                                        id: 'send_email',
                                                        name: 'Send Confirmation Email',
                                                        layer: 'external',
                                                        type: 'step',
                                                        matchStep: 'email:sendConfirmationEmail',
                                                        children: [{
                                                          id: 'email_sent_decision',
                                                          name: 'Email Sent?',
                                                          layer: 'decision',
                                                          type: 'decision',
                                                          condition: 'Check if email was sent successfully',
                                                          matchStepOutput: { stepName: 'email:sendConfirmationEmail', outputField: 'success' },
                                                          children: [
                                                            {
                                                              label: 'No',
                                                              value: false,
                                                              matchValue: false,
                                                              node: {
                                                                id: 'outcome_email_failed',
                                                                name: 'Processed (Email Failed)',
                                                                layer: 'outcome',
                                                                type: 'outcome',
                                                                status: 'success',
                                                                matchAction: 'appointment_processed_with_stage_update',
                                                                children: []
                                                              }
                                                            },
                                                            {
                                                              label: 'Yes',
                                                              value: true,
                                                              matchValue: true,
                                                              node: {
                                                                id: 'send_sms',
                                                                name: 'Send SMS Notifications',
                                                                layer: 'external',
                                                                type: 'step',
                                                                matchStep: 'sms:sendConfirmationSms',
                                                                children: [{
                                                                  id: 'outcome_full_success',
                                                                  name: 'Processed with Notifications',
                                                                  layer: 'outcome',
                                                                  type: 'outcome',
                                                                  status: 'success',
                                                                  matchAction: 'appointment_processed_with_notifications',
                                                                  children: []
                                                                }]
                                                              }
                                                            }
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
                                      }
                                    ]
                                  }]
                                }]
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
          }]
        }]
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
  'appointment-created': appointmentCreatedWorkflow,
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

  // First check if responseBody has an explicit action field
  if (responseBody.action) {
    resultAction = responseBody.action;
  } else if (traceStatus === 'completed' && responseBody.success) {
    if (responseBody.tasksCreated > 0) {
      resultAction = 'tasks_created';
    } else if (responseBody.tasksCreated === 0) {
      resultAction = 'no_tasks';
    } else if (responseBody.stageUpdated) {
      resultAction = 'stage_updated';
    } else if (responseBody.taskId) {
      resultAction = 'task_synced';
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

        // Also check for matchTraceAction on the branch (alternative matching)
        if (branch.matchTraceAction && resultAction === branch.matchTraceAction) {
          isBranchActive = branchActive;
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
