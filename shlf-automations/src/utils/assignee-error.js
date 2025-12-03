/**
 * Custom error class for assignee resolution failures
 * Includes error codes for categorization and logging
 */
export class AssigneeError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = 'AssigneeError';
    this.code = code;
    this.context = context;
  }
}
