import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

vi.mock('@/features/check-in/notifications/payment-reminder-service', () => ({
  sendPaymentReminder: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { sendPaymentReminder } from '@/features/check-in/notifications/payment-reminder-service';
import * as appHandler from '../send-weekly-payment-reminders/route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'a'.repeat(32);
  process.env.WEEKLY_REMINDER_CRON_ENABLED = 'true';
});

describe('POST /api/cron/send-weekly-payment-reminders', () => {
  it('returns 401 without secret', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(401);
      },
    });
  });

  it('short-circuits to disabled:true when WEEKLY_REMINDER_CRON_ENABLED is not "true"', async () => {
    delete process.env.WEEKLY_REMINDER_CRON_ENABLED;
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
        expect(body.sent).toBe(0);
        expect(body.processed).toBe(0);
      },
    });
    expect(readRtdb).not.toHaveBeenCalled();
    expect(sendPaymentReminder).not.toHaveBeenCalled();
  });

  it('iterates unpaid families and calls sendPaymentReminder', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      '1': { fid: '1', name: 'A', paymentStatus: 'paid', contacts: [], students: [] },
      '2': { fid: '2', name: 'B', paymentStatus: 'unpaid', contacts: [], students: [] },
      '3': { fid: '3', name: 'C', paymentStatus: 'partial', contacts: [], students: [] },
    });
    (sendPaymentReminder as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: true });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { authorization: `Bearer ${'a'.repeat(32)}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.processed).toBe(2);
        expect(body.sent).toBe(2);
      },
    });
    expect(sendPaymentReminder).toHaveBeenCalledTimes(2);
    expect(sendPaymentReminder).toHaveBeenCalledWith('2');
    expect(sendPaymentReminder).toHaveBeenCalledWith('3');
  });

  it('is idempotent — rerunning within window does not double-send (throttled)', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      '2': { fid: '2', name: 'B', paymentStatus: 'unpaid', contacts: [], students: [] },
    });
    (sendPaymentReminder as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ sent: false, reason: 'throttled' });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { authorization: `Bearer ${'a'.repeat(32)}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.sent).toBe(0);
        expect(body.skipped).toBe(1);
      },
    });
    expect(sendPaymentReminder).toHaveBeenCalledTimes(1);
  });
});
