import { describe, it, expect } from 'vitest';
import { ProgramDocSchema, CreateProgramSchema, ProgramEligibilitySchema, memberEligibleForProgram } from '../program';

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
