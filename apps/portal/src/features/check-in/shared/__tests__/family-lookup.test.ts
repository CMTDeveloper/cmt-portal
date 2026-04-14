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
  vi.clearAllMocks();
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
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const family = await findFamilyById('999');
    expect(family).toBeNull();
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
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    const family = await findFamilyByContact('email', 'nobody@example.com');
    expect(family).toBeNull();
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
});

describe('normalizeContact', () => {
  it('lowercases email', () => {
    expect(normalizeContact('email', 'Foo@BAR.com')).toBe('foo@bar.com');
  });

  it('strips phone to digits only', () => {
    expect(normalizeContact('phone', '+1 (647) 555-0100')).toBe('16475550100');
  });
});
