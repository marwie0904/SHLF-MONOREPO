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

// Read duplicates without matters CSV
const duplicatesCsv = fs.readFileSync('./csv/duplicates-without-matters.csv', 'utf-8');
const duplicates = parse(duplicatesCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total duplicates to verify: ${duplicates.length}`);
console.log('Starting verification process...\n');

const trulyNoMatters = [];
const hasMatters = [];
let errorCount = 0;

for (let i = 0; i < duplicates.length; i++) {
  const contact = duplicates[i];
  const contactId = contact['Contact ID'];

  if ((i + 1) % 50 === 0 || i === 0 || i === duplicates.length - 1) {
    console.log(`[${i + 1}/${duplicates.length}] Verifying Contact ID: ${contactId} (${contact['Contact Name']})`);
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
      if ((i + 1) % 50 === 0 || i === 0 || i === duplicates.length - 1) {
        console.log(`  ❌ HAS ${matters.length} matter(s)`);
      }
    } else {
      trulyNoMatters.push(result);
      if ((i + 1) % 50 === 0 || i === 0 || i === duplicates.length - 1) {
        console.log(`  ✓ Confirmed NO matters`);
      }
    }

    // Rate limiting - wait 4 seconds between requests
    if (i < duplicates.length - 1) {
      await delay(4000);
    }

  } catch (error) {
    console.error(`  ✗ API Error for ${contactId}: ${error.message}`);
    errorCount++;
    // Still add to trulyNoMatters but mark the error
    trulyNoMatters.push({
      ...contact,
      'API Matter Count': 'ERROR',
      'Matter IDs': '',
      'Matter Descriptions': '',
      'Matter Statuses': '',
      'Verification Error': error.message
    });
  }
}

// Save truly no matters contacts
if (trulyNoMatters.length > 0) {
  const noMattersCsv = stringify(trulyNoMatters, { header: true });
  fs.writeFileSync('./csv/duplicates-verified-no-matters.csv', noMattersCsv);
  console.log(`\n✓ Saved ${trulyNoMatters.length} contacts with NO matters to: ./csv/duplicates-verified-no-matters.csv`);
}

// Save contacts that actually have matters
if (hasMatters.length > 0) {
  const withMattersCsv = stringify(hasMatters, { header: true });
  fs.writeFileSync('./csv/duplicates-verified-with-matters.csv', withMattersCsv);
  console.log(`✓ Saved ${hasMatters.length} contacts WITH matters to: ./csv/duplicates-verified-with-matters.csv`);
}

// Generate summary
console.log('\n=== Verification Summary ===');
console.log(`Total Processed: ${duplicates.length}`);
console.log(`Contacts WITHOUT matters: ${trulyNoMatters.length} ✓`);
console.log(`Contacts WITH matters: ${hasMatters.length} ❌`);
console.log(`API Errors: ${errorCount}`);
console.log(`\nEstimated time: ${Math.round((duplicates.length * 4) / 60)} minutes`);
