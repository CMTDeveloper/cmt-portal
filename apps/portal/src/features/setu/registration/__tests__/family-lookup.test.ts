import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hash each contact deterministically so the test can target a specific key.
vi.mock('../hash-contact-key', () => ({
  hashContactKey: (type: string, value: string) => `hash:${type}:${value.trim().toLowerCase()}`,
}));

// contactKeys/{hash} → {fid, mid} pointer body.
const contactKeyDocs = new Map<string, { fid: string; mid: string }>();
// families/{fid}/members/{mid} → member doc body (portalAccess + manager flag
// matter for classification).
const memberDocs = new Map<string, { portalAccess?: 'active' | 'pending'; manager?: boolean }>();
// Records every contactKeys doc id that .get() was called against, so tests can
// assert how many unique hashes were read (dedupe coverage).
const contactKeyReads: string[] = [];

function fakeDb() {
  // Minimal chainable stub: collection('contactKeys').doc(hash) and
  // collection('families').doc(fid).collection('members').doc(mid).
  function memberRef(fid: string) {
    return {
      collection: (sub: string) => ({
        doc: (mid: string) => ({
          get: async () => {
            if (sub !== 'members') {
              throw new Error(`unexpected subcollection read "${sub}"`);
            }
            const key = `${fid}/${mid}`;
            return memberDocs.has(key)
              ? { exists: true, data: () => memberDocs.get(key) }
              : { exists: false };
          },
        }),
      }),
    };
  }

  return {
    collection: (name: string) => ({
      doc: (id: string) => {
        if (name === 'contactKeys') {
          return {
            get: async () => {
              contactKeyReads.push(id);
              return contactKeyDocs.has(id)
                ? { exists: true, data: () => contactKeyDocs.get(id) }
                : { exists: false };
            },
          };
        }
        if (name === 'families') {
          // The lookup reads the MEMBER doc to classify matchAction, but must
          // NEVER read the family doc itself (privacy). Reading families/{fid}
          // directly (no .collection('members')) would be a regression — there
          // is intentionally no .get() on this ref.
          return memberRef(id);
        }
        throw new Error(`unexpected read of "${name}" — lookup reads only contactKeys + members`);
      },
    }),
  };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => fakeDb(),
}));

import { lookupFamilyByContacts, lookupFamilyByContactList } from '../family-lookup';

beforeEach(() => {
  contactKeyDocs.clear();
  memberDocs.clear();
  contactKeyReads.length = 0;
});

