const axios = require('axios');
require('dotenv').config();

async function verifyOpportunityTasks() {
    const apiKey = process.env.GHL_API_KEY;

    console.log('=== Testing Opportunity Tasks Endpoint ===\n');

    const tests = [
        {
            name: 'POST /opportunities/tasks',
            endpoint: 'https://services.leadconnectorhq.com/opportunities/tasks',
            payload: {
                title: 'Test Opportunity Task',
                body: 'Testing endpoint',
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                completed: false,
                opportunityId: 'test-opp-id'
            }
        },
        {
            name: 'POST /opportunities/{id}/tasks',
            endpoint: 'https://services.leadconnectorhq.com/opportunities/test-opp-id/tasks',
            payload: {
                title: 'Test Opportunity Task',
                body: 'Testing endpoint',
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                completed: false
            }
        }
    ];

    for (const test of tests) {
        console.log('--- ' + test.name + ' ---');
        console.log('Endpoint:', test.endpoint);

        try {
            const response = await axios.post(test.endpoint, test.payload, {
                headers: {
                    'Authorization': 'Bearer ' + apiKey,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            });
            console.log('SUCCESS!');
            console.log('Response:', JSON.stringify(response.data, null, 2));
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                const msg = error.response.data?.message || error.response.data?.error || JSON.stringify(error.response.data);
                if (status === 404) {
                    console.log('404 - Does not exist:', msg);
                } else {
                    console.log(status + ' - Endpoint exists but error:', msg);
                }
            }
        }
        console.log('');
    }
}

verifyOpportunityTasks();
