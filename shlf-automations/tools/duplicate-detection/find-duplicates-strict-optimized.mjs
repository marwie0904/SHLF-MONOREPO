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

// Normalize values for comparison
const normalizeName = (name) => name?.toLowerCase().trim() || '';
const normalizePhone = (phone) => phone?.replace(/[^\d]/g, '') || '';
const normalizeEmail = (email) => email?.toLowerCase().trim() || '';

// Build indexes for faster lookup
console.log('Building indexes...');
const nameIndex = new Map(); // name -> [contact indexes]

contacts.forEach((contact, idx) => {
  const name = normalizeName(contact['Contact Name']);
  if (name) {
    if (!nameIndex.has(name)) {
      nameIndex.set(name, []);
    }
    nameIndex.get(name).push(idx);
  }
});

console.log(`Indexed ${nameIndex.size} unique names`);

// Find duplicates using index
console.log('Finding duplicates...');
const duplicateGroups = [];
const processed = new Set();

for (const [name, indexes] of nameIndex.entries()) {
  // Skip if only one contact with this name
  if (indexes.length < 2) continue;

  // Group contacts with same name by phone/email
  const groups = [];

  for (const idx of indexes) {
    if (processed.has(idx)) continue;

    const contact = contacts[idx];
    const primaryPhone = normalizePhone(contact['Primary Phone Number']);
    const secondaryPhone = normalizePhone(contact['Secondary Phone Number']);
    const primaryEmail = normalizeEmail(contact['Primary Email Address']);
    const secondaryEmail = normalizeEmail(contact['Secondary Email Address']);

    // Find matching group or create new one
    let matchedGroup = null;

    for (const group of groups) {
      // Check if this contact matches any contact in the group
      for (const groupContact of group) {
        const gPrimaryPhone = normalizePhone(groupContact['Primary Phone Number']);
        const gSecondaryPhone = normalizePhone(groupContact['Secondary Phone Number']);
        const gPrimaryEmail = normalizeEmail(groupContact['Primary Email Address']);
        const gSecondaryEmail = normalizeEmail(groupContact['Secondary Email Address']);

        let hasPhoneMatch = false;
        let hasEmailMatch = false;

        // Check phone matches (must be non-empty and at least 7 digits)
        if (primaryPhone && primaryPhone.length >= 7) {
          if (primaryPhone === gPrimaryPhone || primaryPhone === gSecondaryPhone) {
            hasPhoneMatch = true;
          }
        }
        if (secondaryPhone && secondaryPhone.length >= 7) {
          if (secondaryPhone === gPrimaryPhone || secondaryPhone === gSecondaryPhone) {
            hasPhoneMatch = true;
          }
        }

        // Check email matches (must be non-empty)
        if (primaryEmail) {
          if (primaryEmail === gPrimaryEmail || primaryEmail === gSecondaryEmail) {
            hasEmailMatch = true;
          }
        }
        if (secondaryEmail) {
          if (secondaryEmail === gPrimaryEmail || secondaryEmail === gSecondaryEmail) {
            hasEmailMatch = true;
          }
        }

        if (hasPhoneMatch || hasEmailMatch) {
          matchedGroup = group;
          break;
        }
      }
      if (matchedGroup) break;
    }

    if (matchedGroup) {
      matchedGroup.push(contact);
    } else {
      groups.push([contact]);
    }

    processed.add(idx);
  }

  // Add groups with 2+ contacts to duplicateGroups
  for (const group of groups) {
    if (group.length > 1) {
      duplicateGroups.push(group);
    }
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
