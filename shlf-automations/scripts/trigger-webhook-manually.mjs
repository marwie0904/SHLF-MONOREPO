#!/usr/bin/env node
import axios from 'axios';

// Simulate a Clio webhook for stage 848343
const webhookPayload = {
  id: "webhook-test-" + Date.now(),
  type: "matter.updated",
  data: {
    id: 1675950832,
    matter_stage: {
      id: 848343,
      name: "CANCELLED/NO SHOW SIGNING"
    },
    matter_stage_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
};

console.log('🚀 Sending webhook to production server...');
console.log('Payload:', JSON.stringify(webhookPayload, null, 2));

try {
  const response = await axios.post(
    'https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/matters',
    webhookPayload,
    {
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
  console.log('\n✅ Response:', response.status, response.data);
} catch (error) {
  console.error('\n❌ Error:', error.response?.status, error.response?.data || error.message);
}

console.log('\n⏳ Waiting 5 seconds for processing...');
await new Promise(r => setTimeout(r, 5000));
