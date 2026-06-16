import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/check-in/shared', () => ({
  checkAndRecordOtpRateLimit: vi.fn(),
  LOOKUP_RATE_LIMIT_MAX: 30,
}));
vi.mock('@/features/setu/registration/family-lookup', () => ({
  lookupFamilyByContacts: vi.fn(),
  lookupFamilyByContactList: vi.fn(),
}));

import { POST } from '../route';
import { checkAndRecordOtpRateLimit } from '@/features/check-in/shared';
import { lookupFamilyByContactList } from '@/features/setu/registration/family-lookup';

function makeRequest(body: unknown, ip = '1.2.3.4') {
  return new Request('http://localhost/api/setu/family-lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
  (lookupFamilyByContactList as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe('POST /api/setu/family-lookup', () => {
  it('accepts a phone-only legacy body', async () => {
    const res = await POST(makeRequest({ phone: '4165551234' }));
    expect(res.status).toBe(200);
  });

  it('accepts an email-only legacy body', async () => {
    const res = await POST(makeRequest({ email: 'raj@example.com' }));
    expect(res.status).toBe(200);
  });

  it('returns 429 when rate limited', async () => {
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({
      allowed: false,
      resetAt: '2026-05-22T12:00:00.000Z',
    });
    const res = await POST(makeRequest({ email: 'raj@example.com', phone: '4165551234' }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.resetAt).toBe('2026-05-22T12:00:00.000Z');
  });

  it('returns 200 with match=null when no family found', async () => {
    (lookupFamilyByContactList as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeRequest({ email: 'new@example.com', phone: '4165559999' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.match).toBeNull();
  });

  it('returns 200 with a minimal, PII-free match when found', async () => {
    (lookupFamilyByContactList as ReturnType<typeof vi.fn>).mockResolvedValue({
      found: true,
      matchedType: 'email',
      matchedValue: 'raj@example.com',
    });
    const res = await POST(makeRequest({ email: 'raj@example.com', phone: '4165551234' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only the caller's own matched contact — no family name/location/members.
    expect(body.match).toEqual({ found: true, matchedType: 'email', matchedValue: 'raj@example.com' });
  });

  it('maps legacy { email, phone } body to a contact list', async () => {
    await POST(makeRequest({ email: 'raj@example.com', phone: '4165551234' }));
    expect(lookupFamilyByContactList).toHaveBeenCalledWith([
      { type: 'email', value: 'raj@example.com' },
      { type: 'phone', value: '4165551234' },
    ]);
  });

  it('accepts { emails, phones } arrays and forwards every contact', async () => {
    await POST(makeRequest({
      emails: ['a@example.com', 'b@example.com'],
      phones: ['4165550000', '4165550001'],
    }));
    expect(lookupFamilyByContactList).toHaveBeenCalledWith([
      { type: 'email', value: 'a@example.com' },
      { type: 'email', value: 'b@example.com' },
      { type: 'phone', value: '4165550000' },
      { type: 'phone', value: '4165550001' },
    ]);
  });

  it('returns 400 when neither legacy pair nor arrays are present', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the emails array exceeds the cap (>10)', async () => {
    const emails = Array.from({ length: 11 }, (_, i) => `u${i}@example.com`);
    const res = await POST(makeRequest({ emails }));
    expect(res.status).toBe(400);
  });

  it('rate-limits with the lenient lookup bucket (not the strict OTP-send limit)', async () => {
    await POST(makeRequest({ email: 'raj@example.com', phone: '4165551234' }, '9.9.9.9'));
    expect(checkAndRecordOtpRateLimit).toHaveBeenCalledWith('family-lookup:9.9.9.9', 30);
  });

  it('always returns 200 for unknown contacts (no enumeration difference)', async () => {
    const res = await POST(makeRequest({ email: 'unknown@example.com', phone: '4165550000' }));
    expect(res.status).toBe(200);
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest({ email: 'raj@example.com', phone: '4165551234' }));
    expect(res.status).toBe(404);
  });
});
