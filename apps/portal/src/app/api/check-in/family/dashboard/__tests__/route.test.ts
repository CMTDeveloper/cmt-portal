import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
  loadRecentFamilyCheckIns: vi.fn(),
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

const mockFlags = vi.hoisted(() => ({ checkInFamily: true }));
vi.mock('@/lib/flags', () => ({ flags: mockFlags }));

import { findFamilyById, loadRecentFamilyCheckIns } from '@/features/check-in/shared';
import * as appHandler from '../route';

const mockLoadRecentFamilyCheckIns = loadRecentFamilyCheckIns as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFlags.checkInFamily = true;
  fakeCollection.get.mockReset();
  fakeCollection.orderBy.mockClear();
  fakeCollection.limit.mockClear();
  mockLoadRecentFamilyCheckIns.mockResolvedValue([]);
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
    mockLoadRecentFamilyCheckIns.mockResolvedValueOnce([
      {
        checkInId: 'ci-new',
        sid: '1',
        firstName: 'Alice',
        lastName: 'Acme',
        status: 'present',
        checkedInAt: '2026-04-12T14:00:00Z',
        checkedInBy: 'family',
      },
      {
        checkInId: 'ci-old',
        sid: '1',
        firstName: 'Alice',
        lastName: 'Acme',
        status: 'present',
        checkedInAt: '2026-04-10T14:00:00Z',
        checkedInBy: 'sevak',
      },
    ]);
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

  it('returns 404 when checkInFamily flag is off', async () => {
    mockFlags.checkInFamily = false;
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-family-id', '42'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('not-found');
      },
    });
  });
});
