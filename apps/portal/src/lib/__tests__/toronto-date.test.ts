import { describe, it, expect } from 'vitest';
import {
  toTorontoStartOfDay,
  toTorontoEndOfDay,
  toTorontoStartOfDayISO,
  toTorontoEndOfDayISO,
} from '../toronto-date';

// EDT = UTC-4, EST = UTC-5
// 2025-09-07 is during EDT; 2026-01-26 is during EST.

describe('toTorontoStartOfDay', () => {
  it('returns UTC-4 midnight for an EDT date (2025-09-07)', () => {
    const d = toTorontoStartOfDay('2025-09-07');
    // Toronto midnight EDT = 04:00 UTC
    expect(d.toISOString()).toBe('2025-09-07T04:00:00.000Z');
  });

  it('returns UTC-5 midnight for an EST date (2026-01-26)', () => {
    const d = toTorontoStartOfDay('2026-01-26');
    // Toronto midnight EST = 05:00 UTC
    expect(d.toISOString()).toBe('2026-01-26T05:00:00.000Z');
  });

  it('returns UTC-5 midnight for an EST date (2026-02-01)', () => {
    const d = toTorontoStartOfDay('2026-02-01');
    expect(d.toISOString()).toBe('2026-02-01T05:00:00.000Z');
  });

  it('returns UTC-4 midnight for a summer date (2026-06-28)', () => {
    const d = toTorontoStartOfDay('2026-06-28');
    expect(d.toISOString()).toBe('2026-06-28T04:00:00.000Z');
  });
});

describe('toTorontoEndOfDay', () => {
  it('returns 23:59:59 Toronto EDT time as UTC for 2026-01-26', () => {
    const d = toTorontoEndOfDay('2026-01-26');
    // Toronto 23:59:59 EST = next day 04:59:59 UTC
    expect(d.toISOString()).toBe('2026-01-27T04:59:59.000Z');
  });

  it('returns 23:59:59 Toronto EDT time as UTC for 2026-06-28', () => {
    const d = toTorontoEndOfDay('2026-06-28');
    // Toronto 23:59:59 EDT = next day 03:59:59 UTC
    expect(d.toISOString()).toBe('2026-06-29T03:59:59.000Z');
  });

  it('end-of-day is strictly after start-of-day for the same date', () => {
    for (const date of ['2025-09-07', '2026-01-26', '2026-03-08', '2026-11-01']) {
      const start = toTorontoStartOfDay(date);
      const end = toTorontoEndOfDay(date);
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    }
  });
});

describe('ISO helpers', () => {
  it('toTorontoStartOfDayISO returns string form of start-of-day', () => {
    expect(toTorontoStartOfDayISO('2025-09-07')).toBe('2025-09-07T04:00:00.000Z');
  });

  it('toTorontoEndOfDayISO returns string form of end-of-day', () => {
    expect(toTorontoEndOfDayISO('2026-01-26')).toBe('2026-01-27T04:59:59.000Z');
  });
});
