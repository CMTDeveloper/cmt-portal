import { describe, it, expect } from 'vitest';
import { ProgramDocSchema, CreateProgramSchema, ProgramEligibilitySchema, memberEligibleForProgram, isAdultStudyClassProgram } from '../program';

const prog = {
  programKey: 'bala-vihar', label: 'Bala Vihar', shortDescription: 'Sunday classes',
  status: 'active', locations: ['Brampton'], termType: 'term',
  eligibility: { memberType: 'child' }, displayOrder: 0,
  capabilities: { usesOfferings: true, usesDonation: true, usesLevels: true, usesCalendar: true, attendanceMode: 'check-in' },
  createdAt: new Date(), createdBy: 'u', updatedAt: new Date(), updatedBy: 'u',
};

describe('ProgramDoc', () => {
  it('accepts a valid program', () => { expect(ProgramDocSchema.safeParse(prog).success).toBe(true); });
  it('accepts location-less (empty locations)', () => {
    expect(ProgramDocSchema.safeParse({ ...prog, locations: [] }).success).toBe(true);
  });
});

describe('CreateProgramSchema', () => {
  it('accepts a valid create input', () => {
    const r = CreateProgramSchema.safeParse({
      programKey: 'tabla', label: 'Tabla', termType: 'rolling',
      eligibility: { memberType: 'any' },
      capabilities: { usesOfferings: true, usesDonation: false, usesLevels: false, usesCalendar: false, attendanceMode: 'none' },
    });
    expect(r.success).toBe(true);
  });
});

describe('ProgramEligibility min<=max guard', () => {
  it('rejects minAgeYears > maxAgeYears', () => {
    expect(ProgramEligibilitySchema.safeParse({ memberType: 'child', minAgeYears: 12, maxAgeYears: 8 }).success).toBe(false);
  });
  it('accepts minAgeYears <= maxAgeYears', () => {
    expect(ProgramEligibilitySchema.safeParse({ memberType: 'child', minAgeYears: 8, maxAgeYears: 12 }).success).toBe(true);
    expect(ProgramEligibilitySchema.safeParse({ memberType: 'child', minAgeYears: 8, maxAgeYears: 8 }).success).toBe(true);
  });
  it('accepts a single bound or no bounds', () => {
    expect(ProgramEligibilitySchema.safeParse({ memberType: 'child', minAgeYears: 5 }).success).toBe(true);
    expect(ProgramEligibilitySchema.safeParse({ memberType: 'child', maxAgeYears: 18 }).success).toBe(true);
    expect(ProgramEligibilitySchema.safeParse({ memberType: 'any' }).success).toBe(true);
  });
  it('still validates inside CreateProgramSchema/ProgramDocSchema (embedded)', () => {
    const bad = {
      ...prog,
      eligibility: { memberType: 'child', minAgeYears: 12, maxAgeYears: 8 },
    };
    expect(ProgramDocSchema.safeParse(bad).success).toBe(false);
    expect(CreateProgramSchema.safeParse({
      programKey: 'tabla', label: 'Tabla', termType: 'rolling',
      eligibility: { memberType: 'child', minAgeYears: 12, maxAgeYears: 8 },
      capabilities: { usesOfferings: true, usesDonation: false, usesLevels: false, usesCalendar: false, attendanceMode: 'none' },
    }).success).toBe(false);
  });
});

describe('memberEligibleForProgram', () => {
  const now = new Date('2026-01-15');
  const child = { type: 'Child' as const, birthMonthYear: '2018-01' }; // ~8y
  const adult = { type: 'Adult' as const, birthMonthYear: null };
  it('child program excludes adults', () => {
    expect(memberEligibleForProgram(adult, { memberType: 'child' }, now)).toBe(false);
    expect(memberEligibleForProgram(child, { memberType: 'child' }, now)).toBe(true);
  });
  it('any allows both', () => {
    expect(memberEligibleForProgram(adult, { memberType: 'any' }, now)).toBe(true);
    expect(memberEligibleForProgram(child, { memberType: 'any' }, now)).toBe(true);
  });
  it('enforces age range when set', () => {
    expect(memberEligibleForProgram(child, { memberType: 'child', minAgeYears: 10 }, now)).toBe(false);
    expect(memberEligibleForProgram(child, { memberType: 'child', maxAgeYears: 10 }, now)).toBe(true);
  });
  it('passes age gate when birthMonthYear unknown (no false-negative)', () => {
    expect(memberEligibleForProgram({ type: 'Child', birthMonthYear: null }, { memberType: 'child', minAgeYears: 5 }, now)).toBe(true);
  });
});

const caps2 = { usesOfferings: true, usesDonation: true, usesLevels: false, usesCalendar: false, attendanceMode: 'none' as const };

// ── isAdultStudyClassProgram ─────────────────────────────────────────────────
// Scarborough's adult class was created as its own program, `adult-study-east`
// (2026-07-28). Every adult-class code path compared against the literal
// `adult-study-class`, so the gate could never fire for it: the family enrolled,
// paid, and was never asked who attends, with nothing logging a mismatch.
describe('isAdultStudyClassProgram', () => {
  const caps = { usesOfferings: true, usesDonation: true, usesLevels: false, usesCalendar: false, attendanceMode: 'none' as const };

  it('the capability marks a per-centre program, whatever its key', () => {
    expect(
      isAdultStudyClassProgram({ programKey: 'adult-study-east', capabilities: { ...caps, isAdultStudyClass: true } }),
    ).toBe(true);
  });

  it('an ordinary program is not one', () => {
    expect(isAdultStudyClassProgram({ programKey: 'bala-vihar', capabilities: caps })).toBe(false);
    expect(isAdultStudyClassProgram({ programKey: 'tabla', capabilities: { ...caps, isAdultStudyClass: false } })).toBe(false);
  });

  it('a MERELY SIMILAR key is not one - the flag is the rule, not a prefix', () => {
    expect(isAdultStudyClassProgram({ programKey: 'adult-study-class-lookalike', capabilities: caps })).toBe(false);
  });

  it('the original key still counts with no capability set, so Brampton keeps working un-migrated', () => {
    expect(isAdultStudyClassProgram({ programKey: 'adult-study-class', capabilities: caps })).toBe(true);
  });

  it('survives a doc with no capabilities at all rather than throwing', () => {
    expect(isAdultStudyClassProgram({ programKey: 'adult-study-east' })).toBe(false);
    expect(isAdultStudyClassProgram({ programKey: 'adult-study-class' })).toBe(true);
  });
});

// The flag is optional ON PURPOSE: this schema validates on READ, so a required
// field would reject every program doc written before it existed.
describe('ProgramCapabilitiesSchema.isAdultStudyClass', () => {
  it('parses a doc that predates the flag', () => {
    expect(ProgramDocSchema.safeParse({ ...prog, createdAt: new Date(), createdBy: 'x', updatedAt: new Date(), updatedBy: 'x' }).success).toBe(true);
  });

  it('does NOT invent a false default - an absent flag stays absent, so a partial write cannot erase it', () => {
    const parsed = CreateProgramSchema.parse({
      label: 'Adult Study Classes East', termType: 'term',
      eligibility: { memberType: 'adult' }, capabilities: caps2,
    });
    expect('isAdultStudyClass' in parsed.capabilities).toBe(false);
  });

  it('round-trips true', () => {
    const parsed = CreateProgramSchema.parse({
      label: 'Adult Study Classes East', termType: 'term',
      eligibility: { memberType: 'adult' }, capabilities: { ...caps2, isAdultStudyClass: true },
    });
    expect(parsed.capabilities.isAdultStudyClass).toBe(true);
  });
});

