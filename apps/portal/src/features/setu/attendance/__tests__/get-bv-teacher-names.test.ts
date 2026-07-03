import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal in-memory fake: levels/{id}.teacherRefs, and a members collectionGroup
// keyed by mid. Adapt to the repo's existing fake-firestore util if present.
const levels: Record<string, { teacherRefs: string[] }> = {
  'brampton-level-2-p1': { teacherRefs: ['T1', 'T2'] },
  'brampton-shishu-p1': { teacherRefs: [] },
};
const membersByMid: Record<string, { firstName: string; lastName: string }> = {
  T1: { firstName: 'Meera', lastName: 'Rao' },
  T2: { firstName: 'Anil', lastName: 'Kumar' },
};

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: name === 'levels' && id in levels, data: () => levels[id] }),
      }),
    }),
    collectionGroup: (name: string) => ({
      where: (_f: string, _op: string, mids: string[]) => ({
        get: async () => ({
          docs: mids
            .filter((m) => name === 'members' && m in membersByMid)
            .map((m) => ({ data: () => ({ mid: m, ...membersByMid[m] }) })),
        }),
      }),
    }),
  }),
}));

import { getBvTeacherNames } from '../get-bv-teacher-names';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getBvTeacherNames', () => {
  it('maps a level to its teachers\' display names in teacherRefs order', async () => {
    const out = await getBvTeacherNames(['brampton-level-2-p1']);
    expect(out.get('brampton-level-2-p1')).toEqual(['Meera Rao', 'Anil Kumar']);
  });
  it('a level with no teacherRefs maps to an empty array', async () => {
    const out = await getBvTeacherNames(['brampton-shishu-p1']);
    expect(out.get('brampton-shishu-p1')).toEqual([]);
  });
  it('an unknown levelId is absent from the map', async () => {
    const out = await getBvTeacherNames(['does-not-exist']);
    expect(out.has('does-not-exist')).toBe(false);
  });
});
