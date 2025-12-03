import dotenv from 'dotenv';

dotenv.config();

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL;
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;

async function getWebhookDetails() {
  console.log('🔍 Getting detailed webhook information...\n');

  const webhookIds = [3164333, 3175028, 3182003, 3183473];

  for (const id of webhookIds) {
    try {
      const response = await fetch(
        `${CLIO_API_BASE_URL}/api/v4/webhooks/${id}.json`,
        {
          headers: {
            Authorization: `Bearer ${CLIO_ACCESS_TOKEN}`,
          },
        }
      );

      if (!response.ok) {
        console.log(`❌ Webhook ${id}: ${response.status} ${response.statusText}\n`);
        continue;
      }

      const result = await response.json();
      const webhook = result.data;

      console.log(`📌 Webhook ${id}:`);
      console.log(JSON.stringify(webhook, null, 2));
      console.log('');

    } catch (error) {
      console.error(`❌ Error fetching webhook ${id}:`, error.message);
    }
  }
}

getWebhookDetails();
