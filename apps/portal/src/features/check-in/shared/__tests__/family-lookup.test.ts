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
