const axios = require('axios');
require('dotenv').config();

/**
 * Test: Create tasks for custom object records using schemaKey pattern
 */
async function testRecordTasks() {
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    const recordId = process.argv[2] || '692ab85b947d9cc7a17e5e89';
    const schemaKey = process.argv[3] || 'custom_objects.workshops';

    console.log('=== Testing Custom Object Record Tasks ===\n');
    console.log('Record ID:', recordId);
    console.log('Schema Key:', schemaKey);
    console.log('Location ID:', locationId);
    console.log('');

    const headers = {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
    };

    const taskPayload = {
        title: 'Test Task for Custom Object',
        body: 'Testing task creation for custom object record',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        completed: false
    };

    // Step 1: Verify the record exists
    console.log('--- Step 1: Get Record ---');
    try {
        const endpoint = 'https://services.leadconnectorhq.com/objects/' + schemaKey + '/records/' + recordId;
        console.log('GET', endpoint);

        const response = await axios.get(endpoint, { headers });
        console.log('Record found!');
        console.log('Record:', JSON.stringify(response.data, null, 2).substring(0, 500) + '...');
    } catch (error) {
        console.log('Error:', error.response?.status, error.response?.data?.message || error.response?.data);
    }

    // Test different task endpoint patterns
    const tests = [
        {
            name: '/objects/{schemaKey}/records/{recordId}/tasks',
            endpoint: 'https://services.leadconnectorhq.com/objects/' + schemaKey + '/records/' + recordId + '/tasks',
            payload: taskPayload
        },
        {
            name: '/objects/{schemaKey}/tasks with recordId in body',
            endpoint: 'https://services.leadconnectorhq.com/objects/' + schemaKey + '/tasks',
            payload: { ...taskPayload, recordId: recordId }
        },
        {
            name: '/objects/tasks with schemaKey and recordId in body',
            endpoint: 'https://services.leadconnectorhq.com/objects/tasks',
            payload: { ...taskPayload, schemaKey: schemaKey, recordId: recordId }
        },
        {
            name: '/objects/records/{recordId}/tasks with schemaKey in body',
            endpoint: 'https://services.leadconnectorhq.com/objects/records/' + recordId + '/tasks',
            payload: { ...taskPayload, schemaKey: schemaKey }
        }
    ];

    console.log('\n--- Step 2: Test Task Endpoints ---');

    for (const test of tests) {
        console.log('\n' + test.name);
        console.log('POST', test.endpoint);

        try {
            const response = await axios.post(test.endpoint, test.payload, { headers });
            console.log('SUCCESS!');
            console.log('Response:', JSON.stringify(response.data, null, 2));
            return; // Stop on first success
        } catch (error) {
            const status = error.response?.status;
            const msg = error.response?.data?.message || error.response?.data?.error || JSON.stringify(error.response?.data);
            console.log('FAILED -', status, msg);
        }
    }

    console.log('\n=== All task endpoints failed ===');
}

testRecordTasks();
