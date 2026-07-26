import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: vi.fn((type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : value.replace(/\D/g, ''),
  ),
  checkAndRecordOtpRateLimit: vi.fn(),
  storeVerificationCode: vi.fn(),
  REGISTER_RATE_LIMIT_MAX: 10,
}));
vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: vi.fn(),
}));
vi.mock('@/features/setu/auth/find-family-by-contact', () => ({
  findSetuFamilyByContact: vi.fn(),
}));
vi.mock('@/features/setu/auth/magic-links', () => ({
  createMagicLink: vi.fn(),
}));

import { POST } from '../route';
import { checkAndRecordOtpRateLimit, storeVerificationCode } from '@/features/check-in/shared';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import { createMagicLink } from '@/features/setu/auth/magic-links';

const mockSendEmail = vi.fn();
const mockSendSMS = vi.fn();
const mockSendSesTemplatedEmail = vi.fn();

function makeRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request('http://localhost/api/setu/auth/send-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (resolveSender as ReturnType<typeof vi.fn>).mockReturnValue({
    sendEmail: mockSendEmail,
    sendSMS: mockSendSMS,
    sendSesTemplatedEmail: mockSendSesTemplatedEmail,
  });
  (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
  (storeVerificationCode as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (createMagicLink as ReturnType<typeof vi.fn>).mockResolvedValue({
    token: 'test-magic-token-abc123',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  mockSendEmail.mockResolvedValue(undefined);
  mockSendSMS.mockResolvedValue(undefined);
});

describe('POST /api/setu/auth/send-code', () => {
  it('returns 400 on bad payload', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
  });

  it('returns 200 when contact not found (no enumeration) — sign-in path sends NOTHING', async () => {
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: null, fid: null, mid: null, legacyFid: null, family: null,
    });
    const res = await POST(makeRequest({ type: 'email', value: 'unknown@example.com' }));
    expect(res.status).toBe(200);
    expect(storeVerificationCode).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('purpose=register DELIVERS a code to a brand-new (unknown) email', async () => {
    // Without this, the OTP-gated registration flow could never send a net-new
    // family its code (the silent-200 above would swallow it).
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: null, fid: null, mid: null, legacyFid: null, family: null,
    });
    const res = await POST(makeRequest({ type: 'email', value: 'brandnew@example.com', purpose: 'register' }));
    expect(res.status).toBe(200);
    expect(storeVerificationCode).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'brandnew@example.com' }));
  });

  it('purpose=register is bounded by a per-IP bucket (429 when the IP bucket is exhausted)', async () => {
    // First call (per-contact) passes, second call (per-IP register-send) fails.
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, resetAt: '2026-06-16T12:00:00.000Z' });
    const res = await POST(
      makeRequest({ type: 'email', value: 'spray@example.com', purpose: 'register' }),
    );
    expect(res.status).toBe(429);
    expect(checkAndRecordOtpRateLimit).toHaveBeenLastCalledWith(expect.stringMatching(/^register-send:/), 10);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('accepts email contact, calls SES sender', async () => {
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-01', legacyFid: null, family: {},
    });
    const res = await POST(makeRequest({ type: 'email', value: 'raj@example.com' }));
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'raj@example.com' }));
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it('email body builds the magic URL from the configured canonical base + has a 6-digit code', async () => {
    const prev = process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    process.env.NEXT_PUBLIC_PORTAL_BASE_URL = 'https://setu.chinmayatoronto.org';
    try {
      (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
        source: 'setu', fid: 'FAM001', mid: 'FAM001-01', legacyFid: null, family: {},
      });
      await POST(makeRequest({ type: 'email', value: 'raj@example.com' }));
      const [emailArg] = (mockSendEmail as ReturnType<typeof vi.fn>).mock.calls[0] as [{ text: string }];
      expect(emailArg.text).toContain(
        'https://setu.chinmayatoronto.org/api/setu/auth/magic/test-magic-token-abc123',
      );
      expect(emailArg.text).toMatch(/\d{6}/);
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
      else process.env.NEXT_PUBLIC_PORTAL_BASE_URL = prev;
    }
  });

  // SECURITY regression: a forged x-forwarded-host must NEVER appear in the
  // emailed magic-link URL (host-header poisoning would hand the victim a real
  // token pointing at the attacker's domain).
  it('ignores a forged x-forwarded-host when building the magic link', async () => {
    const prev = process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    try {
      (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
        source: 'setu', fid: 'FAM001', mid: 'FAM001-01', legacyFid: null, family: {},
      });
      await POST(
        makeRequest({ type: 'email', value: 'raj@example.com' }, { 'x-forwarded-host': 'evil.com' }),
      );
      const [emailArg] = (mockSendEmail as ReturnType<typeof vi.fn>).mock.calls[0] as [{ text: string }];
      expect(emailArg.text).not.toContain('evil.com');
      // Falls back to the trusted prod origin, not the attacker host.
      expect(emailArg.text).toContain('https://cmt-setu.vercel.app/api/setu/auth/magic/');
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
      else process.env.NEXT_PUBLIC_PORTAL_BASE_URL = prev;
    }
  });

  it('sends the sign-in code through the PLAIN sender, never an SES-managed template', async () => {
    // The Setu sign-in OTP is one of the two live OTP paths and it does not go
    // through sendTemplatedEmail at all - it builds its subject and body inline
    // here. Routing it through SES would put every sign-in behind a template
    // edit that ships with no deploy and no review, and a template that fails
    // to render is accepted by SES and delivered to nobody.
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'setu', fid: 'FAM001', mid: 'FAM001-01', legacyFid: null, family: {},
    });

    const res = await POST(makeRequest({ type: 'email', value: 'raj@example.com' }));

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalled();
    expect(mockSendSesTemplatedEmail).not.toHaveBeenCalled();
  });

  // ── SMS sign-in is refused while NEXT_PUBLIC_FEATURE_SMS_OTP is off ────────
  // These two replace the previous "calls SNS with an E.164-canonical phone"
  // pair. The canonicalization guarantee they also covered is identity-critical
  // (changing it re-keys families onto brand-new auth users), so it did NOT go
  // away with them - it lives on normalizeContactForKey's own tests in
  // shared-domain, where it belongs.

  it('refuses a phone contact with a typed 400 while SMS sign-in is off', async () => {
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'legacy', fid: null, mid: null, legacyFid: '42', family: {},
    });
    const res = await POST(makeRequest({ type: 'phone', value: '4165551234' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('sms-signin-unsupported');
    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('refuses BEFORE the family lookup, so a phone reveals nothing about registration', async () => {
    // The anti-enumeration silent 200 below is what normally hides whether a
    // contact is known. A refusal placed after the lookup would answer
    // differently for registered and unregistered numbers.
    const res = await POST(makeRequest({ type: 'phone', value: '4165551234' }));
    expect(res.status).toBe(400);
    expect(findSetuFamilyByContact).not.toHaveBeenCalled();
  });

  it('still sends SMS when the flag is ON, with the E.164-canonical phone', async () => {
    // Keeps the flag real: without this, flipping NEXT_PUBLIC_FEATURE_SMS_OTP on
    // could restore nothing and no test would notice.
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: true, smsOtp: true } }));
    const { POST: flaggedPOST } = await import('../route');
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'legacy', fid: null, mid: null, legacyFid: '42', family: {},
    });

    const res = await flaggedPOST(makeRequest({ type: 'phone', value: '4165551234' }));

    expect(res.status).toBe(200);
    // Canonicalized to +1XXXXXXXXXX before the SNS publish so AWS does not
    // misinterpret the country code on raw 10-digit input.
    expect(mockSendSMS).toHaveBeenCalledWith(expect.objectContaining({ phone: '+14165551234' }));
  });

  it('returns 429 with resetAt when rate limited', async () => {
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({
      allowed: false,
      resetAt: '2026-05-22T12:00:00.000Z',
    });
    const res = await POST(makeRequest({ type: 'email', value: 'raj@example.com' }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.resetAt).toBe('2026-05-22T12:00:00.000Z');
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest({ type: 'email', value: 'raj@example.com' }));
    expect(res.status).toBe(404);
  });
});
