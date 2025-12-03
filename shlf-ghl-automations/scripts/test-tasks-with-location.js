const axios = require('axios');
require('dotenv').config();

async function testTasksEndpoints() {
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    const recordId = '692ab85b947d9cc7a17e5e89';

    console.log('Location ID:', locationId);
    console.log('Record ID:', recordId);
    console.log('\n');

    const basePayload = {
        title: 'Test Task',
        body: 'Testing task creation',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        completed: false
    };

    // Test different endpoint patterns
    const tests = [
        {
            name: 'POST /locations/{locationId}/tasks with recordId',
            endpoint: `https://services.leadconnectorhq.com/locations/${locationId}/tasks`,
            payload: { ...basePayload, recordId }
        },
        {
            name: 'POST /locations/{locationId}/objects/records/{recordId}/tasks',
            endpoint: `https://services.leadconnectorhq.com/locations/${locationId}/objects/records/${recordId}/tasks`,
            payload: basePayload
        },
        {
            name: 'POST /objects/records/{recordId}/tasks with locationId header',
            endpoint: `https://services.leadconnectorhq.com/objects/records/${recordId}/tasks`,
            payload: basePayload,
            extraHeaders: { 'Location': locationId }
        }
    ];

    for (const test of tests) {
        console.log(`\n--- ${test.name} ---`);
        console.log('Endpoint:', test.endpoint);
        console.log('Payload:', JSON.stringify(test.payload, null, 2));

        try {
            const headers = {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Version': '2021-07-28',
                ...(test.extraHeaders || {})
            };

            const response = await axios.post(test.endpoint, test.payload, { headers });
            console.log('✅ SUCCESS!');
            console.log('Response:', JSON.stringify(response.data, null, 2));
            return; // Stop on first success
        } catch (error) {
            console.log('❌ FAILED');
            if (error.response) {
                console.log('Status:', error.response.status);
                console.log('Response:', JSON.stringify(error.response.data, null, 2));
            }
        }
    }
}

testTasksEndpoints();
