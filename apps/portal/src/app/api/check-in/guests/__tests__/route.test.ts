import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const flagsMock = vi.hoisted(() => ({ checkInKiosk: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

vi.mock('@/features/check-in/shared', () => ({
  recordGuestCheckIn: vi.fn(),
}));

import { recordGuestCheckIn } from '@/features/check-in/shared';
import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.checkInKiosk = true;
});

const validBody = {
  firstName: 'Jane',
  lastName: 'Doe',
  numberOfAdults: 1,
  numberOfChildren: 2,
};

describe('POST /api/check-in/guests', () => {
  it('returns 404 when kiosk flag is off', async () => {
    flagsMock.checkInKiosk = false;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(404);
      },
    });
    expect(recordGuestCheckIn).not.toHaveBeenCalled();
  });

  it('returns 200 and records the guest when flag is on', async () => {
    (recordGuestCheckIn as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('guest-1');
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.id).toBe('guest-1');
      },
    });
    expect(recordGuestCheckIn).toHaveBeenCalledTimes(1);
  });
});
