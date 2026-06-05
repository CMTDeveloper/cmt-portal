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
vi.mock('@/features/setu/members/get-current-family', () => ({
  getCurrentFamily: vi.fn(),
}));
vi.mock('@cmt/shared-domain/setu', () => ({
  normalizeContactForKey: (type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : `+1${value.replace(/\D/g, '')}`,
}));

import { POST } from '../route';
import { checkAndRecordOtpRateLimit, storeVerificationCode } from '@/features/check-in/shared';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';

const mockSendEmail = vi.fn();
const mockSendSMS = vi.fn();

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setu/contacts/send-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const signedInFamily = {
  family: { fid: 'CMT-AB12CD34', name: 'Patel', location: 'Brampton', legacyFid: null, createdAt: new Date(), managers: ['CMT-AB12CD34-02'], searchKeys: [] },
  members: [{ mid: 'CMT-AB12CD34-02', firstName: 'Priya', lastName: 'Patel', altEmails: [], altPhones: [] }],
  currentMid: 'CMT-AB12CD34-02',
  isManager: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  (resolveSender as ReturnType<typeof vi.fn>).mockReturnValue({ sendEmail: mockSendEmail, sendSMS: mockSendSMS });
  (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
  (storeVerificationCode as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue(signedInFamily);
  mockSendEmail.mockResolvedValue(undefined);
  mockSendSMS.mockResolvedValue(undefined);
});

describe('POST /api/setu/contacts/send-code', () => {
  it('returns 401 when not signed in', async () => {
    (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeRequest({ type: 'email', value: 'new@example.com' }));
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
