import {
  addDays,
  addHours,
  addMinutes,
  format,
  isWeekend,
  nextMonday,
  parseISO
} from 'date-fns';
import { config } from '../config/index.js';

/**
 * Date and Time Utility Functions
 */

/**
 * Apply timezone offset for EST conversion
 * @param {Date|string} date
 * @returns {Date}
 */
export function applyTimezoneOffset(date) {
  const parsedDate = typeof date === 'string' ? parseISO(date) : date;
  return addHours(parsedDate, config.automation.timezoneOffsetHours);
}

/**
 * Shift weekend dates to next Monday
 * @param {Date} date
 * @returns {Date}
 */
export function shiftWeekendToMonday(date) {
  if (isWeekend(date)) {
    return nextMonday(date);
  }
  return date;
}

/**
 * Get current date/time in EST/EDT timezone
 * @returns {Date}
 */
export function getNowInEST() {
  const now = new Date();
  // Convert UTC to EST/EDT by subtracting offset
  // EST is UTC-5, EDT is UTC-4
  // Server is UTC, so we subtract the offset to get local Florida time
  const estOffset = config.automation.timezoneOffsetHours;
  return addHours(now, -estOffset);
}

/**
 * Calculate due date based on template configuration
 * @param {Object} taskTemplate
 * @param {Date} referenceDate
 * @param {string} relation - 'after creation', 'before meeting', 'after meeting', 'after task X'
 * @returns {Date}
 */
export function calculateDueDate(taskTemplate, referenceDate = new Date(), relation = 'creation') {
  // Convert reference date to EST/EDT if it's current time (new Date())
  // This ensures calculations use Florida local time, not server UTC
  let dueDate;
  const now = new Date();
  const timeDiff = Math.abs(now - referenceDate);

  // If referenceDate is "now" (within 1 second), use EST time
  if (timeDiff < 1000) {
    dueDate = getNowInEST();
  } else {
    dueDate = new Date(referenceDate);
  }

  const value = parseInt(taskTemplate.due_date_value || taskTemplate['due_date-value-only'] || taskTemplate['due_date-value'] || 0);
  const timeRelation = taskTemplate.due_date_time_relation || taskTemplate['due_date-time-relation'] || 'days';
  const relationType = taskTemplate.due_date_relation || taskTemplate['due_date-relational'] || 'after creation';

  // Handle different time units
  if (timeRelation.includes('hour')) {
    if (relationType.includes('before')) {
      dueDate = addHours(dueDate, -value);
    } else {
      dueDate = addHours(dueDate, value);
    }
  } else if (timeRelation.includes('day')) {
    if (relationType.includes('before')) {
      dueDate = addDays(dueDate, -value);
    } else {
      dueDate = addDays(dueDate, value);
    }
  } else if (timeRelation.includes('minute')) {
    if (relationType.includes('before')) {
      dueDate = addMinutes(dueDate, -value);
    } else {
      dueDate = addMinutes(dueDate, value);
    }
  }

  // Special case: "now" or 0 days
  if (value === 0 || relationType.includes('now')) {
    return dueDate;
  }

  // Shift weekends to Monday
  return shiftWeekendToMonday(dueDate);
}

/**
 * Format date for Clio API
 * @param {Date} date
 * @returns {string}
 */
export function formatForClio(date) {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Format datetime for Clio API with time
 * @param {Date} date
 * @returns {string}
 */
export function formatDateTimeForClio(date) {
  return format(date, "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

/**
 * Check if current time is within X minutes of reference time
 * @param {Date|string} referenceTime
 * @param {number} minutes
 * @returns {boolean}
 */
export function isWithinMinutes(referenceTime, minutes) {
  const ref = typeof referenceTime === 'string' ? parseISO(referenceTime) : referenceTime;
  const now = new Date();
  const diffMs = now - ref;
  const diffMinutes = diffMs / (1000 * 60);
  return diffMinutes <= minutes;
}

/**
 * Get day name from date
 * @param {Date} date
 * @returns {string}
 */
export function getDayName(date) {
  return format(date, 'EEEE');
}

/**
 * Add business days (skipping weekends)
 * @param {Date} startDate
 * @param {number} days - Number of business days to add
 * @returns {Date}
 */
export function addBusinessDays(startDate, days) {
  let currentDate = new Date(startDate);
  let daysAdded = 0;

  while (daysAdded < days) {
    currentDate = addDays(currentDate, 1);

    // Skip weekends
    if (!isWeekend(currentDate)) {
      daysAdded++;
    }
  }

  return currentDate;
}
