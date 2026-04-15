import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const fakeQuery = {
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  get: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collectionGroup: vi.fn(() => fakeQuery) })),
}));

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
  getRosterForClass: vi.fn(),
  listClasses: vi.fn(),
}));

import * as appHandler from '../uninformed/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeQuery.where.mockReturnThis();
  fakeQuery.orderBy.mockReturnThis();
  fakeQuery.get.mockReset();
});

describe('GET /api/check-in/teacher/uninformed', () => {
  it('returns entries filtered to uninformed status', async () => {
    fakeQuery.get.mockResolvedValueOnce({
      docs: [
        { data: () => ({ date: '2026-04-13', classId: 'K', sid: '1', status: 'uninformed' }) },
      ],
    });
    const { listClasses, getRosterForClass } = await import('@/features/check-in/shared');
    (listClasses as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { classId: 'K', name: 'K', studentCount: 1 },
    ]);
    (getRosterForClass as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      classId: 'K',
      name: 'K',
      students: [{ sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' }],
    });
    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/uninformed',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].status).toBe('uninformed');
      },
    });
  });
});
