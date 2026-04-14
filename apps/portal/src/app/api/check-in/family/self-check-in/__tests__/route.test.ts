import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const fakeAddResults = { id: 'ci-new' };
const fakeCollection = {
  add: vi.fn().mockResolvedValue(fakeAddResults),
};
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCollection.add.mockResolvedValue(fakeAddResults);
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

  it('sets checkedInBy to family', async () => {
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
});
