import { describe, it, expect } from 'vitest';
import {
  AttendanceEventDocSchema,
  SaveAttendanceSchema,
  MarkGuestSchema,
  attendanceAid,
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
        marks: { 'CMT-A-02': 'present', 'CMT-A-03': 'absent', 'CMT-B-02': 'late' },
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
    expect(MarkGuestSchema.safeParse({ levelId: 'lvl', date: '2025-09-07', mid: 'CMT-Z-09', status: 'late' }).success).toBe(true);
  });
  it('rejects a missing mid', () => {
    expect(MarkGuestSchema.safeParse({ levelId: 'lvl', date: '2025-09-07' }).success).toBe(false);
  });
});
