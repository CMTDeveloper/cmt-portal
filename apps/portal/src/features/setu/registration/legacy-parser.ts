import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';

/**
 * Migration-focused parser for the legacy /roster RTDB shape.
 *
 * The check-in feature has its own `family-lookup.ts` that flattens the
 * roster into the Family/Student shape it needs (mostly student-row-keyed).
 * Migration needs more: per-row gender, multiple parent (grade=99) rows,
 * the family's `center` (location), the denormalized `pfname/plname/pemail`
 * primary-contact tuple, and emergency contact fields. Rather than bloating
 * the check-in Family type, this lives separately and reads /roster directly.
 *
 * Legacy roster row schema (from real prod RTDB, captured 2026-05-25):
 *   sid, fid, fname, lname, gender ("M"|"F"|""), grade (99 = parent),
 *   pfname, plname, pemail, phphone, pmphone (primary-contact tuple,
 *     duplicated on every row of the family),
 *   email, phone (this row's own contacts; often "NULL"),
 *   center ("Brampton"|"Mississauga"|"Scarborough"|"Markham"),
 *   level, classid, classyear, dob_m (month-of-birth number),
 *   payment, family_join_date, std_join_date,
 *   emergency_name, emergency_email, emergency_hphone, emergency_mphone.
 * String "NULL" is used as a missing-value sentinel — treat as null.
 */

const VALID_LOCATIONS = ['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const;
export type LegacyLocation = (typeof VALID_LOCATIONS)[number];

interface LegacyRosterRow {
  sid?: string | number;
  fid?: string | number;
  fname?: string;
  lname?: string;
  pfname?: string;
  plname?: string;
  gender?: string;
  grade?: number | string;
  level?: string;
  classid?: string;
  classyear?: string;
  payment?: string;
  email?: string | number;
  phone?: string | number;
  pemail?: string | number;
  phphone?: string | number;
  pmphone?: string | number;
  center?: string;
  dob_m?: number | string;
  emergency_name?: string;
  emergency_email?: string;
  emergency_hphone?: string;
  emergency_mphone?: string;
}

export type LegacyGender = 'Male' | 'Female' | 'PreferNotToSay';

export interface LegacyAdult {
  firstName: string;
  lastName: string;
  gender: LegacyGender;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface LegacyChild {
  firstName: string;
  lastName: string;
  gender: LegacyGender;
  schoolGrade: string | null;
  // Legacy roster student id — maps this child to the check-in app's
  // family-check-ins records (which key students by sid).
  legacySid: string | null;
}

export interface LegacyFamilyForMigration {
  legacyFid: string;
  familyName: string;
  location: LegacyLocation;
  primaryFirstName: string;
  primaryLastName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  adults: LegacyAdult[];
  children: LegacyChild[];
}

function clean(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s.length === 0) return null;
  if (s.toUpperCase() === 'NULL') return null;
  return s;
}

function mapGender(value: unknown): LegacyGender {
  const s = clean(value);
  if (!s) return 'PreferNotToSay';
  const upper = s.toUpperCase();
  if (upper === 'M' || upper === 'MALE') return 'Male';
  if (upper === 'F' || upper === 'FEMALE') return 'Female';
  return 'PreferNotToSay';
}

function mapLocation(value: unknown): LegacyLocation {
  const s = clean(value);
  if (s && (VALID_LOCATIONS as readonly string[]).includes(s)) return s as LegacyLocation;
  return 'Brampton';
}

function mapSchoolGrade(row: LegacyRosterRow): string | null {
  const gradeNum = Number(row.grade);
  if (Number.isFinite(gradeNum) && gradeNum >= 1 && gradeNum <= 13) {
    return String(gradeNum);
  }
  return clean(row.level);
}

function isFidMatch(stored: unknown, target: string): boolean {
  if (stored === null || stored === undefined) return false;
  const a = String(stored);
  if (a === target) return true;
  const an = Number(a);
  const bn = Number(target);
  if (!Number.isFinite(an) || !Number.isFinite(bn)) return false;
  return an === bn;
}

export function parseLegacyRowsForMigration(
  rows: LegacyRosterRow[],
  legacyFid: string,
): LegacyFamilyForMigration | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;

  const primaryFirstName = clean(first.pfname) ?? '';
  const primaryLastName = clean(first.plname) ?? clean(first.lname) ?? '';
  const primaryEmail = clean(first.pemail);
  const primaryPhone = clean(first.phphone) ?? clean(first.pmphone);
  const familyName = primaryLastName ? `${primaryLastName} family` : `Family ${legacyFid}`;

  const adultRows = rows.filter((r) => Number(r.grade) === 99);
  const childRows = rows.filter((r) => Number(r.grade) !== 99);

  function isPrimaryRow(r: LegacyRosterRow): boolean {
    if (!primaryFirstName || !primaryLastName) return false;
    const fn = clean(r.fname);
    const ln = clean(r.lname);
    if (!fn || !ln) return false;
    return (
      fn.toLowerCase() === primaryFirstName.toLowerCase() &&
      ln.toLowerCase() === primaryLastName.toLowerCase()
    );
  }

  const adults: LegacyAdult[] = adultRows.map((r) => ({
    firstName: clean(r.fname) ?? '',
    lastName: clean(r.lname) ?? '',
    gender: mapGender(r.gender),
    email: clean(r.email),
    phone: clean(r.phone),
    isPrimary: isPrimaryRow(r),
  }));

  // If no adult row matched the primary tuple, synthesize one from pfname/plname
  // so the family doesn't end up manager-less.
  if (!adults.some((a) => a.isPrimary) && primaryFirstName && primaryLastName) {
    adults.unshift({
      firstName: primaryFirstName,
      lastName: primaryLastName,
      gender: 'PreferNotToSay',
      email: primaryEmail,
      phone: primaryPhone,
      isPrimary: true,
    });
  }

  // Move primary to position 0 for predictable manager assignment.
  adults.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  // Backfill the primary's contacts from the family-level pemail/phphone if
  // their own row was missing email/phone (common — only the primary's own
  // student/adult row has email; the rest are "NULL").
  if (adults.length > 0 && adults[0]!.isPrimary) {
    if (!adults[0]!.email) adults[0]!.email = primaryEmail;
    if (!adults[0]!.phone) adults[0]!.phone = primaryPhone;
  }

  const children: LegacyChild[] = childRows.map((r) => ({
    firstName: clean(r.fname) ?? '',
    lastName: clean(r.lname) ?? primaryLastName,
    gender: mapGender(r.gender),
    schoolGrade: mapSchoolGrade(r),
    legacySid: r.sid != null ? String(r.sid) : null,
  }));

  return {
    legacyFid,
    familyName,
    location: mapLocation(first.center),
    primaryFirstName,
    primaryLastName,
    primaryEmail,
    primaryPhone,
    adults,
    children,
  };
}

export async function fetchLegacyFamilyForMigration(
  legacyFid: string,
): Promise<LegacyFamilyForMigration | null> {
  const roster = (await readRtdb<Record<string, LegacyRosterRow>>('/roster')) ?? {};
  const rows = Object.values(roster).filter((r) => isFidMatch(r.fid, legacyFid));
  return parseLegacyRowsForMigration(rows, legacyFid);
}
