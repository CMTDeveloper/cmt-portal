import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAll } = vi.hoisted(() => ({ mockGetAll: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    getAll: mockGetAll,
    collection: (c: string) => ({ doc: (id: string) => ({ __c: c, __id: id }) }),
  }),
}));

import { findMissingLevelIds } from '../levels';

beforeEach(() => vi.clearAllMocks());

describe('findMissingLevelIds', () => {
  it('returns [] when all level docs exist', async () => {
    mockGetAll.mockResolvedValue([{ exists: true }, { exists: true }]);
    expect(await findMissingLevelIds(['a', 'b'])).toEqual([]);
  });
  it('returns the ids whose docs do not exist (order preserved)', async () => {
    mockGetAll.mockResolvedValue([{ exists: true }, { exists: false }]);
    expect(await findMissingLevelIds(['a', 'ghost'])).toEqual(['ghost']);
  });
  it('returns [] for an empty input without a read', async () => {
    expect(await findMissingLevelIds([])).toEqual([]);
    expect(mockGetAll).not.toHaveBeenCalled();
  });
});
