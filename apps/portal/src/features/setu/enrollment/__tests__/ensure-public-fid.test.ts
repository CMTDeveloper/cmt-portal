import { describe, it, expect, vi, beforeEach } from 'vitest';

const { allocateFamilyPublicId } = vi.hoisted(() => ({ allocateFamilyPublicId: vi.fn() }));
vi.mock('@/features/setu/ids/public-id-allocator', () => ({ allocateFamilyPublicId }));

const mockGet = vi.fn();
const mockTxnGet = vi.fn();
const mockTxnUpdate = vi.fn();
const mockRunTransaction = vi.fn();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockGet })) })),
    runTransaction: mockRunTransaction,
  })),
}));

import { ensurePublicFid } from '../ensure-public-fid';

beforeEach(() => {
  vi.clearAllMocks();
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) =>
    fn({ get: mockTxnGet, update: mockTxnUpdate }),
  );
});

describe('ensurePublicFid', () => {
  it('returns the existing publicFid without allocating (no burn on re-engagement)', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ publicFid: '5075' }) });
    expect(await ensurePublicFid('CMT-A')).toBe('5075');
    expect(allocateFamilyPublicId).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('mints a new publicFid when the family has none', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
    mockTxnGet.mockResolvedValue({ data: () => ({}) }); // still none inside the txn
    allocateFamilyPublicId.mockResolvedValue('5099');
    expect(await ensurePublicFid('CMT-A')).toBe('5099');
    expect(allocateFamilyPublicId).toHaveBeenCalledOnce();
    expect(mockTxnUpdate).toHaveBeenCalledWith(expect.anything(), { publicFid: '5099' });
  });

  it('keeps the raced-in id and does NOT overwrite when a concurrent mint won (TOCTOU)', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) }); // pre-read: none
    mockTxnGet.mockResolvedValue({ data: () => ({ publicFid: '5100' }) }); // txn read: already set
    allocateFamilyPublicId.mockResolvedValue('5099'); // this pre-allocated id goes unused
    expect(await ensurePublicFid('CMT-A')).toBe('5100');
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  it('returns null when the family does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await ensurePublicFid('CMT-MISSING')).toBeNull();
    expect(allocateFamilyPublicId).not.toHaveBeenCalled();
  });
});
