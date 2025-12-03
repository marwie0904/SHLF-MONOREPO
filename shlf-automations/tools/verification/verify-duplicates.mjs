import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Read the duplicates without matters CSV
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

console.log(`Selected ${sample.length} random contacts for verification`);

// Get unique contact IDs for API verification
const contactIds = sample.map(c => c['Contact ID']);

// Save sample to CSV for reference
const sampleCsv = stringify(sample, { header: true });
fs.writeFileSync('./csv/sample-contacts-to-verify.csv', sampleCsv);
console.log('Sample contacts saved to: ./csv/sample-contacts-to-verify.csv');

// Output contact IDs for API querying
console.log('\n=== Contact IDs to verify ===');
console.log(contactIds.join(','));

// Save as JSON for the next script
fs.writeFileSync('./csv/contact-ids-to-verify.json', JSON.stringify(contactIds, null, 2));
console.log('\nContact IDs saved to: ./csv/contact-ids-to-verify.json');
