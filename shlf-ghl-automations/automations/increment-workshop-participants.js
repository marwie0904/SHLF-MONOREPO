const axios = require('axios');
const traceContext = require('../utils/traceContext');

/**
 * Gets workshop data from GHL custom object
 * @param {string} workshopRecordId - The workshop record ID in GHL
 * @returns {Promise<Object>} Workshop data including current participants and max capacity
 */
async function getWorkshopData(workshopRecordId) {
    const apiKey = process.env.GHL_API_KEY;

    if (!apiKey) {
        throw new Error('GHL_API_KEY not configured in environment variables');
    }

    try {
        console.log(`Fetching workshop data for record ID: ${workshopRecordId}`);

        const response = await axios.get(
            `https://services.leadconnectorhq.com/objects/records/${workshopRecordId}`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            }
        );

        console.log('Workshop data retrieved:', response.data);

        // Extract properties from the record
        const properties = response.data.record?.properties || response.data.properties || {};

        return {
            recordId: workshopRecordId,
            currentParticipants: parseInt(properties.number_of_participants) || 0,
            maxCapacity: parseInt(properties.max_capacity) || 0,
            workshopName: properties.workshops || '',
            properties: properties
        };
    } catch (error) {
        console.error('Error fetching workshop data:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Updates the number of participants for a workshop
 * @param {string} workshopRecordId - The workshop record ID in GHL
 * @param {number} newParticipantCount - The new participant count
 * @returns {Promise<Object>} GHL API response
 */
async function updateParticipantCount(workshopRecordId, newParticipantCount) {
    const apiKey = process.env.GHL_API_KEY;

    if (!apiKey) {
        throw new Error('GHL_API_KEY not configured in environment variables');
    }

    try {
        console.log(`Updating workshop ${workshopRecordId} participants to: ${newParticipantCount}`);

        const response = await axios.patch(
            `https://services.leadconnectorhq.com/objects/records/${workshopRecordId}`,
            {
                properties: {
                    number_of_participants: newParticipantCount.toString()
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            }
        );

        console.log('Participant count updated successfully:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error updating participant count:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Increments the participant count for a workshop (with capacity check)
 * @param {string} workshopRecordId - The workshop record ID in GHL
 * @returns {Promise<Object>} Result object with status and details
 */
async function incrementParticipants(workshopRecordId) {
    try {
        console.log('Starting participant increment process...');

        // Get current workshop data
        const workshopData = await getWorkshopData(workshopRecordId);

        console.log(`Current participants: ${workshopData.currentParticipants}`);
        console.log(`Max capacity: ${workshopData.maxCapacity}`);

        // Check if workshop is at capacity
        if (workshopData.currentParticipants >= workshopData.maxCapacity) {
            console.log('Workshop is at max capacity. Not incrementing participants.');
            return {
                success: false,
                atCapacity: true,
                currentParticipants: workshopData.currentParticipants,
                maxCapacity: workshopData.maxCapacity,
                message: 'Workshop is at maximum capacity'
            };
        }

        // Increment participant count
        const newCount = workshopData.currentParticipants + 1;
        const updateResponse = await updateParticipantCount(workshopRecordId, newCount);

        console.log('Participant increment completed successfully');
        return {
            success: true,
            atCapacity: false,
            previousCount: workshopData.currentParticipants,
            newCount: newCount,
            maxCapacity: workshopData.maxCapacity,
            updateResponse: updateResponse
        };
    } catch (error) {
        console.error('Error in incrementParticipants:', error.message);
        throw error;
    }
}

/**
 * Main function to handle workshop participant increment from webhook
 * @param {Object} webhookData - Webhook data from GHL
 * @param {Object} reqContext - Request context for tracing (optional)
 * @returns {Promise<Object>} Result object
 */
async function main(webhookData, reqContext = {}) {
    // Start trace
    const { traceId, context } = await traceContext.startTrace({
        endpoint: '/increment-workshop-participants',
        httpMethod: 'POST',
        headers: reqContext.headers || {},
        body: webhookData,
        triggerType: 'webhook'
    });

    let workshopRecordId = null;
    let workshopData = null;

    try {
        console.log('Processing workshop participant increment webhook...');
        console.log('Webhook data:', JSON.stringify(webhookData, null, 2));

        // Step 1: Extract workshop record ID
        const { stepId: extractStepId } = await traceContext.startStep(
            traceId,
            'increment-workshop-participants',
            'extractWorkshopRecordId',
            { webhookData }
        );

        try {
            // Extract workshop record ID from webhook data
            workshopRecordId = webhookData.workshopRecordId
                || webhookData.recordId
                || webhookData.workshop_id
                || webhookData.workshopId;

            if (!workshopRecordId) {
                throw new Error('Workshop record ID not found in webhook data');
            }

            await traceContext.completeStep(extractStepId, {
                workshopRecordId,
                sourceField: webhookData.workshopRecordId ? 'workshopRecordId' :
                             webhookData.recordId ? 'recordId' :
                             webhookData.workshop_id ? 'workshop_id' : 'workshopId'
            });
        } catch (error) {
            await traceContext.failStep(extractStepId, error, traceId);
            throw error;
        }

        // Step 2: Get current workshop data
        const { stepId: getDataStepId } = await traceContext.startStep(
            traceId,
            'increment-workshop-participants',
            'getWorkshopData',
            { workshopRecordId }
        );

        try {
            workshopData = await getWorkshopData(workshopRecordId);
            await traceContext.completeStep(getDataStepId, {
                currentParticipants: workshopData.currentParticipants,
                maxCapacity: workshopData.maxCapacity,
                workshopName: workshopData.workshopName
            });
        } catch (error) {
            await traceContext.failStep(getDataStepId, error, traceId);
            throw error;
        }

        // Step 3: Check capacity and increment
        const { stepId: incrementStepId } = await traceContext.startStep(
            traceId,
            'increment-workshop-participants',
            'incrementParticipants',
            {
                workshopRecordId,
                currentParticipants: workshopData.currentParticipants,
                maxCapacity: workshopData.maxCapacity
            }
        );

        try {
            // Check if workshop is at capacity
            if (workshopData.currentParticipants >= workshopData.maxCapacity) {
                const capacityResult = {
                    success: false,
                    atCapacity: true,
                    currentParticipants: workshopData.currentParticipants,
                    maxCapacity: workshopData.maxCapacity,
                    message: 'Workshop is at maximum capacity'
                };

                await traceContext.completeStep(incrementStepId, {
                    skipped: true,
                    reason: 'at_capacity',
                    ...capacityResult
                });

                // Complete trace with capacity result
                await traceContext.completeTrace(traceId, 200, {
                    ...capacityResult,
                    traceId
                });

                console.log('Workshop is at max capacity. Not incrementing participants.');
                return { ...capacityResult, traceId };
            }

            // Increment participant count
            const newCount = workshopData.currentParticipants + 1;
            const updateResponse = await updateParticipantCount(workshopRecordId, newCount);

            await traceContext.completeStep(incrementStepId, {
                success: true,
                previousCount: workshopData.currentParticipants,
                newCount: newCount,
                maxCapacity: workshopData.maxCapacity
            });

            const result = {
                success: true,
                traceId: traceId,
                atCapacity: false,
                previousCount: workshopData.currentParticipants,
                newCount: newCount,
                maxCapacity: workshopData.maxCapacity,
                updateResponse: updateResponse
            };

            // Complete trace
            await traceContext.completeTrace(traceId, 200, result);

            console.log('Participant increment completed successfully');
            return result;
        } catch (error) {
            await traceContext.failStep(incrementStepId, error, traceId);
            throw error;
        }
    } catch (error) {
        console.error('Error in main:', error.message);

        // Fail trace
        await traceContext.failTrace(traceId, error, 500, {
            success: false,
            error: error.message,
            workshopRecordId,
            workshopData
        });

        throw error;
    }
}

module.exports = {
    main,
    incrementParticipants,
    getWorkshopData,
    updateParticipantCount
};
