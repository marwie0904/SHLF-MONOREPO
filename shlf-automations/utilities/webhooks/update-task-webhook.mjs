import dotenv from 'dotenv';

dotenv.config();

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL;
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;
const WEBHOOK_ID = 3184103;

async function updateTaskWebhook() {
  console.log(`🔧 Updating task webhook ${WEBHOOK_ID} to include deleted event and fields...\n`);

  const webhookConfig = {
    events: ['updated', 'deleted'],
    fields: 'id,created_at,updated_at,status,matter',
  };

  const payload = { data: webhookConfig };

  console.log('New configuration:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');

  try {
    const response = await fetch(
      `${CLIO_API_BASE_URL}/api/v4/webhooks/${WEBHOOK_ID}.json`,
      {
        method: 'PUT',
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
    console.log('✅ Webhook updated successfully!');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

updateTaskWebhook();
