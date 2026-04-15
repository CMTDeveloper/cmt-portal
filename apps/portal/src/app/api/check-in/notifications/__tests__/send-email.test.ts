import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/notifications/send-email-service', () => ({
  sendTemplatedEmail: vi.fn(),
}));

import { sendTemplatedEmail } from '@/features/check-in/notifications/send-email-service';
import * as appHandler from '../send-email/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/check-in/notifications/send-email', () => {
  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to: 'not-email' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 200 and calls service on happy path', async () => {
    (sendTemplatedEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            to: 'a@b.com',
            template: 'donation-thank-you',
            props: { familyName: 'Acme' },
          }),
        });
        expect(res.status).toBe(200);
      },
    });
    expect(sendTemplatedEmail).toHaveBeenCalled();
  });
});
