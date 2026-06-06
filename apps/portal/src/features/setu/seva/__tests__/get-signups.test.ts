import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockWhere = vi.fn();
const mockDocGet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockDocGet }));
const mockCollection = vi.fn();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: mockCollection })),
}));

import {
  listFamilySignups, listSignupsForOpp, getSignup, serializeSignup, signupDocId, isActiveSignup,
} from '../get-signups';

const ts = (d: Date) => ({ toDate: () => d });
const row = (over = {}) => ({
  signupId: 'o1__F', oppId: 'o1', fid: 'F', mid: null, sevaYear: '2025-26',
  status: 'signed-up', hoursAwarded: 0, signedUpAt: ts(new Date('2026-01-01')),
  signedUpByMid: 'F-01', confirmedAt: null, confirmedBy: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockWhere.mockReturnValue({ get: mockGet });
  mockCollection.mockReturnValue({ where: mockWhere, doc: mockDoc });
  mockGet.mockResolvedValue({ docs: [{ data: () => row() }] });
});

describe('listFamilySignups', () => {
  it('queries by fid and maps Timestamps to Date', async () => {
    const res = await listFamilySignups('F');
    expect(mockWhere).toHaveBeenCalledWith('fid', '==', 'F');
    expect(res[0]!.signedUpAt).toBeInstanceOf(Date);
  });
});
describe('listSignupsForOpp', () => {
  it('queries by oppId', async () => {
    await listSignupsForOpp('o1');
    expect(mockWhere).toHaveBeenCalledWith('oppId', '==', 'o1');
  });
});
describe('getSignup', () => {
  it('returns null when missing', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    expect(await getSignup('nope')).toBeNull();
  });
  it('maps an existing doc', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => row() });
    expect((await getSignup('o1__F'))!.oppId).toBe('o1');
  });
});
describe('serializeSignup', () => {
  it('ISO-stringifies signedUpAt and confirmedAt', () => {
    const s = serializeSignup({ ...row(), signedUpAt: new Date('2026-01-01'), confirmedAt: new Date('2026-02-01') } as never);
    expect(typeof s.signedUpAt).toBe('string');
    expect(typeof s.confirmedAt).toBe('string');
  });
  it('keeps null confirmedAt null', () => {
    const s = serializeSignup({ ...row(), signedUpAt: new Date(), confirmedAt: null } as never);
    expect(s.confirmedAt).toBeNull();
  });
});
describe('helpers', () => {
  it('signupDocId joins with __', () => { expect(signupDocId('o1','F')).toBe('o1__F'); });
  it('isActiveSignup', () => {
    expect(isActiveSignup({ status: 'signed-up' })).toBe(true);
    expect(isActiveSignup({ status: 'completed' })).toBe(true);
    expect(isActiveSignup({ status: 'cancelled' })).toBe(false);
    expect(isActiveSignup({ status: 'no-show' })).toBe(false);
  });
});
