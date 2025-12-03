const axios = require('axios');
require('dotenv').config();

async function testRecordTaskPatterns() {
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    const recordId = '692ab85b947d9cc7a17e5e89';
    const objectKey = 'custom_objects.invoices';
    const objectId = '69271389bba9ed931f66a545';

    const headers = {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
    };

    const basePayload = {
        title: 'Test Task',
        body: 'Testing',
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        completed: false
    };

    // Try all possible patterns following the objects/{key}/records/{id} structure
    const tests = [
        // Pattern matching: GET /objects/{key}/records/{id} -> POST /objects/{key}/records/{id}/tasks
        'https://services.leadconnectorhq.com/objects/' + objectKey + '/records/' + recordId + '/tasks',
        // Using objectId instead of objectKey
        'https://services.leadconnectorhq.com/objects/' + objectId + '/records/' + recordId + '/tasks',
        // Just recordId
        'https://services.leadconnectorhq.com/records/' + recordId + '/tasks',
        // With custom-objects prefix
        'https://services.leadconnectorhq.com/custom-objects/records/' + recordId + '/tasks',
    ];

    console.log('Testing task endpoints for record:', recordId);
    console.log('');

    for (const endpoint of tests) {
        console.log('POST', endpoint);
        try {
            const response = await axios.post(endpoint, basePayload, { headers });
            console.log('SUCCESS:', JSON.stringify(response.data, null, 2));
            return;
        } catch (error) {
            console.log('FAILED:', error.response?.status, '-', error.response?.data?.message || '');
        }
    }
}

testRecordTaskPatterns();
