import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDeriveRoster, mockBatchSet, mockBatchCommit, mockDoc } = vi.hoisted(() => ({
  mockDeriveRoster: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchCommit: vi.fn(),
  mockDoc: vi.fn((id: string) => ({ __id: id })),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  portalFirestore: () => ({
    collection: () => ({ doc: mockDoc }),
    batch: () => ({ set: mockBatchSet, commit: mockBatchCommit }),
  }),
}));
vi.mock('../roster', () => ({ deriveRoster: mockDeriveRoster }));

import { saveAttendance } from '../save-attendance';

const ROSTER = {
  levelId: 'lvl',
  pid: 'bv-brampton-2025-26',
  date: '2025-09-07',
  members: [
    { mid: 'CMT-A-02', fid: 'CMT-A' },
    { mid: 'CMT-B-02', fid: 'CMT-B' },
  ],
  // Unconfirmed carry-forward students are NOT on the confirmed roster, so
  // marks for them must be skipped (never written).
  previousStudents: [{ mid: 'PREV-02', fid: 'PREVFAM' }],
  previousTotal: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchCommit.mockResolvedValue(undefined);
  mockDeriveRoster.mockResolvedValue(ROSTER);
});

describe('saveAttendance', () => {
  it('returns level-not-found when the roster is null', async () => {
    mockDeriveRoster.mockResolvedValue(null);
    const res = await saveAttendance({ levelId: 'nope', date: '2025-09-07', marks: {}, markedByUid: 'u', markedByMid: 'm' });
    expect(res).toEqual({ ok: false, reason: 'level-not-found' });
  });

  it('writes one event per roster mark with composite aid + denormalized fid/pid', async () => {
    const res = await saveAttendance({
      levelId: 'lvl',
      date: '2025-09-07',
      marks: { 'CMT-A-02': 'present', 'CMT-B-02': 'late' },
      markedByUid: 'uid-teacher',
      markedByMid: 'CMT-A-01',
    });
    expect(res).toEqual({ ok: true, saved: 2, skipped: [] });
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    // doc id is the composite aid
    expect(mockDoc).toHaveBeenCalledWith('lvl-CMT-A-02-2025-09-07');
    const firstPayload = mockBatchSet.mock.calls[0]![1] as Record<string, unknown>;
    expect(firstPayload).toMatchObject({
      aid: 'lvl-CMT-A-02-2025-09-07',
      levelId: 'lvl',
      mid: 'CMT-A-02',
      fid: 'CMT-A',
      pid: 'bv-brampton-2025-26',
      date: '2025-09-07',
      status: 'present',
      isGuest: false,
      markedByUid: 'uid-teacher',
      markedByMid: 'CMT-A-01',
    });
    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });

  it('skips marks for mids not on the roster (guest flow handles those)', async () => {
    const res = await saveAttendance({
      levelId: 'lvl',
      date: '2025-09-07',
      marks: { 'CMT-A-02': 'present', 'CMT-Z-99': 'present' },
      markedByUid: 'u',
      markedByMid: null,
    });
    expect(res.ok && res.saved).toBe(1);
    expect(res.ok && res.skipped).toEqual(['CMT-Z-99']);
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
  });

  it('skips marks for previous (unconfirmed) students not on the confirmed roster', async () => {
    const res = await saveAttendance({
      levelId: 'lvl',
      date: '2025-09-07',
      marks: { 'CMT-A-02': 'present', 'PREV-02': 'present' },
      markedByUid: 'u',
      markedByMid: null,
    });
    // PREV-02 is only in previousStudents (unconfirmed), so it never lands on
    // the confirmed roster gate - it is skipped, not written.
    expect(res.ok && res.saved).toBe(1);
    expect(res.ok && res.skipped).toEqual(['PREV-02']);
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockDoc).toHaveBeenCalledWith('lvl-CMT-A-02-2025-09-07');
  });

  it('uses merge:true so re-marking overwrites the same aid (idempotent)', async () => {
    await saveAttendance({ levelId: 'lvl', date: '2025-09-07', marks: { 'CMT-A-02': 'absent' }, markedByUid: 'u', markedByMid: null });
    expect(mockBatchSet.mock.calls[0]![2]).toEqual({ merge: true });
  });
});
