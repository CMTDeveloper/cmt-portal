import { describe, it, expect } from 'vitest';
import {
  AttendanceEventDocSchema,
  SaveAttendanceSchema,
  MarkGuestSchema,
  AddStudentSchema,
  attendanceAid,
  SETU_ATTENDANCE_WRITE_STATUSES,
} from '../schemas/attendance';

describe('attendanceAid', () => {
  it('builds {levelId}-{mid}-{date}', () => {
    expect(attendanceAid('brampton-level-2-bv-brampton-2025-26', 'CMT-AAAA1111-02', '2025-09-07')).toBe(
      'brampton-level-2-bv-brampton-2025-26-CMT-AAAA1111-02-2025-09-07',
    );
  });
});

describe('AttendanceEventDocSchema', () => {
  const valid = {
    aid: 'lvl-mid-2025-09-07',
    levelId: 'lvl',
    mid: 'CMT-AAAA1111-02',
    fid: 'CMT-AAAA1111',
    pid: 'bv-brampton-2025-26',
    date: '2025-09-07',
    status: 'present' as const,
    isGuest: false,
    markedByUid: 'uid-teacher',
    markedByMid: 'CMT-AAAA1111-01',
    markedAt: new Date(),
    updatedAt: new Date(),
  };
  it('accepts a valid event', () => {
    expect(AttendanceEventDocSchema.safeParse(valid).success).toBe(true);
  });
  it('accepts a null markedByMid (teacher-only sevak)', () => {
    expect(AttendanceEventDocSchema.safeParse({ ...valid, markedByMid: null }).success).toBe(true);
  });
  it('rejects an unknown status', () => {
    expect(AttendanceEventDocSchema.safeParse({ ...valid, status: 'tardy' }).success).toBe(false);
  });
  it('rejects a bad date', () => {
    expect(AttendanceEventDocSchema.safeParse({ ...valid, date: '2025/09/07' }).success).toBe(false);
  });
});

describe('SaveAttendanceSchema', () => {
  it('accepts a marks record', () => {
    expect(
      SaveAttendanceSchema.safeParse({
        levelId: 'lvl',
        date: '2025-09-07',
        marks: { 'CMT-A-02': 'present', 'CMT-A-03': 'absent', 'CMT-B-02': 'present' },
      }).success,
    ).toBe(true);
  });
  it('accepts an empty marks record', () => {
    expect(SaveAttendanceSchema.safeParse({ levelId: 'lvl', date: '2025-09-07', marks: {} }).success).toBe(true);
  });
  it('rejects an invalid status value in marks', () => {
    expect(
      SaveAttendanceSchema.safeParse({ levelId: 'lvl', date: '2025-09-07', marks: { 'CMT-A-02': 'maybe' } }).success,
    ).toBe(false);
  });
  it('rejects a missing levelId', () => {
    expect(SaveAttendanceSchema.safeParse({ date: '2025-09-07', marks: {} }).success).toBe(false);
  });
});

describe('MarkGuestSchema', () => {
  it('accepts a guest mark and defaults status to present', () => {
    const r = MarkGuestSchema.safeParse({ levelId: 'lvl', date: '2025-09-07', mid: 'CMT-Z-09' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe('present');
  });
  it('accepts an explicit status', () => {
    expect(MarkGuestSchema.safeParse({ levelId: 'lvl', date: '2025-09-07', mid: 'CMT-Z-09', status: 'absent' }).success).toBe(true);
  });
  it('rejects a missing mid', () => {
    expect(MarkGuestSchema.safeParse({ levelId: 'lvl', date: '2025-09-07' }).success).toBe(false);
  });
});

describe('AddStudentSchema', () => {
  const base = { levelId: 'lvl', date: '2025-09-07', firstName: 'New', lastName: 'Kid', parentEmail: 'p@example.com' };
  it('accepts a minimal add-student payload with defaults', () => {
    const r = AddStudentSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.gender).toBe('PreferNotToSay');
      expect(r.data.schoolGrade).toBeNull();
      expect(r.data.parentPhone).toBeNull();
    }
  });
  it('rejects an invalid parent email', () => {
    expect(AddStudentSchema.safeParse({ ...base, parentEmail: 'not-an-email' }).success).toBe(false);
  });
  it('rejects a missing firstName', () => {
    expect(AddStudentSchema.safeParse({ ...base, firstName: '' }).success).toBe(false);
  });
});

describe('attendance write statuses are binary', () => {
  it('SETU_ATTENDANCE_WRITE_STATUSES is present/absent only', () => {
    expect([...SETU_ATTENDANCE_WRITE_STATUSES]).toEqual(['present', 'absent']);
  });
  it('SaveAttendanceSchema rejects late marks', () => {
    const r = SaveAttendanceSchema.safeParse({ levelId: 'l', date: '2026-01-04', marks: { m1: 'late' } });
    expect(r.success).toBe(false);
  });
  it('SaveAttendanceSchema accepts present/absent', () => {
    expect(SaveAttendanceSchema.safeParse({ levelId: 'l', date: '2026-01-04', marks: { m1: 'present', m2: 'absent' } }).success).toBe(true);
  });
  it('MarkGuestSchema rejects late', () => {
    expect(MarkGuestSchema.safeParse({ levelId: 'l', date: '2026-01-04', mid: 'm', status: 'late' }).success).toBe(false);
  });
  it('AttendanceEventDocSchema still READS a historical late event', () => {
    const doc = { aid: 'a', levelId: 'l', mid: 'm', fid: 'f', pid: 'p', date: '2025-11-02', status: 'late', isGuest: false, markedByUid: 'u', markedByMid: null, markedAt: new Date(), updatedAt: new Date() };
    expect(AttendanceEventDocSchema.safeParse(doc).success).toBe(true);
  });
});
