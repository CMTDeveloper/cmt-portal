import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(),
}));

import { POST } from '../route';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';

const mockUpdateUser = vi.fn();

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setu/auth/set-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function setupSession(claims: Record<string, unknown> | null) {
  const cookieGet = vi.fn().mockReturnValue(
    claims ? { value: 'session-cookie-value' } : undefined,
  );
  (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({ get: cookieGet });
  (verifyPortalSessionCookie as ReturnType<typeof vi.fn>).mockResolvedValue(claims);
}

beforeEach(() => {
  vi.clearAllMocks();
  (portalAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    updateUser: mockUpdateUser,
  });
  mockUpdateUser.mockResolvedValue(undefined);
});

describe('POST /api/setu/auth/set-password', () => {
  it('returns 401 when no session cookie', async () => {
    setupSession(null);
    const res = await POST(makeRequest({ password: 'Secret1' }));
    expect(res.status).toBe(401);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when password is too short', async () => {
    setupSession({ uid: 'uid-123', email: 'raj@example.com', role: 'family-manager' });
    const res = await POST(makeRequest({ password: 'Ab1' }));
    expect(res.status).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when password is too long (>128 chars)', async () => {
    setupSession({ uid: 'uid-123', email: 'raj@example.com', role: 'family-manager' });
    const res = await POST(makeRequest({ password: 'A1' + 'x'.repeat(128) }));
    expect(res.status).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when password has no digit', async () => {
    setupSession({ uid: 'uid-123', email: 'raj@example.com', role: 'family-manager' });
    const res = await POST(makeRequest({ password: 'OnlyLetters' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('digit');
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when password has no letter', async () => {
    setupSession({ uid: 'uid-123', email: 'raj@example.com', role: 'family-manager' });
    const res = await POST(makeRequest({ password: '12345678' }));
    expect(res.status).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when claims have no email', async () => {
    setupSession({ uid: 'uid-123', role: 'family-manager' });
    const res = await POST(makeRequest({ password: 'Secret123' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('no-email-on-session');
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('happy path: calls updateUser with email+password and returns 200', async () => {
    setupSession({ uid: 'uid-123', email: 'raj@example.com', role: 'family-manager' });
    const res = await POST(makeRequest({ password: 'Secret123' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockUpdateUser).toHaveBeenCalledWith('uid-123', {
      email: 'raj@example.com',
      password: 'Secret123',
    });
  });
});
