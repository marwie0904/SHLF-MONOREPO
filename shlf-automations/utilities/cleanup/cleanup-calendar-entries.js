/**
 * Cleanup Calendar Entries for Test Matter
 *
 * Safely deletes all calendar entries for test matter 1675950832
 * with rate limiting (10 entries per minute) to avoid API limits.
 */

import { ClioService } from './src/services/clio.js';

const TEST_MATTER_ID = 1675950832;
const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES = 60000; // 1 minute in milliseconds

async function wait(ms, label = '') {
  if (label) {
    console.log(`   ⏳ Waiting ${ms / 1000} seconds ${label}...`);
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCalendarEntries() {
  try {
    let allFilteredEntries = [];
    let offset = 0;
    const limit = 200;
    let hasMore = true;

    // Fetch all pages of calendar entries
    while (hasMore) {
      const response = await ClioService.client.get('/api/v4/calendar_entries.json', {
        params: {
          fields: 'id,summary,start_at,matter{id}',
          order: 'id(desc)',
          limit: limit,
          offset: offset
        }
      });

      const entries = response.data?.data || [];

      if (entries.length === 0) {
        hasMore = false;
        break;
      }

      // Filter entries for our test matter
      const filtered = entries.filter(entry =>
        entry.matter && entry.matter.id === TEST_MATTER_ID
      );

      allFilteredEntries = allFilteredEntries.concat(filtered);

      console.log(`   Fetched ${entries.length} entries at offset ${offset}, found ${filtered.length} for test matter`);

      // If we got fewer than the limit, we've reached the end
      if (entries.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    console.log(`   Total filtered to ${allFilteredEntries.length} entries for matter ${TEST_MATTER_ID}`);

    return allFilteredEntries;
  } catch (error) {
    console.error('Error fetching calendar entries:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    return [];
  }
}

async function deleteCalendarEntry(entryId, summary, index, total) {
  try {
    await ClioService.client.delete(`/api/v4/calendar_entries/${entryId}.json`);
    console.log(`   ✓ [${index}/${total}] Deleted: "${summary}" (ID: ${entryId})`);
    return true;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`   ⚠️  [${index}/${total}] Already deleted: "${summary}" (ID: ${entryId})`);
      return true;
    }
    console.error(`   ❌ [${index}/${total}] Failed to delete: "${summary}" (ID: ${entryId})`, error.message);
    return false;
  }
}

async function cleanupCalendarEntries() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  Calendar Entry Cleanup - Test Matter 1675950832      ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Step 1: Fetch all calendar entries
  console.log('📅 STEP 1: Fetching calendar entries for test matter...\n');

  const entries = await getCalendarEntries();

  if (entries.length === 0) {
    console.log('✅ No calendar entries found for test matter 1675950832\n');
    return;
  }

  console.log(`   Found ${entries.length} calendar entry(ies)\n`);

  // Display all entries
  console.log('📋 Calendar Entries to Delete:\n');
  entries.forEach((entry, idx) => {
    const startDate = entry.start_at ? new Date(entry.start_at).toLocaleString() : 'No date';
    console.log(`   ${idx + 1}. "${entry.summary}"`);
    console.log(`      Start: ${startDate}`);
    console.log(`      ID: ${entry.id}\n`);
  });

  // Step 2: Delete entries in batches
  console.log(`\n🗑️  STEP 2: Deleting entries (${BATCH_SIZE} per minute)...\n`);

  let deletedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(entries.length / BATCH_SIZE);

    console.log(`\n   📦 Batch ${batchNumber}/${totalBatches} (${batch.length} entries):\n`);

    // Delete entries in current batch
    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j];
      const globalIndex = i + j + 1;
      const success = await deleteCalendarEntry(
        entry.id,
        entry.summary,
        globalIndex,
        entries.length
      );

      if (success) {
        deletedCount++;
      } else {
        failedCount++;
      }

      // Small delay between individual deletes within a batch
      if (j < batch.length - 1) {
        await wait(500); // 0.5 second between deletes
      }
    }

    // Wait 1 minute before next batch (unless this is the last batch)
    if (i + BATCH_SIZE < entries.length) {
      console.log(`\n   ⏸️  Rate limiting: waiting 1 minute before next batch...`);
      await wait(DELAY_BETWEEN_BATCHES);
    }
  }

  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 CLEANUP SUMMARY');
  console.log('='.repeat(60) + '\n');
  console.log(`   Total entries found: ${entries.length}`);
  console.log(`   ✅ Successfully deleted: ${deletedCount}`);
  console.log(`   ❌ Failed to delete: ${failedCount}`);
  console.log('');

  if (failedCount === 0) {
    console.log('✅ All calendar entries cleaned up successfully!\n');
  } else {
    console.log(`⚠️  ${failedCount} entries failed to delete. Please review logs.\n`);
  }
}

// Run cleanup
cleanupCalendarEntries()
  .then(() => {
    console.log('✅ Cleanup script completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Cleanup script failed:', error);
    process.exit(1);
  });
