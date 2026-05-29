import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockBatchSet, mockBatchCommit, docRefs } = vi.hoisted(() => ({
  mockGet: vi.fn(),
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

    expect(res).toEqual({ added: ['l1', 'l2'], removed: [] });
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

    expect(res).toEqual({ added: ['l3'], removed: ['l1'] });
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
    expect(res).toEqual({ added: [], removed: ['l1'] });
  });
});
