import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Read Grow contacts CSV
const growContactsCsv = fs.readFileSync('./csv/Contacts_GROW_2025-10-12 05-31-32.csv', 'utf-8');
const growContacts = parse(growContactsCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total Grow contacts: ${growContacts.length}`);

// Read Grow matters CSV
const growMattersCsv = fs.readFileSync('./csv/Matters_GROW_2025-10-12 05-31-21.csv', 'utf-8');
const growMatters = parse(growMattersCsv, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Total Grow matters: ${growMatters.length}`);

// Helper to normalize values
const normalize = (val) => val?.trim().toLowerCase() || '';

// Build a Set of contacts that have matters
// Use multiple identifiers: name, email, phone
const contactsWithMatters = new Set();

growMatters.forEach(matter => {
  // Extract matter contact info from Grow matters CSV
  const firstName = normalize(matter['First Name']);
  const lastName = normalize(matter['Last Name']);
  const email = normalize(matter['Primary Contact Email']);
  const phone = normalize(matter['Primary Contact Phone Number']);

  if (firstName && lastName) {
    // Create multiple identifiers for matching
    const nameKey = `${firstName}|${lastName}`;
    contactsWithMatters.add(nameKey);

    if (email) {
      contactsWithMatters.add(`${nameKey}|${email}`);
    }
    if (phone) {
      contactsWithMatters.add(`${nameKey}|${phone}`);
    }
  }
});

console.log(`Unique contact identifiers with matters: ${contactsWithMatters.size}`);

// Filter contacts - keep only those WITHOUT matters
const contactsWithoutMatters = growContacts.filter(contact => {
  const firstName = normalize(contact['First']);
  const lastName = normalize(contact['Last']);
  const email = normalize(contact['Primary Email']);
  const phone = normalize(contact['Primary Phone']);

  if (!firstName || !lastName) {
    // Keep contacts with incomplete names for manual review
    return true;
  }

  const nameKey = `${firstName}|${lastName}`;

  // Check if this contact has matters using any identifier
  if (contactsWithMatters.has(nameKey)) {
    // If name matches, check if we can disambiguate with email/phone
    const emailKey = email ? `${nameKey}|${email}` : null;
    const phoneKey = phone ? `${nameKey}|${phone}` : null;

    if (emailKey && contactsWithMatters.has(emailKey)) {
      return false; // Has matters
    }
    if (phoneKey && contactsWithMatters.has(phoneKey)) {
      return false; // Has matters
    }

    // Name matches but no email/phone match - keep for manual review
    return true;
  }

  // No name match - no matters
  return true;
});

console.log(`\nContacts WITHOUT matters: ${contactsWithoutMatters.length}`);
console.log(`Contacts WITH matters (removed): ${growContacts.length - contactsWithoutMatters.length}`);

// Save results
const outputCsv = stringify(contactsWithoutMatters, { header: true });
fs.writeFileSync('./csv/grow-contacts-without-matters.csv', outputCsv);
console.log(`\n✓ Saved to: ./csv/grow-contacts-without-matters.csv`);
