import { describe, it, expect, vi, beforeEach } from 'vitest';

// The stored document `updateGuestChild` will read inside its transaction, and
// the update payload it writes. `stored: null` models a deleted/absent doc.
const store: { stored: Record<string, unknown> | null; written: Record<string, unknown> | null } = {
  stored: null,
  written: null,
};
const txnUpdate = vi.fn((_ref: unknown, data: Record<string, unknown>) => {
  store.written = data;
});
const fakeCollection = {
  add: vi.fn(),
  doc: vi.fn((id: string) => ({ id })),
};
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn(() => fakeCollection),
    runTransaction: async (fn: (txn: unknown) => unknown) =>
      fn({
        get: async () => ({
          exists: store.stored !== null,
          data: () => store.stored,
        }),
        update: txnUpdate,
      }),
  })),
}));

import { sessionDateFor } from '@cmt/shared-domain';
import { recordGuestCheckIn, updateGuestChild } from '../firestore/guest-check-ins';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCollection.add.mockResolvedValue({ id: 'g-1' });
  store.stored = null;
  store.written = null;
});

/** A two-child visit. N=2 deliberately: a positional address only misbehaves
 *  when there is more than one thing it could point at. */
function twoChildVisit() {
  return {
    firstName: 'Carol', lastName: 'Visitor', email: 'c@v.com', phone: '+16475550100',
    numberOfAdults: 2, numberOfChildren: 2,
    children: [
      { name: 'Aarav Visitor', grade: '2' },
      { name: 'Diya Visitor', grade: 'JK' },
    ],
    date: '2026-09-09', sessionDate: '2026-09-06', checkedInAt: '2026-09-09T16:00:00.000Z',
  };
}

const CONTACT = { firstName: 'Carol', lastName: 'Visitor', email: 'c@v.com', phone: '+16475550100' };

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

