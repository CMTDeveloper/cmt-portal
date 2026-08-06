import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getEnrollments, getDonations, getPledgesForStaff } = vi.hoisted(() => ({
  getEnrollments: vi.fn(),
  getDonations: vi.fn(),
  getPledgesForStaff: vi.fn(),
}));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({ getEnrollments }));
// Mocked at the READ boundary, not at `sumCompletedDonations`. The loader now
// reads donations ONCE and both sums them and hands the rows to the screen, so
// stubbing the sum would leave the rows - the half staff actually read - never
// exercised. These stubs also run the real `completed` filter, which the old
// number-stub silently skipped.
vi.mock('@/features/setu/donations/get-donations', () => ({ getDonations }));
vi.mock('@/features/setu/pledges/get-pledges-for-staff', () => ({ getPledgesForStaff }));
// The pledge read is flag-gated, matching `loadActivePledgeFids`. Default ON so
// the pledge cases below exercise the real path.
const flagsMock = vi.hoisted(() => ({ setuPledge: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

import { deriveFamilyPayment, loadFamilyPaymentData } from '../payment';

const ENROLLED = new Date('2026-09-15T12:00:00Z');

/** A completed donation of `amountCAD`. The loader sums only `completed` rows. */
function donated(amountCAD: number) {
  return [{ status: 'completed', amountCAD, createdAt: ENROLLED }];
}

/** One pledge row in `status`, shaped as StaffPledgeView. */
function pledgeRow(status: string, over: Record<string, unknown> = {}) {
  return {
    pid: 'p1',
    status,
    monthlyAmountCAD: 108,
    startedAt: ENROLLED,
    activatedAt: null,
    cancelledAt: null,
    lastCheckedAt: null,
    lastError: null,
    needsStripeVerification: false,
    subscriptionId: null,
    verifiedSubscriptionId: null,
    customerId: null,
    ...over,
  };
}

/**
 * A realistic joined enrollment. The fixtures here previously set only
 * `effectiveSuggestedAmount`, which no longer feeds the verdict — the classifier
 * reads the raw pieces so it can tell "this is free" apart from "we never found
 * a price", and a fixture missing them looks exactly like the latter.
 */
function enrollment(over: {
  status?: string;
  amountCAD?: number | null;
  override?: number | null;
  snapshot?: number;
  paymentSource?: string;
  offeringMissing?: boolean;
} = {}) {
  const amountCAD = over.amountCAD === undefined ? 100 : over.amountCAD;
  return {
    status: over.status ?? 'active',
    suggestedAmountOverride: over.override ?? null,
    suggestedAmountSnapshot: over.snapshot ?? 0,
    enrolledAt: ENROLLED,
    offering: over.offeringMissing
      ? null
      : {
          pricingTiers: amountCAD === null ? [] : [{ effectiveFrom: '2026-09-01', amountCAD, label: 'Full year' }],
          ...(over.paymentSource ? { paymentSource: over.paymentSource } : {}),
        },
  };
}

beforeEach(() => {
  getEnrollments.mockReset();
  getDonations.mockReset();
  getPledgesForStaff.mockReset();
  // No pledge is the default: most families pay in one go.
  getPledgesForStaff.mockResolvedValue([]);
});

describe('deriveFamilyPayment', () => {
  it("returns 'unknown' when there are no active enrollments", async () => {
    getEnrollments.mockResolvedValue([enrollment({ status: 'cancelled' })]);
    getDonations.mockResolvedValue(donated(0));
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });

  it("sums ALL active enrollments (N=2) — outstanding when donations < total expected", async () => {
    getEnrollments.mockResolvedValue([enrollment(), enrollment({ amountCAD: 150 })]);
    getDonations.mockResolvedValue(donated(100)); // < 250
    expect(await deriveFamilyPayment('CMT-X')).toBe('outstanding');
  });

  it("returns 'paid' when completed donations cover the active total", async () => {
    getEnrollments.mockResolvedValue([enrollment(), enrollment({ amountCAD: 150 })]);
    getDonations.mockResolvedValue(donated(250));
    expect(await deriveFamilyPayment('CMT-X')).toBe('paid');
  });

  it("returns 'not-applicable' when every active enrollment is free or waived", async () => {
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: null }), enrollment({ override: 0 })]);
    getDonations.mockResolvedValue(donated(0));
    expect(await deriveFamilyPayment('CMT-X')).toBe('not-applicable');
  });

  // The whole reason the raw pieces are threaded through: a deleted offering doc
  // with a snapshot of 0 must not be reported as owing nothing.
  it("returns 'unknown' when an enrollment cannot be priced at all", async () => {
    getEnrollments.mockResolvedValue([enrollment({ offeringMissing: true, snapshot: 0 })]);
    getDonations.mockResolvedValue(donated(0));
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });

  it("returns 'unknown' (never throws) when a dependency rejects", async () => {
    getEnrollments.mockRejectedValue(new Error('firestore down'));
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });
});

