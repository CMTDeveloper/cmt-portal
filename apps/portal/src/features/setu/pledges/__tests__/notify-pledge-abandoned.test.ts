import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockResolveUnpaid, mockNotifyPending, mockGetFamily } = vi.hoisted(() => ({
  mockResolveUnpaid: vi.fn(),
  mockNotifyPending: vi.fn(),
  mockGetFamily: vi.fn(),
}));
vi.mock('@/features/setu/donations/bv-unpaid', () => ({ resolveBvUnpaid: mockResolveUnpaid }));
vi.mock('@/features/setu/donations/notify-donation-pending', () => ({
  notifyDonationPending: mockNotifyPending,
}));
vi.mock('@/features/setu/members/get-family-by-fid', () => ({ getFamilyByFid: mockGetFamily }));

import { notifyPledgeAbandoned } from '../notify-pledge-abandoned';

const FAMILY = {
  family: { fid: 'CMT-A', legacyFid: '1075', managers: ['CMT-A-01'] },
  members: [
    { mid: 'CMT-A-01', email: 'manager@example.org', firstName: 'Asha', lastName: 'R' },
    { mid: 'CMT-A-02', email: null, firstName: 'Child', lastName: 'R' },
  ],
};

beforeEach(() => {
  mockGetFamily.mockReset();
  mockGetFamily.mockResolvedValue(FAMILY);
  mockResolveUnpaid.mockReset();
  mockResolveUnpaid.mockResolvedValue({ eid: 'CMT-A-bv-2026-27', unpaid: true });
  mockNotifyPending.mockReset();
  mockNotifyPending.mockResolvedValue(undefined);
});

/**
 * Vaibhav, 2026-07-30: *"i did not get donation pending email for
 * family15@gmail.com when I tried PAD option, and cancelled"*.
 *
 * Nothing misfired - there was no trigger at all on the pledge path. These pin
 * that it now exists, and that it inherits the same two refusals the one-time
 * path learned from a Codex review the day before.
 */
describe('notifyPledgeAbandoned', () => {
  it('sends the pending letter for a family that still owes Bala Vihar', async () => {
    await notifyPledgeAbandoned({ fid: 'CMT-A' });
    expect(mockNotifyPending).toHaveBeenCalledWith(
      expect.objectContaining({
        fid: 'CMT-A',
        eid: 'CMT-A-bv-2026-27',
        managerMids: ['CMT-A-01'],
        members: FAMILY.members,
      }),
    );
  });

  // The legacy roster read is expensive and gated on this value, so passing the
  // wrong one (or none) silently changes what "paid" means for legacy families.
  it('asks about payment using the family legacyFid', async () => {
    await notifyPledgeAbandoned({ fid: 'CMT-A' });
    expect(mockResolveUnpaid).toHaveBeenCalledWith('CMT-A', '1075');
  });

  // 🔴 The refusal that matters most: a family already paying MONTHLY who
  // abandons a second attempt must never be told their enrollment is unconfirmed
  // while their bank is being debited. resolveBvUnpaid counts a live pledge as
  // paid, so honouring it is the whole guard.
  it('says NOTHING when Bala Vihar is already settled', async () => {
    mockResolveUnpaid.mockResolvedValue({ eid: 'CMT-A-bv-2026-27', unpaid: false });
    await notifyPledgeAbandoned({ fid: 'CMT-A' });
    expect(mockNotifyPending).not.toHaveBeenCalled();
  });

  it('says nothing when there is no Bala Vihar enrollment to be pending about', async () => {
    mockResolveUnpaid.mockResolvedValue({ eid: null, unpaid: true });
    await notifyPledgeAbandoned({ fid: 'CMT-A' });
    expect(mockNotifyPending).not.toHaveBeenCalled();
  });

  it('says nothing when the family cannot be read', async () => {
    mockGetFamily.mockResolvedValue(null);
    await notifyPledgeAbandoned({ fid: 'CMT-A' });
    expect(mockNotifyPending).not.toHaveBeenCalled();
  });

  // Callers are server components rendering a whole page.
  it('never throws, whatever fails', async () => {
    mockGetFamily.mockRejectedValue(new Error('UNAVAILABLE'));
    await expect(notifyPledgeAbandoned({ fid: 'CMT-A' })).resolves.toBeUndefined();

    mockGetFamily.mockResolvedValue(FAMILY);
    mockNotifyPending.mockRejectedValue(new Error('SES down'));
    await expect(notifyPledgeAbandoned({ fid: 'CMT-A' })).resolves.toBeUndefined();
  });
});
