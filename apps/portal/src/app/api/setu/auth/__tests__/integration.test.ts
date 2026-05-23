import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

// ── Feature flag ──────────────────────────────────────────────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── OTP helpers (check-in shared) ─────────────────────────────────────────────
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: (t: string, v: string) =>
    t === 'email' ? v.trim().toLowerCase() : v.replace(/\D/g, ''),
  checkAndRecordOtpRateLimit: vi.fn(),
  storeVerificationCode: vi.fn(),
  verifyCode: vi.fn(),
  sha256Hex: (s: string) => `sha256:${s}`,
}));

// ── Setu contact lookup ───────────────────────────────────────────────────────
vi.mock('@/features/setu/auth/find-family-by-contact', () => ({
  findSetuFamilyByContact: vi.fn(),
}));

// ── AWS sender ────────────────────────────────────────────────────────────────
const fakeSender = { sendEmail: vi.fn(), sendSMS: vi.fn() };
vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: vi.fn(() => fakeSender),
}));

// ── Firebase admin ────────────────────────────────────────────────────────────
const mockAuth = {
  getUser: vi.fn(),
  createUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
  createCustomToken: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => mockAuth),
}));

vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  setPortalUserClaims: vi.fn(),
  createPortalCustomToken: vi.fn().mockResolvedValue('fake-custom-token'),
}));

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  createPortalSessionCookie: vi.fn().mockResolvedValue('fake-session-cookie'),
  exchangeCustomTokenForIdToken: vi.fn().mockResolvedValue('fake-id-token'),
  verifyPortalSessionCookie: vi.fn(),
}));

import {
  checkAndRecordOtpRateLimit,
  storeVerificationCode,
  verifyCode,
} from '@/features/check-in/shared';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import { createPortalSessionCookie } from '@cmt/firebase-shared/admin/session';

import * as sendCodeHandler from '../send-code/route';
import * as verifyCodeHandler from '../verify-code/route';
import * as signoutHandler from '../signout/route';

const setuFamily = {
  source: 'setu' as const,
  fid: 'FAM001',
  mid: 'FAM001-01',
  legacyFid: null,
  family: { fid: 'FAM001', name: 'Patel' },
};
const legacyFamily = {
  source: 'legacy' as const,
  fid: null,
  mid: null,
  legacyFid: '42',
  family: { fid: '42', name: 'Sharma family' },
};
const noFamily = { source: null, fid: null, mid: null, legacyFid: null, family: null };

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
  (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
  (storeVerificationCode as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue(setuFamily);
  mockAuth.getUser.mockResolvedValue({ uid: 'sha256:a@b.com' });
  mockAuth.createUser.mockResolvedValue({ uid: 'sha256:a@b.com' });
  mockAuth.setCustomUserClaims.mockResolvedValue(undefined);
  mockAuth.createCustomToken.mockResolvedValue('fake-custom-token');
});

// ─────────────────────────────────────────────────────────────────────────────
// send-code → verify-code happy path: existing Setu family
// ─────────────────────────────────────────────────────────────────────────────

