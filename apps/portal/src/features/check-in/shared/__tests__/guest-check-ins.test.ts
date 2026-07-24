import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeCollection = { add: vi.fn() };
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

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
    // `date` (Toronto YMD) drives the teacher visitors match; checkedInAt is a
    // full ISO instant.
    expect(written.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(written.checkedInAt).toMatch(/T/);
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
