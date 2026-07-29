import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
);
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('next/server', () => ({ connection: vi.fn().mockResolvedValue(undefined) }));

const flagsMock = vi.hoisted(() => ({ setuAuth: true, setuAdultClass: true, setuPledge: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

const { mockFinalizePledge, mockGetFamilyPledge } = vi.hoisted(() => ({
  mockFinalizePledge: vi.fn(),
  mockGetFamilyPledge: vi.fn(),
}));
vi.mock('@/features/setu/pledges/finalize-pledge', () => ({ finalizePledge: mockFinalizePledge }));
vi.mock('@/features/setu/pledges/get-family-pledge', () => ({ getFamilyPledge: mockGetFamilyPledge }));

const mockGetCurrentFamily = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-current-family', () => ({ getCurrentFamily: mockGetCurrentFamily }));

const mockMarkDonation = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/donations/mark-donation-status', () => ({ markDonationStatus: mockMarkDonation }));

// BOTH loader variants mocked, so a test can prove WHICH one a receipt page uses.
const { failSoft, orThrow } = vi.hoisted(() => ({ failSoft: vi.fn(), orThrow: vi.fn() }));
vi.mock('@/features/setu/adult-class/load-gate-data', () => ({
  loadAdultClassGateDataFailSoft: failSoft,
  loadAdultClassGateDataOrThrow: orThrow,
}));

const mockNeedsSelection = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/adult-class/needs-selection', async (orig) => ({
  ...(await orig<typeof import('@/features/setu/adult-class/needs-selection')>()),
  needsAdultClassSelection: mockNeedsSelection,
}));

import { DonateSuccessBody } from '../page';

const BV_EID = 'CMT-1-bala-vihar-2026-27';

function adult(mid: string, over: Partial<MemberDoc> = {}): MemberDoc {
  return { mid, firstName: 'Asha', lastName: 'Rao', type: 'Adult', ...over } as MemberDoc;
}

function familyData(over: Partial<FamilyWithMembers> = {}): FamilyWithMembers {
  return {
    family: { fid: 'CMT-1', name: 'Rao' } as FamilyWithMembers['family'],
    members: [adult('CMT-1-01'), adult('CMT-1-02')],
    currentMid: 'CMT-1-01',
    isManager: true,
    ...over,
  };
}

function gateData() {
  return {
    isManager: true,
    members: [adult('CMT-1-01'), adult('CMT-1-02')],
    enrollments: [{ eid: BV_EID, programKey: 'bala-vihar', status: 'active', offering: { paymentSource: 'portal' } }],
    donations: [{ status: 'completed', eid: BV_EID, amountCAD: 500 }],
    currentOffering: { oid: 'asc-2026' },
    teacherAssignedMids: new Set<string>(),
    legacyPaymentStatus: 'unknown',
  };
}

/** The default export is a sync Suspense shell; the body is what does the work. */
// `null` means "no did in the URL". NOT `undefined` - that triggers the default.
async function renderPage(did: string | null = 'don_1') {
  const body = await DonateSuccessBody({ searchParams: Promise.resolve(did ? { did } : {}) });
  render(body);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS = 'true';
  process.env.PLEDGE_MONTHLY_AMOUNT_CAD = '63';
  flagsMock.setuAdultClass = true;
  flagsMock.setuPledge = true;
  mockFinalizePledge.mockResolvedValue({ state: 'active' });
  mockGetFamilyPledge.mockResolvedValue(null);
  mockGetCurrentFamily.mockResolvedValue(familyData());
  mockMarkDonation.mockResolvedValue(undefined);
  failSoft.mockResolvedValue(gateData());
  orThrow.mockReset();
  mockNeedsSelection.mockReturnValue(true);
});

describe('/donate/success - the receipt itself', () => {
  it('always thanks the family', async () => {
    await renderPage();
    expect(screen.getByText(/Thank you for your donation/i)).toBeTruthy();
  });

  it('marks the donation completed before anything else', async () => {
    await renderPage();
    expect(mockMarkDonation).toHaveBeenCalledWith('don_1', 'CMT-1', 'completed');
  });

  // The write is best-effort and NOT authoritative (accounting's notification
  // is), and Stripe already has the money. A failed status write is recoverable;
  // a receipt the family never sees is not. Uncaught, this hid the thank-you AND
  // the ask together.
  it('still shows the receipt when the completion write fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockMarkDonation.mockRejectedValue(new Error('UNAVAILABLE'));
    await renderPage();
    expect(screen.getByText(/Thank you for your donation/i)).toBeTruthy();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not mark anything when there is no did', async () => {
    await renderPage(null);
    expect(mockMarkDonation).not.toHaveBeenCalled();
  });
});

