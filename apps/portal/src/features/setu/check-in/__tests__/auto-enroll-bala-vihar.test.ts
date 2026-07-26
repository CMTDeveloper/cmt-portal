import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above module-level consts, so the mock fns must live in a
// vi.hoisted() block to be initialized before the factories reference them.
const { getOpenOfferingsForFamily, enrollFamily } = vi.hoisted(() => ({
  getOpenOfferingsForFamily: vi.fn(),
  enrollFamily: vi.fn(),
}));
// Only the QUERY is mocked - `resolveCurrentOffering` stays real so the door
// path is exercised against the actual centre-wins rule.
vi.mock('@/features/setu/enrollment/get-open-offerings', async (orig) => ({
  ...(await orig<typeof import('@/features/setu/enrollment/get-open-offerings')>()),
  getOpenOfferingsForFamily,
}));
vi.mock('@/features/setu/enrollment/enroll-family', () => ({ enrollFamily }));

import { autoEnrollBalaVihar } from '../auto-enroll-bala-vihar';

// Offerings carry a real location + startDate: resolveCurrentOffering reads both,
// and a fixture without them proves nothing about which one the door picks.
const SEP = new Date('2026-09-13T00:00:00Z');
function offering(oid: string, over: { location?: string | null; startDate?: Date } = {}) {
  return { oid, location: 'Brampton', startDate: SEP, ...over };
}

describe('autoEnrollBalaVihar', () => {
  beforeEach(() => { getOpenOfferingsForFamily.mockReset(); enrollFamily.mockReset(); });

  it('enrolls into the first open BV offering with enrolledVia=kiosk', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([
      offering('bv-2026'),
      offering('bv-later', { startDate: new Date('2027-01-10T00:00:00Z') }),
    ]);
    enrollFamily.mockResolvedValue({ created: true, eid: 'CMT-A-bv-2026', suggestedAmountSnapshot: 100 });
    const r = await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' });
    expect(getOpenOfferingsForFamily).toHaveBeenCalledWith('bala-vihar', 'Brampton');
    expect(enrollFamily).toHaveBeenCalledWith({ fid: 'CMT-A', oid: 'bv-2026', enrolledVia: 'kiosk', enrolledByMid: null });
    expect(r).toEqual({ enrolled: true, created: true, eid: 'CMT-A-bv-2026' });
  });

  it('reports a no-op when the family is already enrolled', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([offering('bv-2026')]);
    enrollFamily.mockResolvedValue({ created: false, eid: 'CMT-A-bv-2026', suggestedAmountSnapshot: 100 });
    expect(await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).toEqual({ enrolled: true, created: false, eid: 'CMT-A-bv-2026' });
  });

  it('skips (no-open-offering) when there is no BV offering', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([]);
    expect(await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).toEqual({ enrolled: false, reason: 'no-open-offering' });
    expect(enrollFamily).not.toHaveBeenCalled();
  });

  it('skips (no-eligible-members) for an adult-only family', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([offering('bv-2026')]);
    enrollFamily.mockRejectedValue(new Error('no-eligible-members'));
    expect(await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).toEqual({ enrolled: false, reason: 'no-eligible-members' });
  });

  it('rethrows unexpected enrollFamily errors', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([offering('bv-2026')]);
    enrollFamily.mockRejectedValue(new Error('offering-disabled'));
    await expect(autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).rejects.toThrow('offering-disabled');
  });

  // The door must enroll a family into THEIR centre's class, not whichever open
  // BV offering starts first. `offerings[0]` would pick the online one here.
  it('prefers the family centre over an online offering that starts earlier', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([
      offering('bv-online', { location: null, startDate: new Date('2026-09-06T00:00:00Z') }),
      offering('bv-brampton'),
    ]);
    enrollFamily.mockResolvedValue({ created: true, eid: 'CMT-A-bv-brampton', suggestedAmountSnapshot: 100 });
    await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' });
    expect(enrollFamily).toHaveBeenCalledWith(
      expect.objectContaining({ oid: 'bv-brampton' }),
    );
  });
});
