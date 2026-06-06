import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet, set: mockSet }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: mockCollection })),
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

import { getSevaRequirement, setSevaRequirement, DEFAULT_SEVA_REQUIREMENT } from '../seva-requirement';

beforeEach(() => vi.clearAllMocks());

describe('getSevaRequirement', () => {
  it('returns the default when the doc is missing', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await getSevaRequirement()).toEqual(DEFAULT_SEVA_REQUIREMENT);
  });
  it('returns stored config', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ hoursPerYear: 25, currentSevaYear: '2025-26' }) });
    expect(await getSevaRequirement()).toEqual({ hoursPerYear: 25, currentSevaYear: '2025-26' });
  });
  it('falls back to defaults for malformed data', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ hoursPerYear: 'oops' }) });
    expect(await getSevaRequirement()).toEqual(DEFAULT_SEVA_REQUIREMENT);
  });
});

describe('setSevaRequirement', () => {
  it('writes config with a server timestamp', async () => {
    mockSet.mockResolvedValue(undefined);
    await setSevaRequirement({ hoursPerYear: 20, currentSevaYear: '2025-26' });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ hoursPerYear: 20, currentSevaYear: '2025-26', updatedAt: 'SERVER_TS' }),
    );
  });
});
