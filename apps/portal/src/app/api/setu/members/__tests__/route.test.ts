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

const validBody = {
  firstName: 'Diya',
  lastName: 'Patel',
  type: 'Child',
  gender: 'Female',
  schoolGrade: 'Grade 5',
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
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('family-FAM001ABCD12');
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

  it('accepts null for all optional string fields (.nullish() regression)', async () => {
    const bodyWithNulls = {
      ...validBody,
      schoolGrade: null,
      birthMonthYear: null,
      foodAllergies: null,
      email: null,
      phone: null,
      volunteeringSkills: null,
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
});
