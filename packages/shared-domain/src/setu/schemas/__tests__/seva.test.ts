import { describe, it, expect } from 'vitest';
import {
  SevaRequirementConfigSchema,
  SevaOpportunityDocSchema,
  CreateSevaOpportunitySchema,
  UpdateSevaOpportunitySchema,
} from '../seva';

describe('SevaRequirementConfigSchema', () => {
  it('accepts a target + nullable seva year', () => {
    expect(SevaRequirementConfigSchema.parse({ hoursPerYear: 20, currentSevaYear: '2025-26' }).hoursPerYear).toBe(20);
    expect(SevaRequirementConfigSchema.parse({ hoursPerYear: 20, currentSevaYear: null }).currentSevaYear).toBeNull();
  });
  it('rejects a non-positive target', () => {
    expect(SevaRequirementConfigSchema.safeParse({ hoursPerYear: 0, currentSevaYear: null }).success).toBe(false);
  });
});

describe('SevaOpportunityDocSchema', () => {
  const base = {
    oppId: 'opp1', title: 'Diwali setup', description: '', date: new Date(),
    location: '', defaultHours: 4, capacity: null, sevaYear: '2025-26',
    status: 'open' as const, createdAt: new Date(), createdBy: 'u1',
    updatedAt: new Date(), updatedBy: 'u1',
  };
  it('parses a valid opportunity', () => {
    expect(SevaOpportunityDocSchema.parse(base).title).toBe('Diwali setup');
  });
  it('rejects defaultHours <= 0 and status outside the enum', () => {
    expect(SevaOpportunityDocSchema.safeParse({ ...base, defaultHours: 0 }).success).toBe(false);
    expect(SevaOpportunityDocSchema.safeParse({ ...base, status: 'past' }).success).toBe(false);
  });
});

describe('CreateSevaOpportunitySchema', () => {
  it('defaults description/location to "" and capacity to null', () => {
    const p = CreateSevaOpportunitySchema.parse({ title: 'X', date: '2026-01-01', defaultHours: 3 });
    expect(p.description).toBe('');
    expect(p.location).toBe('');
    expect(p.capacity).toBeNull();
  });
  it('rejects an empty title and non-positive hours', () => {
    expect(CreateSevaOpportunitySchema.safeParse({ title: '', date: '2026-01-01', defaultHours: 3 }).success).toBe(false);
    expect(CreateSevaOpportunitySchema.safeParse({ title: 'X', date: '2026-01-01', defaultHours: 0 }).success).toBe(false);
  });
});

describe('UpdateSevaOpportunitySchema', () => {
  it('is fully partial and allows closing', () => {
    expect(UpdateSevaOpportunitySchema.parse({ status: 'closed' }).status).toBe('closed');
    expect(UpdateSevaOpportunitySchema.parse({}).title).toBeUndefined();
  });
});
