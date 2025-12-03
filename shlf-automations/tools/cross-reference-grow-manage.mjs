import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Read Grow duplicates (no matters)
const growDuplicatesCsv = fs.readFileSync('./csv/grow-duplicates.csv', 'utf-8');
const growDuplicates = parse(growDuplicatesCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total Grow duplicates (no matters): ${growDuplicates.length}`);

// Read Clio Manage contacts
const manageContactsCsv = fs.readFileSync('./csv/contacts 2025-10-11 06-50-47.csv', 'utf-8');
const manageContacts = parse(manageContactsCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total Manage contacts: ${manageContacts.length}`);

// Helper - NO NORMALIZATION, only trim
const getValue = (val) => val?.trim() || '';

// Build index of Manage contacts for fast lookup
console.log('\nBuilding Manage contacts index...');
const manageIndex = new Map();

manageContacts.forEach(contact => {
  const firstName = getValue(contact['First Name']);
  const lastName = getValue(contact['Last Name']);
  const primaryEmail = getValue(contact['Primary Email Address']);
  const primaryPhone = getValue(contact['Primary Phone Number']);
  const secondaryPhone = getValue(contact['Secondary Phone Number']);

  if (firstName && lastName) {
    const nameKey = `${firstName}|${lastName}`;

    if (!manageIndex.has(nameKey)) {
      manageIndex.set(nameKey, []);
    }
    manageIndex.get(nameKey).push({
      contact,
      primaryEmail,
      primaryPhone,
      secondaryPhone
    });
  }
});

console.log(`Manage contacts indexed: ${manageIndex.size} unique names`);

// Cross-reference Grow duplicates with Manage contacts
console.log('\nCross-referencing...');
const matched = [];
const notMatched = [];

growDuplicates.forEach((growDup, idx) => {
  const firstName = getValue(growDup['First']);
  const lastName = getValue(growDup['Last']);
  const email = getValue(growDup['Primary Email']);
  const phone = getValue(growDup['Primary Phone']);
  const mobilePhone = getValue(growDup['Mobile Phone']);

  const nameKey = `${firstName}|${lastName}`;
  const manageMatches = manageIndex.get(nameKey);

  let foundMatch = false;

  if (manageMatches) {
    // Check if email or phone matches (exact, no normalization)
    for (const manageMatch of manageMatches) {
      const emailMatch = email && (
        email === manageMatch.primaryEmail
      );

      const phoneMatch = (phone && (
        phone === manageMatch.primaryPhone ||
        phone === manageMatch.secondaryPhone
      )) || (mobilePhone && (
        mobilePhone === manageMatch.primaryPhone ||
        mobilePhone === manageMatch.secondaryPhone
      ));

      if (emailMatch || phoneMatch) {
        foundMatch = true;
        matched.push({
          ...growDup,
          'Manage Contact ID': manageMatch.contact['ID'],
          'Manage Contact Name': `${manageMatch.contact['First Name']} ${manageMatch.contact['Last Name']}`,
          'Match Type': emailMatch ? 'Email' : 'Phone'
        });
        break;
      }
    }
  }

  if (!foundMatch) {
    notMatched.push(growDup);
  }

  // Progress indicator
  if ((idx + 1) % 500 === 0) {
    console.log(`  Processed ${idx + 1}/${growDuplicates.length}...`);
  }
});

console.log(`\n=== Cross-Reference Results ===`);
console.log(`Matched with Manage: ${matched.length} (${Math.round(matched.length/growDuplicates.length*100)}%)`);
console.log(`Not matched: ${notMatched.length} (${Math.round(notMatched.length/growDuplicates.length*100)}%)`);

// Save matched contacts
if (matched.length > 0) {
  const matchedCsv = stringify(matched, { header: true });
  fs.writeFileSync('./csv/grow-duplicates-matched-in-manage.csv', matchedCsv);
  console.log(`\n✓ Saved matched contacts to: ./csv/grow-duplicates-matched-in-manage.csv`);
}

// Save unmatched contacts
if (notMatched.length > 0) {
  const notMatchedCsv = stringify(notMatched, { header: true });
  fs.writeFileSync('./csv/grow-duplicates-not-in-manage.csv', notMatchedCsv);
  console.log(`✓ Saved unmatched contacts to: ./csv/grow-duplicates-not-in-manage.csv`);
}
