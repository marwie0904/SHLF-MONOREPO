import { SupabaseService } from '../services/supabase.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { AssigneeError } from './assignee-error.js';

/**
 * Assignee Resolution Utilities
 */

/**
 * Extract location keyword from meeting location string
 * Uses dynamic keywords from database
 * @param {string} locationString - Meeting location (e.g., "123 Main St, Fort Myers, FL")
 * @returns {Promise<string|null>} - Extracted keyword or null
 */
async function extractLocationKeyword(locationString) {
  if (!locationString) return null;

  // Get valid keywords from database
  const keywords = await SupabaseService.getLocationKeywords();

  if (!keywords || keywords.length === 0) return null;

  // Build dynamic regex pattern from keywords
  const pattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'i');
  const match = locationString.match(pattern);

  return match ? match[1].toLowerCase() : null;
}

/**
 * Resolve dynamic assignee based on type
 * @param {string} assigneeType - CSC, PARALEGAL, ATTORNEY, FUND TABLE, or specific user
 * @param {Object} matterData - Matter information
 * @param {string} meetingLocation - Optional meeting location (for signing meetings)
 * @param {string} lookupReference - Optional reference for lookup (e.g., "location", "attorney")
 * @param {boolean} requireMeetingLocation - If true, meeting location is required (no fallback to matter location)
 * @returns {Promise<Object>} - {id: userId, name: userName}
 */
