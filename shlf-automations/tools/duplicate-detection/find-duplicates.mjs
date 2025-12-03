import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Read the contacts CSV
const csvContent = fs.readFileSync('./csv/contacts 2025-10-11 06-50-47.csv', 'utf-8');
const contacts = parse(csvContent, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total contacts: ${contacts.length}`);

// Find duplicates based on name, phone, or email
const duplicateGroups = [];
const processed = new Set();

for (let i = 0; i < contacts.length; i++) {
  if (processed.has(i)) continue;

  const contact = contacts[i];
  const duplicates = [contact];

  // Normalize values for comparison
  const normalizeName = (name) => name?.toLowerCase().trim() || '';
  const normalizePhone = (phone) => phone?.replace(/[^\d]/g, '') || '';
  const normalizeEmail = (email) => email?.toLowerCase().trim() || '';

  const name = normalizeName(contact['Contact Name']);
  const primaryPhone = normalizePhone(contact['Primary Phone Number']);
  const secondaryPhone = normalizePhone(contact['Secondary Phone Number']);
  const primaryEmail = normalizeEmail(contact['Primary Email Address']);
  const secondaryEmail = normalizeEmail(contact['Secondary Email Address']);

  // Skip if all fields are empty
  if (!name && !primaryPhone && !secondaryPhone && !primaryEmail && !secondaryEmail) {
    processed.add(i);
    continue;
  }

  // Find all duplicates for this contact
  for (let j = i + 1; j < contacts.length; j++) {
    if (processed.has(j)) continue;

    const compareContact = contacts[j];
    const compareName = normalizeName(compareContact['Contact Name']);
    const comparePrimaryPhone = normalizePhone(compareContact['Primary Phone Number']);
    const compareSecondaryPhone = normalizePhone(compareContact['Secondary Phone Number']);
    const comparePrimaryEmail = normalizeEmail(compareContact['Primary Email Address']);
    const compareSecondaryEmail = normalizeEmail(compareContact['Secondary Email Address']);

    let isDuplicate = false;

    // Check name match (must be non-empty)
    if (name && compareName && name === compareName) {
      isDuplicate = true;
    }

    // Check phone matches (must be non-empty and at least 7 digits)
    if (primaryPhone && primaryPhone.length >= 7) {
      if (primaryPhone === comparePrimaryPhone || primaryPhone === compareSecondaryPhone) {
        isDuplicate = true;
      }
    }
    if (secondaryPhone && secondaryPhone.length >= 7) {
      if (secondaryPhone === comparePrimaryPhone || secondaryPhone === compareSecondaryPhone) {
        isDuplicate = true;
      }
    }

    // Check email matches (must be non-empty)
    if (primaryEmail && primaryEmail) {
      if (primaryEmail === comparePrimaryEmail || primaryEmail === compareSecondaryEmail) {
        isDuplicate = true;
      }
    }
    if (secondaryEmail && secondaryEmail) {
      if (secondaryEmail === comparePrimaryEmail || secondaryEmail === compareSecondaryEmail) {
        isDuplicate = true;
      }
    }

    if (isDuplicate) {
      duplicates.push(compareContact);
      processed.add(j);
    }
  }

  processed.add(i);

  // Only add to duplicateGroups if we found actual duplicates (2 or more)
  if (duplicates.length > 1) {
    duplicateGroups.push(duplicates);
  }
}

console.log(`Found ${duplicateGroups.length} duplicate groups`);

// Flatten all duplicates into a single array with group markers
const allDuplicates = [];
duplicateGroups.forEach((group, groupIndex) => {
  group.forEach(contact => {
    allDuplicates.push({
      'Duplicate Group': groupIndex + 1,
      ...contact
    });
  });
});

console.log(`Total duplicate records: ${allDuplicates.length}`);

// Write duplicates to CSV
if (allDuplicates.length > 0) {
  const outputCsv = stringify(allDuplicates, {
    header: true
  });

  fs.writeFileSync('./csv/duplicate-contacts.csv', outputCsv);
  console.log('Duplicates saved to ./csv/duplicate-contacts.csv');

  // Print summary
  console.log('\nDuplicate Summary:');
  duplicateGroups.forEach((group, idx) => {
    console.log(`\nGroup ${idx + 1} (${group.length} contacts):`);
    group.forEach(c => {
      console.log(`  - ID: ${c.ID}, Name: ${c['Contact Name']}, Phone: ${c['Primary Phone Number'] || c['Secondary Phone Number']}, Email: ${c['Primary Email Address']}`);
    });
  });
} else {
  console.log('No duplicates found!');
}