describe('/donate/success - the Adult Study Class ask', () => {
  it('asks a family that owes a selection, and offers the real adults', async () => {
    await renderPage();
    expect(screen.getAllByText(/One last thing/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Asha Rao/i).length).toBeGreaterThan(0);
  });

  // Same predicate the gate uses: a family shown the ask must be exactly a
  // family the gate would catch, or the two surfaces contradict each other.
  it('does NOT ask when the predicate says the family owes nothing', async () => {
    mockNeedsSelection.mockReturnValue(false);
    await renderPage();
    expect(screen.queryByText(/One last thing/i)).toBeNull();
    expect(screen.getAllByText(/Thank you for your donation/i).length).toBeGreaterThan(0);
  });

  it('does NOT ask when the flag is off, and reads nothing', async () => {
    flagsMock.setuAdultClass = false;
    await renderPage();
    expect(screen.queryByText(/One last thing/i)).toBeNull();
    expect(failSoft).not.toHaveBeenCalled();
  });

  // ── THE VARIANT BINDING, receipt edition. A read failure must cost the ASK,
  //    never the family's confirmation that their ~$500 arrived. ────────────
  it('uses the FAIL-SOFT loader, never the throwing one', async () => {
    await renderPage();
    expect(failSoft).toHaveBeenCalledTimes(1);
    expect(orThrow).not.toHaveBeenCalled();
  });

  it('still renders the receipt when the ask cannot be resolved', async () => {
    failSoft.mockResolvedValue(null);
    await renderPage();
    expect(screen.getAllByText(/Thank you for your donation/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/One last thing/i)).toBeNull();
  });
});

describe('/donate/success - the "not now" path', () => {
  // Task 9 Step 4: skipping writes nothing, and AdultClassGate is what brings
  // the family back. So there must be a way out that does NOT commit a
  // selection - and it must not be labelled as a skip it cannot honour.
  it('always offers a way out that writes nothing', async () => {
    await renderPage();
    const back = screen.getAllByRole('link', { name: /Back to family/i });
    expect(back.length).toBeGreaterThan(0);
    expect(back[0]!.getAttribute('href')).toBe('/family');
  });

  it('offers no control promising to skip, since nothing can be persisted', async () => {
    await renderPage();
    expect(screen.queryByText(/^Skip/i)).toBeNull();
  });
});

// ── DOM ORDER. Spec 4.3 fixes it: adult-class ask FIRST (quick, free), pledge
//    SECOND and quieter, because leading with a money ask straight after a ~$500
//    payment reads badly. P5 v3 Task 5 lands its card in THIS file, and until
//    now that order was enforced by a comment alone - which is exactly the
//    "a comment does not survive a copy-paste" trap that made the two loader
//    variants get distinct names. Test-lock it BEFORE P5 touches the file. ────
describe('/donate/success - the ordering Task 9 exists to guarantee', () => {
  it('renders the ask AFTER the thank-you and BEFORE the way out', async () => {
    const body = await DonateSuccessBody({ searchParams: Promise.resolve({ did: 'don_1' }) });
    const { container } = render(body);
    const text = container.textContent ?? '';

    const thanks = text.indexOf('Thank you for your donation');
    const ask = text.indexOf('One last thing');
    const out = text.indexOf('Back to family');

    expect(thanks).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(thanks);
    expect(out).toBeGreaterThan(ask);
  });

  // The pledge card must be a SIBLING after the ask, never nested inside it -
  // nested, it would inherit the adult-class predicate and render for nobody.
  it('leaves the pledge slot outside the conditional ask block', async () => {
    mockNeedsSelection.mockReturnValue(false);
    const body = await DonateSuccessBody({ searchParams: Promise.resolve({ did: 'don_1' }) });
    const { container } = render(body);
    const text = container.textContent ?? '';
    // With no ask, the way out must still render - proving the slot between them
    // is not inside the `ask &&` block.
    expect(text.indexOf('Thank you for your donation')).toBeGreaterThan(-1);
    expect(text.indexOf('Back to family')).toBeGreaterThan(-1);
    expect(text.indexOf('One last thing')).toBe(-1);
  });
});

