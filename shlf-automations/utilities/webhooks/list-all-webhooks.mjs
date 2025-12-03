import dotenv from 'dotenv';

dotenv.config();

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL;
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;

async function listWebhooks() {
  console.log('🔍 Listing all Clio webhooks...\n');

  try {
    // Try with fields parameter
    const response = await fetch(
      `${CLIO_API_BASE_URL}/api/v4/webhooks.json?fields=id,model,events,url,status,fields`,
      {
        headers: {
          Authorization: `Bearer ${CLIO_ACCESS_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('📊 Raw API Response:');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

listWebhooks();
