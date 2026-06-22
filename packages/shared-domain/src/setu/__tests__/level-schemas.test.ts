import { describe, it, expect } from 'vitest';
import {
  CreateLevelSchema,
  UpdateLevelSchema,
  LevelDocSchema,
  levelSlug,
  memberMatchesLevel,
  normalizeGrade,
  LEVEL_KINDS,
} from '../schemas/level';

const validCreate = {
  programKey: 'bala-vihar' as const,
  location: 'Brampton' as const,
  pid: 'bv-brampton-2025-26',
  levelName: 'Level 2',
  levelKind: 'level' as const,
  order: 4,
  gradeBand: ['Gr 2', 'Gr 3'],
  ageLabel: 'Gr 2 & 3',
  curriculum: 'Hanuman',
  enabled: true,
};

// ── CreateLevelSchema ──────────────────────────────────────────────────────────

describe('CreateLevelSchema', () => {
  it('accepts a valid level create payload', () => {
    expect(CreateLevelSchema.safeParse(validCreate).success).toBe(true);
  });

  it('accepts every level kind', () => {
    for (const levelKind of LEVEL_KINDS) {
      const gradeBand = levelKind === 'level' || levelKind === 'pre-level' ? ['Gr 1'] : [];
      expect(CreateLevelSchema.safeParse({ ...validCreate, levelKind, gradeBand }).success).toBe(true);
    }
  });

  it('accepts shishu/parents with an empty gradeBand', () => {
    expect(
      CreateLevelSchema.safeParse({ ...validCreate, levelKind: 'shishu', gradeBand: [], curriculum: 'Devatas', ageLabel: '1.5 to 4 years' }).success,
    ).toBe(true);
    expect(
      CreateLevelSchema.safeParse({ ...validCreate, levelKind: 'parents', gradeBand: [], curriculum: 'Gita', ageLabel: 'All Adults' }).success,
    ).toBe(true);
  });

  it('rejects a level/pre-level with an empty gradeBand', () => {
    expect(CreateLevelSchema.safeParse({ ...validCreate, levelKind: 'level', gradeBand: [] }).success).toBe(false);
    expect(CreateLevelSchema.safeParse({ ...validCreate, levelKind: 'pre-level', gradeBand: [] }).success).toBe(false);
  });

  it('rejects an unknown level kind', () => {
    expect(CreateLevelSchema.safeParse({ ...validCreate, levelKind: 'senior' }).success).toBe(false);
  });

  it('rejects an unknown location', () => {
    expect(CreateLevelSchema.safeParse({ ...validCreate, location: 'Toronto' }).success).toBe(false);
  });

  it('rejects a negative order', () => {
    expect(CreateLevelSchema.safeParse({ ...validCreate, order: -1 }).success).toBe(false);
  });

  it('accepts omitted order so the API can assign display order', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { order, ...rest } = validCreate;
    expect(CreateLevelSchema.safeParse(rest).success).toBe(true);
  });

  it('accepts an optional teacher email for create-time assignment', () => {
    expect(CreateLevelSchema.safeParse({ ...validCreate, teacherEmail: 'teacher@example.com' }).success).toBe(true);
    expect(CreateLevelSchema.safeParse({ ...validCreate, teacherEmail: 'not-an-email' }).success).toBe(false);
  });

  it('rejects an empty levelName', () => {
    expect(CreateLevelSchema.safeParse({ ...validCreate, levelName: '' }).success).toBe(false);
  });

  it('rejects an empty pid', () => {
    expect(CreateLevelSchema.safeParse({ ...validCreate, pid: '' }).success).toBe(false);
  });

  it('defaults enabled to true when omitted', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { enabled, ...rest } = validCreate;
    const result = CreateLevelSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(true);
  });
});

// ── UpdateLevelSchema ──────────────────────────────────────────────────────────

describe('UpdateLevelSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(UpdateLevelSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a partial update (rename + enabled toggle)', () => {
    expect(UpdateLevelSchema.safeParse({ levelName: 'Level 2 (renamed)', enabled: false }).success).toBe(true);
  });

  it('accepts a gradeBand update', () => {
    expect(UpdateLevelSchema.safeParse({ gradeBand: ['Gr 2', 'Gr 3', 'Gr 4'] }).success).toBe(true);
  });

  it('rejects an empty levelName', () => {
    expect(UpdateLevelSchema.safeParse({ levelName: '' }).success).toBe(false);
  });

  it('rejects an unknown levelKind', () => {
    expect(UpdateLevelSchema.safeParse({ levelKind: 'senior' }).success).toBe(false);
  });
});

// ── LevelDocSchema ─────────────────────────────────────────────────────────────

describe('LevelDocSchema', () => {
  const validDoc = {
    levelId: 'brampton-level-2-bv-brampton-2025-26',
    programKey: 'bala-vihar' as const,
    location: 'Brampton' as const,
    levelName: 'Level 2',
    levelKind: 'level' as const,
    order: 4,
    gradeBand: ['Gr 2', 'Gr 3'],
    ageLabel: 'Gr 2 & 3',
    curriculum: 'Hanuman',
    pid: 'bv-brampton-2025-26',
    periodLabel: '2025-26',
    teacherRefs: ['CMT-AAAA1111-01'],
    enabled: true,
    createdAt: new Date(),
    createdBy: 'uid-admin',
    updatedAt: new Date(),
    updatedBy: 'uid-admin',
  };

  it('accepts a valid level doc', () => {
    expect(LevelDocSchema.safeParse(validDoc).success).toBe(true);
  });

  it('accepts an empty teacherRefs array', () => {
    expect(LevelDocSchema.safeParse({ ...validDoc, teacherRefs: [] }).success).toBe(true);
  });

  it('rejects a missing levelId', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { levelId, ...rest } = validDoc;
    expect(LevelDocSchema.safeParse(rest).success).toBe(false);
  });

  it('LevelDoc accepts null location (location-less program)', () => {
    expect(LevelDocSchema.safeParse({ ...validDoc, location: null }).success).toBe(true);
  });
});

