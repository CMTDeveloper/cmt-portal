import { describe, it, expect } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';
import * as appHandler from '../route';

describe('POST /api/auth/signout', () => {
  it('clears the __session cookie', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(200);
        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toMatch(/__session=/);
        expect(setCookie).toMatch(/Max-Age=0/);
      },
    });
  });
});
