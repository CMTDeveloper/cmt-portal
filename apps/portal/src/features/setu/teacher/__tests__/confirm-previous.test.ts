import { it, expect, vi, beforeEach } from 'vitest';

const { mockDerive, mockEnsure } = vi.hoisted(() => ({ mockDerive: vi.fn(), mockEnsure: vi.fn() }));
vi.mock('../roster', () => ({ deriveRoster: mockDerive }));
vi.mock('@/features/setu/enrollment/ensure-public-fid', () => ({ ensurePublicFid: mockEnsure }));

const setMock = vi.fn();
const batchMock = { set: setMock, commit: vi.fn(async () => undefined) };
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ batch: () => batchMock, collection: () => ({ doc: (id: string) => ({ id }) }) }),
  FieldValue: { serverTimestamp: () => 'ts' },
}));
vi.mock('@cmt/shared-domain', () => ({ attendanceAid: (l: string, m: string, d: string) => `${l}:${m}:${d}` }));

import { confirmPreviousStudent } from '../confirm-previous';

beforeEach(() => { mockDerive.mockReset(); setMock.mockReset(); mockEnsure.mockReset(); });

const roster = (prev: Array<{ mid: string; fid: string }>) => ({
  levelId: 'L', pid: 'o', date: '2026-01-18', members: [], previousStudents: prev, total: 0, previousTotal: prev.length, markedCount: 0,
  levelName: 'Level 2', ageLabel: 'Gr 2 & 3', location: 'Brampton',
});

it('writes one present event for a previous student and returns the fid', async () => {
  mockDerive.mockResolvedValue(roster([{ mid: 'C-02', fid: 'C' }, { mid: 'D-02', fid: 'D' }]));
  const res = await confirmPreviousStudent({ levelId: 'L', mid: 'C-02', date: '2026-01-18', markedByUid: 'u', markedByMid: 't' });
  expect(res).toEqual({ ok: true, fid: 'C' });
  expect(setMock).toHaveBeenCalledTimes(1);
  const written = setMock.mock.calls[0]![1];
  expect(written).toMatchObject({ mid: 'C-02', fid: 'C', pid: 'o', status: 'present', isGuest: false });
  // Confirming a carry-forward family mints its publicFid (Model Y2) if it lacks one.
  expect(mockEnsure).toHaveBeenCalledWith('C');
});

it('rejects a mid that is not a previous student (no write)', async () => {
  mockDerive.mockResolvedValue(roster([{ mid: 'C-02', fid: 'C' }]));
  const res = await confirmPreviousStudent({ levelId: 'L', mid: 'X-99', date: '2026-01-18', markedByUid: 'u', markedByMid: 't' });
  expect(res).toEqual({ ok: false, reason: 'not-a-previous-student' });
  expect(setMock).not.toHaveBeenCalled();
  expect(mockEnsure).not.toHaveBeenCalled();
});

it('returns level-not-found when the roster is null', async () => {
  mockDerive.mockResolvedValue(null);
  const res = await confirmPreviousStudent({ levelId: 'nope', mid: 'C-02', date: '2026-01-18', markedByUid: 'u', markedByMid: 't' });
  expect(res).toEqual({ ok: false, reason: 'level-not-found' });
});
