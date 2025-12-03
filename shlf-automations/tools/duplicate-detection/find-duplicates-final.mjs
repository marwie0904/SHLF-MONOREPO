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

// Helper to get trimmed value
const getValue = (val) => val?.trim() || '';

// Check if two contacts are duplicates based on new logic
function areDuplicates(contact1, contact2) {
  const firstName1 = getValue(contact1['First Name']);
  const lastName1 = getValue(contact1['Last Name']);
  const primaryPhone1 = getValue(contact1['Primary Phone Number']);
  const secondaryPhone1 = getValue(contact1['Secondary Phone Number']);
  const primaryEmail1 = getValue(contact1['Primary Email Address']);

  const firstName2 = getValue(contact2['First Name']);
  const lastName2 = getValue(contact2['Last Name']);
  const primaryPhone2 = getValue(contact2['Primary Phone Number']);
  const secondaryPhone2 = getValue(contact2['Secondary Phone Number']);
  const primaryEmail2 = getValue(contact2['Primary Email Address']);

  if (firstName1 && lastName1 && firstName2 && lastName2) {
    // Both contacts have first and last names
    if (firstName1 === firstName2 && lastName1 === lastName2) {
      // Names match - now check contact methods

      const hasPhone1 = primaryPhone1 || secondaryPhone1;
      const hasPhone2 = primaryPhone2 || secondaryPhone2;
      const hasEmail1 = primaryEmail1;
      const hasEmail2 = primaryEmail2;
      const hasContactMethod1 = hasPhone1 || hasEmail1;
      const hasContactMethod2 = hasPhone2 || hasEmail2;

      if (!hasContactMethod1 || !hasContactMethod2) {
        // At least one has no contact method - it's a duplicate based on name alone
        return true;
      } else {
        // Both have phone/email - must match phone OR email
        let phoneMatch = false;
        let emailMatch = false;

        // Check all phone combinations
        if (primaryPhone1 && (primaryPhone1 === primaryPhone2 || primaryPhone1 === secondaryPhone2)) {
          phoneMatch = true;
        }
        if (secondaryPhone1 && (secondaryPhone1 === primaryPhone2 || secondaryPhone1 === secondaryPhone2)) {
          phoneMatch = true;
        }

        // Check email match
        if (primaryEmail1 && primaryEmail2 && primaryEmail1 === primaryEmail2) {
          emailMatch = true;
        }

        return phoneMatch || emailMatch;
      }
    }
  } else {
    // At least one contact is missing first or last name
    // Match whatever exists

    const name1 = firstName1 && lastName1 ? `${firstName1} ${lastName1}` : (firstName1 || lastName1 || '');
    const name2 = firstName2 && lastName2 ? `${firstName2} ${lastName2}` : (firstName2 || lastName2 || '');

    if (name1 && name2 && name1 === name2) {
      // Names match - check phone or email
      let phoneMatch = false;
      let emailMatch = false;

      if (primaryPhone1 && (primaryPhone1 === primaryPhone2 || primaryPhone1 === secondaryPhone2)) {
        phoneMatch = true;
      }
      if (secondaryPhone1 && (secondaryPhone1 === primaryPhone2 || secondaryPhone1 === secondaryPhone2)) {
        phoneMatch = true;
      }
      if (primaryEmail1 && primaryEmail2 && primaryEmail1 === primaryEmail2) {
        emailMatch = true;
      }

      return phoneMatch || emailMatch;
    }
  }

  return false;
}

// Build index by first name + last name for faster lookup
console.log('Building indexes...');
const nameIndex = new Map(); // "FirstName LastName" -> [contact indexes]

contacts.forEach((contact, idx) => {
  const firstName = getValue(contact['First Name']);
  const lastName = getValue(contact['Last Name']);
  const key = firstName && lastName ? `${firstName}|${lastName}` : (firstName || lastName || '');

  if (key) {
    if (!nameIndex.has(key)) {
      nameIndex.set(key, []);
    }
    nameIndex.get(key).push(idx);
  }
});

console.log(`Indexed ${nameIndex.size} unique name combinations`);

// Find duplicates using index
console.log('Finding duplicates...');
const duplicateGroups = [];
const processed = new Set();

for (const [nameKey, indexes] of nameIndex.entries()) {
  // Skip if only one contact with this name
  if (indexes.length < 2) continue;

  // Group contacts that are duplicates
  const groups = [];

  for (const idx of indexes) {
    if (processed.has(idx)) continue;

    const contact = contacts[idx];
    let matchedGroup = null;

    // Check if this contact matches any existing group
    for (const group of groups) {
      for (const groupContact of group) {
        if (areDuplicates(contact, groupContact)) {
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

  fs.writeFileSync('./csv/duplicate-contacts-final.csv', outputCsv);
  console.log('Duplicates saved to ./csv/duplicate-contacts-final.csv');

  // Print summary
  console.log('\nDuplicate Summary (first 20 groups):');
  duplicateGroups.slice(0, 20).forEach((group, idx) => {
    console.log(`\nGroup ${idx + 1} (${group.length} contacts):`);
    group.forEach(c => {
      console.log(`  - ID: ${c.ID}, Name: ${c['First Name']} ${c['Last Name']}, Phone: ${c['Primary Phone Number'] || c['Secondary Phone Number']}, Email: ${c['Primary Email Address']}`);
    });
  });
} else {
  console.log('No duplicates found!');
}
