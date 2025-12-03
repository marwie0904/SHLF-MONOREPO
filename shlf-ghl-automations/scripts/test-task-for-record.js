const axios = require('axios');
require('dotenv').config();

/**
 * Test: Create a task for a custom object record using the /objects/records/{recordId}/tasks endpoint
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

    const payload = {
        title: 'Test Task for Custom Object Record',
        body: 'Testing /objects/records/{recordId}/tasks endpoint',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        completed: false
    };

    const endpoint = `https://services.leadconnectorhq.com/objects/records/${recordId}/tasks`;

    console.log('Endpoint:', endpoint);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('\n');

    try {
        const response = await axios.post(endpoint, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Version': '2021-07-28'
            }
        });

        console.log('✅ SUCCESS! Task created for record!\n');
        console.log('Response:', JSON.stringify(response.data, null, 2));
        return response.data;

    } catch (error) {
        console.error('❌ FAILED\n');

        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error:', error.message);
        }

        process.exit(1);
    }
}

console.log('='.repeat(60));
console.log('Testing Task Creation for Custom Object Records');
console.log('='.repeat(60) + '\n');

testTaskForRecord();
