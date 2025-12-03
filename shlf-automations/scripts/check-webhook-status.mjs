import { supabaseAPI } from './tests/utils/state-capture.js';

const matterId = 1675950832;

// Check webhook events
const events = await supabaseAPI.getWebhookEvents(matterId, 5);
console.log('\n📊 Recent Webhook Events:');
console.log(JSON.stringify(events, null, 2));

// Check error logs
const errors = await supabaseAPI.getErrorLogs(matterId, 5);
console.log('\n🚨 Recent Errors:');
console.log(JSON.stringify(errors, null, 2));
