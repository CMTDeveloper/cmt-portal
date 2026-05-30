import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadRtdb } = vi.hoisted(() => ({ mockReadRtdb: vi.fn() }));

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: mockReadRtdb,
}));

// 'use cache' is a compiler directive (no-op in vitest); the cacheTag/cacheLife
// calls it pairs with must be stubbed so they don't throw outside a Next scope.
vi.mock('next/cache', () => ({
  unstable_cacheTag: vi.fn(),
  unstable_cacheLife: vi.fn(),
}));

/** Set the whole /roster payload returned by readRtdb. */
function setRoster(roster: Record<string, { fid: string | number; payment?: string }> | null) {
  mockReadRtdb.mockResolvedValue(roster);
}

beforeEach(() => {
  vi.clearAllMocks();
});

import { getLegacyPaymentStatus } from '../legacy-payment';

describe('getLegacyPaymentStatus', () => {
  it('returns unknown with no legacyFid (no RTDB read)', async () => {
    expect(await getLegacyPaymentStatus(null)).toBe('unknown');
    expect(mockReadRtdb).not.toHaveBeenCalled();
  });

  it('returns paid when all the family rows are paid', async () => {
    setRoster({
      a: { fid: '42', payment: 'Paid' },
      b: { fid: '42', payment: 'paid' },
      c: { fid: '7', payment: 'Unpaid' },
    });
    expect(await getLegacyPaymentStatus('42')).toBe('paid');
  });

  it('returns unpaid when any family row is unpaid/due', async () => {
    setRoster({ a: { fid: '42', payment: 'paid' }, b: { fid: '42', payment: 'Unpaid' } });
    expect(await getLegacyPaymentStatus('42')).toBe('unpaid');
  });

  it('returns partial when any family row is partial (and none unpaid)', async () => {
    setRoster({ a: { fid: '42', payment: 'partial' }, b: { fid: '42', payment: 'paid' } });
    expect(await getLegacyPaymentStatus('42')).toBe('partial');
  });

  it('returns unknown when no rows match the fid', async () => {
    setRoster({ a: { fid: '7', payment: 'paid' } });
    expect(await getLegacyPaymentStatus('999')).toBe('unknown');
  });

  it('matches a numeric roster fid against a string legacyFid', async () => {
    setRoster({ a: { fid: 42, payment: 'paid' } });
    expect(await getLegacyPaymentStatus('42')).toBe('paid');
  });

  it('returns unknown for an empty/missing roster', async () => {
    setRoster(null);
    expect(await getLegacyPaymentStatus('42')).toBe('unknown');
  });

  it('returns unknown (not throw) if the RTDB read errors', async () => {
    mockReadRtdb.mockRejectedValue(new Error('rtdb down'));
    expect(await getLegacyPaymentStatus('42')).toBe('unknown');
  });
});
