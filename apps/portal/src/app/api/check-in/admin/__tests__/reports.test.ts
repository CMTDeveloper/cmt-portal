import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const makeSnap = (docs: Array<Record<string, unknown>>) => ({
  docs: docs.map((d, i) => ({ id: `id-${i}`, data: () => d })),
});

const fakeQuery = {
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  get: vi.fn(),
};

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeQuery) })),
}));

import * as appHandler from '../reports/[kind]/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeQuery.orderBy.mockReturnThis();
  fakeQuery.limit.mockReturnThis();
  fakeQuery.get.mockReset();
});

describe('POST /api/check-in/admin/reports/check-ins', () => {
  it('streams CSV with correct headers', async () => {
    fakeQuery.get.mockResolvedValueOnce(
      makeSnap([
        { fid: '1', sid: '2', status: 'present', checkedInBy: 'sevak', checkedInAt: '2026-04-13T14:00:00Z' },
      ]),
    );
    await testApiHandler({
      appHandler,
      params: { kind: 'check-ins' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/csv/);
        expect(res.headers.get('content-disposition')).toMatch(/check-ins.*\.csv/);
        const body = await res.text();
        expect(body).toContain('fid,sid,status,checkedInBy,checkedInAt');
      },
    });
  });

  it('returns 400 on unknown kind', async () => {
    await testApiHandler({
      appHandler,
      params: { kind: 'unknown' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(400);
      },
    });
  });
});
