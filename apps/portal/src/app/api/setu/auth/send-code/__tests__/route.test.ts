import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: vi.fn((type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : value.replace(/\D/g, ''),
  ),
  checkAndRecordOtpRateLimit: vi.fn(),
  storeVerificationCode: vi.fn(),
}));
vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: vi.fn(),
}));
vi.mock('@/features/setu/auth/find-family-by-contact', () => ({
  findSetuFamilyByContact: vi.fn(),
}));

import { POST } from '../route';
import { checkAndRecordOtpRateLimit, storeVerificationCode } from '@/features/check-in/shared';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';

const mockSendEmail = vi.fn();
const mockSendSMS = vi.fn();

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setu/auth/send-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (resolveSender as ReturnType<typeof vi.fn>).mockReturnValue({
    sendEmail: mockSendEmail,
    sendSMS: mockSendSMS,
  });
  (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
  (storeVerificationCode as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  mockSendEmail.mockResolvedValue(undefined);
  mockSendSMS.mockResolvedValue(undefined);
});

describe('POST /api/setu/auth/send-code', () => {
  it('returns 400 on bad payload', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
  });

  it('returns 200 when contact not found (no enumeration)', async () => {
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: null, fid: null, mid: null, legacyFid: null, family: null,
    });
    const res = await POST(makeRequest({ type: 'email', value: 'unknown@example.com' }));
    expect(res.status).toBe(200);
    expect(storeVerificationCode).not.toHaveBeenCalled();
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

  it('accepts phone contact, calls SNS sender', async () => {
    (findSetuFamilyByContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: 'legacy', fid: null, mid: null, legacyFid: '42', family: {},
    });
    const res = await POST(makeRequest({ type: 'phone', value: '4165551234' }));
    expect(res.status).toBe(200);
    expect(mockSendSMS).toHaveBeenCalledWith(expect.objectContaining({ phone: '4165551234' }));
    expect(mockSendEmail).not.toHaveBeenCalled();
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
