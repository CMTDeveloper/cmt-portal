import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../get-family-by-fid', () => ({
  getFamilyByFid: vi.fn(),
}));

vi.mock('@/features/setu/enrollment/get-enrollments', () => ({
  getEnrollments: vi.fn(),
}));

vi.mock('@/features/setu/programs/get-programs', () => ({
  listPrograms: vi.fn(),
}));

vi.mock('@/features/setu/teacher/get-attendance', async () => {
  const actual = await vi.importActual<typeof import('@/features/setu/teacher/get-attendance')>(
    '@/features/setu/teacher/get-attendance',
  );
  return { ...actual, getAttendanceForMember: vi.fn() };
});

vi.mock('@/features/setu/attendance/check-in-attendance', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/setu/attendance/check-in-attendance')
  >('@/features/setu/attendance/check-in-attendance');
  return { ...actual, getCheckInAttendance: vi.fn() };
});

vi.mock('@/lib/toronto-date', () => ({
  isoToTorontoDateInput: (iso: string) => iso.slice(0, 10),
}));

import { getFamilyByFid } from '../get-family-by-fid';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { listPrograms } from '@/features/setu/programs/get-programs';
import { getAttendanceForMember } from '@/features/setu/teacher/get-attendance';
import { getCheckInAttendance } from '@/features/setu/attendance/check-in-attendance';
import { getChildProfile } from '../get-child-profile';

const mockGetFamilyByFid = vi.mocked(getFamilyByFid);
const mockGetEnrollments = vi.mocked(getEnrollments);
const mockListPrograms = vi.mocked(listPrograms);
const mockGetAttendanceForMember = vi.mocked(getAttendanceForMember);
const mockGetCheckInAttendance = vi.mocked(getCheckInAttendance);

const FID = 'CMT-FAM1';
const MID = 'CMT-FAM1-03';

function makeFamily(overrides?: { legacySid?: string | null }) {
  return {
    family: {
      fid: FID,
      legacyFid: '4421',
      name: 'Sharma',
      location: 'Brampton',
      createdAt: new Date('2024-01-01'),
      managers: [`${FID}-01`],
      searchKeys: ['sharma'],
    },
    members: [
      {
        mid: `${FID}-01`,
        uid: 'uid-01',
        firstName: 'Raj',
        lastName: 'Sharma',
        type: 'Adult',
        gender: 'Male',
        manager: true,
        joinedAt: new Date('2024-01-01'),
        email: 'raj@example.com',
        phone: null,
        schoolGrade: null,
        legacySid: null,
        birthMonthYear: null,
        volunteeringSkills: [],
        foodAllergies: null,
        emergencyContacts: [null, null],
      },
      {
        mid: MID,
        uid: null,
        firstName: 'Meera',
        lastName: 'Sharma',
        type: 'Child',
        gender: 'Female',
        manager: false,
        joinedAt: new Date('2024-01-01'),
        email: null,
        phone: null,
        schoolGrade: 'Grade 3',
        legacySid: overrides?.legacySid !== undefined ? overrides.legacySid : 'S9',
        birthMonthYear: '2016-05',
        volunteeringSkills: [],
        foodAllergies: 'peanuts',
        emergencyContacts: [null, null],
      },
    ],
  };
}

function makeProgram(programKey: string, attendanceMode: 'none' | 'check-in' | 'teacher') {
  return {
    programKey,
    label: programKey,
    shortDescription: '',
    status: 'active',
    locations: [],
    termType: 'school-year',
    eligibility: { memberType: 'child' },
    capabilities: {
      usesOfferings: true,
      usesDonation: true,
      usesLevels: false,
      usesCalendar: false,
      attendanceMode,
    },
    displayOrder: 0,
    createdAt: new Date('2024-01-01'),
    createdBy: 'admin',
    updatedAt: new Date('2024-01-01'),
    updatedBy: 'admin',
  };
}

