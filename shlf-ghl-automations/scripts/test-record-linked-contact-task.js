const axios = require('axios');
require('dotenv').config();

/**
 * Test: Get the custom object record, find its linked contact, create task on contact
 */
async function testRecordLinkedContactTask() {
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    const recordId = process.argv[2] || '692ab85b947d9cc7a17e5e89';

    console.log('=== Testing Task via Linked Contact ===\n');
    console.log('Record ID:', recordId);

    // Step 1: Get the custom object record to find linked contact
    console.log('\n--- Step 1: Get Custom Object Record ---');
    try {
        const recordResponse = await axios.get(
            'https://services.leadconnectorhq.com/objects/records/' + recordId,
            {
                headers: {
                    'Authorization': 'Bearer ' + apiKey,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            }
        );

        console.log('Record found!');
        console.log('Record data:', JSON.stringify(recordResponse.data, null, 2));

        // Look for a contact association
        const record = recordResponse.data;

        // Check if there's a contact field or association
        if (record.associations) {
            console.log('\nAssociations:', JSON.stringify(record.associations, null, 2));
        }

        // Check for a primary contact field
        const contactId = record.contact_id || record.contactId ||
                          record.properties?.contact_id || record.properties?.contactId ||
                          record.fields?.contact_id || record.fields?.contactId;

        if (contactId) {
            console.log('\nFound linked contact ID:', contactId);

            // Step 2: Create task on the contact
            console.log('\n--- Step 2: Create Task on Linked Contact ---');
            const taskPayload = {
                title: 'Task for Custom Object Record',
                body: 'Created via linked contact. Record ID: ' + recordId,
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                completed: false
            };

            const taskResponse = await axios.post(
                'https://services.leadconnectorhq.com/contacts/' + contactId + '/tasks',
                taskPayload,
                {
                    headers: {
                        'Authorization': 'Bearer ' + apiKey,
                        'Content-Type': 'application/json',
                        'Version': '2021-07-28'
                    }
                }
            );

            console.log('Task created successfully!');
            console.log('Response:', JSON.stringify(taskResponse.data, null, 2));
        } else {
            console.log('\nNo contact ID found in record. Full record structure:');
            console.log(JSON.stringify(record, null, 2));
        }

    } catch (error) {
        console.log('Error:', error.response?.status, '-', error.response?.data?.message || error.response?.data || error.message);
    }
}

testRecordLinkedContactTask();
