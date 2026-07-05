import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockGetAll, mockBatchSet, mockBatchCommit, docRefs } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockGetAll: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchCommit: vi.fn(),
  docRefs: {} as Record<string, unknown>,
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const doc = vi.fn((id: string) => {
    const ref = { __id: id, get: mockGet };
    docRefs[id] = ref;
    return ref;
  });
  const collection = vi.fn(() => ({ doc }));
  return {
    portalFirestore: () => ({
      collection,
      // findMissingLevelIds (assignTeacher's phantom guard) reads existence here.
      getAll: mockGetAll,
      batch: () => ({ set: mockBatchSet, commit: mockBatchCommit }),
    }),
    FieldValue: {
      arrayUnion: (v: unknown) => ({ __arrayUnion: v }),
      arrayRemove: (v: unknown) => ({ __arrayRemove: v }),
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
  };
});

import { getTeacherLevelIds, isTeacherAssigned, assignTeacher } from '../assignments';

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchCommit.mockResolvedValue(undefined);
  // Default: every level referenced in a getAll() exists (drives findMissingLevelIds
  // → nothing skipped). Keyed by ref.__id so tests can mark specific ids missing.
  mockGetAll.mockImplementation((...refs: Array<{ __id: string }>) =>
    Promise.resolve(refs.map((r) => ({ exists: r.__id !== 'ghost' }))),
  );
});

describe('getTeacherLevelIds', () => {
  it('returns [] when no doc exists', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await getTeacherLevelIds('CMT-X-01')).toEqual([]);
  });

  it('returns levelIds from the doc, filtering empties', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ ref: 'CMT-X-01', levelIds: ['l1', '', 'l2'] }),
    });
    expect(await getTeacherLevelIds('CMT-X-01')).toEqual(['l1', 'l2']);
  });
});

describe('isTeacherAssigned', () => {
  it('false when no levels', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ ref: 'x', levelIds: [] }) });
    expect(await isTeacherAssigned('x')).toBe(false);
  });
  it('true when at least one level', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ ref: 'x', levelIds: ['l1'] }) });
    expect(await isTeacherAssigned('x')).toBe(true);
  });
});

describe('assignTeacher', () => {
  it('writes the assignment doc and arrayUnions newly-added levels', async () => {
    mockGet.mockResolvedValue({ exists: false }); // no prior assignment
    const res = await assignTeacher({ ref: 'CMT-X-01', levelIds: ['l1', 'l2'], byUid: 'uid-admin' });

    expect(res).toEqual({ added: ['l1', 'l2'], removed: [], skipped: [] });
    // assignment doc set
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ __id: 'CMT-X-01' }),
      expect.objectContaining({
        ref: 'CMT-X-01',
        levelIds: ['l1', 'l2'],
        updatedAt: 'SERVER_TIMESTAMP',
        updatedByUid: 'uid-admin',
      }),
      { merge: true },
    );
    // each added level gets arrayUnion(ref)
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ __id: 'l1' }),
      { teacherRefs: { __arrayUnion: 'CMT-X-01' } },
      { merge: true },
    );
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ __id: 'l2' }),
      { teacherRefs: { __arrayUnion: 'CMT-X-01' } },
      { merge: true },
    );
    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });

  it('arrayRemoves levels dropped from a prior assignment', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ ref: 'CMT-X-01', levelIds: ['l1', 'l2'] }),
    });
    const res = await assignTeacher({ ref: 'CMT-X-01', levelIds: ['l2', 'l3'], byUid: 'uid-w' });

    expect(res).toEqual({ added: ['l3'], removed: ['l1'], skipped: [] });
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ __id: 'l3' }),
      { teacherRefs: { __arrayUnion: 'CMT-X-01' } },
      { merge: true },
    );
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ __id: 'l1' }),
      { teacherRefs: { __arrayRemove: 'CMT-X-01' } },
      { merge: true },
    );
  });

  it('clearing all levels arrayRemoves every prior level', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ ref: 'CMT-X-01', levelIds: ['l1'] }),
    });
    const res = await assignTeacher({ ref: 'CMT-X-01', levelIds: [], byUid: 'uid-admin' });
    expect(res).toEqual({ added: [], removed: ['l1'], skipped: [] });
  });

  it('skips a non-existent level — never mints a phantom teacherRefs-only doc', async () => {
    mockGet.mockResolvedValue({ exists: false }); // no prior assignment
    // 'ghost' has no level doc (default getAll marks it missing).
    const res = await assignTeacher({ ref: 'CMT-X-01', levelIds: ['l1', 'ghost'], byUid: 'uid-admin' });

    expect(res).toEqual({ added: ['l1'], removed: [], skipped: ['ghost'] });
    // The assignment doc records only the existing level.
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ __id: 'CMT-X-01' }),
      expect.objectContaining({ levelIds: ['l1'] }),
      { merge: true },
    );
    // l1 gets its teacherRefs union…
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ __id: 'l1' }),
      { teacherRefs: { __arrayUnion: 'CMT-X-01' } },
      { merge: true },
    );
    // …but 'ghost' NEVER receives any write (no phantom created).
    const ghostWrites = mockBatchSet.mock.calls.filter((c) => (c[0] as { __id: string }).__id === 'ghost');
    expect(ghostWrites).toHaveLength(0);
  });
});
