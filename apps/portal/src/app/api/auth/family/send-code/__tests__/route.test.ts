import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', () => ({
  findFamilyByContact: vi.fn(),
  storeVerificationCode: vi.fn(),
  checkAndRecordOtpRateLimit: vi.fn(),
  normalizeContact: (t: string, v: string) =>
    t === 'email' ? v.toLowerCase() : v.replace(/\D/g, ''),
  mockSender: { sendEmail: vi.fn(), sendSMS: vi.fn() },
}));

import {
  findFamilyByContact,
  storeVerificationCode,
  checkAndRecordOtpRateLimit,
  mockSender,
} from '@/features/check-in/shared';

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/family/send-code', () => {
  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'carrier-pigeon', value: 'a@b.com' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 200 but does not send code when family not found', async () => {
    (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (checkAndRecordOtpRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: true,
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'nobody@example.com' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
      },
    });
    expect(storeVerificationCode).not.toHaveBeenCalled();
    expect(mockSender.sendEmail).not.toHaveBeenCalled();
    expect(mockSender.sendSMS).not.toHaveBeenCalled();
  });

  it('still increments rate limit when family not found (enumerator cannot bypass rate limit)', async () => {
    (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (checkAndRecordOtpRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: true,
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'bogus@example.com' }),
        });
        expect(res.status).toBe(200);
      },
    });
    expect(checkAndRecordOtpRateLimit).toHaveBeenCalled();
  });

  it('returns 429 when rate-limited', async () => {
    (checkAndRecordOtpRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: false,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.resetAt).toBeDefined();
      },
    });
  });

  it('stores a code and calls sendEmail on happy path', async () => {
    (checkAndRecordOtpRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: true,
    });
    (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
    });
    (storeVerificationCode as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(200);
      },
    });
    expect(storeVerificationCode).toHaveBeenCalled();
    const calls = (storeVerificationCode as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]).toBeDefined();
    const code = calls[0]?.[1] as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(mockSender.sendEmail).toHaveBeenCalled();
  });

  it('calls sendSMS for phone type', async () => {
    (checkAndRecordOtpRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: true,
    });
    (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'phone', value: '+16475550100' }),
        });
        expect(res.status).toBe(200);
      },
    });
    expect(mockSender.sendSMS).toHaveBeenCalled();
  });
});
