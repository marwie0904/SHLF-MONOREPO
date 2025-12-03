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

// Read sample contacts
const sampleCsv = fs.readFileSync('./csv/sample-contacts-to-verify.csv', 'utf-8');
const sampleContacts = parse(sampleCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Verifying ${sampleContacts.length} contacts via Clio API...`);

const verificationResults = [];

for (let i = 0; i < sampleContacts.length; i++) {
  const contact = sampleContacts[i];
  const contactId = contact['Contact ID'];

  console.log(`\n[${i + 1}/${sampleContacts.length}] Verifying Contact ID: ${contactId} (${contact['Contact Name']})`);

  try {
    // Fetch contact details from Clio
    const contactUrl = `${CLIO_API_BASE_URL}/api/v4/contacts/${contactId}.json?fields=id,name,type,phone_numbers,email_addresses`;
    const contactData = await fetchClioAPI(contactUrl);
    const apiContact = contactData.data;

    // Fetch matters for this contact
    const mattersUrl = `${CLIO_API_BASE_URL}/api/v4/matters.json?fields=id,display_number,description&client_id=${contactId}&limit=200`;
    const mattersData = await fetchClioAPI(mattersUrl);
    const matters = mattersData.data || [];

    // Check for duplicates by searching for contacts with same name
    const searchName = apiContact.name || contact['Contact Name'];
    const searchUrl = `${CLIO_API_BASE_URL}/api/v4/contacts.json?fields=id,name,type,phone_numbers,email_addresses&query=${encodeURIComponent(searchName)}&limit=50`;
    const searchData = await fetchClioAPI(searchUrl);
    const searchResults = searchData.data || [];

    // Filter search results to find actual duplicates (same name + phone/email)
    const actualDuplicates = searchResults.filter(c => {
      if (c.id === apiContact.id) return false; // Skip self

      // Check name match
      const nameLower = (c.name || '').toLowerCase().trim();
      const apiNameLower = (apiContact.name || '').toLowerCase().trim();
      if (nameLower !== apiNameLower) return false;

      // Check phone or email match
      const apiPhones = (apiContact.phone_numbers || []).map(p => (p.number || '').replace(/[^\d]/g, ''));
      const cPhones = (c.phone_numbers || []).map(p => (p.number || '').replace(/[^\d]/g, ''));
      const apiEmails = (apiContact.email_addresses || []).map(e => (e.address || '').toLowerCase().trim());
      const cEmails = (c.email_addresses || []).map(e => (e.address || '').toLowerCase().trim());

      // Check if any phone matches
      for (const apiPhone of apiPhones) {
        if (apiPhone && apiPhone.length >= 7 && cPhones.includes(apiPhone)) {
          return true;
        }
      }

      // Check if any email matches
      for (const apiEmail of apiEmails) {
        if (apiEmail && cEmails.includes(apiEmail)) {
          return true;
        }
      }

      return false;
    });

    const result = {
      'CSV Contact ID': contactId,
      'CSV Contact Name': contact['Contact Name'],
      'CSV Phone': contact['Primary Phone'],
      'CSV Email': contact['Primary Email'],
      'CSV Duplicate Group': contact['Duplicate Group'],
      'API Contact Name': apiContact.name,
      'API Phones': (apiContact.phone_numbers || []).map(p => p.number).join('; '),
      'API Emails': (apiContact.email_addresses || []).map(e => e.address).join('; '),
      'Has Matters (API)': matters.length > 0 ? 'Yes' : 'No',
      'Matter Count (API)': matters.length,
      'Matter IDs': matters.map(m => m.display_number).join('; '),
      'Duplicates Found (API)': actualDuplicates.length,
      'Duplicate IDs': actualDuplicates.map(d => d.id).join('; '),
      'Duplicate Names': actualDuplicates.map(d => d.name).join('; '),
      'Verification Status': 'Success'
    };

    verificationResults.push(result);
    console.log(`  ✓ Has Matters: ${result['Has Matters (API)']} (${matters.length})`);
    console.log(`  ✓ Duplicates Found: ${actualDuplicates.length}`);

    // Rate limiting - wait 2 seconds between requests
    await delay(2000);

  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    verificationResults.push({
      'CSV Contact ID': contactId,
      'CSV Contact Name': contact['Contact Name'],
      'CSV Phone': contact['Primary Phone'],
      'CSV Email': contact['Primary Email'],
      'CSV Duplicate Group': contact['Duplicate Group'],
      'API Contact Name': '',
      'API Phones': '',
      'API Emails': '',
      'Has Matters (API)': 'Error',
      'Matter Count (API)': 0,
      'Matter IDs': '',
      'Duplicates Found (API)': 0,
      'Duplicate IDs': '',
      'Duplicate Names': '',
      'Verification Status': `Failed: ${error.message}`
    });
  }
}

// Save verification results
const resultsCsv = stringify(verificationResults, { header: true });
fs.writeFileSync('./csv/verification-results.csv', resultsCsv);
console.log(`\n✓ Verification complete! Results saved to: ./csv/verification-results.csv`);

// Generate summary
const successCount = verificationResults.filter(r => r['Verification Status'] === 'Success').length;
const withMatters = verificationResults.filter(r => r['Has Matters (API)'] === 'Yes').length;
const withoutMatters = verificationResults.filter(r => r['Has Matters (API)'] === 'No').length;
const withDuplicates = verificationResults.filter(r => parseInt(r['Duplicates Found (API)']) > 0).length;
const withoutDuplicates = verificationResults.filter(r => parseInt(r['Duplicates Found (API)']) === 0).length;

console.log('\n=== Verification Summary ===');
console.log(`Total Verified: ${successCount}/${verificationResults.length}`);
console.log(`Contacts WITH matters: ${withMatters}`);
console.log(`Contacts WITHOUT matters: ${withoutMatters}`);
console.log(`Contacts WITH duplicates: ${withDuplicates}`);
console.log(`Contacts WITHOUT duplicates: ${withoutDuplicates}`);
