import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import type {
  ContactInfo,
  Family,
  PaymentStatus,
  Student,
} from '@cmt/shared-domain/check-in/family';
import { normalizeContact } from '../contact/normalize';

export { normalizeContact } from '../contact/normalize';

interface LegacyRosterStudent {
  sid?: string | number;
  fid?: string | number;
  fname?: string;
  lname?: string;
  plname?: string;
  level?: string;
  classid?: string;
  payment?: string;
  pemail?: string;
  email?: string;
  phphone?: string;
  pmphone?: string;
  phone?: string;
  // grade 99 identifies parent rows in the legacy RTDB roster schema
  grade?: number;
}

export async function findFamilyById(fid: string): Promise<Family | null> {
  const family = await readRtdb<Family>(`/families/${fid}`);
  if (family) {
    return family;
  }

  const roster = (await readRtdb<Record<string, LegacyRosterStudent>>('/roster')) ?? {};
  return familyFromRosterRows(
    Object.values(roster).filter((student) => fidMatches(student.fid, fid)),
  );
}

export async function findFamilyByContact(
  type: 'email' | 'phone',
  value: string,
): Promise<Family | null> {
  const target = normalizeContact(type, value);
  const all = (await readRtdb<Record<string, Family>>('/families')) ?? {};

  for (const family of Object.values(all)) {
    for (const contact of family.contacts ?? []) {
      if (contact.type !== type) continue;
      if (contactsMatch(type, normalizeContact(type, contact.value), target)) {
        return family;
      }
    }
  }

  const roster = (await readRtdb<Record<string, LegacyRosterStudent>>('/roster')) ?? {};
  const allRows = Object.values(roster);
  const matchingRow = allRows.find((student) =>
    rosterContactsFor(student).some((contact) => {
      if (contact.type !== type) return false;
      return contactsMatch(type, normalizeContact(type, contact.value), target);
    }),
  );

  if (!matchingRow?.fid) {
    return null;
  }

  return familyFromRosterRows(
    allRows.filter((student) => fidMatches(student.fid, String(matchingRow.fid))),
  );
}

function contactsMatch(type: 'email' | 'phone', candidate: string, target: string) {
  if (type === 'email') {
    return candidate === target;
  }

  return (
    candidate === target ||
    candidate === `1${target}` ||
    `1${candidate}` === target ||
    lastTenDigits(candidate) === lastTenDigits(target)
  );
}

function lastTenDigits(value: string) {
  return value.length >= 10 ? value.slice(-10) : value;
}

function familyFromRosterRows(rows: LegacyRosterStudent[]): Family | null {
  const first = rows[0];
  if (!first) {
    return null;
  }

  const fid = String(first.fid ?? '');
  if (!fid) {
    return null;
  }

  const parentRows = rows.filter((r) => r.grade === 99);
  const nameSource = parentRows[0] ?? first;
  const lastName = nameSource.plname || nameSource.lname;
  const contacts = uniqueContacts(contactRowsFor(rows).flatMap(rosterContactsFor));
  const students = rows
    .filter((r) => r.grade !== 99)
    .map(mapRosterStudent)
    .filter((student): student is Student => Boolean(student));

  return {
    fid,
    name: lastName ? `${lastName} family` : `Family ${fid}`,
    contacts,
    paymentStatus: paymentStatusFor(rows),
    students,
  };
}

function mapRosterStudent(student: LegacyRosterStudent): Student | null {
  const sid = String(student.sid ?? '');
  const fid = String(student.fid ?? '');
  if (!sid || !fid) {
    return null;
  }

  const mapped: Student = {
    sid,
    fid,
    firstName: student.fname ?? '',
    lastName: student.lname ?? '',
    level: student.level ?? '',
  };
  if (student.classid) {
    mapped.className = student.classid;
  }

  return mapped;
}

// Returns the rows to extract contacts from: parent rows (grade 99) when present,
// falling back to all rows with a warning if the roster lacks grade metadata.
function contactRowsFor(rows: LegacyRosterStudent[]): LegacyRosterStudent[] {
  const parents = rows.filter((r) => r.grade === 99);
  if (parents.length > 0) return parents;
  console.warn(
    'family-lookup: no parent rows (grade=99) found; falling back to all rows for contact extraction',
  );
  return rows;
}

function rosterContactsFor(student: LegacyRosterStudent): ContactInfo[] {
  const contacts: ContactInfo[] = [];
  for (const value of [student.pemail, student.email]) {
    if (value && value.trim().length > 0) {
      contacts.push({ type: 'email', value: value.trim() });
    }
  }
  for (const value of [student.phphone, student.pmphone, student.phone]) {
    if (value && value.trim().length > 0) {
      contacts.push({ type: 'phone', value: value.trim() });
    }
  }
  return contacts;
}

function uniqueContacts(contacts: ContactInfo[]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const key = `${contact.type}:${normalizeContact(contact.type, contact.value)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function paymentStatusFor(rows: LegacyRosterStudent[]): PaymentStatus {
  const raw = rows.map((row) => (row.payment ?? '').trim().toLowerCase());
  const known = raw.filter((s) => s.length > 0);
  if (known.length === 0) return 'partial'; // all unknown → warn
  if (known.some((p) => p.includes('unpaid') || p.includes('due'))) return 'unpaid';
  if (known.some((p) => p.includes('partial'))) return 'partial';
  // Some rows had unknown/empty values mixed with paid → warn (don't silently pass them off as paid)
  if (known.length < raw.length) return 'partial';
  if (known.every((p) => p.includes('paid'))) return 'paid';
  return 'partial';
}

// Numeric-coercing fid equality: handles stored-as-number vs string-with-leading-zero mismatches.
function fidMatches(stored: unknown, target: string): boolean {
  if (stored === undefined || stored === null) return false;
  const a = String(stored);
  if (a === target) return true;
  const an = Number(a);
  const bn = Number(target);
  if (!Number.isFinite(an) || !Number.isFinite(bn)) return false;
  return an === bn;
}
