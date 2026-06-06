import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLevelGet, mockReadGuests, mockListDetailed, mockUpsert, mockMarkGuest, contactKeyGet } = vi.hoisted(() => ({
  mockLevelGet: vi.fn(),
  mockReadGuests: vi.fn(),
  mockListDetailed: vi.fn(),
  mockUpsert: vi.fn(),
  mockMarkGuest: vi.fn(),
  contactKeyGet: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (c: string) => {
      if (c === 'levels') return { doc: () => ({ get: mockLevelGet }) };
      return { doc: () => ({ get: contactKeyGet }) }; // contactKeys/{hash}
    },
  }),
}));
vi.mock('@/features/setu/attendance/check-in-attendance', () => ({ readDoorGuestCheckIns: mockReadGuests }));
vi.mock('../guests', () => ({ listGuestsDetailed: mockListDetailed, markGuest: mockMarkGuest }));
vi.mock('../pending-family', () => ({ upsertPendingFamilyChild: mockUpsert }));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({ hashContactKey: (t: string, v: string) => `hash:${t}:${v}` }));

import { guestMatchesLevel, getLevelVisitorsView, addVisitorOnPrompt } from '../visitors';

beforeEach(() => {
  vi.clearAllMocks();
  mockLevelGet.mockResolvedValue({ exists: true, data: () => ({
    levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Brampton',
    pid: 'o-bv', levelKind: 'level', gradeBand: ['1'],
  }) });
});

describe('guestMatchesLevel', () => {
  it('matches a level/pre-level child by normalized grade, never shishu/parents', () => {
    expect(guestMatchesLevel({ grade: 'Grade 1' }, { levelKind: 'level', gradeBand: ['1'] })).toBe(true);
    expect(guestMatchesLevel({ grade: '2' }, { levelKind: 'level', gradeBand: ['1'] })).toBe(false);
    expect(guestMatchesLevel({ grade: '' }, { levelKind: 'level', gradeBand: ['1'] })).toBe(false);
    expect(guestMatchesLevel({ grade: '1' }, { levelKind: 'shishu', gradeBand: [] })).toBe(false);
  });
});

describe('getLevelVisitorsView', () => {
  it('lists matched door guests and flags those already confirmed in the portal', async () => {
    mockReadGuests.mockResolvedValue([
      { name: 'Arjun X', grade: '1', parentEmail: 'mom@x.com', parentName: 'Mom', phone: '416' }, // matches
      { name: 'Maya Y', grade: '5', parentEmail: 'dad@y.com', parentName: null, phone: null },     // grade off → excluded
    ]);
    mockListDetailed.mockResolvedValue([{ mid: 'F-02', fid: 'CMT-F', firstName: 'Arjun', lastName: 'X', status: 'present' }]);
    contactKeyGet.mockResolvedValue({ exists: true, data: () => ({ fid: 'CMT-F' }) }); // mom@x.com already claims CMT-F (in confirmed)
    const view = await getLevelVisitorsView('L', '2026-01-04');
    expect(view).not.toBeNull();
    expect(view!.doorVisitors).toEqual([
      { name: 'Arjun X', grade: '1', parentEmail: 'mom@x.com', parentName: 'Mom', phone: '416', alreadyConfirmed: true },
    ]);
    expect(view!.confirmed).toEqual([{ mid: 'F-02', fid: 'CMT-F', firstName: 'Arjun', lastName: 'X', status: 'present' }]);
  });

  it('returns null when the level is missing', async () => {
    mockLevelGet.mockResolvedValue({ exists: false });
    expect(await getLevelVisitorsView('nope', '2026-01-04')).toBeNull();
  });
});

describe('addVisitorOnPrompt', () => {
  it('upserts the pending family/child then marks present, reporting claimable', async () => {
    mockUpsert.mockResolvedValue({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true });
    mockMarkGuest.mockResolvedValue({ ok: true, aid: 'a1', autoEnrolled: true });
    const r = await addVisitorOnPrompt({
      levelId: 'L', date: '2026-01-04', firstName: 'Walk', lastName: 'In',
      schoolGrade: null, gender: 'PreferNotToSay', parentEmail: null, parentPhone: null,
      markedByUid: 'uid-t', markedByMid: 'CMT-T-01',
    });
    expect(r).toEqual({ ok: true, fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, autoEnrolled: true, claimable: false });
    expect(mockMarkGuest).toHaveBeenCalledWith(expect.objectContaining({ mid: 'CMT-NEW1-02', status: 'present', levelId: 'L' }));
  });

  it('level-not-found short-circuits before any write', async () => {
    mockLevelGet.mockResolvedValue({ exists: false });
    const r = await addVisitorOnPrompt({
      levelId: 'nope', date: '2026-01-04', firstName: 'A', lastName: '', schoolGrade: null,
      gender: 'PreferNotToSay', parentEmail: 'p@x.com', parentPhone: null, markedByUid: 'u', markedByMid: null,
    });
    expect(r).toEqual({ ok: false, reason: 'level-not-found' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
