const axios = require('axios');
require('dotenv').config();

async function testContactsTasks() {
    const apiKey = process.env.GHL_API_KEY;
    const recordId = '692ab85b947d9cc7a17e5e89';

    // Try using the contacts endpoint with the record ID
    const payload = {
        title: 'Test Task for Record via Contacts',
        body: 'Testing if custom object record works in contacts endpoint',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        completed: false
    };

    console.log('Testing POST /contacts/{recordId}/tasks');
    console.log('Record ID:', recordId);
    console.log('Payload:', JSON.stringify(payload, null, 2));

    try {
        const response = await axios.post(
            `https://services.leadconnectorhq.com/contacts/${recordId}/tasks`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            }
        );

        console.log('✅ SUCCESS!');
        console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.log('❌ FAILED');
        if (error.response) {
            console.log('Status:', error.response.status);
            console.log('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

testContactsTasks();
