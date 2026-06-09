import { describe, it, expect } from 'vitest';
import type { EnrollmentReport, AttendanceReport, DonationsReport } from '@cmt/shared-domain';
import { enrollmentReportToCsv, attendanceReportToCsv, donationsReportToCsv } from '../report-csv';

describe('enrollmentReportToCsv', () => {
  it('emits a header row even with no data', () => {
    const r: EnrollmentReport = {
      byProgram: [],
      byLevel: [],
      totalActiveEnrollments: 0,
      totalMembers: 0,
    };
    expect(enrollmentReportToCsv(r)).toBe('scope,key,label,families,members');
  });

  it('emits one row per byProgram and byLevel entry in column order', () => {
    const r: EnrollmentReport = {
      byProgram: [{ programKey: 'bala-vihar', programLabel: 'Bala Vihar', families: 12, members: 30 }],
      byLevel: [{ levelId: 'g3', levelName: 'Grade 3', programKey: 'bala-vihar', members: 8 }],
      totalActiveEnrollments: 1,
      totalMembers: 30,
    };
    const lines = enrollmentReportToCsv(r).split('\n');
    expect(lines).toHaveLength(3); // header + 2
    expect(lines[0]).toBe('scope,key,label,families,members');
    expect(lines[1]).toBe('program,bala-vihar,Bala Vihar,12,30');
    expect(lines[2]).toBe('level,g3,Grade 3,,8'); // level has no families column
  });

  it('escapes RFC-4180 values with a comma and double-quote', () => {
    const r: EnrollmentReport = {
      byProgram: [{ programKey: 'bv', programLabel: 'Bala, "BV"', families: 1, members: 2 }],
      byLevel: [],
      totalActiveEnrollments: 1,
      totalMembers: 2,
    };
    expect(enrollmentReportToCsv(r)).toContain('"Bala, ""BV"""');
  });
});

describe('attendanceReportToCsv', () => {
  it('emits a header row even with no data', () => {
    const r: AttendanceReport = {
      byLevel: [],
      byProgram: [],
      from: '2026-01-01',
      to: '2026-06-09',
      totalEvents: 0,
    };
    expect(attendanceReportToCsv(r)).toBe('scope,key,label,present,absent,late,total,rate');
  });

  it('emits one row per byLevel and byProgram entry in column order', () => {
    const r: AttendanceReport = {
      byLevel: [
        { levelId: 'g3', levelName: 'Grade 3', programKey: 'bala-vihar', present: 9, absent: 1, late: 2, total: 12, rate: 0.9167 },
      ],
      byProgram: [
        { programKey: 'bala-vihar', programLabel: 'Bala Vihar', present: 9, absent: 1, late: 2, total: 12, rate: 0.9167 },
      ],
      from: '2026-01-01',
      to: '2026-06-09',
      totalEvents: 12,
    };
    const lines = attendanceReportToCsv(r).split('\n');
    expect(lines).toHaveLength(3); // header + 2
    expect(lines[0]).toBe('scope,key,label,present,absent,late,total,rate');
    expect(lines[1]).toBe('level,g3,Grade 3,9,1,2,12,0.917');
    expect(lines[2]).toBe('program,bala-vihar,Bala Vihar,9,1,2,12,0.917');
  });

  it('escapes RFC-4180 values with a comma and double-quote', () => {
    const r: AttendanceReport = {
      byLevel: [
        { levelId: 'g3', levelName: 'Grade 3, "G3"', programKey: 'bala-vihar', present: 1, absent: 0, late: 0, total: 1, rate: 1 },
      ],
      byProgram: [],
      from: '2026-01-01',
      to: '2026-06-09',
      totalEvents: 1,
    };
    expect(attendanceReportToCsv(r)).toContain('"Grade 3, ""G3"""');
  });
});

describe('donationsReportToCsv', () => {
  it('emits a header row even with no data', () => {
    const r: DonationsReport = {
      byPeriod: [],
      byProgram: [],
      paidFamilies: 0,
      outstandingFamilies: 0,
      totalCompletedCAD: 0,
    };
    expect(donationsReportToCsv(r)).toBe('scope,key,label,completedCAD,completedCount');
  });

  it('emits one row per byPeriod and byProgram entry in column order', () => {
    const r: DonationsReport = {
      byPeriod: [{ pid: 'p1', label: '2025-26', programLabel: 'Bala Vihar', completedCAD: 1200, completedCount: 6 }],
      byProgram: [{ programKey: 'bala-vihar', programLabel: 'Bala Vihar', completedCAD: 1200, completedCount: 6 }],
      paidFamilies: 6,
      outstandingFamilies: 1,
      totalCompletedCAD: 1200,
    };
    const lines = donationsReportToCsv(r).split('\n');
    expect(lines).toHaveLength(3); // header + 2
    expect(lines[0]).toBe('scope,key,label,completedCAD,completedCount');
    expect(lines[1]).toBe('period,p1,2025-26,1200,6');
    expect(lines[2]).toBe('program,bala-vihar,Bala Vihar,1200,6');
  });

  it('escapes RFC-4180 values with a comma and double-quote', () => {
    const r: DonationsReport = {
      byPeriod: [{ pid: 'p1', label: '2025-26, "FY"', programLabel: 'Bala Vihar', completedCAD: 1, completedCount: 1 }],
      byProgram: [],
      paidFamilies: 1,
      outstandingFamilies: 0,
      totalCompletedCAD: 1,
    };
    expect(donationsReportToCsv(r)).toContain('"2025-26, ""FY"""');
  });
});
