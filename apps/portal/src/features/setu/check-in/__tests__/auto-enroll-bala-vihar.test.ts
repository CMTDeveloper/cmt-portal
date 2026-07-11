import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above module-level consts, so the mock fns must live in a
// vi.hoisted() block to be initialized before the factories reference them.
const { getOpenOfferingsForFamily, enrollFamily } = vi.hoisted(() => ({
  getOpenOfferingsForFamily: vi.fn(),
  enrollFamily: vi.fn(),
}));
vi.mock('@/features/setu/enrollment/get-open-offerings', () => ({ getOpenOfferingsForFamily }));
vi.mock('@/features/setu/enrollment/enroll-family', () => ({ enrollFamily }));

import { autoEnrollBalaVihar } from '../auto-enroll-bala-vihar';

describe('autoEnrollBalaVihar', () => {
  beforeEach(() => { getOpenOfferingsForFamily.mockReset(); enrollFamily.mockReset(); });

  it('enrolls into the first open BV offering with enrolledVia=kiosk', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([{ oid: 'bv-2026' }, { oid: 'bv-old' }]);
    enrollFamily.mockResolvedValue({ created: true, eid: 'CMT-A-bv-2026', suggestedAmountSnapshot: 100 });
    const r = await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' });
    expect(getOpenOfferingsForFamily).toHaveBeenCalledWith('bala-vihar', 'Brampton');
    expect(enrollFamily).toHaveBeenCalledWith({ fid: 'CMT-A', oid: 'bv-2026', enrolledVia: 'kiosk', enrolledByMid: null });
    expect(r).toEqual({ enrolled: true, created: true, eid: 'CMT-A-bv-2026' });
  });

  it('reports a no-op when the family is already enrolled', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([{ oid: 'bv-2026' }]);
    enrollFamily.mockResolvedValue({ created: false, eid: 'CMT-A-bv-2026', suggestedAmountSnapshot: 100 });
    expect(await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).toEqual({ enrolled: true, created: false, eid: 'CMT-A-bv-2026' });
  });

  it('skips (no-open-offering) when there is no BV offering', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([]);
    expect(await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).toEqual({ enrolled: false, reason: 'no-open-offering' });
    expect(enrollFamily).not.toHaveBeenCalled();
  });

  it('skips (no-eligible-members) for an adult-only family', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([{ oid: 'bv-2026' }]);
    enrollFamily.mockRejectedValue(new Error('no-eligible-members'));
    expect(await autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).toEqual({ enrolled: false, reason: 'no-eligible-members' });
  });

  it('rethrows unexpected enrollFamily errors', async () => {
    getOpenOfferingsForFamily.mockResolvedValue([{ oid: 'bv-2026' }]);
    enrollFamily.mockRejectedValue(new Error('offering-disabled'));
    await expect(autoEnrollBalaVihar({ fid: 'CMT-A', location: 'Brampton' })).rejects.toThrow('offering-disabled');
  });
});
