import { describe, it, expect, vi, beforeEach } from 'vitest';

// The staff-side pledge view: ALL of a family's attempts, not just the one the
// family's own card speaks about.
//
// The family view (`getFamilyPledge`) deliberately collapses to a single row and
// omits every provider handle, because it is serialized into HTML a family
// receives. Staff answering a payment enquiry need the opposite: the whole
// history, including the attempts that FAILED and the provider's own words about
// why. Those are the rows Vaibhav currently opens the Stripe dashboard to see.

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: () => ({ where: () => ({ get: mockGet }) }),
  }),
}));

vi.mock('../pledge-amount', () => ({ configuredMonthlyAmountCAD: () => 108 }));

import { getPledgesForStaff } from '../get-pledges-for-staff';

function doc(id: string, raw: Record<string, unknown>) {
  return { id, data: () => raw };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPledgesForStaff', () => {
  it('returns every attempt, newest first (N=2: a live one and an older failure)', async () => {
    mockGet.mockResolvedValue({
      docs: [
        doc('p-old', {
          status: 'failed',
          monthlyAmountCAD: 50,
          startedAt: new Date('2026-01-10T00:00:00Z'),
          lastError: '/pad/monthly-subscription failed with 400: branding_settings.display_name',
        }),
        doc('p-new', {
          status: 'active',
          monthlyAmountCAD: 108,
          startedAt: new Date('2026-07-01T00:00:00Z'),
          activatedAt: new Date('2026-07-03T00:00:00Z'),
          subscriptionId: 'sub_123',
        }),
      ],
    });

    const rows = await getPledgesForStaff('CMT-FAM1');

    // The FAILED attempt must survive. The family view ranks it away; a staff
    // member on the phone about "my payment didn't work" needs exactly it.
    expect(rows.map((r) => r.pid)).toEqual(['p-new', 'p-old']);
    expect(rows[1]?.status).toBe('failed');
  });

  it("carries the provider's own error words verbatim - the closest thing to Stripe feedback we hold", async () => {
    const providerWords = '/pad/monthly-subscription failed with 400: missing display_name';
    mockGet.mockResolvedValue({
      docs: [doc('p1', { status: 'failed', monthlyAmountCAD: 50, startedAt: new Date(), lastError: providerWords })],
    });

    const rows = await getPledgesForStaff('CMT-FAM1');

    expect(rows[0]?.lastError).toBe(providerWords);
  });

  it('exposes the Stripe lookup handles that the FAMILY view structurally omits', async () => {
    mockGet.mockResolvedValue({
      docs: [
        doc('p1', {
          status: 'active',
          monthlyAmountCAD: 108,
          startedAt: new Date(),
          subscriptionId: 'sub_1',
          verifiedSubscriptionId: 'sub_2',
          customerId: 'cus_1',
        }),
      ],
    });

    const rows = await getPledgesForStaff('CMT-FAM1');

    // Deliberate, and the inverse of FamilyPledgeView. These are opaque handles,
    // never credentials and never bank data - they turn "hunt through the Stripe
    // dashboard" into a direct lookup, which is the stated workflow.
    expect(rows[0]?.subscriptionId).toBe('sub_1');
    expect(rows[0]?.verifiedSubscriptionId).toBe('sub_2');
    expect(rows[0]?.customerId).toBe('cus_1');
  });

  it('cannot leak an unexpected raw field, because every field is named', async () => {
    mockGet.mockResolvedValue({
      docs: [
        doc('p1', {
          status: 'active',
          monthlyAmountCAD: 108,
          startedAt: new Date(),
          // If a future writer ever spread a provider response into the doc,
          // a mapping built by spreading would ship this to staff HTML. This is
          // the same guarantee get-family-pledge.ts documents, kept on the staff
          // path too - a wider audience is not a licence to spread.
          bankAccountNumber: '000123456789',
          institutionNumber: '001',
        }),
      ],
    });

    const rows = await getPledgesForStaff('CMT-FAM1');

    expect(JSON.stringify(rows)).not.toContain('000123456789');
    expect(JSON.stringify(rows)).not.toContain('institutionNumber');
  });

  it('keeps a missing date null rather than turning it into 1970', async () => {
    mockGet.mockResolvedValue({
      docs: [doc('p1', { status: 'started', monthlyAmountCAD: 108, startedAt: new Date('2026-05-01T00:00:00Z') })],
    });

    const rows = await getPledgesForStaff('CMT-FAM1');

    expect(rows[0]?.activatedAt).toBeNull();
    expect(rows[0]?.cancelledAt).toBeNull();
    expect(rows[0]?.lastCheckedAt).toBeNull();
  });

  it('returns an empty list for a family that never started one', async () => {
    mockGet.mockResolvedValue({ docs: [] });
    expect(await getPledgesForStaff('CMT-FAM1')).toEqual([]);
  });
});
