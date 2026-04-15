import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const fakeQuery = {
  orderBy: vi.fn().mockReturnThis(),
  startAfter: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  get: vi.fn(),
};
const fakeDoc = { get: vi.fn() };
const fakeCollection = {
  ...fakeQuery,
  doc: vi.fn(() => fakeDoc),
};

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

import * as appHandler from '../guests/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeQuery.orderBy.mockReturnThis();
  fakeQuery.startAfter.mockReturnThis();
  fakeQuery.limit.mockReturnThis();
  fakeQuery.get.mockReset();
  fakeDoc.get.mockReset();
});

describe('GET /api/check-in/admin/guests', () => {
  it('returns paginated guests', async () => {
    fakeQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: 'g1',
          data: () => ({
            firstName: 'Carol',
            lastName: 'Visitor',
            checkedInAt: '2026-04-13T14:00:00Z',
            numberOfAdults: 2,
            numberOfChildren: 1,
          }),
        },
      ],
    });
    await testApiHandler({
      appHandler,
      url: '/api/check-in/admin/guests?limit=20',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.guests).toHaveLength(1);
        expect(body.guests[0].firstName).toBe('Carol');
      },
    });
  });

  it('honors cursor param', async () => {
    fakeDoc.get.mockResolvedValueOnce({ exists: true });
    fakeQuery.get.mockResolvedValueOnce({ docs: [] });
    await testApiHandler({
      appHandler,
      url: '/api/check-in/admin/guests?cursor=g0&limit=20',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
      },
    });
    expect(fakeCollection.doc).toHaveBeenCalledWith('g0');
  });
});
