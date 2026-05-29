import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockEqualTo, mockOrderByChild, mockRef } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockEqualTo: vi.fn(),
  mockOrderByChild: vi.fn(),
  mockRef: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  masterRtdb: () => ({ ref: mockRef }),
}));

function setRows(rowsByCall: Array<Record<string, { fid: string | number; payment?: string }> | null>) {
  let call = 0;
  mockGet.mockImplementation(async () => ({ val: () => rowsByCall[Math.min(call++, rowsByCall.length - 1)] }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEqualTo.mockReturnValue({ get: mockGet });
  mockOrderByChild.mockReturnValue({ equalTo: mockEqualTo });
  mockRef.mockReturnValue({ orderByChild: mockOrderByChild });
});

import { getLegacyPaymentStatus } from '../legacy-payment';

describe('getLegacyPaymentStatus', () => {
  it('returns unknown with no legacyFid (no RTDB read)', async () => {
    expect(await getLegacyPaymentStatus(null)).toBe('unknown');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns paid when all matching rows are paid', async () => {
    setRows([{ r1: { fid: '42', payment: 'Paid' }, r2: { fid: '42', payment: 'paid' } }]);
    expect(await getLegacyPaymentStatus('42')).toBe('paid');
    expect(mockEqualTo).toHaveBeenCalledWith('42');
  });

  it('returns unpaid when any row is unpaid/due', async () => {
    setRows([{ r1: { fid: '42', payment: 'paid' }, r2: { fid: '42', payment: 'Unpaid' } }]);
    expect(await getLegacyPaymentStatus('42')).toBe('unpaid');
  });

  it('returns partial when any row is partial (and none unpaid)', async () => {
    setRows([{ r1: { fid: '42', payment: 'partial' }, r2: { fid: '42', payment: 'paid' } }]);
    expect(await getLegacyPaymentStatus('42')).toBe('partial');
  });

  it('returns unknown when no rows match', async () => {
    setRows([null, null]);
    expect(await getLegacyPaymentStatus('999')).toBe('unknown');
  });

  it('falls back to a numeric fid query when the string query is empty', async () => {
    // first (string) query empty, second (numeric) query has a paid row
    setRows([null, { r1: { fid: 42, payment: 'paid' } }]);
    expect(await getLegacyPaymentStatus('42')).toBe('paid');
    expect(mockEqualTo).toHaveBeenNthCalledWith(1, '42');
    expect(mockEqualTo).toHaveBeenNthCalledWith(2, 42);
  });

  it('returns unknown (not throw) if the RTDB read errors', async () => {
    mockGet.mockRejectedValue(new Error('rtdb down'));
    expect(await getLegacyPaymentStatus('42')).toBe('unknown');
  });
});
