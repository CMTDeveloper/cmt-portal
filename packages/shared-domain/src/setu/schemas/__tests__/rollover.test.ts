import { describe, it, expect } from 'vitest';
import {
  EnrollmentDocSchema,
  LevelSnapshotSchema,
  RolloverReportSchema,
  SchoolYearConfigSchema,
  StartYearResultSchema,
} from '../../index';

describe('school-year config schema', () => {
  it('accepts a canonical current school year', () => {
    expect(SchoolYearConfigSchema.parse({ currentYear: '2026-27' })).toEqual({ currentYear: '2026-27' });
  });

  it('rejects malformed and non-sequential school years', () => {
    expect(SchoolYearConfigSchema.safeParse({ currentYear: '2026' }).success).toBe(false);
    expect(SchoolYearConfigSchema.safeParse({ currentYear: '2026-28' }).success).toBe(false);
  });
});

describe('enrollment schema — rollover extensions', () => {
  const base = {
    eid: 'F1-bv-brampton-2026-27', fid: 'F1', oid: 'bv-brampton-2026-27',
    programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: '2026-27',
    location: 'Brampton', enrolledAt: new Date(), enrolledVia: 'promotion',
    enrolledByMid: null, enrolledMids: ['F1-02'],
    suggestedAmountSnapshot: 0, suggestedAmountOverride: null,
    status: 'active', cancelledAt: null, cancelledReason: null,
  };

  it('accepts pid, levelSnapshots, and enrolledVia=promotion', () => {
    const parsed = EnrollmentDocSchema.parse({
      ...base,
      pid: 'bv-brampton-2026-27',
      levelSnapshots: { 'F1-02': { schoolGrade: '4', levelId: 'brampton-level-3-bv-brampton-2026-27', levelName: 'Level 3' } },
    });
    expect(parsed.pid).toBe('bv-brampton-2026-27');
    expect(parsed.levelSnapshots?.['F1-02']?.levelName).toBe('Level 3');
  });

  it('still parses a legacy doc with no pid / no levelSnapshots', () => {
    const parsed = EnrollmentDocSchema.parse({ ...base, enrolledVia: 'welcome-team' });
    expect(parsed.pid).toBeUndefined();
  });

  it('LevelSnapshot allows null grade/level (shishu / no match)', () => {
    expect(LevelSnapshotSchema.parse({ schoolGrade: null, levelId: null, levelName: 'Shishu Vihar' }).schoolGrade).toBeNull();
  });
});

describe('rollover response schemas', () => {
  it('parses a RolloverReport', () => {
    const r = RolloverReportSchema.parse({
      fromYear: '2025-26', toYear: '2026-27', dryRun: true,
      familiesProcessed: 2, familiesSkippedAlreadyPromoted: 0,
      promoted: 3, advanced: 2, shishuStayed: 1, graduated: 1, needsAttention: 1,
      byTransition: [{ label: 'Level 2 → Level 3', count: 1 }],
      graduates: [], attention: [], rows: [],
    });
    expect(r.promoted).toBe(3);
    // affectedFids is omitted from the fixture → .default([]) fills it in.
    expect(r.affectedFids).toEqual([]);
  });
  it('parses a StartYearResult', () => {
    const s = StartYearResultSchema.parse({
      fromYear: '2025-26', toYear: '2026-27',
      offeringsCreated: ['bv-brampton-2026-27'], offeringsExisting: [],
      levelsCreated: ['brampton-level-1-bv-brampton-2026-27'], levelsExisting: [],
      donationPeriodsCreated: ['bv-brampton-2026-27'],
    });
    expect(s.levelsCreated).toHaveLength(1);
  });
});
