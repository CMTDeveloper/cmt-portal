import { describe, it, expect } from 'vitest';
import { selectFamilyPledge, type FamilyPledgeView } from '../select-family-pledge';

/**
 * A family accumulates pledge ROWS, not a pledge. A failed first attempt, a
 * cancelled one from last year, and a live one all sit in the same collection,
 * so the card's honesty depends entirely on which row this picks.
 *
 * Every case below uses N=2 or more on purpose, and each is asserted in BOTH
 * array orders: a selector that simply returns `rows[0]` (or `rows.at(-1)`)
 * passes half of any single-order suite by luck.
 */

function row(over: Partial<FamilyPledgeView> & { pid: string }): FamilyPledgeView {
  return {
    status: 'started',
    monthlyAmountCAD: 51,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    activatedAt: null,
    ...over,
  };
}

/** Assert the same winner regardless of the order Firestore happened to return. */
function bothOrders(rows: FamilyPledgeView[]): (string | null)[] {
  return [
    selectFamilyPledge(rows)?.pid ?? null,
    selectFamilyPledge([...rows].reverse())?.pid ?? null,
  ];
}

describe('selectFamilyPledge', () => {
  it('returns null when the family has never started one', () => {
    expect(selectFamilyPledge([])).toBeNull();
  });

  it('prefers an ACTIVE row over a failed one, in either order', () => {
    // The real shape after a family's first attempt bounced and the second took.
    const rows = [
      row({ pid: 'FAILED', status: 'failed', startedAt: new Date('2026-03-01T00:00:00Z') }),
      row({ pid: 'LIVE', status: 'active', startedAt: new Date('2026-02-01T00:00:00Z'), activatedAt: new Date('2026-02-02T00:00:00Z') }),
    ];
    // Note the dates: the failed row is NEWER. A selector that sorts by date
    // FIRST and only then by status would return FAILED here - which is the
    // whole point of the fixture. The family is giving; the card must say so.
    expect(bothOrders(rows)).toEqual(['LIVE', 'LIVE']);
  });

  it('prefers ACTIVE over STARTED - a live gift outranks an in-flight one', () => {
    const rows = [
      row({ pid: 'INFLIGHT', status: 'started', startedAt: new Date('2026-05-01T00:00:00Z') }),
      row({ pid: 'LIVE', status: 'active', startedAt: new Date('2026-01-01T00:00:00Z'), activatedAt: new Date('2026-01-02T00:00:00Z') }),
    ];
    expect(bothOrders(rows)).toEqual(['LIVE', 'LIVE']);
  });

  it('prefers STARTED over a terminal row, in either order', () => {
    const rows = [
      row({ pid: 'CANCELLED', status: 'cancelled', startedAt: new Date('2026-06-01T00:00:00Z') }),
      row({ pid: 'INFLIGHT', status: 'started', startedAt: new Date('2026-04-01T00:00:00Z') }),
    ];
    expect(bothOrders(rows)).toEqual(['INFLIGHT', 'INFLIGHT']);
  });

  it('picks the NEWEST when two rows share a rank', () => {
    const rows = [
      row({ pid: 'OLD', status: 'failed', startedAt: new Date('2025-01-01T00:00:00Z') }),
      row({ pid: 'NEW', status: 'cancelled', startedAt: new Date('2026-01-01T00:00:00Z') }),
    ];
    // failed and cancelled share the terminal rank, so this is decided purely on
    // date - and it is the only thing that decides it.
    expect(bothOrders(rows)).toEqual(['NEW', 'NEW']);
  });

  it('picks the newest terminal row whichever terminal status it carries', () => {
    // The MIRRORED pair matters. `failed` and `cancelled` share one rank, so
    // date is the only thing allowed to decide between them - but a rank table
    // that quietly preferred `cancelled` would still pass the case above, where
    // the cancelled row also happens to be the newest. A mutation run found
    // exactly that hole. Running the arrangement both ways closes it.
    const cancelledIsNewest = [
      row({ pid: 'OLD-FAILED', status: 'failed', startedAt: new Date('2025-01-01T00:00:00Z') }),
      row({ pid: 'NEW-CANCELLED', status: 'cancelled', startedAt: new Date('2026-01-01T00:00:00Z') }),
    ];
    const failedIsNewest = [
      row({ pid: 'OLD-CANCELLED', status: 'cancelled', startedAt: new Date('2025-01-01T00:00:00Z') }),
      row({ pid: 'NEW-FAILED', status: 'failed', startedAt: new Date('2026-01-01T00:00:00Z') }),
    ];
    expect(bothOrders(cancelledIsNewest)).toEqual(['NEW-CANCELLED', 'NEW-CANCELLED']);
    expect(bothOrders(failedIsNewest)).toEqual(['NEW-FAILED', 'NEW-FAILED']);
  });

  it('picks the newest ACTIVE when a family somehow has two', () => {
    const rows = [
      row({ pid: 'A1', status: 'active', startedAt: new Date('2025-01-01T00:00:00Z'), activatedAt: new Date('2025-01-02T00:00:00Z') }),
      row({ pid: 'A2', status: 'active', startedAt: new Date('2026-01-01T00:00:00Z'), activatedAt: new Date('2026-01-02T00:00:00Z') }),
    ];
    expect(bothOrders(rows)).toEqual(['A2', 'A2']);
  });

  it('still returns a terminal row when that is all there is, so the card can show the neutral line', () => {
    const rows = [row({ pid: 'GONE', status: 'cancelled' })];
    expect(selectFamilyPledge(rows)?.pid).toBe('GONE');
  });

  it('ignores a row with an unrecognised status rather than ranking it first', () => {
    // Defensive: a doc written by a future version, or hand-edited in the
    // console. Ranking an unknown status above `active` would make the card
    // silently stop telling a giving family that they are giving.
    const rows = [
      { ...row({ pid: 'WEIRD' }), status: 'zombie' as FamilyPledgeView['status'] },
      row({ pid: 'LIVE', status: 'active', activatedAt: new Date('2026-01-02T00:00:00Z') }),
    ];
    expect(bothOrders(rows)).toEqual(['LIVE', 'LIVE']);
  });

  it('does not mutate the caller\'s array', () => {
    // The Firestore read passes its own mapped array; an in-place sort here
    // would reorder a list a caller may still be using.
    const rows = [
      row({ pid: 'A', startedAt: new Date('2025-01-01T00:00:00Z') }),
      row({ pid: 'B', startedAt: new Date('2026-01-01T00:00:00Z') }),
    ];
    selectFamilyPledge(rows);
    expect(rows.map((r) => r.pid)).toEqual(['A', 'B']);
  });
});
