import { ClioService } from './src/services/clio.js';
import { TokenRefreshService } from './src/services/token-refresh.js';
import { config } from './src/config/index.js';

console.log('\n🔍 Testing Clio API with current token...\n');

// Initialize services
await TokenRefreshService.initialize();
ClioService.initializeInterceptors();

// IMPORTANT: Update the axios client headers with the token from Supabase
ClioService.client.defaults.headers['Authorization'] = `Bearer ${config.clio.accessToken}`;

console.log('Current token:', config.clio.accessToken);
console.log('');

// Test 1: Simple GET request (should work if token is valid)
console.log('📋 Test 1: GET /api/v4/matters/1675950832');
try {
  const matter = await ClioService.getMatter(1675950832);
  console.log('✅ Success! Matter:', matter.display_number);
  console.log('   Token is VALID\n');
} catch (err) {
  console.log('❌ Failed:', err.response?.status, err.message);
  console.log('   Token is INVALID or request is wrong\n');
  process.exit(1);
}

// Test 2: Create calendar entry with corrected payload
console.log('📋 Test 2: POST /api/v4/calendar_entries');
console.log('Testing different location formats...\n');

const now = new Date();
const startAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

// Try with location as object
const payload1 = {
  data: {
    summary: 'Test Calendar Entry 1',
    calendar_entry_event_type: { id: 334844 },
    calendar_owner: { id: 7077963 },
    matter: { id: 1675950832 },
    location: { id: 334837 }, // Location as object
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    all_day: false,
  },
};

try {
  console.log('Trying location as object: { id: 334837 }');
  const response = await ClioService.client.post('/api/v4/calendar_entries', payload1, {
    params: {
      fields: 'id,summary,location',
    },
  });
  console.log('✅ Success! Calendar entry created:', response.data.data.id);
  console.log('   Location format: OBJECT works\n');

  // Delete it
  await ClioService.client.delete(`/api/v4/calendar_entries/${response.data.data.id}.json`);
  console.log('   (Cleaned up test entry)\n');
} catch (err) {
  console.log('❌ Failed with location as object');
  console.log('   Status:', err.response?.status);
  console.log('   Error:', err.response?.data);
}

// Try with location as number
const payload2 = {
  data: {
    summary: 'Test Calendar Entry 2',
    calendar_entry_event_type: { id: 334844 },
    calendar_owner: { id: 7077963 },
    matter: { id: 1675950832 },
    location: 334837, // Location as number
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    all_day: false,
  },
};

try {
  console.log('Trying location as number: 334837');
  const response = await ClioService.client.post('/api/v4/calendar_entries', payload2, {
    params: {
      fields: 'id,summary,location',
    },
  });
  console.log('✅ Success! Calendar entry created:', response.data.data.id);
  console.log('   Location format: NUMBER works\n');

  // Delete it
  await ClioService.client.delete(`/api/v4/calendar_entries/${response.data.data.id}.json`);
  console.log('   (Cleaned up test entry)\n');
} catch (err) {
  console.log('❌ Failed with location as number');
  console.log('   Status:', err.response?.status);
  console.log('   Error:', err.response?.data);
}

console.log('✅ API tests complete!\n');
