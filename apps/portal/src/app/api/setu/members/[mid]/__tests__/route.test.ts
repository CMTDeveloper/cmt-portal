import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));
vi.mock('@/features/setu/members', () => ({
  assertNotLastManager: vi.fn(),
  LastManagerError: class LastManagerError extends Error {
    constructor(op: string) {
      super(`Cannot ${op} the last manager`);
      this.name = 'LastManagerError';
    }
  },
}));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: vi.fn((type: string, value: string) => `hash:${type}:${value}`),
}));

import { PATCH, DELETE } from '../route';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { assertNotLastManager, LastManagerError } from '@/features/setu/members';
import { revalidateTag } from 'next/cache';

const mockRunTransaction = vi.fn();
const mockGet = vi.fn();
const mockTxnSet = vi.fn();
const mockTxnDelete = vi.fn();

function makeChainRef(): Record<string, unknown> {
  const ref: Record<string, unknown> = {};
  ref['doc'] = vi.fn(() => makeChainRef());
  ref['collection'] = vi.fn(() => makeChainRef());
  ref['set'] = mockTxnSet;
  ref['delete'] = mockTxnDelete;
  return ref;
}

function makeRequest(method: 'PATCH' | 'DELETE', body: unknown, xHeaders: Record<string, string> = {}) {
  return new Request('http://localhost/api/setu/members/FAM001ABCD12-02', {
    method,
    headers: { 'content-type': 'application/json', ...xHeaders },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
}

function managerHeaders(fid = 'FAM001ABCD12', mid = 'FAM001ABCD12-01'): Record<string, string> {
  return { 'x-portal-role': 'family-manager', 'x-portal-fid': fid, 'x-portal-mid': mid, 'x-portal-uid': `uid-${mid}` };
}

function memberHeaders(fid = 'FAM001ABCD12', mid = 'FAM001ABCD12-02'): Record<string, string> {
  return { 'x-portal-role': 'family-member', 'x-portal-fid': fid, 'x-portal-mid': mid, 'x-portal-uid': `uid-${mid}` };
}

const memberSnap = {
  exists: true,
  data: () => ({
    mid: 'FAM001ABCD12-02',
    uid: null,
    firstName: 'Diya',
    lastName: 'Patel',
    type: 'Child',
    gender: 'Female',
    manager: false,
    joinedAt: { toDate: () => new Date('2026-01-01') },
    email: null,
    phone: null,
    schoolGrade: 'Grade 5',
    birthMonthYear: null,
    volunteeringSkills: [],
    foodAllergies: null,
    emergencyContacts: [null, null],
  }),
};

const familySnap = {
  exists: true,
  data: () => ({
    fid: 'FAM001ABCD12',
    managers: ['FAM001ABCD12-01'],
  }),
};

const params = { mid: 'FAM001ABCD12-02' };

beforeEach(() => {
  vi.clearAllMocks();

  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => unknown) => {
    const txn = {
      get: mockGet,
      set: mockTxnSet,
      delete: mockTxnDelete,
      update: vi.fn(),
    };
    return fn(txn);
  });

  const chainRef = makeChainRef();
  (portalFirestore as ReturnType<typeof vi.fn>).mockReturnValue({
    runTransaction: mockRunTransaction,
    collection: vi.fn(() => chainRef),
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe('PATCH /api/setu/members/[mid]', () => {
  it('returns 401 when no session', async () => {
    const res = await PATCH(makeRequest('PATCH', { firstName: 'Diya2' }), { params: Promise.resolve(params) });
    expect(res.status).toBe(401);
  });

  it('returns 403 when family-member tries to edit another member', async () => {
    // session mid is -03, target is -02 (different)
    const res = await PATCH(
      makeRequest('PATCH', { firstName: 'New' }, memberHeaders('FAM001ABCD12', 'FAM001ABCD12-03')),
      { params: Promise.resolve({ mid: 'FAM001ABCD12-02' }) },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('manager-required');
  });

  it('allows family-member self-edit (own mid)', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberSnap);

    const res = await PATCH(
      makeRequest('PATCH', { firstName: 'Diya2' }, memberHeaders('FAM001ABCD12', 'FAM001ABCD12-02')),
      { params: Promise.resolve(params) },
    );
    expect(res.status).toBe(200);
  });

  it('returns 403 when family-member self-edits tries to set manager flag', async () => {
    const res = await PATCH(
      makeRequest('PATCH', { manager: true }, memberHeaders('FAM001ABCD12', 'FAM001ABCD12-02')),
      { params: Promise.resolve(params) },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('manager-flag-requires-manager-role');
  });

  it('returns 400 when patch body attempts to mutate mid', async () => {
    const res = await PATCH(makeRequest('PATCH', { mid: 'NEW-ID' }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when patch body attempts to mutate uid', async () => {
    const res = await PATCH(makeRequest('PATCH', { uid: 'new-uid' }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when patch body attempts to mutate joinedAt', async () => {
    const res = await PATCH(makeRequest('PATCH', { joinedAt: new Date() }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when member does not exist', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce({ exists: false });

    const res = await PATCH(makeRequest('PATCH', { firstName: 'New' }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful manager patch', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberSnap);

    const res = await PATCH(makeRequest('PATCH', { firstName: 'DiyaNew', schoolGrade: 'Grade 6' }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('family-FAM001ABCD12', 'max');
  });

  it('calls assertNotLastManager when demoting manager flag', async () => {
    const managerMemberSnap = {
      exists: true,
      data: () => ({ ...memberSnap.data(), manager: true, mid: 'FAM001ABCD12-01' }),
    };
    const demotionFamilySnap = {
      exists: true,
      data: () => ({ fid: 'FAM001ABCD12', managers: ['FAM001ABCD12-01'] }),
    };
    mockGet
      .mockResolvedValueOnce(demotionFamilySnap)
      .mockResolvedValueOnce(managerMemberSnap);

    (assertNotLastManager as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new (LastManagerError as unknown as new (op: string) => Error)('demote');
    });

    const res = await PATCH(makeRequest('PATCH', { manager: false }, managerHeaders()), {
      params: Promise.resolve({ mid: 'FAM001ABCD12-01' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('last-manager');
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { PATCH: flaggedPATCH } = await import('../route');
    const res = await flaggedPATCH(makeRequest('PATCH', {}, managerHeaders()), { params: Promise.resolve(params) });
    expect(res.status).toBe(404);
  });

  // ── Adult volunteering-skills requirement (issue #10) ─────────────────────
  // Only enforced when the patch touches volunteeringSkills AND the member
  // is/will be an Adult. Children are never blocked; adults editing other
  // fields (without touching skills) are never blocked.

  const adultMemberSnap = {
    exists: true,
    data: () => ({ ...memberSnap.data(), type: 'Adult', volunteeringSkills: [] }),
  };

  it('returns 400 skills-required when patching an Adult skills to []', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(adultMemberSnap);

    const res = await PATCH(makeRequest('PATCH', { volunteeringSkills: [] }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('skills-required');
  });

  it('returns 200 when patching an Adult skills to a non-empty array', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(adultMemberSnap);

    const res = await PATCH(
      makeRequest('PATCH', { volunteeringSkills: ['Teaching / Facilitation'] }, managerHeaders()),
      { params: Promise.resolve(params) },
    );
    expect(res.status).toBe(200);
  });

  it('returns 200 when patching an Adult other fields without touching skills', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(adultMemberSnap);

    const res = await PATCH(makeRequest('PATCH', { firstName: 'Priya' }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(200);
  });

  it('returns 200 when patching a Child skills to [] (not blocked)', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberSnap); // memberSnap is type 'Child'

    const res = await PATCH(makeRequest('PATCH', { volunteeringSkills: [] }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 skills-required when patch flips a member to Adult with empty skills', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberSnap); // existing doc is Child

    // Flip to Adult and supply the other adult-required fields, so the only
    // missing one is volunteeringSkills.
    const res = await PATCH(
      makeRequest(
        'PATCH',
        {
          type: 'Adult',
          foodAllergies: 'None',
          email: 'p@example.com',
          phone: '4165550000',
          volunteeringSkills: [],
        },
        managerHeaders(),
      ),
      { params: Promise.resolve(params) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('skills-required');
  });

  // ── Per-type required matrix on PATCH (owner spec 2026-06-22) ─────────────
  // A rule fires only when the post-patch member would be MISSING the field for
  // its effective type, AND the patch touches that field OR flips `type`.

  it('returns 400 foodAllergies-required when patch clears foodAllergies (all types)', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberSnap); // Child with foodAllergies already null

    const res = await PATCH(makeRequest('PATCH', { foodAllergies: '' }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('foodAllergies-required');
  });

  it('returns 400 contact-required when patch clears an Adult email', async () => {
    const adultWithContact = {
      exists: true,
      data: () => ({
        ...memberSnap.data(),
        type: 'Adult',
        foodAllergies: 'None',
        email: 'a@example.com',
        phone: '4165550000',
        volunteeringSkills: ['Teaching / Facilitation'],
      }),
    };
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(adultWithContact);

    const res = await PATCH(makeRequest('PATCH', { email: null }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('contact-required');
  });

  it('returns 400 grade-required when patch clears a Child schoolGrade', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberSnap); // Child with schoolGrade 'Grade 5'

    const res = await PATCH(makeRequest('PATCH', { schoolGrade: null }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('grade-required');
  });

  it('returns 400 birthmonth-required when patch sets a Child birthMonthYear to empty', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberSnap); // Child

    const res = await PATCH(makeRequest('PATCH', { birthMonthYear: '' }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('birthmonth-required');
  });

  it('does NOT block a partial patch that leaves a still-missing field untouched', async () => {
    // memberSnap (Child) has foodAllergies null + birthMonthYear null already.
    // Patching only firstName must not 400 those — legacy-incomplete docs stay
    // editable until the field is touched or `type` flips.
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberSnap);

    const res = await PATCH(makeRequest('PATCH', { firstName: 'Renamed' }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(200);
  });

  it('rejects PreferNotToSay gender at write on PATCH', async () => {
    const res = await PATCH(makeRequest('PATCH', { gender: 'PreferNotToSay' }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad-request');
  });

  it('derives + persists birthMonth from birthMonthYear on PATCH', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberSnap); // Child

    const res = await PATCH(makeRequest('PATCH', { birthMonthYear: '2016-09' }, managerHeaders()), {
      params: Promise.resolve(params),
    });
    expect(res.status).toBe(200);
    const memberWrite = mockTxnSet.mock.calls.find(
      ([, data]) => data && typeof data === 'object' && 'birthMonthYear' in data,
    );
    expect(memberWrite?.[1]).toMatchObject({ birthMonthYear: '2016-09', birthMonth: 9 });
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/setu/members/[mid]', () => {
  it('returns 401 when no session', async () => {
    const res = await DELETE(makeRequest('DELETE', null), { params: Promise.resolve(params) });
    expect(res.status).toBe(401);
  });

  it('returns 403 when family-member tries to delete', async () => {
    const res = await DELETE(
      makeRequest('DELETE', null, memberHeaders()),
      { params: Promise.resolve(params) },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('manager-required');
  });

  it('returns 404 when member does not exist', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce({ exists: false });

    const res = await DELETE(makeRequest('DELETE', null, managerHeaders()), { params: Promise.resolve(params) });
    expect(res.status).toBe(404);
  });

  it('calls assertNotLastManager when deleting a manager', async () => {
    const managerMemberSnap = {
      exists: true,
      data: () => ({ ...memberSnap.data(), manager: true, mid: 'FAM001ABCD12-01' }),
    };
    const singleManagerFamilySnap = {
      exists: true,
      data: () => ({ fid: 'FAM001ABCD12', managers: ['FAM001ABCD12-01'] }),
    };
    mockGet
      .mockResolvedValueOnce(singleManagerFamilySnap)
      .mockResolvedValueOnce(managerMemberSnap);

    (assertNotLastManager as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new (LastManagerError as unknown as new (op: string) => Error)('remove');
    });

    const res = await DELETE(makeRequest('DELETE', null, managerHeaders()), {
      params: Promise.resolve({ mid: 'FAM001ABCD12-01' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('last-manager');
  });

  it('returns 200 on successful delete of non-manager member', async () => {
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberSnap);

    const res = await DELETE(makeRequest('DELETE', null, managerHeaders()), { params: Promise.resolve(params) });
    expect(res.status).toBe(200);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('family-FAM001ABCD12', 'max');
  });

  it('removes contactKey docs when member has email/phone', async () => {
    const memberWithContactSnap = {
      exists: true,
      data: () => ({
        ...memberSnap.data(),
        email: 'diya@example.com',
        phone: '4165559999',
      }),
    };
    mockGet
      .mockResolvedValueOnce(familySnap)
      .mockResolvedValueOnce(memberWithContactSnap);

    await DELETE(makeRequest('DELETE', null, managerHeaders()), { params: Promise.resolve(params) });
    // mockTxnDelete called for member + email contactKey + phone contactKey
    expect(mockTxnDelete).toHaveBeenCalledTimes(3);
  });

  it('removes family managers array entry when deleting a non-last manager', async () => {
    const twoManagerFamilySnap = {
      exists: true,
      data: () => ({ fid: 'FAM001ABCD12', managers: ['FAM001ABCD12-01', 'FAM001ABCD12-02'] }),
    };
    const managerMemberSnap = {
      exists: true,
      data: () => ({ ...memberSnap.data(), manager: true, mid: 'FAM001ABCD12-02' }),
    };
    mockGet
      .mockResolvedValueOnce(twoManagerFamilySnap)
      .mockResolvedValueOnce(managerMemberSnap);

    (assertNotLastManager as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const res = await DELETE(makeRequest('DELETE', null, managerHeaders()), { params: Promise.resolve(params) });
    expect(res.status).toBe(200);
    expect(mockTxnSet).toHaveBeenCalled();
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { DELETE: flaggedDELETE } = await import('../route');
    const res = await flaggedDELETE(makeRequest('DELETE', null, managerHeaders()), { params: Promise.resolve(params) });
    expect(res.status).toBe(404);
  });
});
