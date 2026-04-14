import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeDoc = { get: vi.fn(), set: vi.fn() };
const fakeCollection = { doc: vi.fn(() => fakeDoc) };
const fakeFirestore = { collection: vi.fn(() => fakeCollection) };

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => fakeFirestore),
}));

import {
  checkAndRecordOtpRateLimit,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
} from '../rate-limit/otp-rate-limit';

beforeEach(() => {
  vi.clearAllMocks();
  fakeDoc.get.mockReset();
  fakeDoc.set.mockReset();
});

describe('checkAndRecordOtpRateLimit', () => {
  it('allows the first send', async () => {
    fakeDoc.get.mockResolvedValueOnce({ exists: false });
    const result = await checkAndRecordOtpRateLimit('a@b.com');
    expect(result.allowed).toBe(true);
    expect(fakeDoc.set).toHaveBeenCalled();
  });

  it('allows the Nth send where N <= RATE_LIMIT_MAX', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ count: RATE_LIMIT_MAX - 1, windowStart: Date.now() - 1000 }),
    });
    const result = await checkAndRecordOtpRateLimit('a@b.com');
    expect(result.allowed).toBe(true);
  });

  it('denies when RATE_LIMIT_MAX is exceeded within the window', async () => {
    const windowStart = Date.now() - 1000;
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ count: RATE_LIMIT_MAX, windowStart }),
    });
    const result = await checkAndRecordOtpRateLimit('a@b.com');
    expect(result.allowed).toBe(false);
    expect(result.resetAt).toBeDefined();
  });

  it('resets when the window has elapsed', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ count: RATE_LIMIT_MAX, windowStart: Date.now() - RATE_LIMIT_WINDOW_MS - 1000 }),
    });
    const result = await checkAndRecordOtpRateLimit('a@b.com');
    expect(result.allowed).toBe(true);
    const calls = (fakeDoc.set as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]).toBeDefined();
    const write = calls[0]?.[0] as { count: number };
    expect(write.count).toBe(1);
  });
});
