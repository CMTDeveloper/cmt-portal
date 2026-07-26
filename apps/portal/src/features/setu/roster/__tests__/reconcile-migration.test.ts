import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listAllFamilies, listSetuLegacyFids, listDormantLegacyFids } = vi.hoisted(() => ({
  listAllFamilies: vi.fn(),
  listSetuLegacyFids: vi.fn(),
  listDormantLegacyFids: vi.fn(),
}));
vi.mock('@/features/check-in/shared/rtdb/family-lookup', () => ({ listAllFamilies }));
vi.mock('../setu-legacy-fids', () => ({ listSetuLegacyFids }));
vi.mock('@/features/setu/registration/legacy-parser', () => ({ listDormantLegacyFids }));

import { getMigrationStatus } from '../reconcile-migration';

beforeEach(() => {
  listAllFamilies.mockReset();
  listSetuLegacyFids.mockReset();
  listDormantLegacyFids.mockReset();
  listDormantLegacyFids.mockResolvedValue(new Set<string>());
});

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

  // Without this, the bulk migration's deliberate dormant skip would make
  // /welcome/roster show an amber "299 not yet in portal" forever, with no way
  // for staff to tell "skipped on purpose" from "the migration broke" - on a
  // launch-week screen.
  it('excludes deliberately-skipped dormant families from missing, and counts them separately', async () => {
    listAllFamilies.mockResolvedValue([{ fid: '1' }, { fid: '2' }, { fid: '3' }, { fid: '4' }]);
    listSetuLegacyFids.mockResolvedValue(new Set(['1', '2']));
    listDormantLegacyFids.mockResolvedValue(new Set(['3']));

    const res = await getMigrationStatus({ checkedAt: 'x' });

    expect(res.skippedDormant).toBe(1);
    expect(res.legacyTotal).toBe(3); // 4 legacy families minus the 1 skipped
    expect(res.migrated).toBe(2);
    expect(res.missing).toBe(1); // only fid 4 is genuinely missing
    expect(res.missingFids).toEqual(['4']);
  });

  it('reports a clean bill of health when the only absentees are dormant skips', async () => {
    listAllFamilies.mockResolvedValue([{ fid: '1' }, { fid: '2' }]);
    listSetuLegacyFids.mockResolvedValue(new Set(['1']));
    listDormantLegacyFids.mockResolvedValue(new Set(['2']));

    const res = await getMigrationStatus({ checkedAt: 'x' });

    expect(res.missing).toBe(0);
    expect(res.missingFids).toEqual([]);
    expect(res.skippedDormant).toBe(1);
  });

  // A dormant family that came back and signed in IS in Setu. It must not be
  // double-counted as "skipped" once it exists, or the totals stop adding up.
  it('counts a dormant family that has since migrated as migrated, not skipped', async () => {
    listAllFamilies.mockResolvedValue([{ fid: '1' }, { fid: '2' }]);
    listSetuLegacyFids.mockResolvedValue(new Set(['1', '2']));
    listDormantLegacyFids.mockResolvedValue(new Set(['2']));

    const res = await getMigrationStatus({ checkedAt: 'x' });

    expect(res.skippedDormant).toBe(0);
    expect(res.legacyTotal).toBe(2);
    expect(res.migrated).toBe(2);
    expect(res.missing).toBe(0);
  });
});