export async function resolveAssignee(assigneeType, matterData, meetingLocation = null, lookupReference = null, requireMeetingLocation = false) {
  const type = assigneeType?.toString().toUpperCase().trim();

  try {
    // If lookupReference is "location", resolve by location regardless of assignee type
    if (lookupReference?.toLowerCase() === 'location') {
      // If meeting location is required, don't fall back to matter location
      let location;
      if (requireMeetingLocation) {
        if (!meetingLocation) {
          throw new AssigneeError(
            ERROR_CODES.MEETING_NO_LOCATION,
            `Meeting location is required but was not provided. Matter: ${matterData.id}`,
            { matter_id: matterData.id, require_meeting_location: true }
          );
        }
        location = meetingLocation;
      } else {
        location = meetingLocation || matterData.location;
        if (!location) {
          throw new AssigneeError(
            ERROR_CODES.MEETING_NO_LOCATION,
            `No location found for assignee lookup. Matter: ${matterData.id}`,
            { matter_id: matterData.id }
          );
        }
      }

      // If using meeting location, extract keyword
      if (meetingLocation) {
        const keyword = await extractLocationKeyword(meetingLocation);
        if (!keyword) {
          throw new AssigneeError(
            ERROR_CODES.MEETING_INVALID_LOCATION,
            `Could not extract location keyword from meeting location: ${meetingLocation}`,
            { matter_id: matterData.id, meeting_location: meetingLocation }
          );
        }
        location = keyword;
      }

      const assignee = await SupabaseService.getAssigneeByLocation(location);
      if (!assignee) {
        throw new AssigneeError(
          ERROR_CODES.ASSIGNEE_NO_CSC,
          `No CSC found for location: ${location}`,
          { matter_id: matterData.id, location }
        );
      }

      return {
        id: assignee.id,
        name: assignee.name,
        type: 'User',
      };
    }

    // If lookupReference is "attorney", resolve by attorney
    if (lookupReference?.toLowerCase() === 'attorney' || lookupReference?.toLowerCase() === 'attorney_id') {
      const attorney = matterData.responsible_attorney || matterData.originating_attorney;
      if (!attorney) {
        throw new AssigneeError(
          ERROR_CODES.ASSIGNEE_NO_ATTORNEY,
          `No attorney assigned to matter: ${matterData.id}`,
          { matter_id: matterData.id }
        );
      }

      return {
        id: attorney.id,
        name: attorney.name,
        type: 'User',
      };
    }

    // ATTORNEY - use matter's responsible attorney (fallback to originating attorney)
    if (type === 'ATTORNEY') {
      const attorney = matterData.responsible_attorney || matterData.originating_attorney;
      if (!attorney) {
        throw new AssigneeError(
          ERROR_CODES.ASSIGNEE_NO_ATTORNEY,
          `No attorney assigned to matter: ${matterData.id}`,
          { matter_id: matterData.id }
        );
      }

      return {
        id: attorney.id,
        name: attorney.name,
        type: 'User',
      };
    }

    // CSC - resolve by location
    if (type === 'CSC') {
      // If meeting location is required, don't fall back to matter location
      let location;
      if (requireMeetingLocation) {
        if (!meetingLocation) {
          throw new AssigneeError(
            ERROR_CODES.MEETING_NO_LOCATION,
            `Meeting location is required but was not provided. Matter: ${matterData.id}`,
            { matter_id: matterData.id, require_meeting_location: true }
          );
        }
        location = meetingLocation;
      } else {
        location = meetingLocation || matterData.location;
        if (!location) {
          throw new AssigneeError(
            ERROR_CODES.MEETING_NO_LOCATION,
            `No location found for CSC assignment. Matter: ${matterData.id}`,
            { matter_id: matterData.id }
          );
        }
      }

      // If using meeting location, extract keyword
      if (meetingLocation) {
        const keyword = await extractLocationKeyword(meetingLocation);
        if (!keyword) {
          throw new AssigneeError(
            ERROR_CODES.MEETING_INVALID_LOCATION,
            `Could not extract location keyword from meeting location: ${meetingLocation}`,
            { matter_id: matterData.id, meeting_location: meetingLocation }
          );
        }
        location = keyword;
      }

      const assignee = await SupabaseService.getAssigneeByLocation(location);
      if (!assignee) {
        throw new AssigneeError(
          ERROR_CODES.ASSIGNEE_NO_CSC,
          `No CSC found for location: ${location}`,
          { matter_id: matterData.id, location }
        );
      }

      return {
        id: assignee.id,
        name: assignee.name,
        type: 'User',
      };
    }

    // PARALEGAL - resolve by attorney_id
    if (type === 'PARALEGAL') {
      const attorney = matterData.responsible_attorney || matterData.originating_attorney;
      const attorneyId = attorney?.id || matterData.attorney_id;
      if (!attorneyId) {
        throw new AssigneeError(
          ERROR_CODES.ASSIGNEE_NO_ATTORNEY,
          `No attorney found for PARALEGAL assignment. Matter: ${matterData.id}`,
          { matter_id: matterData.id }
        );
      }

      const assignee = await SupabaseService.getAssigneeByAttorneyId(attorneyId);
      if (!assignee) {
        throw new AssigneeError(
          ERROR_CODES.ASSIGNEE_NO_PARALEGAL,
          `No PARALEGAL found for attorney ID: ${attorneyId}`,
          { matter_id: matterData.id, attorney_id: attorneyId }
        );
      }

      return {
        id: assignee.id,
        name: assignee.name,
        type: 'User',
      };
    }

    // FUNDING_COOR - use direct assignee_id from task template
    if (type === 'FUNDING_COOR') {
      // lookupReference contains the assignee_id from the task template
      const assigneeId = lookupReference;

      if (!assigneeId) {
        throw new AssigneeError(
          ERROR_CODES.ASSIGNEE_INVALID_TYPE,
          `No assignee_id provided for FUNDING_COOR assignment. Matter: ${matterData.id}`,
          { matter_id: matterData.id }
        );
      }

      // Validate that assignee_id is numeric
      const numericId = parseInt(assigneeId);
      if (isNaN(numericId)) {
        throw new AssigneeError(
          ERROR_CODES.ASSIGNEE_INVALID_TYPE,
          `Invalid assignee_id for FUNDING_COOR: "${assigneeId}". Must be numeric Clio user ID.`,
          { matter_id: matterData.id, assignee_id: assigneeId }
        );
      }

      return {
        id: numericId,
        name: 'Funding Coordinator',
        type: 'User',
      };
    }

    // FUND TABLE - resolve by responsible attorney's ID
    if (type === 'FUND TABLE' || type === 'FUND_TABLE') {
      const attorney = matterData.responsible_attorney || matterData.originating_attorney;
      if (!attorney) {
        throw new AssigneeError(
          ERROR_CODES.ASSIGNEE_NO_ATTORNEY,
          `No attorney found for FUND TABLE assignment. Matter: ${matterData.id}`,
          { matter_id: matterData.id }
        );
      }

      const attorneyId = attorney.id;
      const assignee = await SupabaseService.getAssigneeByAttorneyFundTable(attorneyId);
      if (!assignee) {
        throw new AssigneeError(
          ERROR_CODES.ASSIGNEE_NO_FUND_TABLE,
          `No assignee found in fund_table for attorney ID: ${attorneyId}`,
          { matter_id: matterData.id, attorney_id: attorneyId }
        );
      }

      return {
        id: assignee.id,
        name: assignee.name,
        type: 'User',
      };
    }

    // VA - hardcoded to Jacqui (357379471)
    if (type === 'VA') {
      return {
        id: 357379471,
        name: 'Jacqui',
        type: 'User',
      };
    }

    // Direct numeric ID - return as-is
    if (!isNaN(assigneeType)) {
      return {
        id: parseInt(assigneeType),
        name: 'Direct Assignment',
        type: 'User',
      };
    }

    // Invalid assignee type
    throw new AssigneeError(
      ERROR_CODES.ASSIGNEE_INVALID_TYPE,
      `Invalid assignee type: "${assigneeType}". Must be ATTORNEY, CSC, PARALEGAL, FUND_TABLE (or FUND TABLE), FUNDING_COOR, VA, or numeric ID.`,
      { matter_id: matterData.id, assignee_type: assigneeType }
    );

  } catch (error) {
    // Re-throw AssigneeError as-is
    if (error instanceof AssigneeError) {
      throw error;
    }

    // Wrap other errors
    console.error('Error resolving assignee:', error.message);
    throw error;
  }
}

/**
 * Create error task when assignee resolution fails
 * @param {Object} matterData
 * @param {string} stageId
 * @param {string} errorMessage
 * @returns {Object} - Error task data
 */
export function createAssigneeErrorTask(matterData, stageId, errorMessage) {
  // Assign error task to the matter's responsible attorney (fallback to originating attorney)
  const attorney = matterData.responsible_attorney || matterData.originating_attorney;

  return {
    name: `⚠️ Assignment Error - ${matterData.display_number}`,
    description: `Unable to generate tasks for stage. ${errorMessage}`,
    matter: { id: matterData.id },
    assignee: attorney ? { id: attorney.id, type: 'User' } : undefined,
    due_at: new Date().toISOString(),
    priority: 'high',
  };
}