describe('deriveFamilyPayment — a live monthly pledge is paid', () => {
  // A live plan writes NO completed donation docs: there is no Stripe webhook
  // (#54/#64), so the donations sum is 0 for a family paying every month.
  // Judged on donations alone they read 'outstanding' forever. Every other
  // paid-verdict surface already ORs the pledge in (report-dataset.ts:197 and
  // four more); this one did not until review caught it, which would have told
  // the family-detail screen that every pledge family was unpaid while the
  // roster called them Paid - the very disagreement this work set out to end.
  it("is 'paid' on an active pledge even with zero completed donations", async () => {
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: 400 })]);
    getDonations.mockResolvedValue(donated(0));
    getPledgesForStaff.mockResolvedValue([pledgeRow('active')]);
    expect(await deriveFamilyPayment('CMT-X')).toBe('paid');
  });

  it("does NOT count a 'started' pledge - nothing came back from Stripe", async () => {
    // `started` means the family was sent to Stripe and no mandate returned:
    // no arrangement, no money. Counting it would call a family paid because
    // they once clicked a button.
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: 400 })]);
    getDonations.mockResolvedValue(donated(0));
    getPledgesForStaff.mockResolvedValue([pledgeRow('started')]);
    expect(await deriveFamilyPayment('CMT-X')).toBe('outstanding');
  });

  it("does NOT count a cancelled pledge", async () => {
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: 400 })]);
    getDonations.mockResolvedValue(donated(0));
    getPledgesForStaff.mockResolvedValue([pledgeRow('cancelled')]);
    expect(await deriveFamilyPayment('CMT-X')).toBe('outstanding');
  });

  it('survives a failed pledge read rather than reporting unknown for everyone', async () => {
    // The pledge lookup is the newest of the three reads; a failure in it must
    // not erase a verdict the other two can still answer.
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: 400 })]);
    getDonations.mockResolvedValue(donated(400));
    getPledgesForStaff.mockRejectedValue(new Error('firestore unavailable'));
    expect(await deriveFamilyPayment('CMT-X')).toBe('paid');
  });
});

describe('deriveFamilyPayment — the pledge kill switch', () => {
  it('ignores pledges entirely when the feature is dark', async () => {
    // `loadActivePledgeFids` returns an empty set with the flag off ("dark means
    // dark"), so every roster and report stops counting pledges. If this
    // predicate kept counting them, the kill switch would make the surfaces
    // disagree at exactly the moment someone reached for it - and this one alone
    // would go on refusing off-portal settlements citing money the rest of the
    // app no longer believes in.
    flagsMock.setuPledge = false;
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: 400 })]);
    getDonations.mockResolvedValue(donated(0));
    getPledgesForStaff.mockResolvedValue([pledgeRow('active')]);
    expect(await deriveFamilyPayment('CMT-X')).toBe('outstanding');
    expect(getPledgesForStaff).not.toHaveBeenCalled();
    flagsMock.setuPledge = true;
  });
});

