import { describe, it, expect } from 'vitest';
import { sessionDateFor } from '../session-date';

describe('sessionDateFor', () => {
  it('maps a Sunday to itself', () => {
    expect(sessionDateFor('2026-09-06')).toBe('2026-09-06');
  });

  it('maps a midweek day back to the preceding Sunday', () => {
    expect(sessionDateFor('2026-09-09')).toBe('2026-09-06');
  });

  it('maps a Saturday back to the preceding Sunday', () => {
    expect(sessionDateFor('2026-09-12')).toBe('2026-09-06');
  });

  it('does not drift a week on a plain date string', () => {
    // The trap this function exists to make unrepeatable. new Date('2026-09-06')
    // is UTC midnight, which is 8pm Sat the 5th in Toronto, so any Toronto-day
    // formatting of it yields '2026-09-05' and the Sunday lands a full week
    // early. Three call sites depend on this agreeing exactly: the guest
    // writer, the visitors reader's caller, and the backfill.
    expect(sessionDateFor('2026-09-06')).not.toBe('2026-08-30');
  });

  it('crosses a month boundary', () => {
    expect(sessionDateFor('2026-10-01')).toBe('2026-09-27');
  });

  it('crosses a year boundary', () => {
    expect(sessionDateFor('2027-01-01')).toBe('2026-12-27');
  });

  it('is idempotent', () => {
    const once = sessionDateFor('2026-09-09');
    expect(sessionDateFor(once)).toBe(once);
  });
});
