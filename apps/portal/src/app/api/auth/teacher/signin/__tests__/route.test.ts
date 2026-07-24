import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  getOrCreateSharedTeacherUser: vi.fn(),
  createPortalCustomToken: vi.fn(),
  SHARED_TEACHER_UID: 'teacher-shared-v1',
}));
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  exchangeCustomTokenForIdToken: vi.fn(),
  createPortalSessionCookie: vi.fn(),
}));

const mockFlags = vi.hoisted(() => ({ checkInTeacher: true }));
vi.mock('@/lib/flags', () => ({ flags: mockFlags }));

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock('@/features/check-in/shared', () => ({
  checkAndRecordOtpRateLimit: mockRateLimit,
  TEACHER_SIGNIN_RATE_LIMIT_MAX: 10,
}));

import {
  getOrCreateSharedTeacherUser,
  createPortalCustomToken,
} from '@cmt/firebase-shared/admin/claims';
import {
  exchangeCustomTokenForIdToken,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  mockFlags.checkInTeacher = true;
  mockRateLimit.mockResolvedValue({ allowed: true });
  process.env.TEACHER_PASSPHRASE = 'TeacherOM!';
  process.env.SESSION_COOKIE_EXPIRES_DAYS = '5';
});

describe('POST /api/auth/teacher/signin', () => {
  it('returns 400 on missing passphrase', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 401 on wrong passphrase without creating any user', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ passphrase: 'wrong' }),
        });
        expect(res.status).toBe(401);
      },
    });
    expect(getOrCreateSharedTeacherUser).not.toHaveBeenCalled();
    // A failed guess consumes the per-IP throttle budget.
    expect(mockRateLimit).toHaveBeenCalledWith(expect.stringContaining('teacher-signin:'), 10);
  });

  it('returns 404 when the teacher flag is off (no work done)', async () => {
    mockFlags.checkInTeacher = false;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ passphrase: 'TeacherOM!' }),
        });
        expect(res.status).toBe(404);
      },
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(getOrCreateSharedTeacherUser).not.toHaveBeenCalled();
  });

  it('returns 429 once the per-IP failure budget is exhausted', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, resetAt: '2026-07-23T00:00:00.000Z' });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ passphrase: 'still-wrong' }),
        });
        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.error).toBe('rate-limited');
      },
    });
    expect(getOrCreateSharedTeacherUser).not.toHaveBeenCalled();
  });

  it('returns 200 + session cookie on correct passphrase', async () => {
    (getOrCreateSharedTeacherUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'teacher-shared-v1',
    });
    (createPortalCustomToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'custom-tok',
    );
    (exchangeCustomTokenForIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'id-tok',
    );
    (createPortalSessionCookie as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'sess-tok',
    );
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ passphrase: 'TeacherOM!' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.redirectTo).toBe('/check-in/teacher');
        expect(res.headers.get('set-cookie')).toMatch(/__session=sess-tok/);
      },
    });
    // A correct sign-in must NOT consume the throttle budget (no venue lockout).
    expect(mockRateLimit).not.toHaveBeenCalled();
  });
});
