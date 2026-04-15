import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeDoc = { get: vi.fn(), set: vi.fn() };
const fakeCollection = { doc: vi.fn(() => fakeDoc) };

// Transaction mock: calls the callback with a tx object that delegates to fakeDoc
const fakeTx = {
  get: vi.fn(async () => fakeDoc.get()),
  set: vi.fn((ref: unknown, data: unknown) => fakeDoc.set(data)),
};
const fakeFirestore = {
  collection: vi.fn(() => fakeCollection),
  runTransaction: vi.fn(async (cb: (tx: typeof fakeTx) => Promise<unknown>) => cb(fakeTx)),
};

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
  fakeTx.get.mockReset();
  fakeTx.set.mockReset();
  fakeFirestore.runTransaction.mockReset();
  // Restore default transaction behaviour
  fakeFirestore.runTransaction.mockImplementation(
    async (cb: (tx: typeof fakeTx) => Promise<unknown>) => cb(fakeTx),
  );
  fakeTx.get.mockImplementation(async () => fakeDoc.get());
  fakeTx.set.mockImplementation((_ref: unknown, data: unknown) => fakeDoc.set(data));
});

describe('checkAndRecordOtpRateLimit', () => {
  it('allows the first send', async () => {
    fakeDoc.get.mockResolvedValueOnce({ exists: false });
    const result = await checkAndRecordOtpRateLimit('a@b.com');
    expect(result.allowed).toBe(true);
    expect(fakeFirestore.runTransaction).toHaveBeenCalled();
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

  // Firestore transaction semantics (runTransaction auto-retries on contention)
  // handle concurrent requests serializing correctly. The mock validates the
  // happy-path logic; true concurrency is guaranteed by Firestore, not unit tests.
  it('uses runTransaction to serialize concurrent requests', async () => {
    fakeDoc.get.mockResolvedValueOnce({ exists: false });
    await checkAndRecordOtpRateLimit('a@b.com');
    expect(fakeFirestore.runTransaction).toHaveBeenCalledOnce();
  });
});
