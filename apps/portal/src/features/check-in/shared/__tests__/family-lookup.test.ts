import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import {
  findFamilyById,
  findFamilyByContact,
  normalizeContact,
} from '../rtdb/family-lookup';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('findFamilyById', () => {
  it('reads /families/{fid} and returns the family', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'paid',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      students: [],
    });
    const family = await findFamilyById('42');
    expect(readRtdb).toHaveBeenCalledWith('/families/42');
    expect(family?.fid).toBe('42');
  });

  it('returns null when not found', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({});
    const family = await findFamilyById('999');
    expect(family).toBeNull();
  });

  it('falls back to /roster and maps legacy roster rows into a family', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        studentA: {
          sid: 1001,
          fid: 42,
          fname: 'Anika',
          lname: 'Rao',
          level: 'Bala Vihar 3',
          classid: 'BV3-A',
          payment: 'paid',
          pemail: 'Parent@Example.com',
          phphone: '(647) 555-0100',
          pmphone: '',
        },
        studentB: {
          sid: 1002,
          fid: 42,
          fname: 'Dev',
          lname: 'Rao',
          level: 'Bala Vihar 1',
          classid: 'BV1-B',
          payment: 'paid',
          pemail: 'Parent@Example.com',
          phphone: '(647) 555-0100',
          pmphone: '',
        },
      });

    const family = await findFamilyById('42');

    expect(readRtdb).toHaveBeenCalledWith('/families/42');
    expect(readRtdb).toHaveBeenCalledWith('/roster');
    expect(family).toMatchObject({
      fid: '42',
      name: 'Rao family',
      paymentStatus: 'paid',
      contacts: [
        { type: 'email', value: 'Parent@Example.com' },
        { type: 'phone', value: '(647) 555-0100' },
      ],
      students: [
        {
          sid: '1001',
          fid: '42',
          firstName: 'Anika',
          lastName: 'Rao',
          level: 'Bala Vihar 3',
          className: 'BV3-A',
        },
        {
          sid: '1002',
          fid: '42',
          firstName: 'Dev',
          lastName: 'Rao',
          level: 'Bala Vihar 1',
          className: 'BV1-B',
        },
      ],
    });
  });
});

describe('findFamilyByContact - email', () => {
  it('scans /families index and matches lowercased email', async () => {
    const all = {
      '42': {
        fid: '42',
        name: 'Acme',
        paymentStatus: 'paid',
        contacts: [{ type: 'email', value: 'Alice@Example.com' }],
        students: [],
      },
      '43': {
        fid: '43',
        name: 'Bravo',
        paymentStatus: 'unpaid',
        contacts: [{ type: 'email', value: 'bob@example.com' }],
        students: [],
      },
    };
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(all);
    const family = await findFamilyByContact('email', 'alice@example.com');
    expect(family?.fid).toBe('42');
  });

  it('returns null when no family matches', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const family = await findFamilyByContact('email', 'nobody@example.com');
    expect(family).toBeNull();
  });

  it('falls back to /roster and matches legacy parent email', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        studentA: {
          sid: 1001,
          fid: 42,
          fname: 'Anika',
          lname: 'Rao',
          level: 'Bala Vihar 3',
          classid: 'BV3-A',
          payment: 'paid',
          pemail: 'Parent@Example.com',
          phphone: '(647) 555-0100',
        },
      });

    const family = await findFamilyByContact('email', 'parent@example.com');

    expect(readRtdb).toHaveBeenCalledWith('/families');
    expect(readRtdb).toHaveBeenCalledWith('/roster');
    expect(family?.fid).toBe('42');
  });
});

describe('findFamilyByContact - phone', () => {
  it('matches by digits-only phone comparison', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      '42': {
        fid: '42',
        name: 'Acme',
        paymentStatus: 'paid',
        contacts: [{ type: 'phone', value: '+1 (647) 555-0100' }],
        students: [],
      },
    });
    const family = await findFamilyByContact('phone', '6475550100');
    expect(family?.fid).toBe('42');
  });

  it('falls back to /roster and matches legacy parent phone by last 10 digits', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        studentA: {
          sid: 1001,
          fid: 42,
          fname: 'Anika',
          lname: 'Rao',
          level: 'Bala Vihar 3',
          classid: 'BV3-A',
          payment: 'paid',
          pemail: 'parent@example.com',
          phphone: '+1 (647) 555-0100',
        },
      });

    const family = await findFamilyByContact('phone', '6475550100');

    expect(family?.fid).toBe('42');
  });
});

