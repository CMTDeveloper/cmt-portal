import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/check-in/shared', () => ({
  checkAndRecordOtpRateLimit: vi.fn(),
  LOOKUP_RATE_LIMIT_MAX: 30,
}));
vi.mock('@/features/setu/registration/family-lookup', () => ({
  lookupFamilyByContacts: vi.fn(),
}));

import { POST } from '../route';
import { checkAndRecordOtpRateLimit } from '@/features/check-in/shared';
import { lookupFamilyByContacts } from '@/features/setu/registration/family-lookup';

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
  (lookupFamilyByContacts as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe('POST /api/setu/family-lookup', () => {
  it('returns 400 on missing email', async () => {
    const res = await POST(makeRequest({ phone: '4165551234' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on missing phone', async () => {
    const res = await POST(makeRequest({ email: 'raj@example.com' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid email format', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email', phone: '4165551234' }));
    expect(res.status).toBe(400);
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
    (lookupFamilyByContacts as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeRequest({ email: 'new@example.com', phone: '4165559999' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.match).toBeNull();
  });

  it('returns 200 with match summary when family found', async () => {
    (lookupFamilyByContacts as ReturnType<typeof vi.fn>).mockResolvedValue({
      fid: 'FAM001ABCD12',
      name: 'Patel',
      location: 'Brampton',
      memberCount: 4,
      managerInitials: 'R.P.',
    });
    const res = await POST(makeRequest({ email: 'raj@example.com', phone: '4165551234' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.match).toEqual({
      fid: 'FAM001ABCD12',
      name: 'Patel',
      location: 'Brampton',
      memberCount: 4,
      managerInitials: 'R.P.',
    });
  });

  it('calls lookupFamilyByContacts with email and phone from request', async () => {
    await POST(makeRequest({ email: 'raj@example.com', phone: '4165551234' }));
    expect(lookupFamilyByContacts).toHaveBeenCalledWith('raj@example.com', '4165551234');
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