// ── levelSlug ──────────────────────────────────────────────────────────────────

describe('levelSlug', () => {
  it('slugs a level name', () => {
    expect(levelSlug('Level 2')).toBe('level-2');
    expect(levelSlug('Pre-Level A')).toBe('pre-level-a');
    expect(levelSlug('Shishu Vihar')).toBe('shishu-vihar');
    expect(levelSlug('Parents')).toBe('parents');
  });
});

// ── normalizeGrade ──────────────────────────────────────────────────────────────

describe('normalizeGrade', () => {
  it('strips a "Grade N" prefix to the bare number', () => {
    expect(normalizeGrade('Grade 3')).toBe('3');
    expect(normalizeGrade('grade 10')).toBe('10');
  });
  it('strips a "Gr N" / "Gr. N" prefix', () => {
    expect(normalizeGrade('Gr 2')).toBe('2');
    expect(normalizeGrade('Gr. 4')).toBe('4');
  });
  it('passes a bare number through', () => {
    expect(normalizeGrade('5')).toBe('5');
  });
  it('lowercases non-numeric labels (JK/SK)', () => {
    expect(normalizeGrade('JK')).toBe('jk');
    expect(normalizeGrade('SK')).toBe('sk');
  });
});

// ── memberMatchesLevel ──────────────────────────────────────────────────────────

describe('memberMatchesLevel', () => {
  const NOW = new Date('2026-01-15T17:00:00Z'); // mid-Jan 2026, Toronto

  const child = (over: Partial<{ schoolGrade: string | null; birthMonthYear: string | null }>) => ({
    type: 'Child' as const,
    schoolGrade: null,
    birthMonthYear: null,
    ...over,
  });
  const adult = { type: 'Adult' as const, schoolGrade: null, birthMonthYear: null };

  it('level: matches a child whose grade is in the band', () => {
    const level = { levelKind: 'level' as const, gradeBand: ['Gr 2', 'Gr 3'] };
    expect(memberMatchesLevel(child({ schoolGrade: 'Gr 2' }), level, NOW)).toBe(true);
    expect(memberMatchesLevel(child({ schoolGrade: 'Gr 3' }), level, NOW)).toBe(true);
  });

  it('level: rejects a child whose grade is not in the band', () => {
    const level = { levelKind: 'level' as const, gradeBand: ['Gr 2', 'Gr 3'] };
    expect(memberMatchesLevel(child({ schoolGrade: 'Gr 5' }), level, NOW)).toBe(false);
  });

  it('level: matches across grade-label formats (band "2" vs member "Grade 2")', () => {
    const level = { levelKind: 'level' as const, gradeBand: ['2', '3'] }; // legacy bare-number band
    expect(memberMatchesLevel(child({ schoolGrade: 'Grade 2' }), level, NOW)).toBe(true);
    expect(memberMatchesLevel(child({ schoolGrade: 'Gr 3' }), level, NOW)).toBe(true);
    expect(memberMatchesLevel(child({ schoolGrade: '3' }), level, NOW)).toBe(true);
    expect(memberMatchesLevel(child({ schoolGrade: 'Grade 4' }), level, NOW)).toBe(false);
  });

  it('level: rejects an adult even with a matching-looking grade', () => {
    const level = { levelKind: 'level' as const, gradeBand: ['Gr 2'] };
    expect(memberMatchesLevel({ ...adult, schoolGrade: 'Gr 2' }, level, NOW)).toBe(false);
  });

  it('pre-level: matches a child by gradeBand (JK/SK)', () => {
    const level = { levelKind: 'pre-level' as const, gradeBand: ['JK', 'SK'] };
    expect(memberMatchesLevel(child({ schoolGrade: 'JK' }), level, NOW)).toBe(true);
    expect(memberMatchesLevel(child({ schoolGrade: 'Gr 1' }), level, NOW)).toBe(false);
  });

  it('shishu: matches a child aged 1.5–4 from birthMonthYear', () => {
    const level = { levelKind: 'shishu' as const, gradeBand: [] };
    // born 2023-06 → ~2.6y at NOW
    expect(memberMatchesLevel(child({ birthMonthYear: '2023-06' }), level, NOW)).toBe(true);
  });

  it('shishu: rejects a child too old (5+)', () => {
    const level = { levelKind: 'shishu' as const, gradeBand: [] };
    // born 2020-01 → ~6y at NOW
    expect(memberMatchesLevel(child({ birthMonthYear: '2020-01' }), level, NOW)).toBe(false);
  });

  it('shishu: rejects a child too young (<1.5)', () => {
    const level = { levelKind: 'shishu' as const, gradeBand: [] };
    // born 2025-06 → ~0.6y at NOW
    expect(memberMatchesLevel(child({ birthMonthYear: '2025-06' }), level, NOW)).toBe(false);
  });

  it('shishu: rejects a child with no birthMonthYear (cannot determine age)', () => {
    const level = { levelKind: 'shishu' as const, gradeBand: [] };
    expect(memberMatchesLevel(child({ birthMonthYear: null }), level, NOW)).toBe(false);
  });

  it('parents: matches adults only', () => {
    const level = { levelKind: 'parents' as const, gradeBand: [] };
    expect(memberMatchesLevel(adult, level, NOW)).toBe(true);
    expect(memberMatchesLevel(child({ schoolGrade: 'Gr 2' }), level, NOW)).toBe(false);
  });
});
