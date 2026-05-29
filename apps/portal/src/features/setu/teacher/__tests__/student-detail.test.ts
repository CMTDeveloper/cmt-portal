import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCollectionGroupGet, mockMembersGet, mockGetMyLevels, mockDeriveRoster, mockAttendance } = vi.hoisted(() => ({
  mockCollectionGroupGet: vi.fn(),
  mockMembersGet: vi.fn(),
  mockGetMyLevels: vi.fn(),
  mockDeriveRoster: vi.fn(),
  mockAttendance: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collectionGroup: () => ({ where: () => ({ limit: () => ({ get: mockCollectionGroupGet }) }) }),
    collection: () => ({ doc: () => ({ collection: () => ({ get: mockMembersGet }) }) }),
  }),
}));
vi.mock('../levels', () => ({ getMyLevels: mockGetMyLevels }));
vi.mock('../roster', () => ({ deriveRoster: mockDeriveRoster }));
vi.mock('../get-attendance', async (orig) => {
  const actual = await orig<typeof import('../get-attendance')>();
  return { ...actual, getAttendanceForMember: mockAttendance };
});

import { getStudentDetail, canTeacherSeeStudent } from '../student-detail';

beforeEach(() => {
  vi.clearAllMocks();
  mockAttendance.mockResolvedValue([{ status: 'present' }, { status: 'absent' }]);
});

describe('getStudentDetail', () => {
  it('returns null when the member is not found', async () => {
    mockCollectionGroupGet.mockResolvedValue({ docs: [] });
    expect(await getStudentDetail('nope')).toBeNull();
  });

  it('assembles member + parent contacts + attendance summary', async () => {
    mockCollectionGroupGet.mockResolvedValue({
      docs: [{
        data: () => ({ mid: 'CMT-A-02', firstName: 'Arjun', lastName: 'Apple', type: 'Child', schoolGrade: 'Grade 2', foodAllergies: 'Peanuts', emergencyContacts: [{ relation: 'Mother', phone: '416', email: 'm@e.com' }, null] }),
        ref: { parent: { parent: { id: 'CMT-A' } } },
      }],
    });
    mockMembersGet.mockResolvedValue({
      docs: [
        { data: () => ({ firstName: 'Asha', lastName: 'Apple', type: 'Adult', manager: true, phone: '416-555', email: 'asha@e.com' }) },
        { data: () => ({ firstName: 'Arjun', lastName: 'Apple', type: 'Child', manager: false, phone: null, email: null }) },
      ],
    });
    const d = await getStudentDetail('CMT-A-02');
    expect(d).not.toBeNull();
    expect(d!.fid).toBe('CMT-A');
    expect(d!.foodAllergies).toBe('Peanuts');
    expect(d!.parents).toEqual([{ name: 'Asha Apple', phone: '416-555', email: 'asha@e.com' }]);
    expect(d!.summary).toMatchObject({ present: 1, absent: 1, total: 2, attendedPct: 50 });
  });
});

describe('canTeacherSeeStudent', () => {
  it('admin always allowed', async () => {
    expect(await canTeacherSeeStudent({ role: 'admin' }, 'CMT-A-02')).toBe(true);
    expect(mockGetMyLevels).not.toHaveBeenCalled();
  });
  it('true when the student is on a roster of one of the teacher levels', async () => {
    mockGetMyLevels.mockResolvedValue([{ levelId: 'lvl1' }, { levelId: 'lvl2' }]);
    mockDeriveRoster
      .mockResolvedValueOnce({ members: [{ mid: 'CMT-Z-09' }] })
      .mockResolvedValueOnce({ members: [{ mid: 'CMT-A-02' }] });
    expect(await canTeacherSeeStudent({ role: 'teacher', mid: 'CMT-T-01' }, 'CMT-A-02')).toBe(true);
  });
  it('false when not on any of the teacher rosters', async () => {
    mockGetMyLevels.mockResolvedValue([{ levelId: 'lvl1' }]);
    mockDeriveRoster.mockResolvedValue({ members: [{ mid: 'CMT-Z-09' }] });
    expect(await canTeacherSeeStudent({ role: 'teacher', mid: 'CMT-T-01' }, 'CMT-A-02')).toBe(false);
  });
});
