import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeDoc = { set: vi.fn(), get: vi.fn(), delete: vi.fn(), update: vi.fn() };
const fakeCollection = { doc: vi.fn(() => fakeDoc) };
const fakeFirestore = { collection: vi.fn(() => fakeCollection) };

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => fakeFirestore),
  FieldValue: {
    increment: (n: number) => ({ _increment: n }),
  },
}));

import {
  storeVerificationCode,
  verifyCode,
  hashContact,
  CODE_TTL_MS,
  MAX_VERIFY_ATTEMPTS,
} from '../firestore/verification-codes';

beforeEach(() => {
  vi.clearAllMocks();
  fakeDoc.set.mockReset();
  fakeDoc.get.mockReset();
  fakeDoc.delete.mockReset();
  fakeDoc.update.mockReset();
});

describe('codesEqual (via verifyCode behaviour)', () => {
  it('treats same-length equal codes as matching', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        code: '999999',
        type: 'email',
        expiresAt: Date.now() + 60_000,
        verifyAttempts: 0,
      }),
    });
    const ok = await verifyCode('a@b.com', '999999', 'email');
    expect(ok).toBe(true);
  });

  it('treats different-length inputs as non-matching without throwing', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        code: '123456',
        type: 'email',
        expiresAt: Date.now() + 60_000,
        verifyAttempts: 0,
      }),
    });
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ verifyAttempts: 1 }),
    });
    const ok = await verifyCode('a@b.com', '12345', 'email');
    expect(ok).toBe(false);
  });
});

describe('hashContact', () => {
  it('produces a stable hex digest for the same contact', () => {
    const a = hashContact('a@b.com');
    const b = hashContact('a@b.com');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different contacts', () => {
    expect(hashContact('a@b.com')).not.toBe(hashContact('c@d.com'));
  });
});

describe('storeVerificationCode', () => {
  it('writes to verification_codes/{hash} with verifyAttempts=0', async () => {
    await storeVerificationCode('a@b.com', '123456', 'email');
    expect(fakeFirestore.collection).toHaveBeenCalledWith('verification_codes');
    expect(fakeCollection.doc).toHaveBeenCalledWith(hashContact('a@b.com'));
    const calls = (fakeDoc.set as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]).toBeDefined();
    const write = calls[0]?.[0] as {
      code: string;
      type: string;
      expiresAt: number;
      verifyAttempts: number;
    };
    expect(write.code).toBe('123456');
    expect(write.type).toBe('email');
    expect(typeof write.expiresAt).toBe('number');
    expect(write.expiresAt - Date.now()).toBeGreaterThan(CODE_TTL_MS - 1000);
    expect(write.verifyAttempts).toBe(0);
  });
});

describe('verifyCode', () => {
  it('returns true and deletes the doc on correct code', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        code: '123456',
        type: 'email',
        expiresAt: Date.now() + 60_000,
        verifyAttempts: 0,
      }),
    });
    const ok = await verifyCode('a@b.com', '123456', 'email');
    expect(ok).toBe(true);
    expect(fakeDoc.delete).toHaveBeenCalled();
  });

  it('returns false on a wrong code and does NOT delete doc after one attempt', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        code: '123456',
        type: 'email',
        expiresAt: Date.now() + 60_000,
        verifyAttempts: 0,
      }),
    });
    // After update, get is called again to check attempts count
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        code: '123456',
        type: 'email',
        expiresAt: Date.now() + 60_000,
        verifyAttempts: 1,
      }),
    });
    const ok = await verifyCode('a@b.com', '000000', 'email');
    expect(ok).toBe(false);
    expect(fakeDoc.update).toHaveBeenCalled();
    expect(fakeDoc.delete).not.toHaveBeenCalled();
  });

  it('deletes the doc after MAX_VERIFY_ATTEMPTS wrong attempts', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        code: '123456',
        type: 'email',
        expiresAt: Date.now() + 60_000,
        verifyAttempts: 0,
      }),
    });
    // After update, verifyAttempts has reached MAX_VERIFY_ATTEMPTS
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        code: '123456',
        type: 'email',
        expiresAt: Date.now() + 60_000,
        verifyAttempts: MAX_VERIFY_ATTEMPTS,
      }),
    });
    const ok = await verifyCode('a@b.com', '000000', 'email');
    expect(ok).toBe(false);
    expect(fakeDoc.update).toHaveBeenCalled();
    expect(fakeDoc.delete).toHaveBeenCalled();
  });

  it('returns false on an expired code', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        code: '123456',
        type: 'email',
        expiresAt: Date.now() - 1,
        verifyAttempts: 0,
      }),
    });
    const ok = await verifyCode('a@b.com', '123456', 'email');
    expect(ok).toBe(false);
  });

  it('returns false when no code exists', async () => {
    fakeDoc.get.mockResolvedValueOnce({ exists: false });
    const ok = await verifyCode('a@b.com', '123456', 'email');
    expect(ok).toBe(false);
  });
});
