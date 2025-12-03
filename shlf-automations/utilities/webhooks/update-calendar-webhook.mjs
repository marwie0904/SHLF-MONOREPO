import dotenv from 'dotenv';

dotenv.config();

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL || 'https://app.clio.com';
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;
const WEBHOOK_ID = '3183473';

console.log('=== Updating Calendar Webhook ===\n');

// First, get the current webhook details
console.log('1. Fetching current webhook configuration...');
const getUrl = `${CLIO_API_BASE_URL}/api/v4/webhooks/${WEBHOOK_ID}.json`;

const getResponse = await fetch(getUrl, {
  headers: {
    'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

if (!getResponse.ok) {
  console.error(`Failed to fetch webhook: ${getResponse.status} ${getResponse.statusText}`);
  process.exit(1);
}

const currentWebhook = await getResponse.json();
console.log('Current webhook:', JSON.stringify(currentWebhook, null, 2));

// Update the webhook to subscribe to CalendarEntry events
console.log('\n2. Updating webhook to subscribe to CalendarEntry.created and CalendarEntry.updated...');

const updateUrl = `${CLIO_API_BASE_URL}/api/v4/webhooks/${WEBHOOK_ID}.json`;

const updatePayload = {
  data: {
    url: 'https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/calendar',
    model: 'Calendar',
    events: ['created', 'updated'],
    fields: 'id,summary,description,start_at,end_at,matter,created_at,updated_at'
  }
};

console.log('Update payload:', JSON.stringify(updatePayload, null, 2));

const updateResponse = await fetch(updateUrl, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(updatePayload)
});

if (!updateResponse.ok) {
  const errorText = await updateResponse.text();
  console.error(`Failed to update webhook: ${updateResponse.status} ${updateResponse.statusText}`);
  console.error('Error details:', errorText);
  process.exit(1);
}

const updatedWebhook = await updateResponse.json();
console.log('\n✓ Webhook updated successfully!');
console.log('Updated webhook:', JSON.stringify(updatedWebhook, null, 2));

// Verify the update
console.log('\n3. Verifying webhook configuration...');
const verifyResponse = await fetch(getUrl, {
  headers: {
    'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

const verifiedWebhook = await verifyResponse.json();
console.log('\nVerified webhook configuration:');
console.log(`  ID: ${verifiedWebhook.data?.id}`);
console.log(`  URL: ${verifiedWebhook.data?.url}`);
console.log(`  Model: ${verifiedWebhook.data?.model}`);
console.log(`  Status: ${verifiedWebhook.data?.status}`);
console.log(`  Events: ${verifiedWebhook.data?.events?.join(', ')}`);
console.log(`  Fields: ${verifiedWebhook.data?.fields}`);

console.log('\n✓ Calendar webhook is now properly configured!');
console.log('\nThis webhook will now trigger when:');
console.log('  - A calendar entry is created (CalendarEntry.created)');
console.log('  - A calendar entry is updated (CalendarEntry.updated)');
console.log('\nSigning meeting tasks should now be created automatically.');
