import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockCollection = vi.fn();
const mockDocGet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockDocGet }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: mockCollection })),
}));

import { listOpportunities, getOpportunity, serializeOpportunity } from '../get-opportunities';

const ts = (d: Date) => ({ toDate: () => d });
const row = (over = {}) => ({
  oppId: 'o1', title: 'Setup', description: '', date: ts(new Date('2026-01-01')),
  location: 'Hall', defaultHours: 4, capacity: null, sevaYear: '2025-26', status: 'open',
  createdAt: ts(new Date()), createdBy: 'u', updatedAt: ts(new Date()), updatedBy: 'u', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockOrderBy.mockReturnValue({ get: mockGet });
  mockWhere.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy, get: mockGet });
  mockCollection.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy, doc: mockDoc, get: mockGet });
  mockGet.mockResolvedValue({ docs: [{ data: () => row() }] });
});

describe('listOpportunities', () => {
  it('maps docs and applies sevaYear + status filters', async () => {
    const res = await listOpportunities({ sevaYear: '2025-26', status: 'open' });
    expect(res).toHaveLength(1);
    expect(res[0]!.date).toBeInstanceOf(Date);
    expect(mockWhere).toHaveBeenCalledWith('sevaYear', '==', '2025-26');
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'open');
  });
});

describe('getOpportunity', () => {
  it('returns null when missing', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    expect(await getOpportunity('nope')).toBeNull();
  });
});

describe('serializeOpportunity', () => {
  it('ISO-stringifies dates', () => {
    const s = serializeOpportunity({ ...row(), date: new Date('2026-01-01'), createdAt: new Date(), updatedAt: new Date() } as never);
    expect(typeof s.date).toBe('string');
  });
});
