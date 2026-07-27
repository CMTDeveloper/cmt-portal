import { describe, it, expect, vi, beforeEach } from 'vitest';

const flagsMock = vi.hoisted(() => ({ setuPledge: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

const mockGetFamilyPledge = vi.hoisted(() => vi.fn());
vi.mock('../get-family-pledge', () => ({ getFamilyPledge: mockGetFamilyPledge }));

import { loadPledgeSlot } from '../load-pledge-slot';

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuPledge = true;
  process.env.PLEDGE_MONTHLY_AMOUNT_CAD = '63';
  mockGetFamilyPledge.mockResolvedValue(null);
});

describe('loadPledgeSlot', () => {
  it('returns the pledge, today\'s ask amount, and who may start one', async () => {
    const live = { pid: 'PLG-1', status: 'active' as const, monthlyAmountCAD: 51, startedAt: new Date(), activatedAt: new Date() };
    mockGetFamilyPledge.mockResolvedValue(live);
    expect(await loadPledgeSlot({ fid: 'CMT-1', isManager: true })).toEqual({
      pledge: live,
      askAmountCAD: 63,
      canStart: true,
    });
  });

  it('reads the ask amount from env at CALL time, not module load', async () => {
    // A captured value would survive a redeploy that changed the amount, and the
    // portal would quote a price Stripe no longer charges.
    process.env.PLEDGE_MONTHLY_AMOUNT_CAD = '75';
    expect((await loadPledgeSlot({ fid: 'CMT-1', isManager: true }))?.askAmountCAD).toBe(75);
  });

  it('withholds the start button from a non-manager', async () => {
    expect((await loadPledgeSlot({ fid: 'CMT-1', isManager: false }))?.canStart).toBe(false);
  });

  it('returns null with the flag off, and reads NOTHING', async () => {
    // Dark means dark. Returning an empty slot instead would still render an ask
    // for a feature whose payment path is in Stripe TEST mode.
    flagsMock.setuPledge = false;
    expect(await loadPledgeSlot({ fid: 'CMT-1', isManager: true })).toBeNull();
    expect(mockGetFamilyPledge).not.toHaveBeenCalled();
  });

  it('fails soft: a Firestore error costs the card, not the page', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetFamilyPledge.mockRejectedValue(new Error('FAILED_PRECONDITION: index'));
    // Both callers are pages a family came to for something else entirely - a
    // receipt, their dashboard. Neither may 500 over an optional ask.
    await expect(loadPledgeSlot({ fid: 'CMT-1', isManager: true })).resolves.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
