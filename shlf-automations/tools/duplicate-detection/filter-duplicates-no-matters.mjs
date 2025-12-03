import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Read the duplicates with matters info CSV
const duplicatesWithMattersCsv = fs.readFileSync('./csv/duplicates-with-matters-info.csv', 'utf-8');
const duplicatesWithMatters = parse(duplicatesWithMattersCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total duplicate records: ${duplicatesWithMatters.length}`);

// Filter to only keep contacts that do NOT have matters
const duplicatesWithoutMatters = duplicatesWithMatters.filter(contact => {
  return contact['Has Matters'] === 'No';
});

console.log(`Duplicates without matters: ${duplicatesWithoutMatters.length}`);

// Save to CSV
if (duplicatesWithoutMatters.length > 0) {
  const outputCsv = stringify(duplicatesWithoutMatters, {
    header: true
  });

  fs.writeFileSync('./csv/duplicates-without-matters.csv', outputCsv);
  console.log('Saved to: ./csv/duplicates-without-matters.csv');
}

// Print summary
console.log('\n=== Summary ===');
console.log(`Total duplicates: ${duplicatesWithMatters.length}`);
console.log(`Duplicates WITH matters: ${duplicatesWithMatters.filter(d => d['Has Matters'] === 'Yes').length}`);
console.log(`Duplicates WITHOUT matters: ${duplicatesWithoutMatters.length}`);

// Count unique duplicate groups without matters
const groupsWithoutMatters = new Set(duplicatesWithoutMatters.map(d => d['Duplicate Group']));
console.log(`\nDuplicate groups without matters: ${groupsWithoutMatters.size}`);

// Show first 10 examples
console.log('\n=== First 10 Examples ===');
duplicatesWithoutMatters.slice(0, 10).forEach(contact => {
  console.log(`Group ${contact['Duplicate Group']}: ${contact['Contact Name']} (ID: ${contact['Contact ID']}), Phone: ${contact['Primary Phone']}, Email: ${contact['Primary Email']}`);
});
