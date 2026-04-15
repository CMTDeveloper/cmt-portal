import { describe, it, expect } from 'vitest';
import {
  ATTENDANCE_STATUSES,
  type AttendanceRecord,
  type ClassRoster,
  type TeacherAttendanceRequest,
} from '../check-in/attendance';

describe('ATTENDANCE_STATUSES', () => {
  it('lists the four statuses', () => {
    expect(ATTENDANCE_STATUSES).toEqual(['present', 'absent', 'late', 'uninformed']);
  });
});

describe('AttendanceRecord', () => {
  it('has required fields', () => {
    const record: AttendanceRecord = {
      date: '2026-04-13',
      classId: 'K',
      sid: '1',
      status: 'present',
      markedAt: '2026-04-13T14:00:00Z',
      markedByUid: 'teacher-shared-v1',
    };
    expect(record.status).toBe('present');
  });
});

describe('ClassRoster', () => {
  it('contains a class id and an array of students', () => {
    const roster: ClassRoster = {
      classId: 'K',
      name: 'Kindergarten',
      students: [
        { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
      ],
    };
    expect(roster.students).toHaveLength(1);
  });
});

describe('TeacherAttendanceRequest', () => {
  it('carries classId, date, and a status map', () => {
    const req: TeacherAttendanceRequest = {
      classId: 'K',
      date: '2026-04-13',
      statuses: { '1': 'present', '2': 'late' },
    };
    expect(req.statuses['1']).toBe('present');
  });
});
