import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet, set: mockSet }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: mockCollection })),
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

import { getLocationOptions, setLocationOptions, DEFAULT_LOCATIONS } from '../locations';

beforeEach(() => { vi.clearAllMocks(); });

describe('getLocationOptions', () => {
  it('returns the default seed when the config doc does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await getLocationOptions()).toEqual([...DEFAULT_LOCATIONS]);
  });
  it('returns the stored options when the doc exists', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ options: ['Brampton', 'Oakville'] }) });
    expect(await getLocationOptions()).toEqual(['Brampton', 'Oakville']);
  });
  it('falls back to defaults when options is not an array', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ options: 'nope' }) });
    expect(await getLocationOptions()).toEqual([...DEFAULT_LOCATIONS]);
  });
  it('drops non-string entries defensively', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ options: ['Brampton', 7, null, 'Scarborough'] }) });
    expect(await getLocationOptions()).toEqual(['Brampton', 'Scarborough']);
  });
});

describe('DEFAULT_LOCATIONS', () => {
  it('is exactly Brampton then Scarborough', () => {
    expect([...DEFAULT_LOCATIONS]).toEqual(['Brampton', 'Scarborough']);
  });
});

describe('setLocationOptions', () => {
  it('writes the options array with a server timestamp', async () => {
    mockSet.mockResolvedValue(undefined);
    await setLocationOptions(['Brampton', 'Scarborough']);
    expect(mockSet).toHaveBeenCalledWith({ options: ['Brampton', 'Scarborough'], updatedAt: 'SERVER_TS' });
  });
});
