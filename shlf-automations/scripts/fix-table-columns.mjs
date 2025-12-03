import { supabaseAPI } from './tests/utils/state-capture.js';

const matterId = 1675950832;

// Check each table
console.log('\n=== Testing table queries ===\n');

try {
  const events = await supabaseAPI.getWebhookEvents(matterId, null, 1);
  console.log('✅ webhook_events works:', events.length, 'records');
} catch (e) {
  console.log('❌ webhook_events error:', e.message);
}

try {
  const tasks = await supabaseAPI.getTasksForMatter(matterId);
  console.log('✅ tasks works:', tasks.length, 'records');
} catch (e) {
  console.log('❌ tasks error:', e.message);
}

try {
  const errors = await supabaseAPI.getErrorLogs(matterId, 5);
  console.log('✅ error_logs works:', errors.length, 'records');
} catch (e) {
  console.log('❌ error_logs error:', e.message);
}

try {
  const history = await supabaseAPI.getMatterHistory(matterId, 5);
  console.log('✅ matters works:', history.length, 'records');
} catch (e) {
  console.log('❌ matters error:', e.message);
}
