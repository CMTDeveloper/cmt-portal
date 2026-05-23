import { describe, it, expect } from 'vitest';
import { POST } from '../route';

function makeRequest() {
  return new Request('http://localhost/api/setu/auth/signout', {
    method: 'POST',
  });
}

describe('POST /api/setu/auth/signout', () => {
  it('redirects to / with 303', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('clears __session cookie', async () => {
    const res = await POST(makeRequest());
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('__session=');
    expect(setCookie).toContain('Max-Age=0');
  });
});
