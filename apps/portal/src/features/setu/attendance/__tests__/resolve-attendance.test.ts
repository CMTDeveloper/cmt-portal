import { describe, it, expect } from 'vitest';
import { resolveMemberAttendance } from '../resolve-attendance';

describe('resolveMemberAttendance', () => {
  it('returns an empty summary for no marks', () => {
    expect(resolveMemberAttendance([], [])).toEqual({
      present: 0, late: 0, absent: 0, total: 0, attendedPct: 0, marks: [],
    });
  });

  it('maps a door check-in to present and a door no-show to absent', () => {
    const out = resolveMemberAttendance([], [
      { date: '2026-01-04', present: true },
      { date: '2026-01-11', present: false },
    ]);
    expect(out.marks).toEqual([
      { date: '2026-01-04', status: 'present', source: 'door' },
      { date: '2026-01-11', status: 'absent', source: 'door' },
    ]);
    expect(out).toMatchObject({ present: 1, absent: 1, total: 2, attendedPct: 50 });
  });

  it('lets a portal mark WIN over a door check-in on the same date', () => {
    const out = resolveMemberAttendance(
      [{ date: '2026-01-04', status: 'late' }],
      [{ date: '2026-01-04', present: true }],
    );
    expect(out.marks).toEqual([{ date: '2026-01-04', status: 'late', source: 'portal' }]);
    expect(out).toMatchObject({ present: 0, late: 1, absent: 0, total: 1, attendedPct: 100 });
  });

  it('unions dates from both sources and sorts ascending; late+present both count as attended (N=2)', () => {
    const out = resolveMemberAttendance(
      [{ date: '2026-01-18', status: 'absent' }, { date: '2026-01-04', status: 'late' }],
      [{ date: '2026-01-11', present: true }],
    );
    expect(out.marks.map((m) => m.date)).toEqual(['2026-01-04', '2026-01-11', '2026-01-18']);
    expect(out.marks.map((m) => m.source)).toEqual(['portal', 'door', 'portal']);
    expect(out).toMatchObject({ present: 1, late: 1, absent: 1, total: 3, attendedPct: 67 });
  });
});
