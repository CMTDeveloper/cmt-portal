import { describe, it, expect } from 'vitest';
import { AwardAchievementSchema, AchievementDocSchema } from '../achievement';

describe('AwardAchievementSchema', () => {
  it('accepts a minimal valid award and defaults programKey to null', () => {
    const r = AwardAchievementSchema.safeParse({ mid: 'CMT-F1-02', title: '  Om Award  ' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBe('Om Award');     // trimmed
      expect(r.data.programKey).toBe(null);       // default
    }
  });
  it('accepts an optional description + programKey', () => {
    const r = AwardAchievementSchema.safeParse({ mid: 'CMT-F1-02', title: 'Gita L2', description: 'Recited ch. 12', programKey: 'bala-vihar' });
    expect(r.success).toBe(true);
  });
  it('rejects an empty title', () => {
    expect(AwardAchievementSchema.safeParse({ mid: 'CMT-F1-02', title: '   ' }).success).toBe(false);
  });
  it('rejects a missing mid', () => {
    expect(AwardAchievementSchema.safeParse({ title: 'X' }).success).toBe(false);
  });
});

describe('AchievementDocSchema', () => {
  it('validates a stored doc with a Date awardedAt', () => {
    const r = AchievementDocSchema.safeParse({
      achId: 'a1', mid: 'CMT-F1-02', fid: 'CMT-F1', title: 'Om Award',
      description: null, programKey: null, awardedByUid: 'u1', awardedByName: null,
      awardedAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(r.success).toBe(true);
  });
});
