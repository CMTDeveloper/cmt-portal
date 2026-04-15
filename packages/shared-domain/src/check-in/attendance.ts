import type { Student } from './family';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'uninformed'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface AttendanceRecord {
  date: string;
  classId: string;
  sid: string;
  status: AttendanceStatus;
  markedAt: string;
  markedByUid: string;
  notes?: string;
}

export interface ClassRoster {
  classId: string;
  name: string;
  students: Student[];
}

export interface TeacherClassListResponse {
  classes: Array<{ classId: string; name: string; studentCount: number }>;
}

export interface TeacherAttendanceRequest {
  classId: string;
  date: string;
  statuses: Record<string, AttendanceStatus>;
}

export interface TeacherAttendanceResponse {
  success: true;
  recorded: number;
}

export interface TeacherReportQuery {
  classId?: string;
  from?: string;
  to?: string;
}

export interface TeacherReportEntry {
  date: string;
  classId: string;
  sid: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus;
}

export interface TeacherReportResponse {
  entries: TeacherReportEntry[];
}

export interface TeacherUninformedResponse {
  entries: TeacherReportEntry[];
}
