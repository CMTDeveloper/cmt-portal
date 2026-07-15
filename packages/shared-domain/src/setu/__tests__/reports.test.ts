// packages/shared-domain/src/setu/__tests__/reports.test.ts
import { describe, it, expect } from 'vitest';
import {
  ReportQuerySchema, REPORT_KINDS,
  EnrollmentReportSchema, AttendanceReportSchema,
} from '../reports';

describe('report schemas', () => {
  it('REPORT_KINDS are the two native kinds (donations report removed)', () => {
    expect(REPORT_KINDS).toEqual(['enrollment', 'attendance']);
  });
  it('ReportQuerySchema defaults format=json and accepts from/to/program/location', () => {
    expect(ReportQuerySchema.parse({}).format).toBe('json');
    const p = ReportQuerySchema.parse({ format: 'csv', from: '2026-01-01', to: '2026-12-31', program: 'bala-vihar' });
    expect(p.from).toBe('2026-01-01');
  });
  it('ReportQuerySchema rejects a bad date and a bad format', () => {
    expect(ReportQuerySchema.safeParse({ from: '2026/01/01' }).success).toBe(false);
    expect(ReportQuerySchema.safeParse({ format: 'pdf' }).success).toBe(false);
  });
  it('ReportQuerySchema keeps a valid year and rejects a malformed one', () => {
    expect(ReportQuerySchema.parse({ year: '2025-26' }).year).toBe('2025-26');
    expect(ReportQuerySchema.parse({}).year).toBeUndefined();
    expect(ReportQuerySchema.safeParse({ year: '2025' }).success).toBe(false);
  });
  it('report response schemas parse representative payloads', () => {
    expect(EnrollmentReportSchema.parse({
      byProgram: [{ programKey: 'bala-vihar', programLabel: 'Bala Vihar', families: 10, members: 14 }],
      byLevel: [{ levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar', members: 7 }],
      totalActiveEnrollments: 10, totalMembers: 14,
    }).byProgram).toHaveLength(1);
    // issue #23: bala-vihar byProgram groups carry optional confirmed/registered
    // counts (confirmed + registered === families); other groups omit them.
    const bvSplit = EnrollmentReportSchema.parse({
      byProgram: [{ programKey: 'bala-vihar', programLabel: 'Bala Vihar', families: 10, members: 14, confirmed: 6, registered: 4 }],
      byLevel: [], totalActiveEnrollments: 10, totalMembers: 14,
    }).byProgram[0]!;
    expect(bvSplit.confirmed).toBe(6);
    expect(bvSplit.registered).toBe(4);
    expect(AttendanceReportSchema.parse({
      byLevel: [{ levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar', present: 5, absent: 1, late: 1, total: 7, rate: 0.71 }],
      byProgram: [{ programKey: 'bala-vihar', programLabel: 'Bala Vihar', present: 5, absent: 1, late: 1, total: 7, rate: 0.71 }],
      from: '2026-01-01', to: '2026-12-31', totalEvents: 7,
    }).byLevel[0]!.rate).toBeCloseTo(0.71);
  });
});
