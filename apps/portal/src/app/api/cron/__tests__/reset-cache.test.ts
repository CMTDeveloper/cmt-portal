import { describe, it, expect, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';
import * as appHandler from '../reset-cache/route';

beforeEach(() => {
  process.env.CRON_SECRET = 'a'.repeat(32);
});

describe('POST /api/cron/reset-cache', () => {
  it('returns 401 on missing Authorization', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 401 on wrong secret', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { authorization: 'Bearer wrong' },
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 200 on valid secret', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { authorization: `Bearer ${'a'.repeat(32)}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
      },
    });
  });
});
