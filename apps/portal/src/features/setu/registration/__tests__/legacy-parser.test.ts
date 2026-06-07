import { describe, it, expect } from 'vitest';
import { parseLegacyRowsForMigration } from '../legacy-parser';

// Each row mirrors the real /roster shape captured from prod RTDB 2026-05-25.
function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    center: 'Brampton',
    classid: 'NULL',
    classyear: 'NULL',
    dob_m: 'NULL',
    email: 'NULL',
    emergency_email: 'NULL',
    emergency_hphone: 'NULL',
    emergency_mphone: 'NULL',
    emergency_name: 'NULL',
    fid: 42,
    fname: '',
    gender: '',
    grade: 1,
    level: 'NULL',
    lname: '',
    payment: 'Paid',
    pemail: 'manager@example.com',
    pfname: 'Asha',
    phone: 'NULL',
    phphone: '4165550100',
    plname: 'Shah',
    pmphone: '4165550101',
    sid: 1,
    ...overrides,
  };
}

describe('parseLegacyRowsForMigration', () => {
  it('returns null for an empty row list', () => {
    expect(parseLegacyRowsForMigration([], '42')).toBeNull();
  });

  it('extracts location from center', () => {
    const result = parseLegacyRowsForMigration(
      [row({ center: 'Mississauga', grade: 99, fname: 'Asha', lname: 'Shah' })],
      '42',
    );
    expect(result?.location).toBe('Mississauga');
  });

  it('defaults to Brampton when center is unknown', () => {
    const result = parseLegacyRowsForMigration(
      [row({ center: 'Atlantis', grade: 99, fname: 'Asha', lname: 'Shah' })],
      '42',
    );
    expect(result?.location).toBe('Brampton');
  });

  it('treats string "NULL" as missing for email and phone', () => {
    const result = parseLegacyRowsForMigration(
      [row({ grade: 99, fname: 'Asha', lname: 'Shah', email: 'NULL', phone: 'NULL' })],
      '42',
    );
    expect(result?.adults[0]?.email).toBe('manager@example.com'); // backfilled from pemail
    expect(result?.adults[0]?.phone).toBe('4165550100'); // backfilled from phphone
  });

  it('maps gender M/F to Male/Female and empty to PreferNotToSay', () => {
    const result = parseLegacyRowsForMigration(
      [
        row({ grade: 99, fname: 'Asha', lname: 'Shah', gender: 'F' }),
        row({ grade: 99, fname: 'Ravi', lname: 'Shah', gender: 'M', sid: 2 }),
        row({ grade: 99, fname: 'Other', lname: 'Shah', gender: '', sid: 3 }),
      ],
      '42',
    );
    const byName = Object.fromEntries((result?.adults ?? []).map((a) => [a.firstName, a.gender]));
    expect(byName.Asha).toBe('Female');
    expect(byName.Ravi).toBe('Male');
    expect(byName.Other).toBe('PreferNotToSay');
  });

  it('marks the primary adult as manager based on matching pfname/plname', () => {
    const result = parseLegacyRowsForMigration(
      [
        row({ grade: 99, fname: 'Spouse', lname: 'Shah', sid: 1 }),
        row({ grade: 99, fname: 'Asha', lname: 'Shah', sid: 2 }),
      ],
      '42',
    );
    expect(result?.adults[0]?.firstName).toBe('Asha'); // primary sorted to front
    expect(result?.adults[0]?.isPrimary).toBe(true);
    expect(result?.adults[1]?.isPrimary).toBe(false);
  });

  it('synthesizes a primary adult when no row matches the primary tuple', () => {
    const result = parseLegacyRowsForMigration(
      [row({ grade: 99, fname: 'Spouse', lname: 'Verma' })], // doesn't match Asha Shah
      '42',
    );
    expect(result?.adults).toHaveLength(2);
    expect(result?.adults[0]).toMatchObject({
      firstName: 'Asha',
      lastName: 'Shah',
      isPrimary: true,
      email: 'manager@example.com',
      phone: '4165550100',
    });
    expect(result?.adults[1]?.isPrimary).toBe(false);
  });

  it('maps numeric grades 1-12 to the bare number', () => {
    const result = parseLegacyRowsForMigration(
      [
        row({ grade: 99, fname: 'Asha', lname: 'Shah', sid: 1 }),
        row({ grade: 3, fname: 'Kid1', lname: 'Shah', level: 'Level 2', sid: 2 }),
        row({ grade: 12, fname: 'Kid2', lname: 'Shah', level: 'Level 9', sid: 3 }),
      ],
      '42',
    );
    expect(result?.children).toHaveLength(2);
    expect(result?.children[0]?.schoolGrade).toBe('3');
    expect(result?.children[1]?.schoolGrade).toBe('12');
  });

  it('maps grade -1 → "JK" and grade 0 → "SK" (Pre-Level band accepts both)', () => {
    const result = parseLegacyRowsForMigration(
      [
        row({ grade: 99, fname: 'Asha', lname: 'Shah', sid: 1 }),
        // JK/SK kids carry a "Pre L1 (Gr JK-SK)" level blob we must NOT store.
        row({ grade: -1, fname: 'KidJK', lname: 'Shah', level: 'Pre L1 (Gr JK-SK)', sid: 2 }),
        row({ grade: 0, fname: 'KidSK', lname: 'Shah', level: 'Pre L1 (Gr JK-SK)', sid: 3 }),
      ],
      '42',
    );
    expect(result?.children).toHaveLength(2);
    expect(result?.children[0]?.schoolGrade).toBe('JK');
    expect(result?.children[1]?.schoolGrade).toBe('SK');
  });

  it('leaves shishu (grade -2) and unknown (grade 14, level NULL) as null', () => {
    const result = parseLegacyRowsForMigration(
      [
        row({ grade: 99, fname: 'Asha', lname: 'Shah', sid: 1 }),
        // Shishu is age-based (no school grade) and carries a "Shishu E/W (Pre-K)" blob.
        row({ grade: -2, fname: 'KidShishu', lname: 'Shah', level: 'Shishu E/W (Pre-K)', sid: 2 }),
        // grade 14 alumni/edge with no level band.
        row({ grade: 14, fname: 'KidEdge', lname: 'Shah', level: 'NULL', sid: 3 }),
      ],
      '42',
    );
    expect(result?.children).toHaveLength(2);
    expect(result?.children[0]?.schoolGrade).toBeNull();
    expect(result?.children[1]?.schoolGrade).toBeNull();
  });

  it('children inherit lastName from primary when their own lname is empty', () => {
    const result = parseLegacyRowsForMigration(
      [
        row({ grade: 99, fname: 'Asha', lname: 'Shah', sid: 1 }),
        row({ grade: 5, fname: 'Kid', lname: '', sid: 2 }),
      ],
      '42',
    );
    expect(result?.children[0]?.lastName).toBe('Shah');
  });

  it('builds a family name from the primary lastName', () => {
    const result = parseLegacyRowsForMigration(
      [row({ grade: 99, fname: 'Asha', lname: 'Shah', sid: 1 })],
      '42',
    );
    expect(result?.familyName).toBe('Shah family');
  });
});
