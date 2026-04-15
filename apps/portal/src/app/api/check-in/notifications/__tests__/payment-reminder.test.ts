import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/notifications/payment-reminder-service', () => ({
  sendPaymentReminder: vi.fn(),
}));

import { sendPaymentReminder } from '@/features/check-in/notifications/payment-reminder-service';
import * as appHandler from '../payment-reminder/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/check-in/notifications/payment-reminder', () => {
  it('returns 400 on missing fid', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 200 with service result', async () => {
    (sendPaymentReminder as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sent: true,
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ familyId: '42' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.sent).toBe(true);
      },
    });
  });
});
