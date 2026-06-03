import { test, expect } from '../fixtures';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

test.describe('B5 — notifications & cron', () => {
  test('cron endpoints reject missing secret', async ({ request }) => {
    const reset = await request.post('/api/cron/reset-cache');
    expect(reset.status()).toBe(401);
    const sweep = await request.post('/api/cron/send-weekly-payment-reminders');
    expect(sweep.status()).toBe(401);
  });

  test('cron reset-cache accepts valid secret', async ({ request }) => {
    test.skip(!CRON_SECRET, 'CRON_SECRET not set');
    const res = await request.post('/api/cron/reset-cache', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
