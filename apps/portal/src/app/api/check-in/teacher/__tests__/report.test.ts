import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const makeSnap = (docs: Array<Record<string, unknown>>) => ({
  docs: docs.map((d) => ({ data: () => d })),
});

const fakeQuery = {
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  get: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collectionGroup: vi.fn(() => fakeQuery),
  })),
}));

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
  getRosterForClass: vi.fn(),
}));

import { getRosterForClass } from '@/features/check-in/shared';
import * as appHandler from '../report/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeQuery.where.mockReturnThis();
  fakeQuery.orderBy.mockReturnThis();
  fakeQuery.get.mockReset();
});

describe('GET /api/check-in/teacher/report', () => {
  it('returns JSON by default', async () => {
    fakeQuery.get.mockResolvedValueOnce(
      makeSnap([
        { date: '2026-04-13', classId: 'K', sid: '1', status: 'present', markedAt: 'x', markedByUid: 'u' },
      ]),
    );
    (getRosterForClass as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      classId: 'K',
      name: 'K',
      students: [{ sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' }],
    });

    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/report?classId=K&from=2026-04-01&to=2026-04-30',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].firstName).toBe('Alice');
      },
    });
  });

  it('returns CSV when Accept: text/csv', async () => {
    fakeQuery.get.mockResolvedValueOnce(
      makeSnap([
        { date: '2026-04-13', classId: 'K', sid: '1', status: 'present', markedAt: 'x', markedByUid: 'u' },
      ]),
    );
    (getRosterForClass as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      classId: 'K',
      name: 'K',
      students: [{ sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' }],
    });

    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/report?classId=K',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { accept: 'text/csv' } });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/csv/);
        expect(res.headers.get('content-disposition')).toMatch(/attendance.*\.csv/);
        const body = await res.text();
        expect(body).toContain('date,classId,sid,firstName,lastName,status');
        expect(body).toContain('Alice');
      },
    });
  });
});
