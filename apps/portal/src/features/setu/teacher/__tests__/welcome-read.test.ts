import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /welcome/levels 500'd in production from day one (Next digest 399933007):
 *
 *   9 FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_ASC index
 *   for collection enrollments and field status.
 *
 * A collection-group query with ANY `where` needs an explicit index — a
 * single-field filter needs a fieldOverride, which `enrollments.status` never
 * had in either project. The previous version of this file mocked
 * `collectionGroup: () => ({ where: () => ({ get }) })`, so the filtered query
 * looked perfectly healthy in tests while failing on every real request.
 *
 * So the mock below REFUSES a filtered collection-group read the way Firestore
 * does. That is the assertion that actually guards this bug; the behavioural
 * tests underneath it would pass against either implementation.
 */

const { mockEnrollGet, mockMembersGet, cgWhereCalls } = vi.hoisted(() => ({
  mockEnrollGet: vi.fn(),
  mockMembersGet: vi.fn(),
  cgWhereCalls: [] as string[],
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collectionGroup: (name: string) => ({
      where: (field: string) => {
        cgWhereCalls.push(`${name}.${field}`);
        throw new Error(
          `9 FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_ASC index for collection ${name} and field ${field}.`,
        );
      },
      get: name === 'enrollments' ? mockEnrollGet : mockMembersGet,
    }),
  }),
}));

import { findUnassignedStudentsByLocation } from '../welcome-read';

const NOW = new Date('2026-01-15T17:00:00Z');

/** One Level-2 (grades 2-3) in Brampton, one Level-5 (grade 5) in Scarborough. */
const LEVELS = [
  { location: 'Brampton', levelKind: 'level' as const, gradeBand: ['2', '3'] },
  { location: 'Scarborough', levelKind: 'level' as const, gradeBand: ['5'] },
];

/** A members collectionGroup doc: the fid comes from ref.parent.parent.id. */
const member = (fid: string, data: Record<string, unknown>) => ({
  ref: { parent: { parent: { id: fid } } },
  data: () => data,
});

beforeEach(() => {
  vi.clearAllMocks();
  cgWhereCalls.length = 0;
  mockEnrollGet.mockResolvedValue({
    docs: [
      { data: () => ({ fid: 'CMT-A', location: 'Brampton', status: 'active' }) },
      { data: () => ({ fid: 'CMT-B', location: 'Scarborough', status: 'active' }) },
      // A withdrawn family must not appear on anyone's worklist.
      { data: () => ({ fid: 'CMT-GONE', location: 'Brampton', status: 'withdrawn' }) },
    ],
  });
});

describe('findUnassignedStudentsByLocation — the query shape that broke prod', () => {
  it('never filters a collection group, so it needs no COLLECTION_GROUP index', async () => {
    mockMembersGet.mockResolvedValue({ docs: [] });
    await expect(findUnassignedStudentsByLocation(LEVELS, NOW)).resolves.toBeInstanceOf(Map);
    expect(cgWhereCalls).toEqual([]);
  });
});

describe('findUnassignedStudentsByLocation — behaviour', () => {
  it('flags a child whose grade matches no level, per location (N=2 locations)', async () => {
    mockMembersGet.mockResolvedValue({
      docs: [
        member('CMT-A', { mid: 'CMT-A-02', firstName: 'OK', lastName: 'Kid', type: 'Child', schoolGrade: 'Grade 2' }),
        member('CMT-A', { mid: 'CMT-A-03', firstName: 'No', lastName: 'Level', type: 'Child', schoolGrade: 'Grade 7' }),
        member('CMT-A', { mid: 'CMT-A-01', firstName: 'Parent', lastName: 'X', type: 'Adult', schoolGrade: null }),
        member('CMT-B', { mid: 'CMT-B-02', firstName: 'Also', lastName: 'Stuck', type: 'Child', schoolGrade: 'Grade 9' }),
        member('CMT-B', { mid: 'CMT-B-03', firstName: 'Fine', lastName: 'Here', type: 'Child', schoolGrade: '5' }),
      ],
    });

    const byLoc = await findUnassignedStudentsByLocation(LEVELS, NOW);

    expect(byLoc.get('Brampton')!.map((u) => u.mid)).toEqual(['CMT-A-03']);
    expect(byLoc.get('Scarborough')!.map((u) => u.mid)).toEqual(['CMT-B-02']);
    // A Brampton child must never leak into the Scarborough worklist.
    expect(byLoc.get('Scarborough')!.map((u) => u.fid)).toEqual(['CMT-B']);
  });

  it('ignores members of families with no ACTIVE enrollment', async () => {
    mockMembersGet.mockResolvedValue({
      docs: [member('CMT-GONE', { mid: 'CMT-GONE-02', firstName: 'Left', lastName: 'Us', type: 'Child', schoolGrade: 'Grade 7' })],
    });
    const byLoc = await findUnassignedStudentsByLocation(LEVELS, NOW);
    expect(byLoc.get('Brampton') ?? []).toEqual([]);
  });

  it('ignores a child the family has retired', async () => {
    mockMembersGet.mockResolvedValue({
      docs: [
        member('CMT-A', { mid: 'CMT-A-04', firstName: 'Retired', lastName: 'Child', type: 'Child', schoolGrade: 'Grade 7', participation: 'inactive' }),
        // Absent participation means ACTIVE — every migrated doc predates the field.
        member('CMT-A', { mid: 'CMT-A-05', firstName: 'Migrated', lastName: 'Child', type: 'Child', schoolGrade: 'Grade 7' }),
      ],
    });
    const byLoc = await findUnassignedStudentsByLocation(LEVELS, NOW);
    expect(byLoc.get('Brampton')!.map((u) => u.mid)).toEqual(['CMT-A-05']);
  });

  it('returns no entry for a location where every child matches a level', async () => {
    mockMembersGet.mockResolvedValue({
      docs: [member('CMT-A', { mid: 'CMT-A-02', firstName: 'OK', lastName: 'Kid', type: 'Child', schoolGrade: '3' })],
    });
    const byLoc = await findUnassignedStudentsByLocation(LEVELS, NOW);
    expect(byLoc.get('Brampton') ?? []).toEqual([]);
  });

  it('sorts by last name then first name', async () => {
    mockMembersGet.mockResolvedValue({
      docs: [
        member('CMT-A', { mid: 'm3', firstName: 'Zoe', lastName: 'Banerjee', type: 'Child', schoolGrade: 'Grade 9' }),
        member('CMT-A', { mid: 'm1', firstName: 'Anil', lastName: 'Anand', type: 'Child', schoolGrade: 'Grade 9' }),
        member('CMT-A', { mid: 'm2', firstName: 'Bala', lastName: 'Anand', type: 'Child', schoolGrade: 'Grade 9' }),
      ],
    });
    const byLoc = await findUnassignedStudentsByLocation(LEVELS, NOW);
    expect(byLoc.get('Brampton')!.map((u) => u.mid)).toEqual(['m1', 'm2', 'm3']);
  });

  it('does not throw on a member doc missing a name', async () => {
    // A blank cell on a read-only worklist beats a 500 that takes out the
    // whole Welcome section, which is what `lastName.localeCompare` would do.
    mockMembersGet.mockResolvedValue({
      docs: [member('CMT-A', { mid: 'CMT-A-09', type: 'Child', schoolGrade: 'Grade 9' })],
    });
    const byLoc = await findUnassignedStudentsByLocation(LEVELS, NOW);
    expect(byLoc.get('Brampton')!.map((u) => u.mid)).toEqual(['CMT-A-09']);
  });
});
