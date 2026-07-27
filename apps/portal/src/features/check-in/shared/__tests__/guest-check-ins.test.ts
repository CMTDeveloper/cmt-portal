import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeCollection = { add: vi.fn() };
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

import { sessionDateFor } from '@cmt/shared-domain';
import { recordGuestCheckIn } from '../firestore/guest-check-ins';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCollection.add.mockResolvedValue({ id: 'g-1' });
});

describe('recordGuestCheckIn', () => {
  it('writes to guest_check_ins with children, a derived count, a date, and a timestamp', async () => {
    const id = await recordGuestCheckIn({
      firstName: 'Carol',
      lastName: 'Visitor',
      email: 'c@v.com',
      phone: '+16475550100',
      numberOfAdults: 2,
      children: [
        { name: 'Aarav Visitor', grade: '2' },
        { name: 'Diya Visitor', grade: 'JK' },
      ],
    });
    expect(id).toBe('g-1');
    const written = (fakeCollection.add as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(written.firstName).toBe('Carol');
    expect(written.email).toBe('c@v.com');
    expect(written.phone).toBe('+16475550100');
    expect(written.numberOfAdults).toBe(2);
    // Per-child data is stored, and numberOfChildren is derived from it so the
    // admin guest list / stats keep working.
    expect(written.children).toEqual([
      { name: 'Aarav Visitor', grade: '2' },
      { name: 'Diya Visitor', grade: 'JK' },
    ]);
    expect(written.numberOfChildren).toBe(2);
    // `date` is the actual Toronto walk-in day; checkedInAt is a full ISO
    // instant.
    expect(written.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(written.checkedInAt).toMatch(/T/);
    // `sessionDate` is what the teacher visitors query filters on.
    //
    // ⚠️ THIS PAIR OF ASSERTIONS IS BLIND ON A SUNDAY, and the comment that used
    // to sit here claimed the opposite ("keeps the test clock-independent").
    // `sessionDateFor` is a no-op on a Sunday input, so when the real clock says
    // Sunday, `sessionDateFor(written.date) === written.date` and a regression
    // that skipped the helper entirely - `sessionDate: ymd` - satisfies BOTH
    // lines: the values match, and the value is trivially "a Sunday" because
    // `date` already was. That is the entire original bug class, passing green.
    //
    // They are kept because they are real checks on the other six days, but the
    // day-independent coverage is the frozen-clock pair below. Do not add
    // assertions of this shape without one.
    expect(written.sessionDate).toBe(sessionDateFor(written.date));
    expect(new Date(`${written.sessionDate}T12:00:00Z`).getUTCDay()).toBe(0); // a Sunday
  });

  // ── The writer's date key, pinned independently of the real clock ───────────
  // `recordGuestCheckIn` reads `new Date()` directly with no injection point, so
  // this is the ONLY layer that can prove the call site rolls back to Sunday: an
  // E2E cannot choose the day it runs on, and on a Sunday every assertion about
  // the produced document is satisfied by a naive copy. Fake timers remove the
  // run day from the question entirely.
  it.each([
    // Toronto local day → the Sunday that week. The instants are 16:00Z so they
    // are the same calendar day in Toronto (UTC-4/-5) as in UTC.
    ['Wednesday', '2026-09-09T16:00:00Z', '2026-09-09', '2026-09-06'],
    ['Saturday', '2026-09-12T16:00:00Z', '2026-09-12', '2026-09-06'],
    ['Monday', '2026-09-07T16:00:00Z', '2026-09-07', '2026-09-06'],
  ])('a %s walk-in is stamped with that week\'s Sunday, not the walk-in day', async (_day, instant, expectedDate, expectedSunday) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    try {
      await recordGuestCheckIn({
        firstName: 'Mid', lastName: 'Week', email: 'm@w.com', phone: '+16475550122',
        numberOfAdults: 1, children: [{ name: 'Kid Week', grade: '1' }],
      });
    } finally {
      vi.useRealTimers();
    }
    const w = (fakeCollection.add as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    // `date` is the real walk-in day and must NOT be rewritten - it is the only
    // record of when the guest actually came.
    expect(w.date).toBe(expectedDate);
    // `sessionDate` is the Sunday every teacher surface defaults to. These two
    // differ on every day of the fixture, so a `sessionDate: ymd` regression
    // fails here whatever day the suite runs.
    expect(w.sessionDate).toBe(expectedSunday);
    expect(w.sessionDate).not.toBe(w.date);
  });

  it('leaves a Sunday walk-in on its own date (the no-op case, stated explicitly)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T16:00:00Z')); // a Sunday
    try {
      await recordGuestCheckIn({
        firstName: 'Sun', lastName: 'Day', email: 's@d.com', phone: '+16475550133',
        numberOfAdults: 1, children: [{ name: 'Kid Day', grade: '1' }],
      });
    } finally {
      vi.useRealTimers();
    }
    const w = (fakeCollection.add as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    // Both equal, and that is correct - this is the case that makes every OTHER
    // assertion in this file blind when the suite happens to run on a Sunday.
    expect(w.date).toBe('2026-09-06');
    expect(w.sessionDate).toBe('2026-09-06');
  });

  it('derives numberOfChildren = 0 for an adults-only visit', async () => {
    await recordGuestCheckIn({
      firstName: 'Sam',
      lastName: 'Solo',
      email: 's@solo.com',
      phone: '+16475550111',
      numberOfAdults: 1,
      children: [],
    });
    const written = (fakeCollection.add as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(written.children).toEqual([]);
    expect(written.numberOfChildren).toBe(0);
  });
});
