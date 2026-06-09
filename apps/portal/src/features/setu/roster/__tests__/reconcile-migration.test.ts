import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listAllFamilies, listSetuLegacyFids } = vi.hoisted(() => ({
  listAllFamilies: vi.fn(),
  listSetuLegacyFids: vi.fn(),
}));
vi.mock('@/features/check-in/shared/rtdb/family-lookup', () => ({ listAllFamilies }));
vi.mock('../setu-legacy-fids', () => ({ listSetuLegacyFids }));

import { getMigrationStatus } from '../reconcile-migration';

beforeEach(() => { listAllFamilies.mockReset(); listSetuLegacyFids.mockReset(); });

describe('getMigrationStatus', () => {
  it('flags legacy fids absent from Setu families', async () => {
    listAllFamilies.mockResolvedValue([{ fid: '1' }, { fid: '2' }, { fid: '3' }]);
    listSetuLegacyFids.mockResolvedValue(new Set(['1', '2']));
    const res = await getMigrationStatus({ checkedAt: '2026-06-09T00:00:00.000Z' });
    expect(res.legacyTotal).toBe(3);
    expect(res.migrated).toBe(2);
    expect(res.missing).toBe(1);
    expect(res.missingFids).toEqual(['3']);
    expect(res.checkedAt).toBe('2026-06-09T00:00:00.000Z');
  });

  it('reports zero missing when all legacy fids are migrated', async () => {
    listAllFamilies.mockResolvedValue([{ fid: '1' }]);
    listSetuLegacyFids.mockResolvedValue(new Set(['1']));
    const res = await getMigrationStatus({ checkedAt: 'x' });
    expect(res.missing).toBe(0);
    expect(res.missingFids).toEqual([]);
  });
});
