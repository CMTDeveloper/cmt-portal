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
  level?: string;
  classid?: string;
  payment?: string;
  pemail?: string;
  email?: string;
  phphone?: string;
  pmphone?: string;
  phone?: string;
  plname?: string;
}

export async function findFamilyById(fid: string): Promise<Family | null> {
  const family = await readRtdb<Family>(`/families/${fid}`);
  if (family) {
    return family;
  }

  const roster = (await readRtdb<Record<string, LegacyRosterStudent>>('/roster')) ?? {};
  return familyFromRosterRows(
    Object.values(roster).filter((student) => String(student.fid ?? '') === fid),
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
  const matchingRow = Object.values(roster).find((student) =>
    rosterContactsFor(student).some((contact) => {
      if (contact.type !== type) return false;
      return contactsMatch(type, normalizeContact(type, contact.value), target);
    }),
  );

  if (!matchingRow?.fid) {
    return null;
  }

  return familyFromRosterRows(
    Object.values(roster).filter((student) => String(student.fid ?? '') === String(matchingRow.fid)),
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
  if (rows.length === 0) {
    return null;
  }

  const first = rows[0];
  const fid = String(first?.fid ?? '');
  if (!fid) {
    return null;
  }

  const lastName = first?.lname || first?.plname;
  const contacts = uniqueContacts(rows.flatMap(rosterContactsFor));
  const students = rows
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

function rosterContactsFor(student: LegacyRosterStudent): ContactInfo[] {
  const contacts: ContactInfo[] = [];
  for (const value of [student.pemail, student.email]) {
    if (value) {
      contacts.push({ type: 'email', value });
    }
  }
  for (const value of [student.phphone, student.pmphone, student.phone]) {
    if (value) {
      contacts.push({ type: 'phone', value });
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
  const statuses = rows.map((row) => (row.payment ?? '').toLowerCase());
  if (statuses.some((payment) => payment.includes('unpaid') || payment.includes('due'))) {
    return 'unpaid';
  }
  if (statuses.some((payment) => payment.includes('partial'))) {
    return 'partial';
  }
  return 'paid';
}
