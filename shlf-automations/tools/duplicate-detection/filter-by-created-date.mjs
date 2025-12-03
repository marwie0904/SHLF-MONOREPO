import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Read the original contacts CSV to get the Contact Created Date field
const contactsCsv = fs.readFileSync('./csv/contacts 2025-10-11 06-50-47.csv', 'utf-8');
const contacts = parse(contactsCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

// Create a map of Contact ID -> Contact Created Date
const contactDateMap = new Map();
contacts.forEach(contact => {
  const contactId = contact['ID'];
  const createdDate = contact['Contact Created Date'];
  if (contactId && createdDate) {
    contactDateMap.set(contactId, createdDate);
  }
});

console.log(`Total contacts in original CSV: ${contacts.length}`);
console.log(`Contacts with created date: ${contactDateMap.size}`);

// Read the verified no-matters CSV
const verifiedCsv = fs.readFileSync('./csv/duplicates-verified-no-matters.csv', 'utf-8');
const verifiedDuplicates = parse(verifiedCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total verified duplicates: ${verifiedDuplicates.length}`);

// Filter by date: 07/08/2025 (match just the date part, not time)
const targetDate = '07/08/2025';
const filteredDuplicates = verifiedDuplicates.filter(dup => {
  const contactId = dup['Contact ID'];
  const createdDate = contactDateMap.get(contactId);
  // Match just the date part (MM/DD/YYYY)
  return createdDate && createdDate.startsWith(targetDate);
});

console.log(`\nFiltered to contacts created on ${targetDate}: ${filteredDuplicates.length}`);

// Save filtered results
if (filteredDuplicates.length > 0) {
  const outputCsv = stringify(filteredDuplicates, { header: true });
  fs.writeFileSync('./csv/duplicates-created-07-08-2025.csv', outputCsv);
  console.log(`✓ Saved to: ./csv/duplicates-created-07-08-2025.csv`);
} else {
  console.log('⚠️  No contacts found with that creation date.');
}
