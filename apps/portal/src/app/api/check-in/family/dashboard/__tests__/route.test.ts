import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/check-in/shared')>()),
  findFamilyById: vi.fn(),
}));

const fakeQuery = {
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  get: vi.fn(),
};
const fakeCollection = { ...fakeQuery };
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

import { findFamilyById } from '@/features/check-in/shared';
import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCollection.get.mockReset();
  fakeCollection.orderBy.mockClear();
  fakeCollection.limit.mockClear();
});

describe('GET /api/check-in/family/dashboard', () => {
  it('returns 401 when family header missing', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns family + recent check-ins on happy path', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'paid',
      contacts: [],
      students: [{ sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' }],
    });
    fakeCollection.get.mockResolvedValueOnce({
      docs: [
        {
          id: 'ci-old',
          data: () => ({
            sid: '1',
            status: 'present',
            checkedInAt: '2026-04-10T14:00:00Z',
            checkedInBy: 'sevak',
          }),
        },
        {
          id: 'ci-new',
          data: () => ({
            sid: '1',
            status: 'present',
            checkedInAt: '2026-04-12T14:00:00Z',
            checkedInBy: 'family',
          }),
        },
      ],
    });
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-family-id', '42'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.family.fid).toBe('42');
        expect(body.recentCheckIns).toHaveLength(2);
        expect(body.recentCheckIns[0].checkInId).toBe('ci-new');
        expect(body.recentCheckIns[0].firstName).toBe('Alice');
        expect(body.paymentStatus).toBe('paid');
      },
    });
    expect(fakeCollection.orderBy).not.toHaveBeenCalled();
    expect(fakeCollection.limit).not.toHaveBeenCalled();
  });

  it('returns 404 if family not found', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    fakeCollection.get.mockResolvedValueOnce({ docs: [] });
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-family-id', '999'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(404);
      },
    });
  });
});
