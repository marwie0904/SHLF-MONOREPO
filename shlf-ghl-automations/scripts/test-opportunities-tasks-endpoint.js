const axios = require('axios');
require('dotenv').config();

async function testOpportunitiesTasksEndpoint() {
    const apiKey = process.env.GHL_API_KEY;

    // Try different API versions
    const versions = ['2021-07-28', '2021-04-15'];
    
    for (const version of versions) {
        console.log(`\n--- Testing version: ${version} ---`);
        
        try {
            // First, let's just try a GET to see what endpoints exist
            const response = await axios.get(
                'https://services.leadconnectorhq.com/opportunities/',
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'Version': version
                    }
                }
            );
            console.log('GET /opportunities/ response:', JSON.stringify(response.data, null, 2).slice(0, 500));
        } catch (error) {
            if (error.response) {
                console.log('Status:', error.response.status);
                console.log('Response:', JSON.stringify(error.response.data, null, 2));
            }
        }
    }
}

testOpportunitiesTasksEndpoint();
