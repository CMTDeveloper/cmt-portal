import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLevelGet, mockMemberGet, mockEnrollGet, mockSet, mockEventsGet, mockEnroll } = vi.hoisted(() => ({
  mockLevelGet: vi.fn(),
  mockMemberGet: vi.fn(),
  mockEnrollGet: vi.fn(),
  mockSet: vi.fn(),
  mockEventsGet: vi.fn(),
  mockEnroll: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  portalFirestore: () => ({
    collection: (name: string) => {
      if (name === 'levels') return { doc: () => ({ get: mockLevelGet }) };
      if (name === 'families') return { doc: () => ({ collection: () => ({ doc: () => ({ get: mockEnrollGet }) }) }) };
      // attendanceEvents
      const eventsChain = { where: () => eventsChain, get: mockEventsGet };
      return { doc: () => ({ set: mockSet }), where: () => eventsChain };
    },
    collectionGroup: () => ({ where: () => ({ limit: () => ({ get: mockMemberGet }) }) }),
  }),
}));
vi.mock('@/features/setu/enrollment/enroll-on-first-attendance', () => ({ enrollFamilyOnFirstAttendance: mockEnroll }));

import { markGuest, listGuests } from '../guests';

beforeEach(() => {
  vi.clearAllMocks();
  mockLevelGet.mockResolvedValue({ exists: true, data: () => ({ levelId: 'lvl', pid: 'bv-brampton-2025-26', location: 'Brampton' }) });
  mockMemberGet.mockResolvedValue({ docs: [{ data: () => ({ firstName: 'Visiting', lastName: 'Kid' }), ref: { parent: { parent: { id: 'CMT-Z' } } } }] });
  mockSet.mockResolvedValue(undefined);
  mockEnroll.mockResolvedValue({ created: true, eid: 'CMT-Z-bv-brampton-2025-26', suggestedAmountSnapshot: 500 });
});

describe('markGuest', () => {
  it('level-not-found when level missing', async () => {
    mockLevelGet.mockResolvedValue({ exists: false });
    expect(await markGuest({ levelId: 'x', date: '2025-09-07', mid: 'M', status: 'present', markedByUid: 'u', markedByMid: null }))
      .toEqual({ ok: false, reason: 'level-not-found' });
  });

  it('member-not-found when the mid resolves to no member', async () => {
    mockMemberGet.mockResolvedValue({ docs: [] });
    expect(await markGuest({ levelId: 'lvl', date: '2025-09-07', mid: 'nope', status: 'present', markedByUid: 'u', markedByMid: null }))
      .toEqual({ ok: false, reason: 'member-not-found' });
  });

  it('auto-enrolls when the guest family has no active enrollment, writes isGuest event', async () => {
    mockEnrollGet.mockResolvedValue({ exists: false }); // no enrollment
    const res = await markGuest({ levelId: 'lvl', date: '2025-09-07', mid: 'CMT-Z-09', status: 'present', markedByUid: 'uid-t', markedByMid: 'CMT-T-01' });
    expect(res).toEqual({ ok: true, aid: 'lvl-CMT-Z-09-2025-09-07', autoEnrolled: true });
    expect(mockEnroll).toHaveBeenCalledWith({ fid: 'CMT-Z', oid: 'bv-brampton-2025-26', markedByTeacherUid: 'uid-t' });
    const payload = mockSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({ mid: 'CMT-Z-09', fid: 'CMT-Z', isGuest: true, status: 'present' });
  });

  it('does NOT auto-enroll when the family already has an active enrollment', async () => {
    mockEnrollGet.mockResolvedValue({ exists: true, data: () => ({ status: 'active' }) });
    const res = await markGuest({ levelId: 'lvl', date: '2025-09-07', mid: 'CMT-Z-09', status: 'late', markedByUid: 'u', markedByMid: null });
    expect(res).toMatchObject({ ok: true, autoEnrolled: false });
    expect(mockEnroll).not.toHaveBeenCalled();
  });
});

describe('listGuests', () => {
  it('returns only isGuest events for the level/date', async () => {
    mockEventsGet.mockResolvedValue({
      docs: [
        { data: () => ({ aid: 'a1', mid: 'CMT-Z-09', fid: 'CMT-Z', date: '2025-09-07', status: 'present', isGuest: true }) },
        { data: () => ({ aid: 'a2', mid: 'CMT-A-02', fid: 'CMT-A', date: '2025-09-07', status: 'present', isGuest: false }) },
      ],
    });
    const out = await listGuests('lvl', '2025-09-07');
    expect(out).toHaveLength(1);
    expect(out[0]!.mid).toBe('CMT-Z-09');
  });
});
