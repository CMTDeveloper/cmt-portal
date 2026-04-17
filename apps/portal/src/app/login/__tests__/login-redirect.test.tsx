import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for session-redirect behavior on the three login pages.
 *
 * Each server component page does:
 *   1. Read the __session cookie via next/headers cookies()
 *   2. Call verifyPortalSessionCookie(session)
 *   3. If claims.role matches the page's role, redirect() to the dashboard
 *   4. Otherwise render the login form
 *
 * Pattern: vi.resetModules() + vi.doMock() + dynamic import() per test,
 * matching the existing codebase pattern (see /check-in/family/__tests__/page.test.tsx).
 *
 * redirect() in Next.js throws internally; we replicate that by making the
 * mock throw a sentinel error so we can assert it was called.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCookieStore(sessionValue: string | undefined) {
  return {
    get: vi.fn((name: string) =>
      name === '__session' && sessionValue !== undefined
        ? { value: sessionValue }
        : undefined,
    ),
  };
}

// ---------------------------------------------------------------------------
// Admin login page
// ---------------------------------------------------------------------------

describe('/login/admin page — session redirect', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('renders the login form when no __session cookie exists', async () => {
    const redirectSpy = vi.fn();
    const verifyMock = vi.fn().mockResolvedValue(null);

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore(undefined)),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/auth/admin-login-form', () => ({
      AdminLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: AdminLoginPage } = await import('../admin/page');
    await AdminLoginPage();

    expect(verifyMock).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('renders the login form when __session cookie is invalid or expired', async () => {
    const redirectSpy = vi.fn();
    const verifyMock = vi.fn().mockResolvedValue(null);

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore('bad-token')),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/auth/admin-login-form', () => ({
      AdminLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: AdminLoginPage } = await import('../admin/page');
    await AdminLoginPage();

    expect(verifyMock).toHaveBeenCalledWith('bad-token');
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('redirects to /check-in/admin when valid session with admin role exists', async () => {
    const redirectSpy = vi.fn(() => {
      throw new Error('NEXT_REDIRECT');
    });
    const verifyMock = vi.fn().mockResolvedValue({ role: 'admin' });

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore('valid-admin-token')),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/auth/admin-login-form', () => ({
      AdminLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: AdminLoginPage } = await import('../admin/page');
    await expect(AdminLoginPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(redirectSpy).toHaveBeenCalledWith('/check-in/admin');
  });

  it('renders the login form when valid session has wrong role (teacher)', async () => {
    const redirectSpy = vi.fn();
    const verifyMock = vi.fn().mockResolvedValue({ role: 'teacher' });

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore('teacher-token')),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/auth/admin-login-form', () => ({
      AdminLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: AdminLoginPage } = await import('../admin/page');
    await AdminLoginPage();

    expect(verifyMock).toHaveBeenCalledWith('teacher-token');
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Teacher login page
// ---------------------------------------------------------------------------

describe('/login/teacher page — session redirect', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('renders the login form when no __session cookie exists', async () => {
    const redirectSpy = vi.fn();
    const verifyMock = vi.fn().mockResolvedValue(null);

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore(undefined)),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/auth/teacher-login-form', () => ({
      TeacherLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: TeacherLoginPage } = await import('../teacher/page');
    await TeacherLoginPage();

    expect(verifyMock).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('renders the login form when __session cookie is invalid or expired', async () => {
    const redirectSpy = vi.fn();
    const verifyMock = vi.fn().mockResolvedValue(null);

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore('bad-token')),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/auth/teacher-login-form', () => ({
      TeacherLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: TeacherLoginPage } = await import('../teacher/page');
    await TeacherLoginPage();

    expect(verifyMock).toHaveBeenCalledWith('bad-token');
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('redirects to /check-in/teacher when valid session with teacher role exists', async () => {
    const redirectSpy = vi.fn(() => {
      throw new Error('NEXT_REDIRECT');
    });
    const verifyMock = vi.fn().mockResolvedValue({ role: 'teacher' });

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore('valid-teacher-token')),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/auth/teacher-login-form', () => ({
      TeacherLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: TeacherLoginPage } = await import('../teacher/page');
    await expect(TeacherLoginPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(redirectSpy).toHaveBeenCalledWith('/check-in/teacher');
  });

  it('renders the login form when valid session has wrong role (family)', async () => {
    const redirectSpy = vi.fn();
    const verifyMock = vi.fn().mockResolvedValue({ role: 'family' });

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore('family-token')),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/auth/teacher-login-form', () => ({
      TeacherLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: TeacherLoginPage } = await import('../teacher/page');
    await TeacherLoginPage();

    expect(verifyMock).toHaveBeenCalledWith('family-token');
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Family login page
// ---------------------------------------------------------------------------

describe('/login/family page — session redirect', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('renders the login form when no __session cookie exists', async () => {
    const redirectSpy = vi.fn();
    const verifyMock = vi.fn().mockResolvedValue(null);

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore(undefined)),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/family', () => ({
      FamilyLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: FamilyLoginPage } = await import('../family/page');
    await FamilyLoginPage();

    expect(verifyMock).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('renders the login form when __session cookie is invalid or expired', async () => {
    const redirectSpy = vi.fn();
    const verifyMock = vi.fn().mockResolvedValue(null);

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore('bad-token')),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/family', () => ({
      FamilyLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: FamilyLoginPage } = await import('../family/page');
    await FamilyLoginPage();

    expect(verifyMock).toHaveBeenCalledWith('bad-token');
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('redirects to /check-in/family when valid session with family role exists', async () => {
    const redirectSpy = vi.fn(() => {
      throw new Error('NEXT_REDIRECT');
    });
    const verifyMock = vi.fn().mockResolvedValue({ role: 'family' });

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore('valid-family-token')),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/family', () => ({
      FamilyLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: FamilyLoginPage } = await import('../family/page');
    await expect(FamilyLoginPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(redirectSpy).toHaveBeenCalledWith('/check-in/family');
  });

  it('renders the login form when valid session has wrong role (admin)', async () => {
    const redirectSpy = vi.fn();
    const verifyMock = vi.fn().mockResolvedValue({ role: 'admin' });

    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue(makeCookieStore('admin-token')),
    }));
    vi.doMock('next/navigation', () => ({ redirect: redirectSpy }));
    vi.doMock('@cmt/firebase-shared/admin/session', () => ({
      verifyPortalSessionCookie: verifyMock,
    }));
    vi.doMock('@/features/check-in/family', () => ({
      FamilyLoginForm: vi.fn().mockReturnValue(null),
    }));

    const { default: FamilyLoginPage } = await import('../family/page');
    await FamilyLoginPage();

    expect(verifyMock).toHaveBeenCalledWith('admin-token');
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});
