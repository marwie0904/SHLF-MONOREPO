import { resolveAssignee } from './src/utils/assignee-resolver.js';
import { SupabaseService } from './src/services/supabase.js';

/**
 * Test script for FUNDING_COOR and FUND TABLE assignee logic
 */

// Mock matter data
const mockMatter = {
  id: 123456789,
  display_number: 'TEST-001',
  responsible_attorney: {
    id: 357380836,  // Example attorney ID
    name: 'Test Attorney'
  },
  originating_attorney: {
    id: 357387241,
    name: 'Tom LaTorre'
  }
};

async function testFundingCoor() {
  console.log('\n=== Testing FUNDING_COOR ===');

  try {
    // Test with numeric assignee_id
    const assigneeId = '357168768';  // Example Clio user ID
    console.log(`Testing FUNDING_COOR with assignee_id: ${assigneeId}`);

    const result = await resolveAssignee('FUNDING_COOR', mockMatter, null, assigneeId);

    console.log('✅ FUNDING_COOR test passed!');
    console.log('Result:', result);
  } catch (error) {
    console.error('❌ FUNDING_COOR test failed:', error.message);
  }
}

async function testFundTable() {
  console.log('\n=== Testing FUND TABLE ===');

  try {
    console.log(`Testing FUND TABLE with attorney ID: ${mockMatter.responsible_attorney.id}`);

    const result = await resolveAssignee('FUND TABLE', mockMatter);

    console.log('✅ FUND TABLE test passed!');
    console.log('Result:', result);
  } catch (error) {
    console.error('❌ FUND TABLE test failed:', error.message);
    console.log('Note: This may fail if the attorney ID is not in the assigned_user_reference.fund_table column');
  }
}

async function checkAssignedUserReference() {
  console.log('\n=== Checking assigned_user_reference table ===');

  try {
    // Try to fetch a sample from assigned_user_reference
    const result = await SupabaseService.getAssigneeByAttorneyFundTable(357380836);

    if (result) {
      console.log('✅ Found assignee in fund_table:');
      console.log('  ID:', result.id);
      console.log('  Name:', result.name);
      console.log('  Fund Table:', result.fund_table);
    } else {
      console.log('⚠️  No assignee found for attorney ID 357380836');
      console.log('   Make sure the assigned_user_reference.fund_table column contains attorney IDs');
    }
  } catch (error) {
    console.error('❌ Error checking assigned_user_reference:', error.message);
  }
}

async function runTests() {
  console.log('🧪 Starting FUNDING Assignee Tests\n');
  console.log('Testing the new FUNDING_COOR and FUND TABLE logic...\n');

  await testFundingCoor();
  await testFundTable();
  await checkAssignedUserReference();

  console.log('\n✨ Tests complete!\n');
  process.exit(0);
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