// ── P5 Task 5: the pledge card, and the return from the Stripe-hosted page ────
//
// This page is BOTH the donation receipt and the pledge success URL
// (`start-pledge.ts` sets successUrl to `/donate/success?pledge=<pid>`), so it
// has to finish a pledge as well as show one.
describe('/donate/success - finishing a pledge on return from Stripe', () => {
  async function renderWith(params: Record<string, string>) {
    const body = await DonateSuccessBody({ searchParams: Promise.resolve(params) });
    return render(body);
  }

  it('finalizes the pledge named in the URL, against the SESSION fid', async () => {
    await renderWith({ pledge: 'PLG-7' });
    // fid from the session, never the query. A pid in a URL someone else could
    // send must not be enough to drive another family's pledge.
    expect(mockFinalizePledge).toHaveBeenCalledWith({ pid: 'PLG-7', fid: 'CMT-1' });
  });

  it('finalizes BEFORE reading the pledge for the card', async () => {
    // The family lands here the instant they leave the hosted page. Reading
    // first would render the pre-finalize state - a family whose mandate just
    // confirmed would be told it is still being set up, then have to reload to
    // learn otherwise.
    await renderWith({ pledge: 'PLG-7' });
    const finalizeAt = mockFinalizePledge.mock.invocationCallOrder[0]!;
    const readAt = mockGetFamilyPledge.mock.invocationCallOrder[0]!;
    expect(finalizeAt).toBeLessThan(readAt);
  });

  it('does not finalize when the URL names no pledge', async () => {
    await renderWith({ did: 'don_1' });
    expect(mockFinalizePledge).not.toHaveBeenCalled();
  });

  it('still shows the receipt when finalize throws', async () => {
    // Stripe being unreachable must not cost the family their donation receipt.
    // The reconciler cron resolves the pledge either way.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFinalizePledge.mockRejectedValue(new Error('ECONNRESET'));
    await renderWith({ did: 'don_1', pledge: 'PLG-7' });
    expect(screen.getByText(/Thank you for your donation/i)).toBeTruthy();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still shows the receipt when reading the pledge throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetFamilyPledge.mockRejectedValue(new Error('UNAVAILABLE'));
    await renderWith({ did: 'don_1' });
    expect(screen.getByText(/Thank you for your donation/i)).toBeTruthy();
    spy.mockRestore();
  });
});

