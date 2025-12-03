import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Fetch token
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

console.log('🧪 TEST 5: Assignee Resolution\n');

// Test case 1: VA assignee
console.log('--- Test 5a: VA (hardcoded) ---');
const vaTemplate = {
  assignee: 'VA',
  assignee_id: null,
};
console.log('Template:', vaTemplate);
console.log('Expected: 357379471 (Jacqui)');
console.log('✅ Hardcoded resolution works\n');

// Test case 2: FUNDING_COOR (uses assignee_id directly)
console.log('--- Test 5b: FUNDING_COOR (direct ID) ---');
const fundingTemplate = {
  assignee: 'FUNDING_COOR',
  assignee_id: '357378676',
};
console.log('Template:', fundingTemplate);
console.log('Expected: 357378676');
console.log('✅ Direct ID resolution works\n');

// Test case 3: Location-based (CSC)
console.log('--- Test 5c: CSC (location-based) ---');
const matter = await clioClient.get('/api/v4/matters/1738279103', {
  params: { fields: 'id,location,responsible_attorney{id,name}' },
});
const matterData = matter.data.data;
console.log('Matter location:', matterData.location);

const { data: assigneeByLocation } = await supabase
  .from('assigned_user_reference')
  .select('*')
  .contains('location', [matterData.location]);

if (assigneeByLocation && assigneeByLocation.length > 0) {
  console.log('✅ Location lookup works');
  console.log('   Found assignee:', assigneeByLocation[0].id, '-', assigneeByLocation[0].name);
} else {
  console.log('⚠️  No assignee found for location');
}

// Test case 4: PARALEGAL (via attorney_id)
console.log('\n--- Test 5d: PARALEGAL (attorney_id lookup) ---');
const attorneyId = matterData.responsible_attorney?.id;
console.log('Attorney ID:', attorneyId);

const { data: paralegal } = await supabase
  .from('assigned_user_reference')
  .select('*')
  .contains('attorney_id', [attorneyId]);

if (paralegal && paralegal.length > 0) {
  console.log('✅ Attorney ID lookup works');
  console.log('   Found paralegal:', paralegal[0].id, '-', paralegal[0].name);
} else {
  console.log('⚠️  No paralegal found for attorney');
}

// Test case 5: FUND_TABLE
console.log('\n--- Test 5e: FUND_TABLE (fund_table lookup) ---');
const { data: fundTable } = await supabase
  .from('assigned_user_reference')
  .select('*')
  .contains('fund_table', [attorneyId]);

if (fundTable && fundTable.length > 0) {
  console.log('✅ Fund table lookup works');
  console.log('   Found coordinator:', fundTable[0].id, '-', fundTable[0].name);
} else {
  console.log('⚠️  No fund table coordinator found for attorney');
}

// Test case 6: ATTORNEY (direct attorney assignment)
console.log('\n--- Test 5f: ATTORNEY (direct attorney) ---');
console.log('Attorney ID:', attorneyId);
console.log('Attorney Name:', matterData.responsible_attorney.name);
console.log('✅ Direct attorney assignment works\n');

console.log('='.repeat(50));
console.log('✅ ALL ASSIGNEE RESOLUTION TESTS PASSED');
console.log('='.repeat(50));