// ── loadFamilyPaymentData - the verdict WITH its evidence ────────────────────
//
// The screen this feeds exists because a bare verdict sends the welcome desk to
// the Stripe dashboard. These pin the evidence, and - more importantly - the
// three failure directions, which are NOT the same and must not be "tidied" into
// one try/catch.
describe('loadFamilyPaymentData', () => {
  it('returns the arithmetic, not just the word', async () => {
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: 300 }), enrollment({ amountCAD: 200 })]);
    getDonations.mockResolvedValue(donated(500));
    getPledgesForStaff.mockResolvedValue([]);

    const d = await loadFamilyPaymentData('CMT-X');

    expect(d.verdict).toBe('paid');
    expect(d.expectedCAD).toBe(500);
    expect(d.paidCAD).toBe(500);
    expect(d.unknownReason).toBeNull();
  });

  it('names WHY it is unknown, which is the whole point of the screen', async () => {
    // An unpriceable enrollment. Before this, the desk saw "Unknown" and had
    // nowhere to go but Stripe - where the answer is not, because the problem is
    // a missing offering price in our own data.
    getEnrollments.mockResolvedValue([enrollment({ offeringMissing: true, snapshot: 0 })]);
    getDonations.mockResolvedValue([]);
    getPledgesForStaff.mockResolvedValue([]);

    const d = await loadFamilyPaymentData('CMT-X');

    expect(d.verdict).toBe('unknown');
    expect(d.unknownReason).toBe('unpriceable-enrollment');
  });

  it('hands back the donation ROWS, not only their sum (one read serves both)', async () => {
    getEnrollments.mockResolvedValue([enrollment()]);
    getDonations.mockResolvedValue(donated(100));
    getPledgesForStaff.mockResolvedValue([]);

    const d = await loadFamilyPaymentData('CMT-X');

    expect(d.donations).toHaveLength(1);
    // The read happened exactly once - the point of the consolidation. Two calls
    // here means someone reintroduced the separate sum query.
    expect(getDonations).toHaveBeenCalledTimes(1);
    expect(getEnrollments).toHaveBeenCalledTimes(1);
  });

  it('THROWS when enrollments fail, so the caller can fail CLOSED', async () => {
    // Deliberately not softened to an empty list: the page's off-portal control
    // reads this, and an empty list would make every waived enrollment look like
    // an unexplained zero and re-offer "Mark paid off-portal" on money already
    // handled. Losing the panel is the cheaper failure.
    getEnrollments.mockRejectedValue(new Error('firestore unavailable'));
    getDonations.mockResolvedValue([]);
    getPledgesForStaff.mockResolvedValue([]);

    await expect(loadFamilyPaymentData('CMT-X')).rejects.toThrow();
    // ...while the five callers promised a plain word still get one.
    expect(await deriveFamilyPayment('CMT-X')).toBe('unknown');
  });

  it('reports donations as unavailable rather than as zero given', async () => {
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: 300 })]);
    getDonations.mockRejectedValue(new Error('firestore unavailable'));
    getPledgesForStaff.mockResolvedValue([]);

    const d = await loadFamilyPaymentData('CMT-X');

    expect(d.donations).toBe('unavailable');
    expect(d.paidCAD).toBeNull();
    // NOT 'outstanding' - that is a dunning letter to a family who may have paid.
    expect(d.verdict).toBe('unknown');
  });

  it('keeps classifying when only the PLEDGE read fails (asymmetric on purpose)', async () => {
    // The counterpart of the test above, and the asymmetry is the point: a
    // pledge outage must not blank the payment column for every family at once.
    // The screen still learns the history is missing.
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: 300 })]);
    getDonations.mockResolvedValue(donated(300));
    getPledgesForStaff.mockRejectedValue(new Error('firestore unavailable'));

    const d = await loadFamilyPaymentData('CMT-X');

    expect(d.pledges).toBe('unavailable');
    expect(d.verdict).toBe('paid');
  });

  it('distinguishes a DARK feature flag from a broken pledge read', async () => {
    // Both leave the screen with no pledge rows, but only one is a fault. An
    // "unavailable" banner shown because a kill switch is off would send staff
    // chasing an outage that does not exist.
    flagsMock.setuPledge = false;
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: 300 })]);
    getDonations.mockResolvedValue(donated(300));

    const d = await loadFamilyPaymentData('CMT-X');

    expect(d.pledges).toEqual([]);
    expect(d.pledges).not.toBe('unavailable');
    flagsMock.setuPledge = true;
  });

  it('flags a family whose PAID verdict rests on a live pledge (N=2 attempts)', async () => {
    // A pledge family has no completed donations, so the arithmetic alone reads
    // outstanding. The screen must be able to say "monthly plan" instead of
    // showing an expected/received line that looks unpaid.
    getEnrollments.mockResolvedValue([enrollment({ amountCAD: 300 })]);
    getDonations.mockResolvedValue([]);
    getPledgesForStaff.mockResolvedValue([
      pledgeRow('active', { pid: 'p-new' }),
      pledgeRow('failed', { pid: 'p-old', lastError: 'card_declined' }),
    ]);

    const d = await loadFamilyPaymentData('CMT-X');

    expect(d.verdict).toBe('paid');
    expect(d.paidByPledge).toBe(true);
    expect(d.unknownReason).toBeNull();
    // The failed attempt survives for the history - it is the row staff are
    // asked about most.
    expect(d.pledges).toHaveLength(2);
  });
});