describe('/donate/success - the pledge card', () => {
  // The card belongs to a pledge RETURN (`?pledge=`), where it reports the
  // status of a mandate the family just authorised. It is NOT an ask, and the
  // `?did=` receipt arrival gets none of it - see the regression block below.
  //
  // ── Why these now seed a pledge ───────────────────────────────────────────
  // They used to render `?pledge=PLG-7` on top of `getFamilyPledge -> null`, a
  // combination that CANNOT occur: `startPledge` writes the doc before it mints
  // the hosted page, so a family arriving from Stripe always has one. That
  // impossible fixture is what let the ask-shaped `AskBody` render here for
  // weeks while the suite stayed green - it was asserting the bug (rule 7: the
  // fixture has to look like a real account).
  beforeEach(() => {
    mockGetFamilyPledge.mockResolvedValue({
      pid: 'PLG-7', status: 'started', monthlyAmountCAD: 63,
      startedAt: new Date('2026-07-28T12:00:00Z'), activatedAt: null,
    });
  });

  async function renderWith(params: Record<string, string> = { pledge: 'PLG-7' }) {
    const body = await DonateSuccessBody({ searchParams: Promise.resolve(params) });
    return render(body);
  }

  it('shows NO "Monthly giving" card - the headline already says it', async () => {
    // CMT Developer, 2026-07-28: "just hide monthly giving it should not display
    // anywhere." Nothing is lost here: this page's own headline is "Your monthly
    // gift is being set up", so the card only restated the page it sat on.
    const { container } = await renderWith();
    expect(container.textContent).not.toMatch(/Monthly giving/);
    // ...and the acknowledgement itself is still on the page. A family who has
    // just authorised a recurring bank debit must see the portal confirm it.
    expect(screen.getByText(/monthly gift is being set up/i)).toBeTruthy();
  });

  it('shows no card even when there is no adult-class ask', async () => {
    mockNeedsSelection.mockReturnValue(false);
    const { container } = await renderWith();
    expect(container.textContent).not.toMatch(/Monthly giving/);
  });

  it('quotes NO monthly amount, for an active plan or any other', async () => {
    // The card was the only surface that printed a figure here. With it gone the
    // page must not reintroduce one: a receipt that names a price is an ask.
    mockGetFamilyPledge.mockResolvedValue({
      pid: 'PLG-7', status: 'active', monthlyAmountCAD: 51,
      startedAt: new Date('2026-02-01T12:00:00Z'), activatedAt: new Date('2026-02-03T12:00:00Z'),
    });
    const { container } = await renderWith();
    expect(container.textContent).not.toMatch(/\$51/);
    expect(container.textContent).not.toMatch(/\$63/);
    // Deliberately not /a month/: the headline legitimately thanks them for
    // "a monthly gift". What must never appear is a PRICE.
    expect(container.textContent).not.toMatch(/\$\d+\s*(a month|monthly|per month)/i);
  });

  it('renders NOTHING pledge-shaped when the flag is off, and reads nothing', async () => {
    flagsMock.setuPledge = false;
    const { container } = await renderWith({ did: 'don_1', pledge: 'PLG-7' });
    expect(container.textContent).not.toMatch(/Monthly giving/);
    // Dark means dark: no Firestore read, and above all no provider call for a
    // pid someone put in the URL.
    expect(mockGetFamilyPledge).not.toHaveBeenCalled();
    expect(mockFinalizePledge).not.toHaveBeenCalled();
  });

  // ── 🔴 A RECEIPT IS NOT A DECISION POINT ─────────────────────────────────
  //
  // Reported 2026-07-28: an adult who had just paid the $101 adult-class
  // donation was shown "Monthly giving - support the mission with $51 a month".
  // The card used to render on EVERY arrival, so any completed donation was
  // followed by a monthly ask.
  //
  // The pledge is the Bala Vihar contribution - $500 once or $51 a month - not a
  // general "support the mission" ask (Vaibhav: "It's part of Bala Vihar"). The
  // place to offer it is where the family chooses how to pay, on the enroll
  // page. These pin that a one-time receipt never solicits.
  describe('a one-time donation receipt never asks for a pledge', () => {
    it('shows no pledge card after an ADULT-CLASS donation', async () => {
      const { container } = await renderWith({ did: 'don_adult_class' });
      expect(container.textContent).not.toMatch(/Monthly giving/);
      expect(container.textContent).not.toMatch(/Give \$\d+ monthly/);
    });

    it('shows no pledge card after the Bala Vihar donation itself', async () => {
      // The worst version: asking a family to pay monthly for the very thing
      // they just paid in full.
      const { container } = await renderWith({ did: 'don_bala_vihar' });
      expect(container.textContent).not.toMatch(/Monthly giving/);
    });

    it('does not even READ the pledge on a receipt arrival', async () => {
      await renderWith({ did: 'don_1' });
      expect(mockGetFamilyPledge).not.toHaveBeenCalled();
    });

    it('still FINALIZES on a pledge return, and says so without a card', async () => {
      const { container } = await renderWith({ pledge: 'PLG-7' });
      expect(mockFinalizePledge).toHaveBeenCalled();
      expect(container.textContent).not.toMatch(/Monthly giving/);
      expect(container.textContent).toMatch(/monthly gift is being set up/i);
    });
  });

  // ── 🔴 `?pledge=` is a claim, not proof ────────────────────────────────────
  //
  // Found in review 2026-07-28. `resolvePledgeSlot` gated on `!!pledgePid` -
  // ANY non-empty query value - and `finalizePledge` deliberately no-ops on a
  // pid it cannot match. So a signed-in manager reaching this URL without a
  // real pledge got a live "Give $63 monthly" button inside `AskBody`, under a
  // headline thanking them for setting up a monthly gift they had never set up.
  //
  // This is not an exotic URL to reach: a genuine pledge return lands the
  // family on exactly this address, so it sits in their history and back
  // button. Revisit it after the mandate fails and the page thanks you for a
  // gift while the card beneath says it is not active.
  //
  // The page's own docstring already said "STATUS of a pledge just authorised -
  // never a new ASK". The code just never enforced it.
  describe('a pledge param without a pledge behind it', () => {
    it('shows no card at all when the family has no pledge', async () => {
      mockGetFamilyPledge.mockResolvedValue(null);
      const { container } = await renderWith({ pledge: 'anything' });
      expect(container.textContent).not.toMatch(/Monthly giving/);
      expect(container.textContent).not.toMatch(/Give \$\d+ monthly/);
      expect(container.textContent).not.toMatch(/Support the mission/);
    });

    it('does not thank them for a monthly gift they never set up', async () => {
      mockGetFamilyPledge.mockResolvedValue(null);
      await renderWith({ pledge: 'anything' });
      expect(screen.queryByText(/monthly gift is being set up/i)).toBeNull();
      expect(screen.queryByText(/thank you for setting up a monthly gift/i)).toBeNull();
    });

    it('shows no card for a pledge that already FAILED - that state is an ask', async () => {
      // `AskBody` renders for any terminal pledge, and its whole content is a
      // solicitation. A receipt is not the place to re-ask.
      mockGetFamilyPledge.mockResolvedValue({
        pid: 'PLG-7', status: 'failed', monthlyAmountCAD: 63,
        startedAt: new Date('2026-07-01T12:00:00Z'), activatedAt: null,
      });
      const { container } = await renderWith({ pledge: 'PLG-7' });
      expect(container.textContent).not.toMatch(/Monthly giving/);
      expect(container.textContent).not.toMatch(/set one up again/);
    });

    it('never renders a pledge START control here, even for a real pledge', async () => {
      // This page does not solicit. The ask lives on the enroll page, where the
      // family is choosing. Scoped to a pledge-shaped button on purpose - the
      // adult-class ask has its own legitimate "Continue" on this same screen.
      const { container } = await renderWith({ pledge: 'PLG-7' });
      expect(container.textContent).not.toMatch(/Monthly giving/);
      expect(screen.queryByRole('button', { name: /monthly/i })).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The page must not tell a pledging family their money arrived
// ─────────────────────────────────────────────────────────────────────────────

describe('/donate/success - a pledge arrival must not claim money was received', () => {
  /**
   * Reported from preview 2026-07-28. This page serves TWO arrivals and the
   * copy was unconditional, so a family returning from authorising a
   * pre-authorized debit was shown "Thank you for your donation / Your donation
   * has been received", plus a promise of a tax receipt for the prior calendar
   * year - directly above a card reading "Nothing has been taken from your
   * account yet".
   *
   * Nothing HAS been taken: the mandate still has to clear, which is why the
   * pledge sits in `started` and the reconciler exists. Telling someone they
   * have paid when a debit may fail days later is the precise harm this whole
   * feature is designed around, and it is the one thing a receipt page must
   * never get wrong.
   */
  // A real return always has the pledge doc behind it - `startPledge` writes it
  // before minting the hosted page. Seeded so these assert the genuine arrival
  // rather than a shape that cannot occur.
  beforeEach(() => {
    mockGetFamilyPledge.mockResolvedValue({
      pid: 'PLG-7', status: 'started', monthlyAmountCAD: 63,
      startedAt: new Date('2026-07-28T12:00:00Z'), activatedAt: null,
    });
  });

  async function renderWith(params: Record<string, string>) {
    const body = await DonateSuccessBody({ searchParams: Promise.resolve(params) });
    return render(body);
  }

  it('does NOT say the donation was received when the family arrives from a pledge', async () => {
    await renderWith({ pledge: 'PLG-7' });
    expect(screen.queryByText(/has been received/i)).toBeNull();
    expect(screen.queryByText(/Thank you for your donation/i)).toBeNull();
  });

  it('says the monthly gift is being SET UP instead', async () => {
    await renderWith({ pledge: 'PLG-7' });
    expect(screen.getByText(/being set up/i)).toBeTruthy();
  });

  it('does not promise a receipt for the prior calendar year on a pledge arrival', async () => {
    // A prior-year receipt implies money already given. The pledge wording
    // still explains receipts, but only for what is actually received.
    await renderWith({ pledge: 'PLG-7' });
    expect(screen.queryByText(/for the prior calendar year/i)).toBeNull();
    expect(screen.getByText(/actually received during the year/i)).toBeTruthy();
  });

  it('still confirms receipt for a real one-time donation', async () => {
    // The fix must not blunt the honest case: ?did= means Stripe already
    // collected the money.
    await renderWith({ did: 'don_1' });
    expect(screen.getByText(/has been received/i)).toBeTruthy();
    expect(screen.getByText(/for the prior calendar year/i)).toBeTruthy();
  });
});
