const axios = require('axios');
require('dotenv').config();

/**
 * Test: Create a task for a custom object record using patterns similar to opportunities
 */
async function testTaskForRecord() {
    const apiKey = process.env.GHL_API_KEY;
    const recordId = process.argv[2] || '692ab85b947d9cc7a17e5e89';

    if (!apiKey) {
        console.error('Missing GHL_API_KEY in environment variables');
        process.exit(1);
    }

    console.log('🧪 Testing task creation for custom object record...\n');
    console.log('Record ID:', recordId);
    console.log('\n');

    // TEST 1: Try /objects/tasks with recordId in body (similar to /opportunities/tasks)
    console.log('TEST 1: POST /objects/tasks with recordId in body...');
    try {
        const payload = {
            title: 'Test Task for Record',
            body: 'Testing /objects/tasks endpoint',
            dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            completed: false,
            recordId: recordId
        };

        const endpoint = 'https://services.leadconnectorhq.com/objects/tasks';
        console.log('Endpoint:', endpoint);
        console.log('Payload:', JSON.stringify(payload, null, 2));

        const response = await axios.post(endpoint, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Version': '2021-07-28'
            }
        });

        console.log('✅ SUCCESS!\n');
        console.log('Response:', JSON.stringify(response.data, null, 2));
        return;
    } catch (error) {
        console.error('❌ FAILED');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }

    // TEST 2: Try /objects/records/tasks with recordId in body
    console.log('\n\nTEST 2: POST /objects/records/tasks with recordId in body...');
    try {
        const payload = {
            title: 'Test Task for Record',
            body: 'Testing /objects/records/tasks endpoint',
            dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            completed: false,
            recordId: recordId
        };

        const endpoint = 'https://services.leadconnectorhq.com/objects/records/tasks';
        console.log('Endpoint:', endpoint);
        console.log('Payload:', JSON.stringify(payload, null, 2));

        const response = await axios.post(endpoint, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Version': '2021-07-28'
            }
        });

        console.log('✅ SUCCESS!\n');
        console.log('Response:', JSON.stringify(response.data, null, 2));
        return;
    } catch (error) {
        console.error('❌ FAILED');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }

    // TEST 3: Try the same opportunities/tasks endpoint with recordId
    console.log('\n\nTEST 3: POST /opportunities/tasks with recordId instead of opportunityId...');
    try {
        const payload = {
            title: 'Test Task for Record',
            body: 'Testing opportunities endpoint with recordId',
            dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            completed: false,
            recordId: recordId
        };

        const endpoint = 'https://services.leadconnectorhq.com/opportunities/tasks';
        console.log('Endpoint:', endpoint);
        console.log('Payload:', JSON.stringify(payload, null, 2));

        const response = await axios.post(endpoint, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Version': '2021-07-28'
            }
        });

        console.log('✅ SUCCESS!\n');
        console.log('Response:', JSON.stringify(response.data, null, 2));
        return;
    } catch (error) {
        console.error('❌ FAILED');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }

    console.log('\n\n❌ All tests failed. Custom object tasks endpoint may not exist yet.');
}

console.log('='.repeat(60));
console.log('Testing Task Creation for Custom Object Records v2');
console.log('='.repeat(60) + '\n');

testTaskForRecord();
