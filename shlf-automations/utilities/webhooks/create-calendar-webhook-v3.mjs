import dotenv from 'dotenv';

dotenv.config();

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL || 'https://app.clio.com';
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;

console.log('=== Creating Calendar Webhook ===\n');

const createUrl = `${CLIO_API_BASE_URL}/api/v4/webhooks.json`;

const createPayload = {
  data: {
    url: 'https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/calendar',
    model: 'calendar_entry',
    events: ['created', 'updated'],
    // Include nested matter fields - matter_stage will return default fields only
    fields: 'id,summary,description,start_at,end_at,matter{id,display_number,matter_stage,location},created_at,updated_at'
  }
};

console.log('Create payload:', JSON.stringify(createPayload, null, 2));

const createResponse = await fetch(createUrl, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(createPayload)
});

if (!createResponse.ok) {
  const errorText = await createResponse.text();
  console.error(`Failed to create webhook: ${createResponse.status} ${createResponse.statusText}`);
  console.error('Error details:', errorText);
  process.exit(1);
}

const newWebhook = await createResponse.json();
console.log('\n✓ New webhook created successfully!');
console.log('New webhook:', JSON.stringify(newWebhook, null, 2));

console.log('\n=== Summary ===');
console.log(`New Webhook ID: ${newWebhook.data?.id}`);
console.log(`Events: calendar_entry.created, calendar_entry.updated`);

console.log('\n✓ Calendar webhook is now configured!');
console.log('\nThis webhook will now trigger when:');
console.log('  - A calendar entry is created');
console.log('  - A calendar entry is updated');
console.log('\nThe webhook payload will now include:');
console.log('  - matter.id');
console.log('  - matter.display_number');
console.log('  - matter.matter_stage (with default fields: id, name)');
console.log('  - matter.location');
