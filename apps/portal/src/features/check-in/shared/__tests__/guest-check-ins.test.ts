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
  it('writes to guest_check_ins with provided fields and timestamp', async () => {
    const id = await recordGuestCheckIn({
      firstName: 'Carol',
      lastName: 'Visitor',
      email: 'c@v.com',
      phone: '+16475550100',
      numberOfAdults: 2,
      numberOfChildren: 1,
    });
    expect(id).toBe('g-1');
    const written = (fakeCollection.add as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(written.firstName).toBe('Carol');
    expect(written.numberOfAdults).toBe(2);
    expect(written.checkedInAt).toMatch(/T/);
  });
});
