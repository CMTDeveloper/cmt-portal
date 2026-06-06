import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const flagsMock = vi.hoisted(() => ({ checkInKiosk: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

vi.mock('@/features/check-in/shared', () => ({
  findFamilyByContact: vi.fn(),
}));

import { findFamilyByContact } from '@/features/check-in/shared';
import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.checkInKiosk = true;
});

describe('POST /api/check-in/lookup', () => {
  it('returns 404 when kiosk flag is off', async () => {
    flagsMock.checkInKiosk = false;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(404);
      },
    });
    expect(findFamilyByContact).not.toHaveBeenCalled();
  });

  it('returns 200 with familyId on hit when flag is on', async () => {
    (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.familyId).toBe('42');
      },
    });
  });
});
