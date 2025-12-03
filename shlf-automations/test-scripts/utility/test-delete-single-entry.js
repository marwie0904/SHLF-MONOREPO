/**
 * Test deleting a single calendar entry
 */

import { ClioService } from './src/services/clio.js';

async function testDeleteSingleEntry() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  Test Delete Single Calendar Entry                    ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Fetch one calendar entry for the test matter
    console.log('📅 STEP 1: Fetching one calendar entry...\n');

    const response = await ClioService.client.get('/api/v4/calendar_entries.json', {
      params: {
        fields: 'id,summary,start_at,matter{id}',
        order: 'id(desc)',
        limit: 50
      }
    });

    const allEntries = response.data?.data || [];
    const testMatterEntries = allEntries.filter(entry =>
      entry.matter && entry.matter.id === 1675950832
    );

    if (testMatterEntries.length === 0) {
      console.log('✅ No calendar entries found for test matter 1675950832\n');
      return;
    }

    const entryToDelete = testMatterEntries[0];
    console.log(`   Found entry to delete:`);
    console.log(`   ID: ${entryToDelete.id}`);
    console.log(`   Summary: ${entryToDelete.summary}`);
    console.log(`   Start: ${entryToDelete.start_at}`);
    console.log('');

    // Step 2: Try to delete it
    console.log('🗑️  STEP 2: Attempting to delete...\n');

    try {
      await ClioService.client.delete(`/api/v4/calendar_entries/${entryToDelete.id}.json`);
      console.log(`   ✅ Successfully deleted entry ${entryToDelete.id}\n`);
    } catch (deleteError) {
      console.log(`   ❌ Failed to delete entry ${entryToDelete.id}`);
      console.log(`   Status: ${deleteError.response?.status}`);
      console.log(`   Error: ${JSON.stringify(deleteError.response?.data, null, 2)}\n`);
    }

    // Step 3: Verify deletion
    console.log('🔍 STEP 3: Verifying deletion...\n');

    try {
      const verifyResponse = await ClioService.client.get(`/api/v4/calendar_entries/${entryToDelete.id}.json`);
      console.log(`   ⚠️  Entry still exists after delete attempt`);
      console.log(`   ${JSON.stringify(verifyResponse.data, null, 2)}\n`);
    } catch (verifyError) {
      if (verifyError.response?.status === 404) {
        console.log(`   ✅ Confirmed: Entry ${entryToDelete.id} no longer exists (404)\n`);
      } else {
        console.log(`   Unexpected error during verification: ${verifyError.message}\n`);
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run test
testDeleteSingleEntry()
  .then(() => {
    console.log('✅ Test completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