describe('lookupFamilyByContactList', () => {
  it('returns a minimal {found, matchedType, matchedValue, matchAction} when ANY one contact hits', async () => {
    contactKeyDocs.set('hash:phone:+14165550200', { fid: 'CMT-AB12CD34', mid: 'M1' });
    memberDocs.set('CMT-AB12CD34/M1', {}); // no portalAccess ⇒ active ⇒ sign-in
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'not-on-file@example.com' },
      { type: 'phone', value: '+14165550200' },
    ]);
    expect(match).toEqual({
      found: true,
      matchedType: 'phone',
      matchedValue: '+14165550200',
      matchAction: 'sign-in',
    });
  });

  it('leaks NO family PII (no fid/mid/name/location/memberCount/managerInitials)', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34', mid: 'M1' });
    memberDocs.set('CMT-AB12CD34/M1', { portalAccess: 'active' });
    const match = await lookupFamilyByContactList([{ type: 'email', value: 'raj@example.com' }]);
    expect(match).not.toBeNull();
    expect(Object.keys(match!).sort()).toEqual(['found', 'matchAction', 'matchedType', 'matchedValue']);
    const json = JSON.stringify(match);
    expect(json).not.toContain('CMT-AB12CD34'); // fid
    expect(json).not.toContain('M1'); // mid
    expect(json).not.toContain('Patel'); // name / initials
    expect(json).not.toContain('Brampton'); // location
  });

  it("classifies a manager / active member hit as matchAction:'sign-in'", async () => {
    contactKeyDocs.set('hash:email:manager@example.com', { fid: 'CMT-AB12CD34', mid: 'MGR' });
    memberDocs.set('CMT-AB12CD34/MGR', { portalAccess: 'active' });
    const match = await lookupFamilyByContactList([{ type: 'email', value: 'manager@example.com' }]);
    expect(match?.matchAction).toBe('sign-in');
  });

  it("classifies a member with NO portalAccess (absent ⇒ active) as matchAction:'sign-in'", async () => {
    contactKeyDocs.set('hash:email:legacy@example.com', { fid: 'CMT-AB12CD34', mid: 'LEG' });
    memberDocs.set('CMT-AB12CD34/LEG', {}); // absent ⇒ active
    const match = await lookupFamilyByContactList([{ type: 'email', value: 'legacy@example.com' }]);
    expect(match?.matchAction).toBe('sign-in');
  });

  it("classifies a portalAccess:'pending' (gated) member hit as matchAction:'request-to-join'", async () => {
    contactKeyDocs.set('hash:email:gated@example.com', { fid: 'CMT-AB12CD34', mid: 'GATED' });
    memberDocs.set('CMT-AB12CD34/GATED', { portalAccess: 'pending' });
    const match = await lookupFamilyByContactList([{ type: 'email', value: 'gated@example.com' }]);
    expect(match).toEqual({
      found: true,
      matchedType: 'email',
      matchedValue: 'gated@example.com',
      matchAction: 'request-to-join',
    });
  });

  it("classifies a MANAGER as 'sign-in' even if portalAccess is 'pending' (a manager is never gated)", async () => {
    contactKeyDocs.set('hash:email:mgr@example.com', { fid: 'CMT-AB12CD34', mid: 'MGR' });
    // Data-anomaly belt-and-suspenders: even a manager flagged pending must
    // route to sign-in, mirroring the sign-in gate (managers are never gated).
    memberDocs.set('CMT-AB12CD34/MGR', { manager: true, portalAccess: 'pending' });
    const match = await lookupFamilyByContactList([{ type: 'email', value: 'mgr@example.com' }]);
    expect(match?.matchAction).toBe('sign-in');
  });

  it("falls back to 'sign-in' when the matched member doc is missing (data anomaly)", async () => {
    contactKeyDocs.set('hash:email:orphan@example.com', { fid: 'CMT-AB12CD34', mid: 'GONE' });
    // No memberDocs entry → member.exists === false.
    const match = await lookupFamilyByContactList([{ type: 'email', value: 'orphan@example.com' }]);
    expect(match?.matchAction).toBe('sign-in');
  });

  it('reports WHICH contact hit — the 2nd, a phone', async () => {
    contactKeyDocs.set('hash:phone:+14165550200', { fid: 'CMT-AB12CD34', mid: 'M1' });
    memberDocs.set('CMT-AB12CD34/M1', { portalAccess: 'active' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'not-on-file@example.com' },
      { type: 'phone', value: '+14165550200' },
    ]);
    expect(match?.matchedType).toBe('phone');
    expect(match?.matchedValue).toBe('+14165550200');
  });

  it('dedupes by hash — the same contact entered twice reads one unique hash', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34', mid: 'M1' });
    memberDocs.set('CMT-AB12CD34/M1', { portalAccess: 'active' });
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

  it('returns null for a contact that is NOT a contactKey — emergency contacts are never indexed so never matched', async () => {
    // Emergency contacts live ONLY on the member doc; they are never written
    // into contactKeys, so even if a member happens to exist, an emergency-only
    // email/phone produces no contactKeys hit → null. Pin this so a future
    // change that starts indexing emergency contacts has to update this test.
    contactKeyDocs.set('hash:email:primary@example.com', { fid: 'CMT-AB12CD34', mid: 'M1' });
    memberDocs.set('CMT-AB12CD34/M1', { portalAccess: 'active' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'emergency-only@example.com' }, // never a contactKey
    ]);
    expect(match).toBeNull();
  });

  it('ignores blank/whitespace contacts', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34', mid: 'M1' });
    memberDocs.set('CMT-AB12CD34/M1', { portalAccess: 'active' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: '   ' },
      { type: 'email', value: 'raj@example.com' },
    ]);
    expect(match?.matchedValue).toBe('raj@example.com');
  });
});

describe('lookupFamilyByContacts (back-compat)', () => {
  it('still resolves a hit from a single email+phone pair', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34', mid: 'M1' });
    memberDocs.set('CMT-AB12CD34/M1', { portalAccess: 'active' });
    const match = await lookupFamilyByContacts('raj@example.com', '4165551234');
    expect(match?.matchedType).toBe('email');
    expect(match?.matchedValue).toBe('raj@example.com');
    expect(match?.matchAction).toBe('sign-in');
  });
});
