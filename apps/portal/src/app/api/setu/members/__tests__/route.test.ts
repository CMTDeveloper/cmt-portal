import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: vi.fn((type: string, value: string) => `hash:${type}:${value}`),
}));
// Public-id allocator mock (issue #4). The POST add-member path allocates exactly
// one publicMid for the new member; mock it deterministically to '50001'.
vi.mock('@/features/setu/ids/public-id-allocator', () => ({
  allocateMemberPublicIds: vi.fn(async (count: number) =>
    Array.from({ length: count }, (_, i) => String(50001 + i)),
  ),
}));

import { POST } from '../route';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { revalidateTag } from 'next/cache';

const mockRunTransaction = vi.fn();
const mockGet = vi.fn();
const mockSet = vi.fn();

function makeChainRef(): Record<string, unknown> {
  const ref: Record<string, unknown> = {};
  ref['doc'] = vi.fn(() => makeChainRef());
  ref['collection'] = vi.fn(() => makeChainRef());
  ref['set'] = mockSet;
  ref['delete'] = vi.fn();
  return ref;
}

function makeRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request('http://localhost/api/setu/members', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function managerHeaders(fid = 'FAM001ABCD12', mid = 'FAM001ABCD12-01'): Record<string, string> {
  return { 'x-portal-role': 'family-manager', 'x-portal-fid': fid, 'x-portal-mid': mid, 'x-portal-uid': `uid-${mid}` };
}

function memberHeaders(fid = 'FAM001ABCD12', mid = 'FAM001ABCD12-02'): Record<string, string> {
  return { 'x-portal-role': 'family-member', 'x-portal-fid': fid, 'x-portal-mid': mid, 'x-portal-uid': `uid-${mid}` };
}

// A gate-complete Child per the 2026-06-22 required matrix: all-fields
// (firstName/lastName/gender/foodAllergies) + child-only (schoolGrade,
// birthMonthYear). Used as the baseline for happy-path tests.
const validBody = {
  firstName: 'Diya',
  lastName: 'Patel',
  type: 'Child',
  gender: 'Female',
  foodAllergies: 'None',
  schoolGrade: 'Grade 5',
  birthMonthYear: '2015-05',
};

// A gate-complete Adult: all-fields + adult-only (email, phone, >=1 skill).
const validAdultBody = {
  firstName: 'Priya',
  lastName: 'Patel',
  type: 'Adult',
  gender: 'Female',
  foodAllergies: 'None',
  email: 'priya@example.com',
  phone: '4165550000',
  volunteeringSkills: ['Teaching / Facilitation'],
};

beforeEach(() => {
  vi.clearAllMocks();

  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => unknown) => {
    const txn = { get: mockGet, set: mockSet };
    return fn(txn);
  });

  const familySnap = {
    exists: true,
    data: () => ({ fid: 'FAM001ABCD12', managers: ['FAM001ABCD12-01'] }),
  };
  const membersSnap = { size: 1, docs: [] };

  mockGet
    .mockResolvedValueOnce(familySnap)
    .mockResolvedValueOnce(membersSnap);

  const chainRef = makeChainRef();
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
    runTransaction: mockRunTransaction,
    collection: vi.fn(() => chainRef),
  });
});

