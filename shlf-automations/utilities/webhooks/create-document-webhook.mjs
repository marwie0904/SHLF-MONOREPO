import dotenv from 'dotenv';

dotenv.config();

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL;
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;
const WEBHOOK_URL = 'https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/documents';

async function createDocumentWebhook() {
  console.log('🔧 Creating document webhook...\n');

  const webhookConfig = {
    url: WEBHOOK_URL,
    model: 'document',
    events: ['created'],
    fields: 'id,created_at,matter',
  };

  const payload = { data: webhookConfig };

  console.log('Configuration:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');

  try {
    const response = await fetch(
      `${CLIO_API_BASE_URL}/api/v4/webhooks.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CLIO_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} ${response.statusText}\n${error}`);
    }

    const result = await response.json();
    console.log('✅ Document webhook created successfully!');
    console.log(`   Webhook ID: ${result.data.id}`);
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createDocumentWebhook();