describe('send-code + verify-code: Setu family happy path', () => {
  it('send-code stores a code and sends email; verify-code sets cookie and returns /family', async () => {
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue(setuFamily);

    // send-code
    await testApiHandler({
      appHandler: sendCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
      },
    });

    expect(storeVerificationCode).toHaveBeenCalledOnce();
    const storedCode = (storeVerificationCode as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(storedCode).toMatch(/^\d{6}$/);
    expect(fakeSender.sendEmail).toHaveBeenCalledOnce();

    // verify-code with the stored code
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue(setuFamily);

    await testApiHandler({
      appHandler: verifyCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com', code: storedCode }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.redirectTo).toBe('/family');
        // session cookie set
        const setCookie = res.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('__session');
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// send-code → verify-code: legacy family (lazy-migrate path)
// ─────────────────────────────────────────────────────────────────────────────

describe('send-code + verify-code: legacy family hit', () => {
  it('verify-code uses family role + familyId for legacy hit and redirects to /register?contact=verified', async () => {
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue(legacyFamily);
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await testApiHandler({
      appHandler: verifyCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'sharma@example.com', code: '123456' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        // Legacy hit → no Setu family doc yet → redirect to register
        expect(body.redirectTo).toBe('/register?contact=verified');
        const setCookie = res.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('__session');
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify-code: no family at all → stub session + redirect /register
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-code: no family found', () => {
  it('returns redirectTo /register?contact=verified and does NOT set a session cookie', async () => {
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue(noFamily);
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await testApiHandler({
      appHandler: verifyCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'new@example.com', code: '999999' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.redirectTo).toBe('/register?contact=verified');
        // No session cookie when no family found
        expect(createPortalSessionCookie).not.toHaveBeenCalled();
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phone send-code → verify-code happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('phone send-code + verify-code', () => {
  it('sends SMS on send-code and resolves session on verify-code', async () => {
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue(setuFamily);

    await testApiHandler({
      appHandler: sendCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'phone', value: '+14165550100' }),
        });
        expect(res.status).toBe(200);
      },
    });

    expect(fakeSender.sendSMS).toHaveBeenCalledOnce();
    expect(fakeSender.sendEmail).not.toHaveBeenCalled();

    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await testApiHandler({
      appHandler: verifyCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'phone', value: '+14165550100', code: '123456' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.redirectTo).toBe('/family');
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wrong code → 400; verification record not consumed
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-code: wrong code', () => {
  it('returns 400 and does not set a cookie', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await testApiHandler({
      appHandler: verifyCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '000000' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBeDefined();
        expect(createPortalSessionCookie).not.toHaveBeenCalled();
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate-limit on send-code → 429 with resetAt
// ─────────────────────────────────────────────────────────────────────────────

describe('send-code: rate-limited', () => {
  it('returns 429 with resetAt in body', async () => {
    const resetAt = new Date(Date.now() + 60_000).toISOString();
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({
      allowed: false,
      resetAt,
    });

    await testApiHandler({
      appHandler: sendCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.resetAt).toBe(resetAt);
      },
    });

    // Rate limit checked even though we returned early — no code stored
    expect(storeVerificationCode).not.toHaveBeenCalled();
    expect(fakeSender.sendEmail).not.toHaveBeenCalled();
  });

  it('rate limit is checked even when contact is not found (no enumeration bypass)', async () => {
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue(noFamily);

    await testApiHandler({
      appHandler: sendCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'nobody@example.com' }),
        });
        expect(res.status).toBe(200);
      },
    });

    expect(checkAndRecordOtpRateLimit).toHaveBeenCalledOnce();
    expect(storeVerificationCode).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag off → 404
// ─────────────────────────────────────────────────────────────────────────────

describe('feature flag off', () => {
  it('send-code returns 404 when setuAuth=false', async () => {
    flagsMock.setuAuth = false;
    await testApiHandler({
      appHandler: sendCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(404);
      },
    });
    expect(checkAndRecordOtpRateLimit).not.toHaveBeenCalled();
  });

  it('verify-code returns 404 when setuAuth=false', async () => {
    flagsMock.setuAuth = false;
    await testApiHandler({
      appHandler: verifyCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '123456' }),
        });
        expect(res.status).toBe(404);
      },
    });
    expect(verifyCode).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signout: clears cookie and 303 → /
// ─────────────────────────────────────────────────────────────────────────────

describe('signout', () => {
  it('clears __session cookie and redirects 303 to /', async () => {
    await testApiHandler({
      appHandler: signoutHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toMatch(/\/$/);
        const setCookie = res.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('__session=');
        expect(setCookie).toMatch(/max-age=0/i);
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify-code: contact not found during verify should not create session
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-code: send-code never called (no stored code)', () => {
  it('returns 400 when verifyCode returns false (no prior send)', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await testApiHandler({
      appHandler: verifyCodeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '123456' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Concurrent verify calls: only one should succeed (verifyCode is consumed once)
// ─────────────────────────────────────────────────────────────────────────────

describe('concurrent verify-code calls', () => {
  it('only the first concurrent verify succeeds; second gets 400', async () => {
    let callCount = 0;
    (verifyCode as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return callCount === 1; // first call succeeds, subsequent fail
    });
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue(setuFamily);

    const statuses: number[] = [];

    await Promise.all([
      testApiHandler({
        appHandler: verifyCodeHandler,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '123456' }),
          });
          statuses.push(res.status);
        },
      }),
      testApiHandler({
        appHandler: verifyCodeHandler,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '123456' }),
          });
          statuses.push(res.status);
        },
      }),
    ]);

    // One 200 and one 400 — order not guaranteed
    expect(statuses).toContain(200);
    expect(statuses).toContain(400);
  });
});
