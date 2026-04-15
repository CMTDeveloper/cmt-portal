import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const fakeAddResults = { id: 'ci-new' };
const fakeCollection = {
  add: vi.fn().mockResolvedValue(fakeAddResults),
};
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
}));

const mockFlags = vi.hoisted(() => ({ checkInFamily: true }));
vi.mock('@/lib/flags', () => ({ flags: mockFlags }));

import { findFamilyById } from '@/features/check-in/shared';
import * as appHandler from '../route';

const mockFindFamilyById = findFamilyById as unknown as ReturnType<typeof vi.fn>;

const familyWith123 = {
  fid: '42',
  name: 'Test Family',
  paymentStatus: 'paid',
  contacts: [],
  students: [
    { sid: '1', fid: '42', firstName: 'Alice', lastName: 'A', level: 'K' },
    { sid: '2', fid: '42', firstName: 'Bob', lastName: 'A', level: '1' },
    { sid: '3', fid: '42', firstName: 'Carol', lastName: 'A', level: '2' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFlags.checkInFamily = true;
  fakeCollection.add.mockResolvedValue(fakeAddResults);
  mockFindFamilyById.mockResolvedValue(familyWith123);
});

describe('POST /api/check-in/family/self-check-in', () => {
  it('returns 401 without family header', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => {
        req.headers.set('x-portal-family-id', '42');
        req.headers.set('x-portal-uid', 'u1');
      },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 400 when students object is empty', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => {
        req.headers.set('x-portal-family-id', '42');
        req.headers.set('x-portal-uid', 'u1');
      },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: {} }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('bad-request');
      },
    });
  });

  it('returns 404 when family not found', async () => {
    mockFindFamilyById.mockResolvedValueOnce(null);
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => {
        req.headers.set('x-portal-family-id', '999');
        req.headers.set('x-portal-uid', 'u1');
      },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('family-not-found');
      },
    });
  });

  it('rejects submission containing a foreign student sid', async () => {
    mockFindFamilyById.mockResolvedValueOnce({
      fid: '42',
      name: 'Test Family',
      paymentStatus: 'paid',
      contacts: [],
      students: [{ sid: '1', fid: '42', firstName: 'Alice', lastName: 'A', level: 'K' }],
    });
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => {
        req.headers.set('x-portal-family-id', '42');
        req.headers.set('x-portal-uid', 'u1');
      },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true, '999-foreign': true } }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('invalid-students');
        expect(body.foreignSids).toEqual(['999-foreign']);
      },
    });
  });

  it('writes check-in events for each student and returns ids', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => {
        req.headers.set('x-portal-family-id', '42');
        req.headers.set('x-portal-uid', 'u1');
      },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true, '2': true, '3': false } }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.checkInIds).toHaveLength(3);
      },
    });
    expect(fakeCollection.add).toHaveBeenCalledTimes(3);
  });

  it('sets checkedInBy to family and recordedByUid on the Firestore doc', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => {
        req.headers.set('x-portal-family-id', '42');
        req.headers.set('x-portal-uid', 'u1');
      },
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
      },
    });
    const writes = (fakeCollection.add as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(writes[0]).toBeDefined();
    const write = writes[0]?.[0] as { checkedInBy: string; recordedByUid: string };
    expect(write.checkedInBy).toBe('family');
    expect(write.recordedByUid).toBe('u1');
  });

  it('returns 404 when checkInFamily flag is off', async () => {
    mockFlags.checkInFamily = false;
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => {
        req.headers.set('x-portal-family-id', '42');
        req.headers.set('x-portal-uid', 'u1');
      },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('not-found');
      },
    });
  });
});
