import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL || 'https://app.clio.com';
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;

if (!CLIO_ACCESS_TOKEN) {
  console.error('CLIO_ACCESS_TOKEN is not set');
  process.exit(1);
}

// Helper function to fetch from Clio API
async function fetchClioAPI(url) {
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Helper to add delay between requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Read matched contacts
const matchedCsv = fs.readFileSync('./csv/grow-duplicates-matched-in-manage.csv', 'utf-8');
const matchedContacts = parse(matchedCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total matched contacts to verify: ${matchedContacts.length}`);
console.log('Starting API verification (2 second delay)...\n');

const safeToDelete = [];
const hasMatters = [];
let errorCount = 0;

for (let i = 0; i < matchedContacts.length; i++) {
  const contact = matchedContacts[i];
  const contactId = contact['Manage Contact ID'];

  if ((i + 1) % 50 === 0 || i === 0) {
    console.log(`[${i + 1}/${matchedContacts.length}] Verifying Contact ID: ${contactId} (${contact['Manage Contact Name']})`);
  }

  try {
    // Fetch matters for this contact (including closed matters)
    const mattersUrl = `${CLIO_API_BASE_URL}/api/v4/matters.json?fields=id,display_number,description,status&client_id=${contactId}&limit=200`;
    const mattersData = await fetchClioAPI(mattersUrl);
    const matters = mattersData.data || [];

    const result = {
      ...contact,
      'API Matter Count': matters.length,
      'Matter IDs': matters.map(m => m.display_number).join('; '),
      'Matter Descriptions': matters.map(m => m.description).join('; '),
      'Matter Statuses': matters.map(m => m.status).join('; ')
    };

    if (matters.length > 0) {
      hasMatters.push(result);
      if ((i + 1) % 50 === 0 || i === 0) {
        console.log(`  ❌ HAS ${matters.length} matter(s) - NOT SAFE`);
      }
    } else {
      safeToDelete.push(result);
      if ((i + 1) % 50 === 0 || i === 0) {
        console.log(`  ✓ No matters - SAFE`);
      }
    }

    // Rate limiting - wait 2 seconds between requests
    if (i < matchedContacts.length - 1) {
      await delay(2000);
    }

  } catch (error) {
    console.error(`  ✗ API Error for ${contactId}: ${error.message}`);
    errorCount++;
    // Mark as unsafe due to error
    hasMatters.push({
      ...contact,
      'API Matter Count': 'ERROR',
      'Matter IDs': '',
      'Matter Descriptions': '',
      'Matter Statuses': '',
      'Error': error.message
    });
  }
}

// Save safe to delete contacts
if (safeToDelete.length > 0) {
  const safeCsv = stringify(safeToDelete, { header: true });
  fs.writeFileSync('./csv/safe-to-delete-contacts.csv', safeCsv);
  console.log(`\n✓ Saved ${safeToDelete.length} SAFE contacts to: ./csv/safe-to-delete-contacts.csv`);
}

// Save contacts with matters (DO NOT DELETE)
if (hasMatters.length > 0) {
  const unsafeCsv = stringify(hasMatters, { header: true });
  fs.writeFileSync('./csv/unsafe-has-matters.csv', unsafeCsv);
  console.log(`✓ Saved ${hasMatters.length} UNSAFE contacts to: ./csv/unsafe-has-matters.csv`);
}

// Generate summary
console.log('\n=== Verification Summary ===');
console.log(`Total Verified: ${matchedContacts.length}`);
console.log(`SAFE to delete (no matters): ${safeToDelete.length} ✓`);
console.log(`UNSAFE (has matters): ${hasMatters.length} ❌`);
console.log(`API Errors: ${errorCount}`);
console.log(`\nEstimated time: ${Math.round((matchedContacts.length * 2) / 60)} minutes`);
