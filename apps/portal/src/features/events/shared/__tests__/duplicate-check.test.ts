import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firestore-adapter — provide a configurable docs array
const mockDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
const mockGet = vi.fn(async () => ({ docs: mockDocs, empty: mockDocs.length === 0 }));
const mockLimit = vi.fn(() => ({ get: mockGet }));
const mockWhere2 = vi.fn(() => ({ limit: mockLimit, get: mockGet }));
const mockWhere1 = vi.fn(() => ({ where: mockWhere2, limit: mockLimit, get: mockGet }));
const mockColRef = { where: mockWhere1 };

vi.mock('../firestore-adapter', () => ({
  registrationsCollection: vi.fn(() => mockColRef),
}));

import { checkExistingRegistration } from '../duplicate-check';

beforeEach(() => {
  mockDocs.length = 0;
  vi.clearAllMocks();
});

describe('checkExistingRegistration — bvFamilyEmail type', () => {
  it('detects old BV Family registration by email (isBvFamily:true, no category field)', async () => {
    mockDocs.push({
      id: 'reg-old-001',
      data: () => ({ email: 'parent@example.com', isBvFamily: true, paymentStatus: 'pending' }),
    });
    // mockGet must reflect current docs
    mockGet.mockResolvedValueOnce({ docs: mockDocs, empty: false });

    const result = await checkExistingRegistration({
      type: 'bvFamilyEmail',
      value: 'parent@example.com',
    });

    expect(result).not.toBeNull();
    expect(result?.registrationId).toBe('reg-old-001');
    expect(result?.paymentStatus).toBe('pending');
  });

  it('detects new BV Family registration by email (category:"bv-family", no isBvFamily field)', async () => {
    mockDocs.push({
      id: 'reg-new-001',
      data: () => ({ email: 'parent@example.com', category: 'bv-family', paymentStatus: 'paid' }),
    });
    mockGet.mockResolvedValueOnce({ docs: mockDocs, empty: false });

    const result = await checkExistingRegistration({
      type: 'bvFamilyEmail',
      value: 'parent@example.com',
    });

    expect(result).not.toBeNull();
    expect(result?.registrationId).toBe('reg-new-001');
    expect(result?.paymentStatus).toBe('paid');
  });

  it('returns null when email matches but record is non-bv (no isBvFamily, no bv-family category)', async () => {
    mockDocs.push({
      id: 'reg-nonbv-001',
      data: () => ({ email: 'other@example.com', category: 'non-bv', paymentStatus: 'pending' }),
    });
    mockGet.mockResolvedValueOnce({ docs: mockDocs, empty: false });

    const result = await checkExistingRegistration({
      type: 'bvFamilyEmail',
      value: 'other@example.com',
    });

    expect(result).toBeNull();
  });

  it('returns null when no docs match the email', async () => {
    // mockDocs is empty
    mockGet.mockResolvedValueOnce({ docs: [], empty: true });

    const result = await checkExistingRegistration({
      type: 'bvFamilyEmail',
      value: 'nobody@example.com',
    });

    expect(result).toBeNull();
  });

  it('defaults paymentStatus to "pending" when field is missing', async () => {
    mockDocs.push({
      id: 'reg-nopayment-001',
      data: () => ({ email: 'parent@example.com', isBvFamily: true }),
    });
    mockGet.mockResolvedValueOnce({ docs: mockDocs, empty: false });

    const result = await checkExistingRegistration({
      type: 'bvFamilyEmail',
      value: 'parent@example.com',
    });

    expect(result?.paymentStatus).toBe('pending');
  });
});

describe('checkExistingRegistration — fid type', () => {
  it('returns registration by fid', async () => {
    mockWhere1.mockReturnValueOnce({ where: mockWhere2, limit: mockLimit, get: mockGet });
    mockLimit.mockReturnValueOnce({ get: mockGet });
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'reg-fid-001', data: () => ({ fid: '42', paymentStatus: 'paid' }) }],
    });

    const result = await checkExistingRegistration({ type: 'fid', value: '42' });

    expect(result?.registrationId).toBe('reg-fid-001');
    expect(result?.paymentStatus).toBe('paid');
  });

  it('returns null when no fid match', async () => {
    mockWhere1.mockReturnValueOnce({ where: mockWhere2, limit: mockLimit, get: mockGet });
    mockLimit.mockReturnValueOnce({ get: mockGet });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    const result = await checkExistingRegistration({ type: 'fid', value: '99' });

    expect(result).toBeNull();
  });
});
