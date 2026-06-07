import { describe, it, expect } from 'vitest';
import { decidePromotion, GRADE_LADDER } from '../grade-ladder';

const NOW = new Date('2026-06-07T00:00:00Z');
function child(schoolGrade: string | null, birthMonthYear: string | null = null) {
  return { schoolGrade, birthMonthYear };
}

describe('GRADE_LADDER', () => {
  it('runs JK,SK,1..12', () => {
    expect(GRADE_LADDER[0]).toBe('JK');
    expect(GRADE_LADDER[1]).toBe('SK');
    expect(GRADE_LADDER[GRADE_LADDER.length - 1]).toBe('12');
  });
});

describe('decidePromotion', () => {
  it('advances a numeric grade one rung', () => {
    expect(decidePromotion(child('3'), NOW)).toEqual({ kind: 'advance', from: '3', to: '4' });
  });
  it('normalizes "Grade 3" / "Gr 3" before advancing', () => {
    expect(decidePromotion(child('Grade 3'), NOW)).toEqual({ kind: 'advance', from: '3', to: '4' });
    expect(decidePromotion(child('Gr 3'), NOW)).toEqual({ kind: 'advance', from: '3', to: '4' });
  });
  it('advances JK→SK and SK→1', () => {
    expect(decidePromotion(child('JK'), NOW)).toEqual({ kind: 'advance', from: 'JK', to: 'SK' });
    expect(decidePromotion(child('SK'), NOW)).toEqual({ kind: 'advance', from: 'SK', to: '1' });
  });
  it('graduates Grade 12', () => {
    expect(decidePromotion(child('12'), NOW)).toEqual({ kind: 'graduate', from: '12' });
  });
  it('flags an off-ladder grade as needs-grade', () => {
    expect(decidePromotion(child('Kindergarten'), NOW).kind).toBe('needs-grade');
    expect(decidePromotion(child('13'), NOW).kind).toBe('needs-grade');
  });
  it('shishu-age child with no grade → shishu-stays', () => {
    expect(decidePromotion(child(null, '2023-12'), NOW).kind).toBe('shishu-stays');
  });
  it('no grade + aged out of shishu (≥60mo) → shishu-aged-out', () => {
    expect(decidePromotion(child(null, '2020-01'), NOW).kind).toBe('shishu-aged-out');
  });
  it('no grade + no/bad birthMonthYear → needs-grade', () => {
    expect(decidePromotion(child(null, null), NOW).kind).toBe('needs-grade');
    expect(decidePromotion(child(null, 'xxxx'), NOW).kind).toBe('needs-grade');
  });
});