describe('normalizeContact', () => {
  it('lowercases email', () => {
    expect(normalizeContact('email', 'Foo@BAR.com')).toBe('foo@bar.com');
  });

  it('strips phone to digits only', () => {
    expect(normalizeContact('phone', '+1 (647) 555-0100')).toBe('16475550100');
  });
});

describe('paymentStatusFor (via findFamilyById roster fallback)', () => {
  function makeRow(payment: string | null | undefined, fid = 42, sid = 1) {
    return { sid, fid, fname: 'A', lname: 'B', payment: payment as string | undefined };
  }

  async function getStatus(rows: ReturnType<typeof makeRow>[]) {
    const roster: Record<string, ReturnType<typeof makeRow>> = {};
    rows.forEach((r, i) => { roster[`row${i}`] = r; });
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(roster);
    const family = await findFamilyById('42');
    return family?.paymentStatus;
  }

  it('defaults to partial when all rows have empty payment', async () => {
    expect(await getStatus([makeRow(''), makeRow('')])).toBe('partial');
  });

  it('defaults to partial when all rows have null payment', async () => {
    expect(await getStatus([makeRow(null), makeRow(null)])).toBe('partial');
  });

  it('returns paid when every row explicitly says paid', async () => {
    expect(await getStatus([makeRow('paid'), makeRow('Paid')])).toBe('paid');
  });

  it('returns partial when some rows say paid and others have unknown values', async () => {
    expect(await getStatus([makeRow('paid'), makeRow('')])).toBe('partial');
  });

  it('returns unpaid when any row contains unpaid', async () => {
    expect(await getStatus([makeRow('paid'), makeRow('unpaid')])).toBe('unpaid');
  });

  it('returns unpaid when any row contains due', async () => {
    expect(await getStatus([makeRow('paid'), makeRow('due')])).toBe('unpaid');
  });
});

describe('rosterContactsFor parent-row filtering', () => {
  it('filters to parent rows (grade 99) when present', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        parentRow: {
          sid: 999,
          fid: 42,
          fname: 'Parent',
          lname: 'Smith',
          plname: 'Smith',
          grade: 99,
          pemail: 'parent@example.com',
          phphone: '6475550100',
          payment: 'paid',
        },
        studentRow: {
          sid: 1001,
          fid: 42,
          fname: 'Kid',
          lname: 'Smith',
          grade: 3,
          pemail: 'student-email@example.com',
          payment: 'paid',
        },
      });
    const family = await findFamilyById('42');
    const emails = family?.contacts.filter((c) => c.type === 'email').map((c) => c.value) ?? [];
    expect(emails).toContain('parent@example.com');
    expect(emails).not.toContain('student-email@example.com');
  });

  it('falls back to all rows and warns when no parent rows found', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        studentRow: {
          sid: 1001,
          fid: 42,
          fname: 'Kid',
          lname: 'Smith',
          pemail: 'kid@example.com',
          payment: 'paid',
        },
      });
    const family = await findFamilyById('42');
    const emails = family?.contacts.filter((c) => c.type === 'email').map((c) => c.value) ?? [];
    expect(emails).toContain('kid@example.com');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('family members include parents (whole-family check-in)', () => {
  it('includes grade-99 parent rows as adult members alongside children', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        parentA: {
          sid: 3504,
          fid: 1257,
          fname: 'Dinesh',
          lname: 'Matta',
          plname: 'Matta',
          grade: 99,
          level: 'NULL',
          pemail: 'dinesh@example.com',
          payment: 'paid',
        },
        child: {
          sid: 3505,
          fid: 1257,
          fname: 'Divina',
          lname: 'Matta',
          grade: 1,
          level: 'Level 1 (Gr 1)',
          payment: 'paid',
        },
        parentB: {
          sid: 3506,
          fid: 1257,
          fname: 'Noopur',
          lname: 'Matta',
          plname: 'Matta',
          grade: 99,
          level: 'NULL',
          pemail: 'noopur@example.com',
          payment: 'paid',
        },
      });

    const family = await findFamilyById('1257');

    // All three members show so the sevak can check who actually came.
    expect(family?.students).toHaveLength(3);
    const byName = Object.fromEntries(
      (family?.students ?? []).map((s) => [s.firstName, s]),
    );
    expect(byName.Dinesh).toMatchObject({ sid: '3504', isAdult: true });
    expect(byName.Noopur).toMatchObject({ sid: '3506', isAdult: true });
    expect(byName.Divina).toMatchObject({
      sid: '3505',
      isAdult: false,
      level: 'Level 1 (Gr 1)',
    });
    // A legacy 'NULL' level string must never surface as a member label.
    expect(byName.Dinesh?.level).toBe('');
  });
});

