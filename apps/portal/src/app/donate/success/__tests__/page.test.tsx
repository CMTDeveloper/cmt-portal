import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
);
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('next/server', () => ({ connection: vi.fn().mockResolvedValue(undefined) }));

const flagsMock = vi.hoisted(() => ({ setuAuth: true, setuAdultClass: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

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
  flagsMock.setuAdultClass = true;
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
