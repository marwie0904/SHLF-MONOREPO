/**
 * Error Codes for Supabase error_logs table
 *
 * Format: ERR_[CATEGORY]_[SPECIFIC_ERROR]
 */
export const ERROR_CODES = {
  // Assignee resolution errors
  ASSIGNEE_NO_ATTORNEY: 'ERR_ASSIGNEE_NO_ATTORNEY',
  ASSIGNEE_NO_CSC: 'ERR_ASSIGNEE_NO_CSC',
  ASSIGNEE_NO_PARALEGAL: 'ERR_ASSIGNEE_NO_PARALEGAL',
  ASSIGNEE_NO_FUND_TABLE: 'ERR_ASSIGNEE_NO_FUND_TABLE',

  // Meeting location errors
  MEETING_NO_LOCATION: 'ERR_MEETING_NO_LOCATION',
  MEETING_INVALID_LOCATION: 'ERR_MEETING_INVALID_LOCATION',

  // Template validation errors
  TEMPLATE_MISSING: 'ERR_TEMPLATE_MISSING',
  TEMPLATE_DUPLICATE: 'ERR_TEMPLATE_DUPLICATE',
  TEMPLATE_NOT_FOUND: 'ERR_TEMPLATE_NOT_FOUND',

  // API and sync errors
  CLIO_API_FAILED: 'ERR_CLIO_API_FAILED',
  SUPABASE_SYNC_FAILED: 'ERR_SUPABASE_SYNC_FAILED',
  TASK_NOT_FOUND_IN_CLIO: 'ERR_TASK_NOT_FOUND_IN_CLIO',

  // Invalid input errors
  ASSIGNEE_INVALID_TYPE: 'ERR_ASSIGNEE_INVALID_TYPE',

  // Validation errors (missing required data from Clio)
  VALIDATION_MISSING_STAGE: 'ERR_VALIDATION_MISSING_STAGE',
  VALIDATION_MISSING_MATTER: 'ERR_VALIDATION_MISSING_MATTER',
  VALIDATION_MISSING_EVENT_TYPE: 'ERR_VALIDATION_MISSING_EVENT_TYPE',
  VALIDATION_MISSING_REQUIRED_FIELD: 'ERR_VALIDATION_MISSING_REQUIRED_FIELD',

  // Webhook security errors
  WEBHOOK_INVALID_SIGNATURE: 'ERR_WEBHOOK_INVALID_SIGNATURE',
  WEBHOOK_MISSING_SIGNATURE: 'ERR_WEBHOOK_MISSING_SIGNATURE',

  // Bill and payment checking errors
  BILL_CHECK_FAILED: 'ERR_BILL_CHECK_FAILED',
  PAYMENT_CHECK_FAILED: 'ERR_PAYMENT_CHECK_FAILED',
  CLOSED_MATTER_TASK_FAILED: 'ERR_CLOSED_MATTER_TASK_FAILED',
};

/**
 * Error messages for each code
 */
export const ERROR_MESSAGES = {
  [ERROR_CODES.ASSIGNEE_NO_ATTORNEY]: 'No originating attorney found on matter',
  [ERROR_CODES.ASSIGNEE_NO_CSC]: 'No CSC found for location',
  [ERROR_CODES.ASSIGNEE_NO_PARALEGAL]: 'No paralegal found for attorney',
  [ERROR_CODES.ASSIGNEE_NO_FUND_TABLE]: 'No user found for fund table',
  [ERROR_CODES.MEETING_NO_LOCATION]: 'Signing meeting has no location',
  [ERROR_CODES.MEETING_INVALID_LOCATION]: 'Meeting location does not contain required keywords',
  [ERROR_CODES.TEMPLATE_MISSING]: 'No task templates found for stage',
  [ERROR_CODES.TEMPLATE_DUPLICATE]: 'Duplicate task_number found in templates',
  [ERROR_CODES.TEMPLATE_NOT_FOUND]: 'Task template not found',
  [ERROR_CODES.CLIO_API_FAILED]: 'Clio API request failed',
  [ERROR_CODES.SUPABASE_SYNC_FAILED]: 'Supabase sync failed after Clio success',
  [ERROR_CODES.TASK_NOT_FOUND_IN_CLIO]: 'Task not found in Clio (404) - marked for regeneration',
  [ERROR_CODES.VALIDATION_MISSING_STAGE]: 'Matter missing required stage information',
  [ERROR_CODES.VALIDATION_MISSING_MATTER]: 'Task missing required matter association',
  [ERROR_CODES.VALIDATION_MISSING_EVENT_TYPE]: 'Calendar entry missing required event type',
  [ERROR_CODES.VALIDATION_MISSING_REQUIRED_FIELD]: 'Missing required field from Clio API',
  [ERROR_CODES.WEBHOOK_INVALID_SIGNATURE]: 'Invalid webhook signature',
  [ERROR_CODES.WEBHOOK_MISSING_SIGNATURE]: 'Missing webhook signature',
  [ERROR_CODES.BILL_CHECK_FAILED]: 'Failed to retrieve or check bills for matter',
  [ERROR_CODES.PAYMENT_CHECK_FAILED]: 'Failed to check payment status for matter',
  [ERROR_CODES.CLOSED_MATTER_TASK_FAILED]: 'Failed to create task for closed matter without payment',
};
