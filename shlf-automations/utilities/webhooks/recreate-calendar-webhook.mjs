import dotenv from 'dotenv';

dotenv.config();

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL || 'https://app.clio.com';
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;
const OLD_WEBHOOK_ID = '3183473';

console.log('=== Recreating Calendar Webhook ===\n');

// Step 1: Delete the old webhook
console.log('1. Deleting old calendar webhook...');
const deleteUrl = `${CLIO_API_BASE_URL}/api/v4/webhooks/${OLD_WEBHOOK_ID}.json`;

const deleteResponse = await fetch(deleteUrl, {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

if (!deleteResponse.ok) {
  console.error(`Failed to delete webhook: ${deleteResponse.status} ${deleteResponse.statusText}`);
  const errorText = await deleteResponse.text();
  console.error('Error details:', errorText);
  process.exit(1);
}

console.log('✓ Old webhook deleted');

// Step 2: Create new webhook for calendar entries
console.log('\n2. Creating new calendar webhook...');

const createUrl = `${CLIO_API_BASE_URL}/api/v4/webhooks.json`;

const createPayload = {
  data: {
    url: 'https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/calendar',
    model: 'CalendarEntry',
    events: ['created', 'updated'],
    fields: 'id,summary,description,start_at,end_at,matter,created_at,updated_at'
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
console.log(`Old Webhook ID: ${OLD_WEBHOOK_ID} (deleted)`);
console.log(`New Webhook ID: ${newWebhook.data?.id}`);
console.log(`URL: ${newWebhook.data?.url}`);
console.log(`Status: ${newWebhook.data?.status}`);
console.log(`Events: CalendarEntry.created, CalendarEntry.updated`);

console.log('\n✓ Calendar webhook is now properly configured!');
console.log('\nThis webhook will now trigger when:');
console.log('  - A calendar entry is created');
console.log('  - A calendar entry is updated');
console.log('\nSigning meeting tasks should now be created automatically.');