describe('POST /api/setu/members', () => {
  it('returns 403 for family-member (not manager)', async () => {
    const res = await POST(makeRequest(validBody, memberHeaders()));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('manager-required');
  });

  it('returns 401 when no role', async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('returns 400 on missing firstName', async () => {
    const { firstName: _firstName, ...rest } = validBody;
    void _firstName;
    const res = await POST(makeRequest(rest, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 400 on missing type', async () => {
    const { type: _type, ...rest } = validBody;
    void _type;
    const res = await POST(makeRequest(rest, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid type value', async () => {
    const res = await POST(makeRequest({ ...validBody, type: 'Pet' }, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid gender value', async () => {
    const res = await POST(makeRequest({ ...validBody, gender: 'Unknown' }, managerHeaders()));
    expect(res.status).toBe(400);
  });

  it('returns 201 with new mid on success', async () => {
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mid).toBeDefined();
    expect(body.mid).toMatch(/^FAM001ABCD12-/);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('family-FAM001ABCD12', 'max');
  });

  it('rejects a Child whose birth month/year is in the future', async () => {
    // Two years ahead stays in the future as the calendar advances.
    const futureYm = `${new Date().getUTCFullYear() + 2}-01`;
    const res = await POST(makeRequest({ ...validBody, birthMonthYear: futureYm }, managerHeaders()));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('birthdate-future');
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(404);
  });

  it('returns 400 when fid missing from session', async () => {
    const res = await POST(makeRequest(validBody, {
      'x-portal-role': 'family-manager',
      'x-portal-mid': 'FAM001ABCD12-01',
      'x-portal-uid': 'uid-raj',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing-fid');
  });

  // ── Regression tests for schema fixes ─────────────────────────────────────
  // Guard the .nullish() schema (commit ac85d6c) and emergency-contact
  // relation-only allowance (commit 33a8891). Both bugs shipped as silent
  // 400 "bad-request" responses with no useful detail.

  it('accepts null for the optional-by-type string fields (.nullish() regression)', async () => {
    // An Adult satisfies its required matrix (email/phone/skills + foodAllergies)
    // while the child-only fields (schoolGrade, birthMonthYear) are sent as null —
    // the schema must still accept the nulls without a zod 400.
    const bodyWithNulls = {
      ...validAdultBody,
      schoolGrade: null,
      birthMonthYear: null,
      emergencyContacts: null,
    };
    const res = await POST(makeRequest(bodyWithNulls, managerHeaders()));
    expect(res.status).toBe(201);
  });

  it('accepts emergency contact with only relation filled (phone+email empty)', async () => {
    const body = {
      ...validBody,
      emergencyContacts: [
        { relation: 'Mother', phone: '', email: '' },
        null,
      ],
    };
    const res = await POST(makeRequest(body, managerHeaders()));
    expect(res.status).toBe(201);
  });

  it('accepts emergencyContacts: [null, null] when no emergency contact', async () => {
    const body = { ...validBody, emergencyContacts: [null, null] };
    const res = await POST(makeRequest(body, managerHeaders()));
    expect(res.status).toBe(201);
  });

  it('400 bad-request response includes an issues array for client to surface', async () => {
    const { firstName: _firstName, ...rest } = validBody;
    void _firstName;
    const res = await POST(makeRequest(rest, managerHeaders()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('bad-request');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues[0]).toHaveProperty('path');
    expect(body.issues[0]).toHaveProperty('message');
  });

  it('assigns a publicMid to the newly added member (issue #4)', async () => {
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(201);
    const memberWrite = mockSet.mock.calls.find(
      ([, data]) => data && typeof data === 'object' && 'firstName' in data,
    );
    expect(memberWrite?.[1]).toMatchObject({ publicMid: '50001' });
  });

  it('derives birthMonth from birthMonthYear on write', async () => {
    // validBody has birthMonthYear '2015-05' → birthMonth 5, derived server-side
    // (the client never has to keep the two in sync).
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(201);
    const memberWrite = mockSet.mock.calls.find(
      ([, data]) => data && typeof data === 'object' && 'firstName' in data,
    );
    expect(memberWrite?.[1]).toMatchObject({ birthMonth: 5, birthMonthYear: '2015-05' });
  });

  it('writes birthMonth: null when no birthMonthYear (e.g. an adult)', async () => {
    const res = await POST(makeRequest(validAdultBody, managerHeaders()));
    expect(res.status).toBe(201);
    const memberWrite = mockSet.mock.calls.find(
      ([, data]) => data && typeof data === 'object' && 'firstName' in data,
    );
    expect(memberWrite?.[1]).toMatchObject({ birthMonth: null });
  });

  // ── Adult volunteering-skills requirement (issue #10) ─────────────────────
  // Adults must pick at least one skill; children are never blocked.

  it('returns 400 skills-required for an Adult with empty volunteeringSkills', async () => {
    const body = { ...validBody, type: 'Adult', volunteeringSkills: [] };
    const res = await POST(makeRequest(body, managerHeaders()));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('skills-required');
  });

  it('returns 400 skills-required for an Adult with omitted volunteeringSkills', async () => {
    const body = { ...validBody, type: 'Adult' };
    const res = await POST(makeRequest(body, managerHeaders()));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('skills-required');
  });

  it('returns 201 for an Adult with at least one volunteering skill', async () => {
    const res = await POST(makeRequest(validAdultBody, managerHeaders()));
    expect(res.status).toBe(201);
  });

  it('returns 201 for a Child with empty volunteeringSkills (not blocked)', async () => {
    const body = { ...validBody, type: 'Child', volunteeringSkills: [] };
    const res = await POST(makeRequest(body, managerHeaders()));
    expect(res.status).toBe(201);
  });

  it('rejects emergency contact with empty relation (relation is the one required EC field)', async () => {
    const body = {
      ...validBody,
      emergencyContacts: [
        { relation: '', phone: '(416) 555-0000', email: '' },
        null,
      ],
    };
    const res = await POST(makeRequest(body, managerHeaders()));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('bad-request');
  });

  // ── Per-type required matrix (owner spec 2026-06-22) ──────────────────────
  // foodAllergies required for all; adult email+phone; child schoolGrade +
  // birthMonthYear. Each surfaces a distinct 400 error code.

  it('returns 400 foodAllergies-required when foodAllergies is missing (all types)', async () => {
    const { foodAllergies: _fa, ...rest } = validBody;
    void _fa;
    const res = await POST(makeRequest(rest, managerHeaders()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('foodAllergies-required');
  });

  it('returns 400 foodAllergies-required when foodAllergies is an empty string', async () => {
    const res = await POST(makeRequest({ ...validBody, foodAllergies: '' }, managerHeaders()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('foodAllergies-required');
  });

  it('returns 400 contact-required when an Adult is missing email', async () => {
    const { email: _e, ...rest } = validAdultBody;
    void _e;
    const res = await POST(makeRequest(rest, managerHeaders()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('contact-required');
  });

  it('returns 400 contact-required when an Adult is missing phone', async () => {
    const { phone: _p, ...rest } = validAdultBody;
    void _p;
    const res = await POST(makeRequest(rest, managerHeaders()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('contact-required');
  });

  it('returns 400 grade-required when a Child is missing schoolGrade', async () => {
    const { schoolGrade: _g, ...rest } = validBody;
    void _g;
    const res = await POST(makeRequest(rest, managerHeaders()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('grade-required');
  });

  it('returns 400 birthmonth-required when a Child is missing birthMonthYear', async () => {
    const { birthMonthYear: _b, ...rest } = validBody;
    void _b;
    const res = await POST(makeRequest(rest, managerHeaders()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('birthmonth-required');
  });

  it('does NOT require schoolGrade/birthMonthYear on an Adult', async () => {
    // validAdultBody omits the child-only fields entirely → still 201.
    const res = await POST(makeRequest(validAdultBody, managerHeaders()));
    expect(res.status).toBe(201);
  });

  it('does NOT require email/phone/skills on a Child', async () => {
    // validBody (a Child) omits the adult-only fields → still 201.
    const res = await POST(makeRequest(validBody, managerHeaders()));
    expect(res.status).toBe(201);
  });

  // ── Gender write enum is Male|Female only ────────────────────────────────
  it('rejects PreferNotToSay gender at write (read-doc keeps it; write does not)', async () => {
    const res = await POST(makeRequest({ ...validBody, gender: 'PreferNotToSay' }, managerHeaders()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad-request');
  });

  // ── Same-family contact reuse is allowed ─────────────────────────────────
  it('accepts an Adult reusing the family/manager email+phone (no uniqueness block)', async () => {
    // contactKey lookups resolve to this same fid → the theft guard passes and
    // the required email/phone are satisfied by the reused values.
    mockGet.mockReset();
    const familySnap = { exists: true, data: () => ({ fid: 'FAM001ABCD12', managers: ['FAM001ABCD12-01'] }) };
    const membersSnap = { size: 1, docs: [] };
    const sameFamilyContact = { exists: true, data: () => ({ fid: 'FAM001ABCD12' }) };
    mockGet
      .mockResolvedValueOnce(familySnap) // family doc
      .mockResolvedValueOnce(membersSnap) // members collection
      .mockResolvedValueOnce(sameFamilyContact) // email contactKey (same fid)
      .mockResolvedValueOnce(sameFamilyContact); // phone contactKey (same fid)

    const res = await POST(makeRequest(validAdultBody, managerHeaders()));
    expect(res.status).toBe(201);
  });
});
