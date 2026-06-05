import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hash each contact deterministically so the test can target a specific key.
vi.mock('../hash-contact-key', () => ({
  hashContactKey: (type: string, value: string) => `hash:${type}:${value.trim().toLowerCase()}`,
}));

const contactKeyDocs = new Map<string, { fid: string }>();
const familyDocs = new Map<string, Record<string, unknown>>();
const memberDocs = new Map<string, { firstName: string; lastName: string }>();
// Records every contactKeys doc id that .get() was called against, so tests can
// assert how many unique hashes were read (dedupe coverage).
const contactKeyReads: string[] = [];

function fakeDb() {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (name === 'contactKeys') {
            contactKeyReads.push(id);
            return contactKeyDocs.has(id)
              ? { exists: true, data: () => contactKeyDocs.get(id) }
              : { exists: false };
          }
          if (name === 'families') {
            return familyDocs.has(id)
              ? { exists: true, data: () => familyDocs.get(id) }
              : { exists: false };
          }
          return { exists: false };
        },
        collection: () => ({
          get: async () => ({ size: 3 }),
          doc: (mid: string) => ({
            get: async () =>
              memberDocs.has(mid)
                ? { exists: true, data: () => memberDocs.get(mid) }
                : { exists: false },
          }),
        }),
      }),
    }),
  };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => fakeDb(),
}));

import { lookupFamilyByContacts, lookupFamilyByContactList } from '../family-lookup';

beforeEach(() => {
  contactKeyDocs.clear();
  familyDocs.clear();
  memberDocs.clear();
  contactKeyReads.length = 0;
  familyDocs.set('CMT-AB12CD34', {
    name: 'Patel',
    location: 'Brampton',
    managers: ['CMT-AB12CD34-01'],
  });
  memberDocs.set('CMT-AB12CD34-01', { firstName: 'Raj', lastName: 'Patel' });
});

describe('lookupFamilyByContactList', () => {
  it('returns the family when ANY one contact hits (the 2nd of several)', async () => {
    contactKeyDocs.set('hash:phone:+14165550200', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'not-on-file@example.com' },
      { type: 'phone', value: '+14165550200' },
    ]);
    expect(match?.fid).toBe('CMT-AB12CD34');
    expect(match?.name).toBe('Patel');
    expect(match?.managerInitials).toBe('R.P.');
  });

  it('reports WHICH contact hit (matchedType/matchedValue) — the 2nd, a phone', async () => {
    contactKeyDocs.set('hash:phone:+14165550200', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'not-on-file@example.com' },
      { type: 'phone', value: '+14165550200' },
    ]);
    expect(match?.matchedType).toBe('phone');
    expect(match?.matchedValue).toBe('+14165550200');
    // Still carries the full summary alongside the matched-contact fields.
    expect(match?.fid).toBe('CMT-AB12CD34');
    expect(match?.name).toBe('Patel');
  });

  it('dedupes by hash — the same contact entered twice reads one unique hash', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'raj@example.com' },
      { type: 'email', value: 'RAJ@example.com' }, // same hash after normalize
    ]);
    expect(match?.fid).toBe('CMT-AB12CD34');
    expect(match?.matchedType).toBe('email');
    expect(match?.matchedValue).toBe('raj@example.com'); // first occurrence wins
    // Only one unique contactKeys hash was read despite two inputs.
    expect(contactKeyReads).toEqual(['hash:email:raj@example.com']);
  });

  it('returns null when no contact hits', async () => {
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'a@example.com' },
      { type: 'email', value: 'b@example.com' },
    ]);
    expect(match).toBeNull();
  });

  it('ignores blank/whitespace contacts', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: '   ' },
      { type: 'email', value: 'raj@example.com' },
    ]);
    expect(match?.fid).toBe('CMT-AB12CD34');
  });
});

describe('lookupFamilyByContacts (back-compat)', () => {
  it('still resolves a family from a single email+phone pair', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContacts('raj@example.com', '4165551234');
    expect(match?.fid).toBe('CMT-AB12CD34');
  });
});
