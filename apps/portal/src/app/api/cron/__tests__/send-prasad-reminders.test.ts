import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/setu/prasad/reminder-service', () => ({
  sendDuePrasadReminders: vi.fn(),
}));

import { sendDuePrasadReminders } from '@/features/setu/prasad/reminder-service';
import * as appHandler from '../send-prasad-reminders/route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'a'.repeat(32);
  process.env.PRASAD_REMINDER_CRON_ENABLED = 'true';
});

describe('POST /api/cron/send-prasad-reminders', () => {
  it('returns 401 without a bearer', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(401);
      },
    });
    expect(sendDuePrasadReminders).not.toHaveBeenCalled();
  });

  it('returns 401 with a wrong bearer', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { authorization: `Bearer ${'b'.repeat(32)}` },
        });
        expect(res.status).toBe(401);
      },
    });
    expect(sendDuePrasadReminders).not.toHaveBeenCalled();
  });

  it('short-circuits to disabled:true when PRASAD_REMINDER_CRON_ENABLED is not "true"', async () => {
    delete process.env.PRASAD_REMINDER_CRON_ENABLED;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { authorization: `Bearer ${'a'.repeat(32)}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.disabled).toBe(true);
        expect(body.checked).toBe(0);
        expect(body.sent).toBe(0);
        expect(body.skipped).toBe(0);
      },
    });
    expect(sendDuePrasadReminders).not.toHaveBeenCalled();
  });

  it('with the flag set + valid bearer, runs the service and returns its result', async () => {
    (sendDuePrasadReminders as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      checked: 4,
      sent: 3,
      skipped: 1,
    });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { authorization: `Bearer ${'a'.repeat(32)}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, checked: 4, sent: 3, skipped: 1 });
      },
    });
    expect(sendDuePrasadReminders).toHaveBeenCalledTimes(1);
  });

  // Vercel cron invokes with GET — this is the path that actually fires in prod.
  it('runs over GET (the Vercel cron invocation method) with a valid bearer', async () => {
    (sendDuePrasadReminders as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      checked: 2,
      sent: 2,
      skipped: 0,
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: `Bearer ${'a'.repeat(32)}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, checked: 2, sent: 2, skipped: 0 });
      },
    });
    expect(sendDuePrasadReminders).toHaveBeenCalledTimes(1);
  });

  it('returns 401 over GET without a bearer (the prod cron carries one)', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(401);
      },
    });
    expect(sendDuePrasadReminders).not.toHaveBeenCalled();
  });
});
