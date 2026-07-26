import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadRtdb } = vi.hoisted(() => ({ mockReadRtdb: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({ readRtdb: mockReadRtdb }));

import { listDormantLegacyFids } from '../legacy-parser';

beforeEach(() => {
  mockReadRtdb.mockReset();
});

function rosterRow(o: Record<string, unknown>): Record<string, unknown> {
  return { center: 'NULL', level: 'NULL', grade: 1, fname: 'A', lname: 'B', ...o };
}

describe('listDormantLegacyFids', () => {
  it('groups rows by fid and returns only the dormant families', async () => {
    mockReadRtdb.mockResolvedValue({
      r1: rosterRow({ fid: 100, grade: 99 }), // dormant: no centre, no level
      r2: rosterRow({ fid: 100, grade: 3 }),
      r3: rosterRow({ fid: 200, grade: 99, center: 'Scarborough' }), // real centre
      r4: rosterRow({ fid: 300, grade: 99 }),
      r5: rosterRow({ fid: 300, grade: 5, level: 'Level 3' }), // real level
      r6: rosterRow({ fid: 400, grade: 99 }), // dormant
    });

    const dormant = await listDormantLegacyFids();

    expect(dormant).toEqual(new Set(['100', '400']));
  });

  it('keys fids the same way listAllFamilies does, so the two sets are comparable', async () => {
    // listAllFamilies groups with String(row.fid ?? '') (family-lookup.ts:221).
    // If this used a different normalization, reconcile would subtract a set that
    // never intersects the one it is filtering, and every dormant family would
    // still read as "missing".
    mockReadRtdb.mockResolvedValue({
      r1: rosterRow({ fid: 42, grade: 99 }),
      r2: rosterRow({ fid: '77', grade: 99 }),
    });

    const dormant = await listDormantLegacyFids();

    expect(dormant.has('42')).toBe(true);
    expect(dormant.has('77')).toBe(true);
  });

  it('ignores rows with no fid rather than bucketing them under "undefined"', async () => {
    mockReadRtdb.mockResolvedValue({
      r1: rosterRow({ grade: 99 }), // no fid at all
      r2: rosterRow({ fid: 500, grade: 99 }),
    });

    const dormant = await listDormantLegacyFids();

    expect(dormant).toEqual(new Set(['500']));
  });

  it('returns an empty set when the roster is missing entirely', async () => {
    mockReadRtdb.mockResolvedValue(null);
    expect(await listDormantLegacyFids()).toEqual(new Set());
  });
});
