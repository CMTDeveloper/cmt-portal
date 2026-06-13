import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(),
}));

import { POST } from '../route';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';

const mockUpdateUser = vi.fn();

// The route authenticates from the middleware-set x-portal-* headers (works
// for both cookie and Bearer/mobile callers).
function makeRequest(
  body: unknown,
  session?: { uid: string; email?: string; role?: string },
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (session) {
    headers.set('x-portal-role', session.role ?? 'family-manager');
    headers.set('x-portal-uid', session.uid);
    if (session.email) headers.set('x-portal-email', session.email);
  }
  return new Request('http://localhost/api/setu/auth/set-password', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (portalAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    updateUser: mockUpdateUser,
  });
  mockUpdateUser.mockResolvedValue(undefined);
});

describe('POST /api/setu/auth/set-password', () => {
  it('returns 401 when no session headers', async () => {
    const res = await POST(makeRequest({ password: 'Secret1' }));
    expect(res.status).toBe(401);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when password is too short', async () => {
    const res = await POST(makeRequest({ password: 'Ab1' }, { uid: 'uid-123', email: 'raj@example.com' }));
    expect(res.status).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when password is too long (>128 chars)', async () => {
    const res = await POST(
      makeRequest({ password: 'A1' + 'x'.repeat(128) }, { uid: 'uid-123', email: 'raj@example.com' }),
    );
    expect(res.status).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when password has no digit', async () => {
    const res = await POST(
      makeRequest({ password: 'OnlyLetters' }, { uid: 'uid-123', email: 'raj@example.com' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('digit');
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when password has no letter', async () => {
    const res = await POST(
      makeRequest({ password: '12345678' }, { uid: 'uid-123', email: 'raj@example.com' }),
    );
    expect(res.status).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when session has no email (phone-only sign-in)', async () => {
    const res = await POST(makeRequest({ password: 'Secret123' }, { uid: 'uid-123' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('no-email-on-session');
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('happy path: calls updateUser with email+password and returns 200', async () => {
    const res = await POST(
      makeRequest({ password: 'Secret123' }, { uid: 'uid-123', email: 'raj@example.com' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockUpdateUser).toHaveBeenCalledWith('uid-123', {
      email: 'raj@example.com',
      password: 'Secret123',
    });
  });
});
