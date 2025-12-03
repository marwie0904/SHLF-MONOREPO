const axios = require('axios');
require('dotenv').config();

/**
 * Test: Create tasks for custom object records using the same pattern as opportunities
 * Opportunity pattern: POST /opportunities/tasks with { contactId, opportunityId, title, ... }
 * Custom object pattern: POST /objects/{schemaKey}/tasks with { recordId, title, ... } ?
 */
async function testCustomObjectTask() {
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    const recordId = process.argv[2] || '692ab85b947d9cc7a17e5e89';
    const objectKey = 'custom_objects.invoices';

    console.log('=== Testing Custom Object Task Creation ===\n');
    console.log('Record ID:', recordId);
    console.log('Object Key:', objectKey);
    console.log('');

    const headers = {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
    };

    // First, get the record to see its structure (including any linked contact)
    console.log('--- Step 1: Fetch the record ---');
    let record;
    try {
        const response = await axios.get(
            'https://services.leadconnectorhq.com/objects/' + objectKey + '/records/' + recordId,
            { headers }
        );
        record = response.data.record;
        console.log('Record found!');
        console.log('Object ID:', record.objectId);
        console.log('Properties:', JSON.stringify(record.properties, null, 2).substring(0, 300));
    } catch (error) {
        console.log('Error fetching record:', error.response?.status, error.response?.data);
        return;
    }

    // Test different endpoint patterns (following opportunity pattern)
    const tests = [
        // Pattern 1: Like /opportunities/tasks but for objects
        {
            name: 'POST /objects/{objectKey}/tasks (like /opportunities/tasks)',
            endpoint: 'https://services.leadconnectorhq.com/objects/' + objectKey + '/tasks',
            payload: {
                title: 'Test Task for Invoice',
                body: 'Testing task creation for custom object',
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                completed: false,
                recordId: recordId
            }
        },
        // Pattern 2: Using objectId instead of objectKey
        {
            name: 'POST /objects/{objectId}/tasks',
            endpoint: 'https://services.leadconnectorhq.com/objects/' + record.objectId + '/tasks',
            payload: {
                title: 'Test Task for Invoice',
                body: 'Testing task creation for custom object',
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                completed: false,
                recordId: recordId
            }
        },
        // Pattern 3: Using /custom-objects/{objectKey}/tasks
        {
            name: 'POST /custom-objects/{objectKey}/tasks',
            endpoint: 'https://services.leadconnectorhq.com/custom-objects/' + objectKey + '/tasks',
            payload: {
                title: 'Test Task for Invoice',
                body: 'Testing task creation for custom object',
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                completed: false,
                recordId: recordId
            }
        },
        // Pattern 4: /objects/records/tasks (like the base pattern)
        {
            name: 'POST /objects/records/tasks with objectKey in body',
            endpoint: 'https://services.leadconnectorhq.com/objects/records/tasks',
            payload: {
                title: 'Test Task for Invoice',
                body: 'Testing task creation for custom object',
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                completed: false,
                recordId: recordId,
                objectKey: objectKey
            }
        },
        // Pattern 5: With locationId
        {
            name: 'POST /objects/{objectKey}/tasks with locationId',
            endpoint: 'https://services.leadconnectorhq.com/objects/' + objectKey + '/tasks',
            payload: {
                title: 'Test Task for Invoice',
                body: 'Testing task creation for custom object',
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                completed: false,
                recordId: recordId,
                locationId: locationId
            }
        }
    ];

    console.log('\n--- Step 2: Test Task Endpoints ---');

    for (const test of tests) {
        console.log('\n' + test.name);
        console.log('POST', test.endpoint);
        console.log('Payload:', JSON.stringify(test.payload, null, 2));

        try {
            const response = await axios.post(test.endpoint, test.payload, { headers });
            console.log('SUCCESS!');
            console.log('Response:', JSON.stringify(response.data, null, 2));
            return;
        } catch (error) {
            const status = error.response?.status;
            const msg = error.response?.data?.message || error.response?.data?.error || JSON.stringify(error.response?.data);
            if (status === 404) {
                console.log('FAILED - 404 (endpoint does not exist)');
            } else if (status === 400) {
                console.log('FAILED - 400 (endpoint exists but bad request):', msg);
            } else if (status === 401) {
                console.log('FAILED - 401 (endpoint exists but unauthorized):', msg);
            } else {
                console.log('FAILED -', status, msg);
            }
        }
    }

    console.log('\n=== All tests failed ===');
}

testCustomObjectTask();