function makeEnrollment(opts: {
  eid: string;
  oid: string;
  programKey: string;
  status?: 'active' | 'cancelled';
  enrolledMids?: string[];
  offering?: { startDate: Date; endDate: Date | null } | null;
}) {
  return {
    eid: opts.eid,
    fid: FID,
    oid: opts.oid,
    programKey: opts.programKey,
    programLabel: `${opts.programKey} label`,
    termLabel: 'Fall 2025',
    location: 'Brampton',
    enrolledAt: new Date('2025-09-01'),
    enrolledVia: 'family-initiated',
    enrolledByMid: `${FID}-01`,
    enrolledMids: opts.enrolledMids ?? [MID],
    suggestedAmountSnapshot: 100,
    suggestedAmountOverride: null,
    status: opts.status ?? 'active',
    cancelledAt: null,
    cancelledReason: null,
    effectiveSuggestedAmount: 100,
    offering:
      opts.offering === undefined
        ? {
            oid: opts.oid,
            programKey: opts.programKey,
            programLabel: `${opts.programKey} label`,
            location: 'Brampton',
            termLabel: 'Fall 2025',
            termType: 'school-year',
            startDate: new Date('2025-09-01T00:00:00.000Z'),
            endDate: new Date('2026-06-30T00:00:00.000Z'),
            pricingTiers: [],
            enabled: true,
            createdAt: new Date('2024-01-01'),
            createdBy: 'admin',
            updatedAt: new Date('2024-01-01'),
            updatedBy: 'admin',
          }
        : opts.offering,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getChildProfile', () => {
  it('returns null when the family does not exist', async () => {
    mockGetFamilyByFid.mockResolvedValue(null);
    const result = await getChildProfile(MID);
    expect(result).toBeNull();
  });

  it('returns null when the member is not in the family', async () => {
    mockGetFamilyByFid.mockResolvedValue(makeFamily() as never);
    mockGetEnrollments.mockResolvedValue([] as never);
    mockListPrograms.mockResolvedValue([] as never);
    mockGetAttendanceForMember.mockResolvedValue([] as never);
    mockGetCheckInAttendance.mockResolvedValue([] as never);
    const result = await getChildProfile('CMT-FAM1-99');
    expect(result).toBeNull();
  });

  it('composes three active programs with per-mode attendance (N=3) and blended stats', async () => {
    mockGetFamilyByFid.mockResolvedValue(makeFamily() as never);
    mockListPrograms.mockResolvedValue([
      makeProgram('tabla', 'teacher'),
      makeProgram('bala-vihar', 'check-in'),
      makeProgram('om', 'none'),
    ] as never);
    mockGetEnrollments.mockResolvedValue([
      makeEnrollment({ eid: 'e-tabla', oid: 'o-tabla', programKey: 'tabla' }),
      makeEnrollment({ eid: 'e-bv', oid: 'o-bv', programKey: 'bala-vihar' }),
      makeEnrollment({ eid: 'e-om', oid: 'o-om', programKey: 'om' }),
    ] as never);

    // Teacher attendance: 2 present + 1 absent for o-tabla, plus a stray record
    // for a different oid that the pid===oid filter must exclude. Newest-first.
    mockGetAttendanceForMember.mockResolvedValue([
      { aid: 'a4', mid: MID, fid: FID, levelId: 'l1', pid: 'o-other', date: '2025-10-15', status: 'present', isGuest: false },
      { aid: 'a3', mid: MID, fid: FID, levelId: 'l1', pid: 'o-tabla', date: '2025-10-08', status: 'absent', isGuest: false },
      { aid: 'a2', mid: MID, fid: FID, levelId: 'l1', pid: 'o-tabla', date: '2025-10-01', status: 'present', isGuest: false },
      { aid: 'a1', mid: MID, fid: FID, levelId: 'l1', pid: 'o-tabla', date: '2025-09-24', status: 'present', isGuest: false },
    ] as never);

    // Check-in: S9 present 3, absent 1 (recorded 4).
    mockGetCheckInAttendance.mockResolvedValue([
      { date: '2025-09-07', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
      { date: '2025-09-14', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
      { date: '2025-09-21', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: false }] },
      { date: '2025-09-28', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
    ] as never);

    const result = await getChildProfile(MID);
    expect(result).not.toBeNull();
    expect(result!.firstName).toBe('Meera');
    expect(result!.type).toBe('Child');
    expect(result!.schoolGrade).toBe('Grade 3');
    expect(result!.foodAllergies).toBe('peanuts');
    expect(result!.programs).toHaveLength(3);

    const tabla = result!.programs.find((p) => p.programKey === 'tabla')!;
    expect(tabla.attendance.mode).toBe('teacher');
    expect(tabla.attendance.available).toBe(true);
    expect(tabla.attendance.attended).toBe(2);
    expect(tabla.attendance.total).toBe(3);
    expect(tabla.attendance.marks).toHaveLength(3);

    const bv = result!.programs.find((p) => p.programKey === 'bala-vihar')!;
    expect(bv.attendance.mode).toBe('check-in');
    expect(bv.attendance.available).toBe(true);
    expect(bv.attendance.attended).toBe(3);
    expect(bv.attendance.total).toBe(4);

    const om = result!.programs.find((p) => p.programKey === 'om')!;
    expect(om.attendance.mode).toBe('none');
    expect(om.attendance.available).toBe(false);

    // Blended: (2+3) / (3+4) = 5/7 = 71% — distinct from tabla-alone (67%) and bv-alone (75%).
    expect(result!.stats.overallAttendedPct).toBe(71);
    expect(result!.stats.programCount).toBe(3);
    expect(result!.stats.hasAnyAttendance).toBe(true);

    // Result must be plain-JSON (no Date instances).
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('marks check-in attendance unavailable with a note when legacySid is null', async () => {
    mockGetFamilyByFid.mockResolvedValue(makeFamily({ legacySid: null }) as never);
    mockListPrograms.mockResolvedValue([makeProgram('bala-vihar', 'check-in')] as never);
    mockGetEnrollments.mockResolvedValue([
      makeEnrollment({ eid: 'e-bv', oid: 'o-bv', programKey: 'bala-vihar' }),
    ] as never);
    mockGetAttendanceForMember.mockResolvedValue([] as never);
    mockGetCheckInAttendance.mockResolvedValue([] as never);

    const result = await getChildProfile(MID);
    const bv = result!.programs[0]!;
    expect(bv.attendance.mode).toBe('check-in');
    expect(bv.attendance.available).toBe(false);
    expect(bv.attendance.note).toBeTruthy();
  });

  it('puts cancelled enrollments in pastPrograms, not programs', async () => {
    mockGetFamilyByFid.mockResolvedValue(makeFamily() as never);
    mockListPrograms.mockResolvedValue([makeProgram('tabla', 'teacher')] as never);
    mockGetEnrollments.mockResolvedValue([
      makeEnrollment({ eid: 'e-tabla', oid: 'o-tabla', programKey: 'tabla', status: 'cancelled' }),
    ] as never);
    mockGetAttendanceForMember.mockResolvedValue([] as never);
    mockGetCheckInAttendance.mockResolvedValue([] as never);

    const result = await getChildProfile(MID);
    expect(result!.programs).toHaveLength(0);
    expect(result!.pastPrograms).toHaveLength(1);
    expect(result!.pastPrograms[0]!.programKey).toBe('tabla');
    expect(result!.stats.programCount).toBe(0);
  });
});
