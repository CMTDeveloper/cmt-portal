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
    // `sessionDate` is what the teacher visitors query filters on. Asserting it
    // against sessionDateFor(written.date) rather than a literal keeps the test
    // clock-independent while still pinning the relationship - and this file
    // had NO coverage of the write half before, so a missing sessionDate would
    // have shipped green.
    expect(written.sessionDate).toBe(sessionDateFor(written.date));
    expect(new Date(`${written.sessionDate}T12:00:00Z`).getUTCDay()).toBe(0); // a Sunday
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
