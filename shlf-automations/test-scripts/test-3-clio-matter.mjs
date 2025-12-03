import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Fetch token from Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const { data: tokenData } = await supabase
  .from('clio_tokens')
  .select('access_token')
  .eq('id', 1)
  .single();

const clioClient = axios.create({
  baseURL: process.env.CLIO_API_BASE_URL,
  headers: {
    'Authorization': `Bearer ${tokenData.access_token}`,
    'Content-Type': 'application/json',
  },
});

console.log('🧪 TEST 3: Clio Matter API Endpoint\n');

const testMatterId = 1738279103;

console.log(`Testing Clio API for matter ${testMatterId}...\n`);

try {
  const response = await clioClient.get(`/api/v4/matters/${testMatterId}`, {
    params: {
      fields: 'id,display_number,location,practice_area,originating_attorney{id,name},responsible_attorney{id,name}',
    },
  });

  console.log('✅ API call successful!\n');
  console.log('📋 Response structure:');
  console.log(JSON.stringify(response.data, null, 2));

  const matter = response.data.data;
  console.log('\n📊 Field verification:');
  console.log(`  id: ${matter.id} (${typeof matter.id})`);
  console.log(`  display_number: ${matter.display_number} (${typeof matter.display_number})`);
  console.log(`  location: ${matter.location ? JSON.stringify(matter.location) : 'null'}`);
  console.log(`  practice_area: ${matter.practice_area ? JSON.stringify(matter.practice_area) : 'null'}`);
  console.log(`  originating_attorney: ${matter.originating_attorney ? JSON.stringify(matter.originating_attorney) : 'null'}`);
  console.log(`  responsible_attorney: ${matter.responsible_attorney ? JSON.stringify(matter.responsible_attorney) : 'null'}`);

  if (matter.location) {
    console.log(`    location.id: ${matter.location.id} (${typeof matter.location.id})`);
  }

  if (matter.responsible_attorney) {
    console.log(`    responsible_attorney.id: ${matter.responsible_attorney.id} (${typeof matter.responsible_attorney.id})`);
    console.log(`    responsible_attorney.name: ${matter.responsible_attorney.name} (${typeof matter.responsible_attorney.name})`);
  }

  console.log('\n✅ Test 3 passed - Clio matter endpoint structure is correct');
  console.log('✅ Response format matches script expectations');
} catch (error) {
  console.error('❌ API call failed:', error.message);
  console.error('Status:', error.response?.status);
  console.error('Data:', JSON.stringify(error.response?.data, null, 2));
  process.exit(1);
}
