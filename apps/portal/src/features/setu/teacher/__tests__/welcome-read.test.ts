import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLevelsGet, mockEnrollGet, mockMembersGet } = vi.hoisted(() => ({
  mockLevelsGet: vi.fn(),
  mockEnrollGet: vi.fn(),
  mockMembersGet: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const levelsChain = { where: () => levelsChain, get: mockLevelsGet };
  return {
    portalFirestore: () => ({
      collection: (name: string) => {
        if (name === 'levels') return { where: () => levelsChain };
        // families
        return { doc: () => ({ collection: () => ({ get: mockMembersGet }) }) };
      },
      collectionGroup: () => ({ where: () => ({ get: mockEnrollGet }) }),
    }),
  };
});

import { findUnassignedStudents } from '../welcome-read';

const NOW = new Date('2026-01-15T17:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  // One Level-2 covering grades 2,3 in Brampton
  mockLevelsGet.mockResolvedValue({
    docs: [{ data: () => ({ levelId: 'lvl2', location: 'Brampton', levelKind: 'level', gradeBand: ['2', '3'], enabled: true }) }],
  });
  mockEnrollGet.mockResolvedValue({
    docs: [{ data: () => ({ fid: 'CMT-A', location: 'Brampton', status: 'active' }) }],
  });
});

describe('findUnassignedStudents', () => {
  it('flags a child whose grade matches no level', async () => {
    mockMembersGet.mockResolvedValue({
      docs: [
        { data: () => ({ mid: 'CMT-A-02', firstName: 'OK', lastName: 'Kid', type: 'Child', schoolGrade: 'Grade 2' }) }, // matches lvl2
        { data: () => ({ mid: 'CMT-A-03', firstName: 'No', lastName: 'Level', type: 'Child', schoolGrade: 'Grade 7' }) }, // no match
        { data: () => ({ mid: 'CMT-A-01', firstName: 'Parent', lastName: 'X', type: 'Adult', schoolGrade: null }) }, // adults ignored
      ],
    });
    const out = await findUnassignedStudents('Brampton', NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.mid).toBe('CMT-A-03');
    expect(out[0]!.schoolGrade).toBe('Grade 7');
  });

  it('returns empty when every child matches a level', async () => {
    mockMembersGet.mockResolvedValue({
      docs: [{ data: () => ({ mid: 'CMT-A-02', firstName: 'OK', lastName: 'Kid', type: 'Child', schoolGrade: '3' }) }],
    });
    expect(await findUnassignedStudents('Brampton', NOW)).toEqual([]);
  });
});
