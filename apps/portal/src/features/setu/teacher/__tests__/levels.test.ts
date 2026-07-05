import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAll, mockGet, mockWhere, mockGetLiveYear } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockGet: vi.fn(),
  mockWhere: vi.fn(),
  mockGetLiveYear: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  // One chainable object serves both shapes levels.ts uses: `.doc(id)` (getAll
  // path in findMissingLevelIds) and `.where().where().get()` (getMyLevels).
  const query = {
    doc: (id: string) => ({ __id: id }),
    where: (...args: unknown[]) => {
      mockWhere(...args);
      return query;
    },
    get: mockGet,
  };
  return {
    portalFirestore: () => ({ getAll: mockGetAll, collection: () => query }),
    // levels.ts imports Timestamp only for a `ReturnType<typeof Timestamp.now>`
    // type; a minimal stub is enough at runtime.
    Timestamp: { now: () => ({ toDate: () => new Date() }) },
  };
});

vi.mock('@/features/setu/rollover/live-school-year', () => ({
  getLiveSchoolYearCached: mockGetLiveYear,
}));

import { findMissingLevelIds, getMyLevels } from '../levels';

beforeEach(() => vi.clearAllMocks());

/** A fake levels/ doc whose data() carries Timestamp createdAt/updatedAt so
 *  docToLevel(.toDate()) works. */
function levelDoc(fields: {
  levelId: string;
  levelName: string;
  location: string;
  order: number;
  periodLabel: string;
}) {
  const now = { toDate: () => new Date() };
  return {
    data: () => ({
      levelId: fields.levelId,
      programKey: 'bala-vihar',
      location: fields.location,
      levelName: fields.levelName,
      levelKind: 'level',
      order: fields.order,
      gradeBand: ['1'],
      curriculum: 'Krishna Krishna',
      pid: `bv-${fields.location.toLowerCase()}-${fields.periodLabel}`,
      periodLabel: fields.periodLabel,
      teacherRefs: ['T-1'],
      enabled: true,
      createdAt: now,
      createdBy: 'x',
      updatedAt: now,
      updatedBy: 'x',
    }),
  };
}

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

describe('getMyLevels', () => {
  it('returns [] for a null ref without touching Firestore or the live year', async () => {
    expect(await getMyLevels(null)).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockGetLiveYear).not.toHaveBeenCalled();
  });

  it('keeps ONLY the live school year — a teacher on both years\' Level 1 sees one card', async () => {
    mockGetLiveYear.mockResolvedValue('2026-27');
    mockGet.mockResolvedValue({
      docs: [
        levelDoc({ levelId: 'brampton-level-1-bv-brampton-2025-26', levelName: 'Level 1', location: 'Brampton', order: 2, periodLabel: '2025-26' }),
        levelDoc({ levelId: 'brampton-level-1-bv-brampton-2026-27', levelName: 'Level 1', location: 'Brampton', order: 2, periodLabel: '2026-27' }),
      ],
    });

    const levels = await getMyLevels('T-1');
    expect(levels).toHaveLength(1);
    expect(levels[0]!.levelId).toBe('brampton-level-1-bv-brampton-2026-27');
    expect(levels[0]!.periodLabel).toBe('2026-27');
  });

  it('sorts by location then order within the live year', async () => {
    mockGetLiveYear.mockResolvedValue('2026-27');
    mockGet.mockResolvedValue({
      docs: [
        levelDoc({ levelId: 's-b', levelName: 'Level B', location: 'Scarborough', order: 3, periodLabel: '2026-27' }),
        levelDoc({ levelId: 'b-2', levelName: 'Level 2', location: 'Brampton', order: 3, periodLabel: '2026-27' }),
        levelDoc({ levelId: 'b-1', levelName: 'Level 1', location: 'Brampton', order: 2, periodLabel: '2026-27' }),
        levelDoc({ levelId: 'old', levelName: 'Level 1', location: 'Brampton', order: 2, periodLabel: '2025-26' }),
      ],
    });

    const levels = await getMyLevels('T-1');
    expect(levels.map((l) => l.levelId)).toEqual(['b-1', 'b-2', 's-b']); // old-year filtered out
  });
});
