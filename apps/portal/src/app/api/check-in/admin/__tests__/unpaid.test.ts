import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import * as appHandler from '../unpaid/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/check-in/admin/unpaid', () => {
  it('returns only families whose paymentStatus is not paid', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      '1': { fid: '1', name: 'A', paymentStatus: 'paid', contacts: [], students: [] },
      '2': { fid: '2', name: 'B', paymentStatus: 'unpaid', contacts: [], students: [] },
      '3': { fid: '3', name: 'C', paymentStatus: 'partial', contacts: [], students: [] },
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.families).toHaveLength(2);
        const fids = body.families.map((f: { fid: string }) => f.fid).sort();
        expect(fids).toEqual(['2', '3']);
      },
    });
  });
});
