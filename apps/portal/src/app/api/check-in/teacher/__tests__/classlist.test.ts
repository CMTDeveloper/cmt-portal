import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', () => ({
  listClasses: vi.fn(),
  getRosterForClass: vi.fn(),
}));

import { listClasses, getRosterForClass } from '@/features/check-in/shared';
import * as classlistHandler from '../classlist/route';
import * as rosterHandler from '../roster/[classId]/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/check-in/teacher/classlist', () => {
  it('returns 200 with classes', async () => {
    (listClasses as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { classId: 'K', name: 'Kindergarten', studentCount: 12 },
    ]);
    await testApiHandler({
      appHandler: classlistHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.classes).toHaveLength(1);
        expect(body.classes[0].classId).toBe('K');
      },
    });
  });
});

describe('GET /api/check-in/teacher/roster/:classId', () => {
  it('returns 200 with roster', async () => {
    (getRosterForClass as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      classId: 'K',
      name: 'Kindergarten',
      students: [{ sid: '1', fid: '42', firstName: 'A', lastName: 'B', level: 'K' }],
    });
    await testApiHandler({
      appHandler: rosterHandler,
      params: { classId: 'K' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.classId).toBe('K');
        expect(body.students).toHaveLength(1);
      },
    });
  });

  it('returns 404 when not found', async () => {
    (getRosterForClass as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await testApiHandler({
      appHandler: rosterHandler,
      params: { classId: 'X' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(404);
      },
    });
  });
});
