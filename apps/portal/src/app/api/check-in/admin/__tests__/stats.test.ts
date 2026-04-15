import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const makeSnap = (count: number) => ({ size: count, docs: Array.from({ length: count }) });

const fakeCheckIns = {
  where: vi.fn().mockReturnThis(),
  count: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }) })),
  get: vi.fn(),
};
const fakeGuests = { where: vi.fn().mockReturnThis(), get: vi.fn() };

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn((name: string) => {
      if (name === 'check_in_events') return fakeCheckIns;
      if (name === 'guest_check_ins') return fakeGuests;
      return fakeCheckIns;
    }),
  })),
}));

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import * as appHandler from '../stats/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCheckIns.where.mockReturnThis();
  fakeCheckIns.get.mockReset();
  fakeGuests.where.mockReturnThis();
  fakeGuests.get.mockReset();
});

describe('GET /api/check-in/admin/stats', () => {
  it('returns counts', async () => {
    fakeCheckIns.get.mockResolvedValueOnce(makeSnap(12)).mockResolvedValueOnce(makeSnap(40));
    fakeGuests.get.mockResolvedValueOnce(makeSnap(3));
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      '1': { fid: '1', paymentStatus: 'unpaid', name: 'A', students: [], contacts: [] },
      '2': { fid: '2', paymentStatus: 'paid', name: 'B', students: [], contacts: [] },
      '3': { fid: '3', paymentStatus: 'unpaid', name: 'C', students: [], contacts: [] },
    });

    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-role', 'admin'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.checkInsToday).toBe(12);
        expect(body.checkInsThisWeek).toBe(40);
        expect(body.guestsToday).toBe(3);
        expect(body.unpaidFamilies).toBe(2);
      },
    });
  });
});
