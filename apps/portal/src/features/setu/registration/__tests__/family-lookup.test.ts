import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hash each contact deterministically so the test can target a specific key.
vi.mock('../hash-contact-key', () => ({
  hashContactKey: (type: string, value: string) => `hash:${type}:${value.trim().toLowerCase()}`,
}));

const contactKeyDocs = new Map<string, { fid: string }>();
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
          // The PUBLIC lookup must NOT read families/members (privacy) — any
          // such read here would be a regression.
          throw new Error(`unexpected read of "${name}" — public lookup must only read contactKeys`);
        },
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
  contactKeyReads.length = 0;
});

describe('lookupFamilyByContactList', () => {
  it('returns a minimal {found, matchedType, matchedValue} when ANY one contact hits', async () => {
    contactKeyDocs.set('hash:phone:+14165550200', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'not-on-file@example.com' },
      { type: 'phone', value: '+14165550200' },
    ]);
    expect(match).toEqual({ found: true, matchedType: 'phone', matchedValue: '+14165550200' });
  });

  it('leaks NO family PII (no fid/name/location/memberCount/managerInitials)', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContactList([{ type: 'email', value: 'raj@example.com' }]);
    expect(match).not.toBeNull();
    expect(Object.keys(match!).sort()).toEqual(['found', 'matchedType', 'matchedValue']);
    const json = JSON.stringify(match);
    expect(json).not.toContain('CMT-AB12CD34'); // fid
    expect(json).not.toContain('Patel'); // name / initials
    expect(json).not.toContain('Brampton'); // location
  });

  it('reports WHICH contact hit — the 2nd, a phone', async () => {
    contactKeyDocs.set('hash:phone:+14165550200', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'not-on-file@example.com' },
      { type: 'phone', value: '+14165550200' },
    ]);
    expect(match?.matchedType).toBe('phone');
    expect(match?.matchedValue).toBe('+14165550200');
  });

  it('dedupes by hash — the same contact entered twice reads one unique hash', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'raj@example.com' },
      { type: 'email', value: 'RAJ@example.com' }, // same hash after normalize
    ]);
    expect(match?.matchedType).toBe('email');
    expect(match?.matchedValue).toBe('raj@example.com'); // first occurrence wins
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
    expect(match?.matchedValue).toBe('raj@example.com');
  });
});

describe('lookupFamilyByContacts (back-compat)', () => {
  it('still resolves a hit from a single email+phone pair', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContacts('raj@example.com', '4165551234');
    expect(match?.matchedType).toBe('email');
    expect(match?.matchedValue).toBe('raj@example.com');
  });
});
