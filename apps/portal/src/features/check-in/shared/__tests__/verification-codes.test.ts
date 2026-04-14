import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeDoc = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
const fakeCollection = { doc: vi.fn(() => fakeDoc) };
const fakeFirestore = { collection: vi.fn(() => fakeCollection) };

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => fakeFirestore),
}));

import {
  storeVerificationCode,
  verifyCode,
  hashContact,
  CODE_TTL_MS,
} from '../firestore/verification-codes';

beforeEach(() => {
  vi.clearAllMocks();
  fakeDoc.set.mockReset();
  fakeDoc.get.mockReset();
  fakeDoc.delete.mockReset();
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
  it('writes to verification_codes/{hash}', async () => {
    await storeVerificationCode('a@b.com', '123456', 'email');
    expect(fakeFirestore.collection).toHaveBeenCalledWith('verification_codes');
    expect(fakeCollection.doc).toHaveBeenCalledWith(hashContact('a@b.com'));
    const calls = (fakeDoc.set as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]).toBeDefined();
    const write = calls[0]?.[0] as { code: string; type: string; expiresAt: number };
    expect(write.code).toBe('123456');
    expect(write.type).toBe('email');
    expect(typeof write.expiresAt).toBe('number');
    expect(write.expiresAt - Date.now()).toBeGreaterThan(CODE_TTL_MS - 1000);
  });
});

describe('verifyCode', () => {
  it('returns true on a matching non-expired code', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ code: '123456', type: 'email', expiresAt: Date.now() + 60_000 }),
    });
    const ok = await verifyCode('a@b.com', '123456', 'email');
    expect(ok).toBe(true);
    expect(fakeDoc.delete).toHaveBeenCalled();
  });

  it('returns false on a wrong code', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ code: '123456', type: 'email', expiresAt: Date.now() + 60_000 }),
    });
    const ok = await verifyCode('a@b.com', '000000', 'email');
    expect(ok).toBe(false);
    expect(fakeDoc.delete).not.toHaveBeenCalled();
  });

  it('returns false on an expired code', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ code: '123456', type: 'email', expiresAt: Date.now() - 1 }),
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
