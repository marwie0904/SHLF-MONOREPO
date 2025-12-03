import dotenv from 'dotenv';

dotenv.config();

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL || 'https://app.clio.com';
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;

console.log('=== Creating Calendar Webhook ===\n');

const createUrl = `${CLIO_API_BASE_URL}/api/v4/webhooks.json`;

// Try different model names
const modelsToTry = ['CalendarEntry', 'Calendar', 'calendar_entry', 'calendar_entries'];

for (const modelName of modelsToTry) {
  console.log(`\nTrying model: "${modelName}"...`);

  const createPayload = {
    data: {
      url: 'https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/calendar',
      model: modelName,
      events: ['created', 'updated'],
      fields: 'id,summary,description,start_at,end_at,matter,created_at,updated_at'
    }
  };

  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(createPayload)
  });

  if (createResponse.ok) {
    const newWebhook = await createResponse.json();
    console.log(`\n✓ SUCCESS! Webhook created with model "${modelName}"`);
    console.log('New webhook:', JSON.stringify(newWebhook, null, 2));

    console.log('\n=== Summary ===');
    console.log(`Webhook ID: ${newWebhook.data?.id}`);
    console.log(`URL: ${newWebhook.data?.url}`);
    console.log(`Model: ${modelName}`);
    console.log(`Status: ${newWebhook.data?.status}`);
    console.log(`Events: ${newWebhook.data?.events?.join(', ')}`);

    console.log('\n✓ Calendar webhook is now properly configured!');
    console.log('\nThis webhook will trigger when:');
    console.log('  - A calendar entry is created');
    console.log('  - A calendar entry is updated');
    console.log('\nSigning meeting tasks should now be created automatically.');
    break;
  } else {
    const errorText = await createResponse.text();
    console.log(`  ❌ Failed: ${createResponse.status} - ${errorText}`);
  }
}
