import { describe, it, expect } from 'vitest';
import { proposePrasadAssignments, type PrasadEngineInput } from '../prasad-engine';

const sundays = (...dates: string[]) => dates.map((date) => ({ date }));
const child = (mid: string, gradeRung: number | null, birthMonth: number | null, name = mid) =>
  ({ mid, name, gradeRung, birthMonth });
const fam = (
  fid: string,
  children: ReturnType<typeof child>[],
  existing: { date: string } | null = null,
) => ({ fid, familyName: `Fam ${fid}`, children, existing });

function run(input: Partial<PrasadEngineInput>): ReturnType<typeof proposePrasadAssignments> {
  return proposePrasadAssignments({
    pid: 'bv-brampton-2025-26',
    location: 'Brampton',
    cap: 2,
    sundays: sundays('2026-03-01', '2026-03-08', '2026-04-05'),
    families: [],
    ...input,
  });
}

describe('proposePrasadAssignments', () => {
  it('places a family in its youngest child birthday month', () => {
    const out = run({ families: [fam('A', [child('A-02', 3, 3)])] });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ fid: 'A', date: '2026-03-01', reason: 'birthday-month', birthMonth: 3 });
  });

  it('youngest = lowest gradeRung; tie broken by lower mid', () => {
    const out = run({
      families: [fam('A', [child('A-03', 1, 4), child('A-02', 1, 3)])],
      sundays: sundays('2026-03-01', '2026-04-05'),
    });
    // tie on rung 1 → A-02 wins → birthMonth 3 → March
    expect(out.rows[0]).toMatchObject({ youngestMid: 'A-02', date: '2026-03-01' });
  });

  it('falls back to the next-youngest child WITH a birth month', () => {
    const out = run({
      families: [fam('A', [child('A-02', 0, null), child('A-03', 5, 4)])],
      sundays: sundays('2026-03-01', '2026-04-05'),
    });
    expect(out.rows[0]).toMatchObject({ date: '2026-04-05', birthMonth: 4, reason: 'birthday-month' });
  });

  it('balances within the month: picks the Sunday with most seats, tie → earliest', () => {
    const out = run({
      cap: 2,
      families: [fam('A', [child('a', 1, 3)]), fam('B', [child('b', 1, 3)]), fam('C', [child('c', 1, 3)])],
      sundays: sundays('2026-03-01', '2026-03-08'),
    });
    const dates = out.rows.map((r) => r.date).sort();
    expect(dates).toEqual(['2026-03-01', '2026-03-01', '2026-03-08']);
  });

  it('spills to the calendar-nearest Sunday when the month is full (equal distance → earlier)', () => {
    const out = run({
      cap: 1,
      families: [fam('A', [child('a', 1, 3)]), fam('B', [child('b', 1, 3)])],
      sundays: sundays('2026-02-22', '2026-03-01', '2026-04-12'),
    });
    const a = out.rows.find((r) => r.fid === 'A')!;
    const b = out.rows.find((r) => r.fid === 'B')!;
    expect(a).toMatchObject({ date: '2026-03-01', reason: 'birthday-month' });
    // March's only Sunday is taken → anchor 2026-03-01; Feb 22 is 7 days away,
    // Apr 12 is 42 → nearest open seat is Feb 22.
    expect(b).toMatchObject({ date: '2026-02-22', reason: 'spill' });
  });

  it('July/August birthdays (no class Sundays) spill to the nearest class Sunday', () => {
    const out = run({
      families: [fam('A', [child('a', 1, 7)])],
      sundays: sundays('2025-09-07', '2026-06-14'),
    });
    expect(out.rows[0]!.reason).toBe('spill');
    expect(['2025-09-07', '2026-06-14']).toContain(out.rows[0]!.date);
  });

  it('no-birth-month families fill the emptiest Sundays', () => {
    const out = run({
      cap: 2,
      families: [fam('A', [child('a', 1, 3)]), fam('B', [child('b', 1, null)])],
      sundays: sundays('2026-03-01', '2026-04-05'),
    });
    expect(out.rows.find((r) => r.fid === 'B')).toMatchObject({ date: '2026-04-05', reason: 'no-birth-month', birthMonth: null });
  });

  it('keeps existing assignments (never moves), their seats are consumed, and they are not re-proposed', () => {
    const out = run({
      cap: 1,
      families: [fam('A', [child('a', 1, 3)], { date: '2026-03-01' }), fam('B', [child('b', 1, 3)])],
      sundays: sundays('2026-03-01', '2026-03-08'),
    });
    expect(out.rows.map((r) => r.fid)).toEqual(['B']);  // A untouched
    expect(out.rows[0]!.date).toBe('2026-03-08');        // A consumed March 1's only seat
    expect(out.stats.keptExisting).toBe(1);
  });

  it('flags unplaceable families when total seats run out', () => {
    const out = run({
      cap: 1,
      sundays: sundays('2026-03-01'),
      families: [fam('A', [child('a', 1, 3)]), fam('B', [child('b', 1, 3)])],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.unplaced.map((u) => u.fid)).toEqual(['B']);
  });

  it('is deterministic: same input → identical output', () => {
    const input: PrasadEngineInput = {
      pid: 'p', location: 'Brampton', cap: 2,
      sundays: sundays('2026-03-01', '2026-03-08', '2026-04-05'),
      families: [fam('C', [child('c', 2, 4)]), fam('A', [child('a', 1, 3)]), fam('B', [child('b', 1, null)])],
    };
    expect(proposePrasadAssignments(input)).toEqual(proposePrasadAssignments(input));
  });

  it('reports per-Sunday counts including existing assignments', () => {
    const out = run({
      families: [fam('A', [child('a', 1, 3)], { date: '2026-03-08' }), fam('B', [child('b', 1, 3)])],
    });
    const march1 = out.perSunday.find((s) => s.date === '2026-03-01')!;
    const march8 = out.perSunday.find((s) => s.date === '2026-03-08')!;
    expect(march8.count).toBe(1); // existing
    expect(march1.count).toBe(1); // B balances onto the emptier March Sunday
  });
});
