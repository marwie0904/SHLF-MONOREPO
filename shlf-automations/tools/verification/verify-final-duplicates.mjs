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

console.log(`Total duplicates without matters: ${duplicates.length}`);

// Randomly select 100 contacts
const shuffled = duplicates.sort(() => 0.5 - Math.random());
const sample = shuffled.slice(0, 100);

console.log(`Selected ${sample.length} random contacts for verification\n`);

const verificationResults = [];

for (let i = 0; i < sample.length; i++) {
  const contact = sample[i];
  const contactId = contact['Contact ID'];

  console.log(`[${i + 1}/${sample.length}] Verifying Contact ID: ${contactId} (${contact['Contact Name']})`);

  try {
    // Fetch contact details from Clio
    const contactUrl = `${CLIO_API_BASE_URL}/api/v4/contacts/${contactId}.json?fields=id,name,type`;
    const contactData = await fetchClioAPI(contactUrl);
    const apiContact = contactData.data;

    // Fetch matters for this contact
    const mattersUrl = `${CLIO_API_BASE_URL}/api/v4/matters.json?fields=id,display_number,description&client_id=${contactId}&limit=200`;
    const mattersData = await fetchClioAPI(mattersUrl);
    const matters = mattersData.data || [];

    const result = {
      'CSV Contact ID': contactId,
      'CSV Contact Name': contact['Contact Name'],
      'CSV Duplicate Group': contact['Duplicate Group'],
      'API Contact Name': apiContact.name,
      'Has Matters (API)': matters.length > 0 ? 'YES' : 'NO',
      'Matter Count (API)': matters.length,
      'Matter IDs': matters.map(m => m.display_number).join('; '),
      'Matter Descriptions': matters.map(m => m.description).join('; '),
      'Verification Status': 'Success'
    };

    verificationResults.push(result);

    if (matters.length > 0) {
      console.log(`  ❌ ERROR: Contact HAS ${matters.length} matter(s)!`);
    } else {
      console.log(`  ✓ Confirmed: NO matters`);
    }

    // Rate limiting - wait 4 seconds between requests
    if (i < sample.length - 1) {
      await delay(4000);
    }

  } catch (error) {
    console.error(`  ✗ API Error: ${error.message}`);
    verificationResults.push({
      'CSV Contact ID': contactId,
      'CSV Contact Name': contact['Contact Name'],
      'CSV Duplicate Group': contact['Duplicate Group'],
      'API Contact Name': '',
      'Has Matters (API)': 'ERROR',
      'Matter Count (API)': 0,
      'Matter IDs': '',
      'Matter Descriptions': '',
      'Verification Status': `Failed: ${error.message}`
    });
  }
}

// Save verification results
const resultsCsv = stringify(verificationResults, { header: true });
fs.writeFileSync('./csv/verification-final-results.csv', resultsCsv);
console.log(`\n✓ Verification complete! Results saved to: ./csv/verification-final-results.csv`);

// Generate summary
const successCount = verificationResults.filter(r => r['Verification Status'] === 'Success').length;
const withMatters = verificationResults.filter(r => r['Has Matters (API)'] === 'YES').length;
const withoutMatters = verificationResults.filter(r => r['Has Matters (API)'] === 'NO').length;
const errors = verificationResults.filter(r => r['Has Matters (API)'] === 'ERROR').length;

console.log('\n=== Verification Summary ===');
console.log(`Total Verified: ${successCount}/${verificationResults.length}`);
console.log(`Contacts WITH matters: ${withMatters} ❌`);
console.log(`Contacts WITHOUT matters: ${withoutMatters} ✓`);
console.log(`API Errors: ${errors}`);

if (withMatters > 0) {
  console.log('\n⚠️  WARNING: Some contacts marked as "no matters" actually HAVE matters!');
  console.log('Check verification-final-results.csv for details.');
}
