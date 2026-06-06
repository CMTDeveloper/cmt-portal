import type { ProgramDoc } from '@cmt/shared-domain';
import { getFamilyByFid } from './get-family-by-fid';
import { getEnrollments, type EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { listPrograms } from '@/features/setu/programs/get-programs';
import { getAttendanceForMember, summarize } from '@/features/setu/teacher/get-attendance';
import { getCheckInAttendance, summarizeMemberCheckIns } from '@/features/setu/attendance/check-in-attendance';
import { getMemberAchievements, type ChildAchievement } from './get-achievements';
import { fidFromMid } from './mid';
import { isoToTorontoDateInput } from '@/lib/toronto-date';

export type { ChildAchievement } from './get-achievements';

export interface ChildProgramAttendance {
  mode: 'teacher' | 'check-in' | 'none';
  available: boolean;
  attended: number;
  total: number;
  attendedPct: number;
  marks: { date: string; present: boolean }[];
  note: string | null;
}

export interface ChildProfileProgram {
  eid: string;
  programKey: string;
  label: string;
  term: string;
  location: string | null;
  status: 'active' | 'cancelled';
  attendance: ChildProgramAttendance;
}

export interface ChildProfile {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  type: 'Adult' | 'Child';
  schoolGrade: string | null;
  birthMonthYear: string | null;
  foodAllergies: string | null;
  programs: ChildProfileProgram[];
  pastPrograms: ChildProfileProgram[];
  achievements: ChildAchievement[];
  stats: { programCount: number; overallAttendedPct: number; hasAnyAttendance: boolean };
}

const NO_ATTENDANCE: ChildProgramAttendance = {
  mode: 'none', available: false, attended: 0, total: 0, attendedPct: 0, marks: [], note: null,
};

export async function getChildProfile(mid: string): Promise<ChildProfile | null> {
  const fid = fidFromMid(mid);
  const fam = await getFamilyByFid(fid);
  if (!fam) return null;
  const member = fam.members.find((m) => m.mid === mid);
  if (!member) return null;

  const [enrollments, programs, memberRecords, checkIns, achievements] = await Promise.all([
    getEnrollments(fid),
    listPrograms(),
    getAttendanceForMember(mid),
    getCheckInAttendance(fam.family.legacyFid),
    getMemberAchievements(fid, mid),
  ]);
  const programByKey = new Map<string, ProgramDoc>(programs.map((p) => [p.programKey, p]));
  const mine = enrollments.filter((e) => e.enrolledMids.includes(mid));

  function buildAttendance(e: EnrollmentWithOffering): ChildProgramAttendance {
    const mode = programByKey.get(e.programKey)?.capabilities.attendanceMode ?? 'none';
    if (mode === 'teacher') {
      const recs = memberRecords.filter((r) => r.pid === e.oid);
      const s = summarize(recs);
      const marks = recs.slice().reverse().map((r) => ({ date: r.date, present: r.status !== 'absent' }));
      return { mode, available: true, attended: s.present + s.late, total: s.total, attendedPct: s.attendedPct, marks, note: null };
    }
    if (mode === 'check-in') {
      if (!member!.legacySid) {
        return { mode, available: false, attended: 0, total: 0, attendedPct: 0, marks: [], note: "Attendance isn't linked for this member yet." };
      }
      const off = e.offering;
      const scoped = off
        ? checkIns.filter((r) => {
            const start = isoToTorontoDateInput(off.startDate.toISOString());
            const end = off.endDate ? isoToTorontoDateInput(off.endDate.toISOString()) : '9999-12-31';
            return r.date >= start && r.date <= end;
          })
        : checkIns;
      const s = summarizeMemberCheckIns(scoped, member!.legacySid);
      const attendedPct = s.recorded > 0 ? Math.round((s.attended / s.recorded) * 100) : 0;
      return { mode, available: true, attended: s.attended, total: s.recorded, attendedPct, marks: s.marks, note: null };
    }
    return NO_ATTENDANCE;
  }

  const toProgram = (e: EnrollmentWithOffering): ChildProfileProgram => ({
    eid: e.eid, programKey: e.programKey, label: e.programLabel, term: e.termLabel,
    location: e.location, status: e.status,
    attendance: e.status === 'active' ? buildAttendance(e) : NO_ATTENDANCE,
  });

  const activePrograms = mine.filter((e) => e.status === 'active').map(toProgram);
  const pastPrograms = mine.filter((e) => e.status !== 'active').map(toProgram);

  const withAtt = activePrograms.filter((p) => p.attendance.available);
  const sumAttended = withAtt.reduce((acc, p) => acc + p.attendance.attended, 0);
  const sumTotal = withAtt.reduce((acc, p) => acc + p.attendance.total, 0);
  const overallAttendedPct = sumTotal > 0 ? Math.round((sumAttended / sumTotal) * 100) : 0;

  return {
    mid, fid,
    firstName: member.firstName, lastName: member.lastName, type: member.type,
    schoolGrade: member.schoolGrade ?? null, birthMonthYear: member.birthMonthYear ?? null,
    foodAllergies: member.foodAllergies ?? null,
    programs: activePrograms, pastPrograms,
    achievements,
    stats: { programCount: activePrograms.length, overallAttendedPct, hasAnyAttendance: sumTotal > 0 },
  };
}
