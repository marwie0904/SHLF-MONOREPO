const axios = require('axios');
require('dotenv').config();

async function testCustomObjectTasks() {
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    const recordId = '692ab85b947d9cc7a17e5e89';

    const basePayload = {
        title: 'Test Task for Custom Object',
        body: 'Testing various endpoint patterns',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        completed: false
    };

    // Based on how opportunities/tasks works, try similar patterns for custom objects
    const tests = [
        // Pattern 1: /custom-objects/tasks (like /opportunities/tasks)
        {
            name: 'POST /custom-objects/tasks with recordId in body',
            endpoint: 'https://services.leadconnectorhq.com/custom-objects/tasks',
            payload: { ...basePayload, recordId }
        },
        // Pattern 2: /records/tasks
        {
            name: 'POST /records/tasks with recordId in body',
            endpoint: 'https://services.leadconnectorhq.com/records/tasks',
            payload: { ...basePayload, recordId }
        },
        // Pattern 3: Just /tasks with recordId
        {
            name: 'POST /tasks with recordId in body',
            endpoint: 'https://services.leadconnectorhq.com/tasks',
            payload: { ...basePayload, recordId }
        },
        // Pattern 4: /custom-objects/records/tasks
        {
            name: 'POST /custom-objects/records/tasks',
            endpoint: 'https://services.leadconnectorhq.com/custom-objects/records/tasks',
            payload: { ...basePayload, recordId }
        },
        // Pattern 5: Try with objectId field instead of recordId
        {
            name: 'POST /objects/tasks with objectId',
            endpoint: 'https://services.leadconnectorhq.com/objects/tasks',
            payload: { ...basePayload, objectId: recordId }
        },
        // Pattern 6: Try with customObjectId
        {
            name: 'POST /objects/tasks with customObjectId',
            endpoint: 'https://services.leadconnectorhq.com/objects/tasks',
            payload: { ...basePayload, customObjectId: recordId }
        },
        // Pattern 7: /associations/tasks
        {
            name: 'POST /associations/tasks',
            endpoint: 'https://services.leadconnectorhq.com/associations/tasks',
            payload: { ...basePayload, recordId }
        },
        // Pattern 8: Try the exact opportunity pattern but for objects
        {
            name: 'POST /objects/{recordId}/tasks (like /opportunities/{id}/tasks)',
            endpoint: `https://services.leadconnectorhq.com/objects/${recordId}/tasks`,
            payload: basePayload
        },
        // Pattern 9: /custom-objects/{recordId}/tasks
        {
            name: 'POST /custom-objects/{recordId}/tasks',
            endpoint: `https://services.leadconnectorhq.com/custom-objects/${recordId}/tasks`,
            payload: basePayload
        }
    ];

    for (const test of tests) {
        console.log(`\n--- ${test.name} ---`);
        console.log('Endpoint:', test.endpoint);

        try {
            const response = await axios.post(test.endpoint, test.payload, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            });
            console.log('✅ SUCCESS!');
            console.log('Response:', JSON.stringify(response.data, null, 2));
            return; // Stop on first success
        } catch (error) {
            if (error.response) {
                console.log('❌', error.response.status, '-', error.response.data?.message || error.response.data?.error || JSON.stringify(error.response.data));
            } else {
                console.log('❌ Error:', error.message);
            }
        }
    }

    console.log('\n\n=== All tests failed ===');
}

testCustomObjectTasks();
