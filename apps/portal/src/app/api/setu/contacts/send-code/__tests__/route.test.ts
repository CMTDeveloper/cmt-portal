import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: vi.fn((type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : value.replace(/\D/g, ''),
  ),
  checkAndRecordOtpRateLimit: vi.fn(),
  CONTACTS_SEND_PER_SENDER_MAX: 10,
  storeVerificationCode: vi.fn(),
}));
vi.mock('@/lib/aws/resolve-sender', () => ({ resolveSender: vi.fn() }));
vi.mock('@cmt/shared-domain/setu', () => ({
  normalizeContactForKey: (type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : `+1${value.replace(/\D/g, '')}`,
}));

import { POST } from '../route';
import { checkAndRecordOtpRateLimit, storeVerificationCode } from '@/features/check-in/shared';
import { resolveSender } from '@/lib/aws/resolve-sender';

const mockSendEmail = vi.fn();
const mockSendSMS = vi.fn();

// The route authenticates from the middleware-set x-portal-* headers (cookie
// AND Bearer/mobile sessions). Pass session: null for a signed-out request.
const SIGNED_IN = { role: 'family-member', fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-02' };

function makeRequest(body: unknown, session: typeof SIGNED_IN | null = SIGNED_IN) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (session) {
    headers.set('x-portal-role', session.role);
    headers.set('x-portal-fid', session.fid);
    headers.set('x-portal-mid', session.mid);
  }
  return new Request('http://localhost/api/setu/contacts/send-code', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (resolveSender as ReturnType<typeof vi.fn>).mockReturnValue({ sendEmail: mockSendEmail, sendSMS: mockSendSMS });
  (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
  (storeVerificationCode as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  mockSendEmail.mockResolvedValue(undefined);
  mockSendSMS.mockResolvedValue(undefined);
});

describe('POST /api/setu/contacts/send-code', () => {
  it('returns 401 when not signed in', async () => {
    const res = await POST(makeRequest({ type: 'email', value: 'new@example.com' }, null));
    expect(res.status).toBe(401);
  });

  it('returns 400 on bad payload', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
  });

  it('sends an OTP email to the new contact and stores the code', async () => {
    const res = await POST(makeRequest({ type: 'email', value: 'priya.work@example.com' }));
    expect(res.status).toBe(200);
    expect(storeVerificationCode).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'priya.work@example.com' }));
  });

  it('sends an OTP SMS for a phone contact (E.164-canonical)', async () => {
    const res = await POST(makeRequest({ type: 'phone', value: '4165550200' }));
    expect(res.status).toBe(200);
    expect(mockSendSMS).toHaveBeenCalledWith(expect.objectContaining({ phone: '+14165550200' }));
  });

  it('returns 429 when rate limited', async () => {
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, resetAt: '2026-06-05T12:00:00.000Z' });
    const res = await POST(makeRequest({ type: 'email', value: 'new@example.com' }));
    expect(res.status).toBe(429);
  });

  it('consults the per-sender bucket keyed by the current member id', async () => {
    const res = await POST(makeRequest({ type: 'email', value: 'priya.work@example.com' }));
    expect(res.status).toBe(200);
    expect(checkAndRecordOtpRateLimit).toHaveBeenCalledWith('contacts-send:CMT-AB12CD34-02', 10);
  });

  it('returns 429 when the per-sender bucket is exhausted (per-target ok)', async () => {
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ allowed: true }) // per-target passes
      .mockResolvedValueOnce({ allowed: false, resetAt: '2026-06-05T12:00:00.000Z' }); // per-sender exhausted
    const res = await POST(makeRequest({ type: 'email', value: 'new@example.com' }));
    expect(res.status).toBe(429);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest({ type: 'email', value: 'new@example.com' }));
    expect(res.status).toBe(404);
  });
});
