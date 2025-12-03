import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Read the duplicates CSV (final version)
const duplicatesCsv = fs.readFileSync('./csv/duplicate-contacts-final.csv', 'utf-8');
const duplicates = parse(duplicatesCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total duplicate records: ${duplicates.length}`);

// Read the matters CSV
const mattersCsv = fs.readFileSync('./csv/matters 2025-10-11 06-54-22.csv', 'utf-8');
const matters = parse(mattersCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total matters: ${matters.length}`);

// Create a Map of contact ID to their matters
const contactMattersMap = new Map();

matters.forEach(matter => {
  const clientId = matter['Client ID'];
  if (clientId) {
    if (!contactMattersMap.has(clientId)) {
      contactMattersMap.set(clientId, []);
    }
    contactMattersMap.get(clientId).push({
      matterId: matter['Unique ID'],
      matterNumber: matter['Display Number'],
      description: matter['Description'],
      status: matter['Status'],
      practiceArea: matter['Practice Area'],
      matterStage: matter['Matter stage']
    });
  }
});

console.log(`Contacts with matters: ${contactMattersMap.size}`);

// Enrich duplicates with matter information
const duplicatesWithMatters = duplicates.map(contact => {
  const contactId = contact['ID'];
  const contactMatters = contactMattersMap.get(contactId) || [];

  return {
    'Duplicate Group': contact['Duplicate Group'],
    'Contact ID': contactId,
    'Contact Name': contact['Contact Name'],
    'Primary Phone': contact['Primary Phone Number'],
    'Secondary Phone': contact['Secondary Phone Number'],
    'Primary Email': contact['Primary Email Address'],
    'Secondary Email': contact['Secondary Email Address'],
    'Has Matters': contactMatters.length > 0 ? 'Yes' : 'No',
    'Matter Count': contactMatters.length,
    'Matter IDs': contactMatters.map(m => m.matterNumber).join('; '),
    'Matter Descriptions': contactMatters.map(m => m.description).join('; '),
    'Matter Statuses': contactMatters.map(m => m.status).join('; '),
    'Practice Areas': contactMatters.map(m => m.practiceArea).join('; '),
    'Matter Stages': contactMatters.map(m => m.matterStage).join('; ')
  };
});

// Filter to only show duplicates that have matters
const duplicatesWithMattersOnly = duplicatesWithMatters.filter(d => d['Has Matters'] === 'Yes');

console.log(`\nDuplicates with matters: ${duplicatesWithMattersOnly.length} out of ${duplicatesWithMatters.length}`);

// Save all duplicates with matter info
const allOutputCsv = stringify(duplicatesWithMatters, {
  header: true
});
fs.writeFileSync('./csv/duplicates-with-matters-info.csv', allOutputCsv);
console.log('Saved all duplicates with matter info to: ./csv/duplicates-with-matters-info.csv');

// Save only duplicates that have matters
if (duplicatesWithMattersOnly.length > 0) {
  const withMattersOnlyCsv = stringify(duplicatesWithMattersOnly, {
    header: true
  });
  fs.writeFileSync('./csv/duplicates-with-matters-only.csv', withMattersOnlyCsv);
  console.log('Saved duplicates with matters only to: ./csv/duplicates-with-matters-only.csv');
}

// Print summary by duplicate group
console.log('\n=== Summary by Duplicate Group ===');
const groupSummary = new Map();

duplicatesWithMatters.forEach(dup => {
  const groupId = dup['Duplicate Group'];
  if (!groupSummary.has(groupId)) {
    groupSummary.set(groupId, {
      totalContacts: 0,
      contactsWithMatters: 0,
      totalMatters: 0
    });
  }
  const summary = groupSummary.get(groupId);
  summary.totalContacts++;
  if (dup['Has Matters'] === 'Yes') {
    summary.contactsWithMatters++;
    summary.totalMatters += dup['Matter Count'];
  }
});

// Print first 20 groups
let count = 0;
for (const [groupId, summary] of groupSummary.entries()) {
  if (count >= 20) break;
  console.log(`Group ${groupId}: ${summary.totalContacts} contacts, ${summary.contactsWithMatters} with matters (${summary.totalMatters} total matters)`);
  count++;
}
