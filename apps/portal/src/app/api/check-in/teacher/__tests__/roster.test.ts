import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', () => ({
  getRosterForClass: vi.fn(),
  getRosterWithContacts: vi.fn(),
}));

vi.mock('@/lib/flags', () => ({
  flags: { checkInTeacher: true },
}));

import { getRosterForClass } from '@/features/check-in/shared';
import * as rosterHandler from '../roster/[classId]/route';

const mockGetRosterForClass = getRosterForClass as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/check-in/teacher/roster/[classId]', () => {
  it('returns 200 with roster data for a valid classId', async () => {
    mockGetRosterForClass.mockResolvedValueOnce({
      classId: 'K',
      name: 'Kindergarten',
      students: [
        { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
        { sid: '2', fid: '43', firstName: 'Bob', lastName: 'Bravo', level: 'K' },
      ],
    });

    await testApiHandler({
      appHandler: rosterHandler,
      params: { classId: 'K' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.classId).toBe('K');
        expect(body.name).toBe('Kindergarten');
        expect(body.students).toHaveLength(2);
        expect(body.students[0].firstName).toBe('Alice');
      },
    });
  });

  it('returns 404 when classId does not match any class', async () => {
    mockGetRosterForClass.mockResolvedValueOnce(null);

    await testApiHandler({
      appHandler: rosterHandler,
      params: { classId: 'NONEXISTENT' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('class-not-found');
      },
    });
  });

  it('returns 200 with empty students array when class exists but has no students', async () => {
    mockGetRosterForClass.mockResolvedValueOnce({
      classId: 'EMPTY',
      name: 'Empty Class',
      students: [],
    });

    await testApiHandler({
      appHandler: rosterHandler,
      params: { classId: 'EMPTY' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.students).toHaveLength(0);
      },
    });
  });

  it('calls getRosterForClass with the classId from route params', async () => {
    mockGetRosterForClass.mockResolvedValueOnce({
      classId: 'G3',
      name: 'Grade 3',
      students: [],
    });

    await testApiHandler({
      appHandler: rosterHandler,
      params: { classId: 'G3' },
      test: async ({ fetch }) => {
        await fetch({ method: 'GET' });
        expect(getRosterForClass).toHaveBeenCalledWith('G3');
      },
    });
  });
});

// NOTE: The current roster route at roster/[classId]/route.ts does not enforce
// the checkInTeacher flag — it has no flag-gate guard. Flag-off behaviour
// (notFound when checkInTeacher=false) is tested at the page/middleware layer
// and covered by the e2e spec at apps/portal/e2e/b3-teacher.spec.ts.
// A unit-level flag-gate test for this route should be added once the route
// itself gains a flag check (matching the pattern used in attendance/route.ts).
