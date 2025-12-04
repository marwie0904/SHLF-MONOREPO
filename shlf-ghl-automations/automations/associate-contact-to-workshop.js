const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const traceContext = require('../utils/traceContext');

/**
 * Finds workshop ID from Supabase by matching event details
 * @param {Object} eventDetails - Event details from form submission
 * @param {string} eventDetails.title - Event title
 * @param {string} eventDetails.date - Event date (format: MM/DD/YYYY)
 * @param {string} eventDetails.time - Event time
 * @param {string} eventDetails.type - Workshop type (Seminar/Webinar/Office)
 * @returns {Promise<string|null>} GHL workshop record ID or null if not found
 */
async function findWorkshopId(eventDetails) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('SUPABASE_URL or SUPABASE_KEY not configured in environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        console.log('Searching for workshop in Supabase...');
        console.log('Search criteria:', eventDetails);

        // Use case-insensitive matching with ilike for more robust searching
        const { data, error } = await supabase
            .from('workshops')
            .select('ghl_workshop_id')
            .ilike('title', eventDetails.title)
            .eq('event_date', eventDetails.date)
            .ilike('event_time', eventDetails.time)
            .ilike('workshop_type', eventDetails.type)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                // No rows found
                console.log('No matching workshop found');
                return null;
            }
            throw error;
        }

        console.log('Found workshop:', data.ghl_workshop_id);
        return data.ghl_workshop_id;
    } catch (error) {
        console.error('Error finding workshop in Supabase:', error.message);
        throw error;
    }
}

/**
 * Creates a relation between contact and workshop in GHL
 * @param {string} contactId - GHL contact ID
 * @param {string} workshopRecordId - GHL workshop record ID
 * @param {string} associationId - GHL association ID for contact-workshop relationship
 * @returns {Promise<Object>} GHL API response
 */
async function createContactWorkshopRelation(contactId, workshopRecordId, associationId) {
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;

    if (!apiKey) {
        throw new Error('GHL_API_KEY not configured in environment variables');
    }

    if (!locationId) {
        throw new Error('GHL_LOCATION_ID not configured in environment variables');
    }

    if (!associationId) {
        throw new Error('GHL_ASSOCIATION_ID not configured in environment variables');
    }

    try {
        console.log('Creating contact-workshop relation in GHL...');
        console.log('Contact ID:', contactId);
        console.log('Workshop Record ID:', workshopRecordId);
        console.log('Association ID:', associationId);

        const response = await axios.post(
            'https://services.leadconnectorhq.com/associations/relations',
            {
                locationId: locationId,
                associationId: associationId,
                firstRecordId: contactId,
                secondRecordId: workshopRecordId
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            }
        );

        console.log('Contact-workshop relation created successfully:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error creating contact-workshop relation:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Main function to associate contact to workshop
 * @param {Object} params - Function parameters
 * @param {string} params.contactId - GHL contact ID
 * @param {string} params.eventTitle - Workshop title
 * @param {string} params.eventDate - Event date (format: MM/DD/YYYY)
 * @param {string} params.eventTime - Event time
 * @param {string} params.eventType - Workshop type (Seminar/Webinar/Office)
 * @param {Object} reqContext - Request context for tracing (optional)
 * @returns {Promise<Object>} Result object
 */
async function main({ contactId, eventTitle, eventDate, eventTime, eventType }, reqContext = {}) {
    // Start trace
    const { traceId, context } = await traceContext.startTrace({
        endpoint: '/associate-contact-to-workshop',
        httpMethod: 'POST',
        headers: reqContext.headers || {},
        body: { contactId, eventTitle, eventDate, eventTime, eventType },
        triggerType: 'webhook'
    });

    // Update trace with contact ID context
    await traceContext.updateTraceContextIds(traceId, { contactId });

    let workshopRecordId = null;
    let relationResponse = null;

    try {
        console.log('Starting contact-workshop association process...');

        // Step 1: Validate inputs
        const { stepId: validationStepId } = await traceContext.startStep(
            traceId,
            'associate-contact-to-workshop',
            'validateInputs',
            { contactId, eventTitle, eventDate, eventTime, eventType }
        );

        try {
            // Validate required parameters
            if (!contactId) {
                throw new Error('contactId is required');
            }
            if (!eventTitle) {
                throw new Error('eventTitle is required');
            }
            if (!eventDate) {
                throw new Error('eventDate is required');
            }
            if (!eventTime) {
                throw new Error('eventTime is required');
            }
            if (!eventType) {
                throw new Error('eventType is required');
            }

            // Validate eventType
            const validTypes = ['Seminar', 'Webinar', 'Office'];
            if (!validTypes.includes(eventType)) {
                throw new Error(`eventType must be one of: ${validTypes.join(', ')}`);
            }

            await traceContext.completeStep(validationStepId, {
                valid: true,
                contactId,
                eventTitle,
                eventType
            });
        } catch (error) {
            await traceContext.failStep(validationStepId, error, traceId);
            throw error;
        }

        // Step 2: Find workshop ID from Supabase
        const { stepId: findWorkshopStepId } = await traceContext.startStep(
            traceId,
            'associate-contact-to-workshop',
            'findWorkshopId',
            { title: eventTitle, date: eventDate, time: eventTime, type: eventType }
        );

        try {
            workshopRecordId = await findWorkshopId({
                title: eventTitle,
                date: eventDate,
                time: eventTime,
                type: eventType
            });

            if (!workshopRecordId) {
                throw new Error('Workshop not found. Please ensure the workshop exists in the system.');
            }

            await traceContext.completeStep(findWorkshopStepId, {
                found: true,
                workshopRecordId
            });
        } catch (error) {
            await traceContext.failStep(findWorkshopStepId, error, traceId);
            throw error;
        }

        // Step 3: Create relation in GHL
        const associationId = process.env.GHL_ASSOCIATION_ID;
        const { stepId: createRelationStepId } = await traceContext.startStep(
            traceId,
            'associate-contact-to-workshop',
            'createContactWorkshopRelation',
            { contactId, workshopRecordId, associationId }
        );

        try {
            relationResponse = await createContactWorkshopRelation(
                contactId,
                workshopRecordId,
                associationId
            );

            await traceContext.completeStep(createRelationStepId, {
                success: true,
                relationId: relationResponse?.id || relationResponse?.relationId
            });
        } catch (error) {
            await traceContext.failStep(createRelationStepId, error, traceId);
            throw error;
        }

        const result = {
            success: true,
            traceId: traceId,
            contactId: contactId,
            workshopRecordId: workshopRecordId,
            relationResponse: relationResponse
        };

        // Complete trace
        await traceContext.completeTrace(traceId, 200, result);

        console.log('Contact-workshop association completed successfully');
        return result;
    } catch (error) {
        console.error('Error in contact-workshop association:', error.message);

        // Fail trace
        await traceContext.failTrace(traceId, error, 500, {
            success: false,
            error: error.message,
            contactId,
            workshopRecordId
        });

        throw error;
    }
}

module.exports = {
    main,
    findWorkshopId,
    createContactWorkshopRelation
};
