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

// Find duplicates based on: NAME match AND (phone OR email match)
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

  // Skip if name is empty
  if (!name) {
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

    // MUST have name match
    if (!compareName || name !== compareName) {
      continue;
    }

    // Now check if phone OR email matches
    let hasPhoneMatch = false;
    let hasEmailMatch = false;

    // Check phone matches (must be non-empty and at least 7 digits)
    if (primaryPhone && primaryPhone.length >= 7) {
      if (primaryPhone === comparePrimaryPhone || primaryPhone === compareSecondaryPhone) {
        hasPhoneMatch = true;
      }
    }
    if (secondaryPhone && secondaryPhone.length >= 7) {
      if (secondaryPhone === comparePrimaryPhone || secondaryPhone === compareSecondaryPhone) {
        hasPhoneMatch = true;
      }
    }

    // Check email matches (must be non-empty)
    if (primaryEmail && primaryEmail) {
      if (primaryEmail === comparePrimaryEmail || primaryEmail === compareSecondaryEmail) {
        hasEmailMatch = true;
      }
    }
    if (secondaryEmail && secondaryEmail) {
      if (secondaryEmail === comparePrimaryEmail || secondaryEmail === compareSecondaryEmail) {
        hasEmailMatch = true;
      }
    }

    // Name match AND (phone OR email match)
    if (hasPhoneMatch || hasEmailMatch) {
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

  fs.writeFileSync('./csv/duplicate-contacts-strict.csv', outputCsv);
  console.log('Duplicates saved to ./csv/duplicate-contacts-strict.csv');

  // Print summary
  console.log('\nDuplicate Summary (first 20 groups):');
  duplicateGroups.slice(0, 20).forEach((group, idx) => {
    console.log(`\nGroup ${idx + 1} (${group.length} contacts):`);
    group.forEach(c => {
      console.log(`  - ID: ${c.ID}, Name: ${c['Contact Name']}, Phone: ${c['Primary Phone Number'] || c['Secondary Phone Number']}, Email: ${c['Primary Email Address']}`);
    });
  });
} else {
  console.log('No duplicates found!');
}