describe('updateGuestChild', () => {
  it('corrects ONLY the addressed child and leaves the sibling untouched', async () => {
    store.stored = twoChildVisit();
    const res = await updateGuestChild({
      docId: 'g-carol', childIndex: 1,
      expected: { name: 'Diya Visitor', grade: 'JK' },
      child: { name: 'Diya Visitor', grade: 'SK' },
      contact: CONTACT, editedByUid: 'u-desk',
    });
    expect(res).toEqual({ ok: true });
    // The point of the whole feature: index 1 moved, index 0 did NOT. A writer
    // that rebuilt the array, or addressed by a shared key (docId, email, parent
    // name), would corrupt the sibling here and nowhere else.
    expect(store.written?.['children']).toEqual([
      { name: 'Aarav Visitor', grade: '2' },
      { name: 'Diya Visitor', grade: 'SK' },
    ]);
  });

  it('refuses when the stored child no longer matches what the desk was shown', async () => {
    store.stored = twoChildVisit();
    const res = await updateGuestChild({
      docId: 'g-carol', childIndex: 1,
      // Someone else already corrected this child to SK; the desk still holds JK.
      expected: { name: 'Diya Visitor', grade: 'Grade 1' },
      child: { name: 'Diya Visitor', grade: 'SK' },
      contact: CONTACT, editedByUid: 'u-desk',
    });
    expect(res).toEqual({ ok: false, reason: 'changed' });
    // Refused means NOTHING was written - not "wrote and reported failure".
    expect(txnUpdate).not.toHaveBeenCalled();
  });

  it('treats a blank stored grade as a legitimate expected value', async () => {
    // The row this feature exists for. If the compare-and-swap could not express
    // "grade was blank", every child in the "Not matched to a class" bucket -
    // the ones actually invisible to teachers - would be permanently un-editable.
    store.stored = {
      ...twoChildVisit(),
      children: [{ name: 'No Grade Kid', grade: '' }],
      numberOfChildren: 1,
    };
    const res = await updateGuestChild({
      docId: 'g-carol', childIndex: 0,
      expected: { name: 'No Grade Kid', grade: '' },
      child: { name: 'No Grade Kid', grade: '3' },
      contact: CONTACT, editedByUid: 'u-desk',
    });
    expect(res).toEqual({ ok: true });
    expect(store.written?.['children']).toEqual([{ name: 'No Grade Kid', grade: '3' }]);
  });

  it('compares under the same normalization the board rendered with', async () => {
    // The board shows `String(grade).trim()`, so a stored numeric 2 is displayed
    // - and sent back - as "2". Comparing raw would fail every such correction as
    // a phantom conflict, and the guest would be stuck uncorrectable.
    store.stored = { ...twoChildVisit(), children: [{ name: '  Padded Kid ', grade: 2 }], numberOfChildren: 1 };
    const res = await updateGuestChild({
      docId: 'g-carol', childIndex: 0,
      expected: { name: 'Padded Kid', grade: '2' },
      child: { name: 'Padded Kid', grade: '3' },
      contact: CONTACT, editedByUid: 'u-desk',
    });
    expect(res).toEqual({ ok: true });
  });

  it('preserves unknown fields on the corrected child', async () => {
    // A child object may carry keys this route knows nothing about. Replacing
    // the element instead of spreading it would silently drop them.
    store.stored = {
      ...twoChildVisit(),
      children: [{ name: 'Aarav Visitor', grade: '2', someFutureField: 'keep-me' }],
      numberOfChildren: 1,
    };
    await updateGuestChild({
      docId: 'g-carol', childIndex: 0,
      expected: { name: 'Aarav Visitor', grade: '2' },
      child: { name: 'Aarav Visitor', grade: '3' },
      contact: CONTACT, editedByUid: 'u-desk',
    });
    expect(store.written?.['children']).toEqual([
      { name: 'Aarav Visitor', grade: '3', someFutureField: 'keep-me' },
    ]);
  });

  it('never rewrites date, sessionDate or checkedInAt', async () => {
    store.stored = twoChildVisit();
    await updateGuestChild({
      docId: 'g-carol', childIndex: 0,
      expected: { name: 'Aarav Visitor', grade: '2' },
      child: { name: 'Aarav Visitor', grade: '3' },
      contact: CONTACT, editedByUid: 'u-desk',
    });
    // These three decide WHICH Sunday - and therefore which teacher - the guest
    // belongs to, and when they actually walked in. A correction screen that
    // re-filed the visit would move it off the board the corrector is looking at.
    expect(store.written).not.toHaveProperty('date');
    expect(store.written).not.toHaveProperty('sessionDate');
    expect(store.written).not.toHaveProperty('checkedInAt');
  });

  it('re-derives numberOfChildren and stamps who edited it', async () => {
    store.stored = twoChildVisit();
    await updateGuestChild({
      docId: 'g-carol', childIndex: 0,
      expected: { name: 'Aarav Visitor', grade: '2' },
      child: { name: 'Aarav Visitor', grade: '3' },
      contact: CONTACT, editedByUid: 'u-desk',
    });
    expect(store.written?.['numberOfChildren']).toBe(2);
    expect(store.written?.['lastEditedByUid']).toBe('u-desk');
    expect(String(store.written?.['lastEditedAt'])).toMatch(/T/);
  });

  it('writes the visit contact, which is shared by every child on it', async () => {
    store.stored = twoChildVisit();
    await updateGuestChild({
      docId: 'g-carol', childIndex: 1,
      expected: { name: 'Diya Visitor', grade: 'JK' },
      child: { name: 'Diya Visitor', grade: 'SK' },
      contact: { firstName: 'Carol', lastName: 'Newname', email: 'new@v.com', phone: '+16475559999' },
      editedByUid: 'u-desk',
    });
    expect(store.written?.['lastName']).toBe('Newname');
    expect(store.written?.['email']).toBe('new@v.com');
    expect(store.written?.['phone']).toBe('+16475559999');
  });

  it('reports not-found for a visit that no longer exists', async () => {
    store.stored = null;
    const res = await updateGuestChild({
      docId: 'gone', childIndex: 0,
      expected: { name: 'A', grade: '1' }, child: { name: 'A', grade: '2' },
      contact: CONTACT, editedByUid: 'u-desk',
    });
    expect(res).toEqual({ ok: false, reason: 'not-found' });
    expect(txnUpdate).not.toHaveBeenCalled();
  });

  it('reports no-children for a pre-b1395e0 doc with a bare count and no array', async () => {
    // The shape of the live UAT doc `pdsBr0M0QutelNwyX2vn`. There is no child row
    // to address, so a positional edit is meaningless - and `kids.length` on a
    // non-array would otherwise throw inside the transaction.
    store.stored = {
      firstName: 'Visitor', lastName: '1', numberOfAdults: 1, numberOfChildren: 1,
      checkedInAt: '2026-07-23T23:58:59.076Z',
    };
    const res = await updateGuestChild({
      docId: 'pdsBr0M0QutelNwyX2vn', childIndex: 0,
      expected: { name: '', grade: '' }, child: { name: 'Someone', grade: '2' },
      contact: CONTACT, editedByUid: 'u-desk',
    });
    expect(res).toEqual({ ok: false, reason: 'no-children' });
    expect(txnUpdate).not.toHaveBeenCalled();
  });

  it('reports index-out-of-range rather than appending a new child', async () => {
    store.stored = twoChildVisit();
    const res = await updateGuestChild({
      docId: 'g-carol', childIndex: 7,
      expected: { name: 'Ghost', grade: '1' }, child: { name: 'Ghost', grade: '2' },
      contact: CONTACT, editedByUid: 'u-desk',
    });
    expect(res).toEqual({ ok: false, reason: 'index-out-of-range' });
    expect(txnUpdate).not.toHaveBeenCalled();
  });
});
