import dotenv from 'dotenv';

dotenv.config();

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL || 'https://app.clio.com';
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;

console.log('=== Fixing Calendar Webhook ===\n');

// Webhook ID from list-all-webhooks
const CALENDAR_WEBHOOK_ID = '3205148';

console.log('Updating calendar webhook to include nested matter fields...');
console.log('Current fields: id,summary,description,start_at,end_at,matter,created_at,updated_at');
console.log('New fields will include: matter{id,display_number,matter_stage{id,name}}\n');

const updateUrl = `${CLIO_API_BASE_URL}/api/v4/webhooks/${CALENDAR_WEBHOOK_ID}.json`;

const updatePayload = {
  data: {
    url: 'https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/calendar',
    model: 'calendar_entry',
    events: ['created', 'updated'],
    // Updated fields with nested matter fields including matter_stage
    fields: 'id,summary,description,start_at,end_at,matter{id,display_number,matter_stage{id,name},location},created_at,updated_at'
  }
};

console.log('Update payload:', JSON.stringify(updatePayload, null, 2));

const updateResponse = await fetch(updateUrl, {
  method: 'PUT',
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

console.log('\n=== Summary ===');
console.log(`Updated: Webhook ${CALENDAR_WEBHOOK_ID}`);
console.log(`URL: ${updatedWebhook.data?.url}`);
console.log(`Status: ${updatedWebhook.data?.status}`);
console.log(`Events: CalendarEntry.created, CalendarEntry.updated`);
console.log(`Fields: ${updatedWebhook.data?.fields}`);

console.log('\n✓ Calendar webhook is now properly configured!');
console.log('\nThe webhook payload will now include:');
console.log('  - matter.id');
console.log('  - matter.display_number');
console.log('  - matter.matter_stage.id');
console.log('  - matter.matter_stage.name');
console.log('  - matter.location');
console.log('\nNote: matter_stage is a second-level nested field, so it will only return default fields (id, name)');
