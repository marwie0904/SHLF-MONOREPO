import dotenv from 'dotenv';

dotenv.config();

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL || 'https://app.clio.com';
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;

console.log('=== Fixing Matter Webhooks ===\n');

// Webhook IDs from list-all-webhooks
const MINIMAL_WEBHOOK_ID = '3175028'; // Only has id,etag - needs to be deleted
const FULL_WEBHOOK_ID = '3219548';    // Has full fields - needs to be updated

// Step 1: Delete the minimal webhook (3175028)
console.log('1. Deleting minimal matter webhook (3175028)...');
console.log('   This webhook only has fields: id,etag');
console.log('   It triggers but provides no useful data\n');

const deleteUrl = `${CLIO_API_BASE_URL}/api/v4/webhooks/${MINIMAL_WEBHOOK_ID}.json`;

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

console.log('✓ Minimal webhook (3175028) deleted\n');

// Step 2: Update the full webhook (3219548) to include nested matter_stage fields
console.log('2. Updating full matter webhook (3219548)...');
console.log('   Adding nested matter_stage fields: matter_stage{id,name}\n');

const updateUrl = `${CLIO_API_BASE_URL}/api/v4/webhooks/${FULL_WEBHOOK_ID}.json`;

const updatePayload = {
  data: {
    url: 'https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/matters',
    model: 'matter',
    events: ['created', 'updated'],
    // Updated fields with nested matter_stage
    fields: 'id,matter_stage{id,name},display_number,location,practice_area,originating_attorney,matter_stage_updated_at,user,status'
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
console.log(`Deleted: Webhook ${MINIMAL_WEBHOOK_ID} (minimal fields)`);
console.log(`Updated: Webhook ${FULL_WEBHOOK_ID} (full fields with nested matter_stage)`);
console.log(`URL: ${updatedWebhook.data?.url}`);
console.log(`Status: ${updatedWebhook.data?.status}`);
console.log(`Events: Matter.created, Matter.updated`);
console.log(`Fields: ${updatedWebhook.data?.fields}`);

console.log('\n✓ Matter webhook is now properly configured!');
console.log('\nThis webhook will now trigger when:');
console.log('  - A matter is created');
console.log('  - A matter stage is changed');
console.log('  - A matter status is changed to Closed');
console.log('\nThe webhook payload will now include:');
console.log('  - matter_stage.id');
console.log('  - matter_stage.name');
console.log('  - All other matter details needed for automation');