describe('findFamilyById numeric fid coercion', () => {
  it('matches numeric fid 42 stored as number to string lookup "42"', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        studentA: { sid: 1001, fid: 42, fname: 'Anika', lname: 'Rao', payment: 'paid' },
      });
    const family = await findFamilyById('42');
    expect(family?.fid).toBe('42');
  });

  it('matches fid "042" (leading zero) to numeric 42 and returns canonical stored form', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        studentA: { sid: 1001, fid: 42, fname: 'Anika', lname: 'Rao', payment: 'paid' },
      });
    // Lookup accepts '042' via numeric coercion, but the returned family.fid is
    // always the canonical stored form ('42'). This ensures two different lookup
    // inputs pointing at the same family produce identical family.fid values,
    // which is required for consistent session cookies and downstream Firestore
    // queries keyed on fid.
    const family = await findFamilyById('042');
    expect(family?.fid).toBe('42');
  });
});

describe('family name from parent row', () => {
  it('uses parent row plname even when student row comes first', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        studentFirst: {
          sid: 1001,
          fid: 42,
          fname: 'Kid',
          lname: 'StudentSurname',
          grade: 3,
          payment: 'paid',
        },
        parentSecond: {
          sid: 999,
          fid: 42,
          fname: 'Parent',
          lname: 'ParentSurname',
          plname: 'ParentSurname',
          grade: 99,
          pemail: 'parent@example.com',
          payment: 'paid',
        },
      });
    const family = await findFamilyById('42');
    expect(family?.name).toBe('ParentSurname family');
  });
});

describe('findFamilyByContact edge cases', () => {
  it('matches contact value with trailing whitespace after normalization', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        parentRow: {
          sid: 999,
          fid: 42,
          fname: 'Parent',
          lname: 'Smith',
          grade: 99,
          pemail: 'parent@example.com  ',
          payment: 'paid',
        },
      });
    const family = await findFamilyByContact('email', 'parent@example.com');
    expect(family?.fid).toBe('42');
  });

  it('skips malformed roster row missing sid', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        malformedRow: { fid: 42, fname: 'Bad', lname: 'Row', payment: 'paid' },
        goodRow: { sid: 1001, fid: 42, fname: 'Good', lname: 'Row', payment: 'paid' },
      });
    const family = await findFamilyById('42');
    expect(family).not.toBeNull();
    expect(family?.students).toHaveLength(1);
    expect(family?.students[0]?.sid).toBe('1001');
  });

  it('rejects whitespace-only contact values', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        parentRow: {
          sid: 999,
          fid: 42,
          fname: 'Parent',
          lname: 'Smith',
          grade: 99,
          pemail: '   ',
          phphone: '  ',
          payment: 'paid',
        },
      });
    const family = await findFamilyByContact('email', 'parent@example.com');
    expect(family).toBeNull();
  });

  it('handles numeric phone/email fields in legacy roster without throwing (regression for prod 500)', async () => {
    // Legacy RTDB stores phone fields as numbers (not strings). Prior to the
    // string coercion in rosterContactsFor, this would throw
    // "TypeError: a.trim is not a function" at runtime and cause
    // /api/auth/family/send-code to return HTTP 500 in production.
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        numericPhoneRow: {
          sid: 1001,
          fid: 42,
          fname: 'Alice',
          lname: 'Rao',
          grade: 99,
          // Numeric contact fields — the exact shape that crashed prod.
          phphone: 16475550100,
          pmphone: 16475550101,
          pemail: 'alice@example.com',
          payment: 'paid',
        },
      });
    // Should not throw. Unrelated lookup returns null, matching lookup works.
    await expect(
      findFamilyByContact('email', 'unrelated@example.com'),
    ).resolves.toBeNull();
  });

  it('matches a phone contact stored as a number in legacy roster', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        numericPhoneRow: {
          sid: 1001,
          fid: 42,
          fname: 'Alice',
          lname: 'Rao',
          grade: 99,
          phphone: 16475550100,
          payment: 'paid',
        },
      });
    const family = await findFamilyByContact('phone', '+1 (647) 555-0100');
    expect(family?.fid).toBe('42');
  });

  it('mixed statuses paid+unpaid+empty → unpaid (unpaid wins)', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        r1: { sid: 1, fid: 42, fname: 'A', lname: 'B', payment: 'paid' },
        r2: { sid: 2, fid: 42, fname: 'C', lname: 'D', payment: 'unpaid' },
        r3: { sid: 3, fid: 42, fname: 'E', lname: 'F', payment: '' },
      });
    const family = await findFamilyById('42');
    expect(family?.paymentStatus).toBe('unpaid');
  });
});
