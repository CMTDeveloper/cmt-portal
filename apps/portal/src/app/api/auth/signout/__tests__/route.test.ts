import { describe, it, expect } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';
import * as appHandler from '../route';

describe('POST /api/auth/signout', () => {
  it('returns 303 redirect to /login and clears the __session cookie', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', redirect: 'manual' });
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toMatch(/\/login$/);
        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toMatch(/__session=/);
        expect(setCookie).toMatch(/Max-Age=0/);
      },
    });
  });
});
