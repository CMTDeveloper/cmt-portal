import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
);
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

const flagsMock = vi.hoisted(() => ({ setuAuth: true, setuDisclaimers: true, setuAdultClass: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

const mockGetCurrentFamily = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-current-family', () => ({ getCurrentFamily: mockGetCurrentFamily }));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: () => ({}) }));

const mockGetState = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/disclaimers/acceptance', () => ({ getDisclaimerStateForFamily: mockGetState }));

// BOTH loader variants are mocked so a test can prove WHICH one the gate calls.
// They have identical signatures, so nothing else can.
const { failSoft, orThrow } = vi.hoisted(() => ({ failSoft: vi.fn(), orThrow: vi.fn() }));
vi.mock('@/features/setu/adult-class/load-gate-data', () => ({
  loadAdultClassGateDataFailSoft: failSoft,
  loadAdultClassGateDataOrThrow: orThrow,
}));

const mockNeedsSelection = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/adult-class/needs-selection', () => ({
  needsAdultClassSelection: mockNeedsSelection,
  isBalaViharPaid: vi.fn(),
}));

import { AdultClassGate } from '../layout';

const COMPLETE_ADDRESS = { street: '1 King St', unit: '', city: 'Toronto', province: 'ON', postalCode: 'M5H 2N2' };

function adult(over: Partial<MemberDoc> = {}): MemberDoc {
  return {
    mid: 'm-adult', uid: 'u1', firstName: 'Asha', lastName: 'Rao', type: 'Adult', gender: 'Female',
    manager: true, joinedAt: new Date(), email: 'a@x.com', phone: '+14165551234', altEmails: [], altPhones: [],
    schoolGrade: null, birthMonthYear: null, volunteeringSkills: ['Kitchen'], foodAllergies: 'None',
    emergencyContacts: [{ relation: 'Spouse', phone: '+14165550000', email: 'x@x.com' }, null], ...over,
  } as MemberDoc;
}

function family(members: MemberDoc[], over: Partial<FamilyWithMembers> = {}): FamilyWithMembers {
  return {
    family: { fid: 'CMT-1', name: 'Rao', disclaimersAccepted: null, familyAddress: COMPLETE_ADDRESS } as FamilyWithMembers['family'],
    members, currentMid: members[0]?.mid ?? 'm-adult', isManager: true, ...over,
  };
}

beforeEach(() => {
  mockRedirect.mockClear();
  mockGetCurrentFamily.mockReset().mockResolvedValue(family([adult()]));
  mockGetState.mockReset().mockResolvedValue({ accepted: true });
  failSoft.mockReset().mockResolvedValue({ currentOffering: { oid: 'asc-2026' } });
  orThrow.mockReset();
  mockNeedsSelection.mockReset().mockReturnValue(true);
  flagsMock.setuAuth = true; flagsMock.setuDisclaimers = true; flagsMock.setuAdultClass = true;
});

describe('AdultClassGate', () => {
  it('redirects a gated family to /adult-class', async () => {
    await expect(AdultClassGate()).rejects.toThrow('NEXT_REDIRECT:/adult-class');
  });

  it('no-ops when the predicate says the family owes nothing', async () => {
    mockNeedsSelection.mockReturnValue(false);
    expect(await AdultClassGate()).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('no-ops when the flag is off, without reading anything', async () => {
    flagsMock.setuAdultClass = false;
    expect(await AdultClassGate()).toBeNull();
    expect(mockGetCurrentFamily).not.toHaveBeenCalled();
    expect(failSoft).not.toHaveBeenCalled();
  });

  it('no-ops for an unauthenticated visitor', async () => {
    mockGetCurrentFamily.mockResolvedValue(null);
    expect(await AdultClassGate()).toBeNull();
  });

  // ── THE VARIANT BINDING. Both loaders return Promise<AdultClassGateInput|null>,
  //    so pasting the wrong name compiles clean and type-checks green. Only this
  //    assertion catches it - and getting it wrong reopens the redirect
  //    ping-pong the split exists to close. ────────────────────────────────────
  it('calls the FAIL-SOFT loader, never the throwing one', async () => {
    await expect(AdultClassGate()).rejects.toThrow('NEXT_REDIRECT:/adult-class');
    expect(failSoft).toHaveBeenCalledTimes(1);
    expect(orThrow).not.toHaveBeenCalled();
  });

  it('does not gate when the loader reports nothing to ask', async () => {
    failSoft.mockResolvedValue(null);
    expect(await AdultClassGate()).toBeNull();
    expect(mockNeedsSelection).not.toHaveBeenCalled();
  });

  // ── Ordering. These run as SIBLING Suspense boundaries, so this gate has to
  //    decide for itself whether an earlier one is still pending. ─────────────
  describe('deferring to the earlier gates', () => {
    it('defers while the profile is incomplete', async () => {
      mockGetCurrentFamily.mockResolvedValue(
        family([adult({ foodAllergies: null })]),
      );
      expect(await AdultClassGate()).toBeNull();
      expect(failSoft).not.toHaveBeenCalled();
    });

    it('defers while the family home address is missing', async () => {
      mockGetCurrentFamily.mockResolvedValue(
        family([adult()], { family: { fid: 'CMT-1', name: 'Rao', disclaimersAccepted: null, familyAddress: null } as FamilyWithMembers['family'] }),
      );
      expect(await AdultClassGate()).toBeNull();
      expect(failSoft).not.toHaveBeenCalled();
    });

    // P6: both earlier gates call needsCentreConfirmation. A third gate that
    // omitted it would route a family that still has to confirm its centre
    // straight to /adult-class.
    it('defers while the migrated centre is unconfirmed', async () => {
      mockGetCurrentFamily.mockResolvedValue(
        family([adult()], { family: { fid: 'CMT-1', name: 'Rao', disclaimersAccepted: null, familyAddress: COMPLETE_ADDRESS, locationNeedsConfirmation: true } as FamilyWithMembers['family'] }),
      );
      expect(await AdultClassGate()).toBeNull();
      expect(failSoft).not.toHaveBeenCalled();
    });

    it('defers while the disclaimers are unaccepted', async () => {
      mockGetState.mockResolvedValue({ accepted: false });
      expect(await AdultClassGate()).toBeNull();
      expect(failSoft).not.toHaveBeenCalled();
    });

    // Turning disclaimers OFF must not silently disable THIS gate: DisclaimerGate
    // never fires when the flag is off, so there is nothing to defer to.
    it('does NOT defer to an unaccepted disclaimer when the disclaimers flag is off', async () => {
      flagsMock.setuDisclaimers = false;
      mockGetState.mockResolvedValue({ accepted: false });
      await expect(AdultClassGate()).rejects.toThrow('NEXT_REDIRECT:/adult-class');
    });

    // A family-member is never disclaimer-gated, so there is nothing pending for
    // them to wait on - the predicate's own condition 1 handles members.
    it('does not treat an unaccepted disclaimer as pending for a family-member', async () => {
      mockGetCurrentFamily.mockResolvedValue(family([adult()], { isManager: false }));
      mockGetState.mockResolvedValue({ accepted: false });
      await expect(AdultClassGate()).rejects.toThrow('NEXT_REDIRECT:/adult-class');
    });
  });
});

// ── MOUNTING. Every predicate, route and gate test above passes while this
//    element is absent from the layout - the feature would simply never run.
//    A source assertion is crude, but it is the only thing that catches it. ───
describe('the gate is actually MOUNTED, after DisclaimerGate', () => {
  const layout = readFileSync(join(__dirname, '..', 'layout.tsx'), 'utf8');

  it('renders <AdultClassGate /> in the layout', () => {
    expect(layout).toContain('<AdultClassGate />');
  });

  it('renders it AFTER <DisclaimerGate />, which is after <ProfileCompletionGate />', () => {
    const profile = layout.indexOf('<ProfileCompletionGate />');
    const disclaimer = layout.indexOf('<DisclaimerGate />');
    const adultClass = layout.indexOf('<AdultClassGate />');
    expect(profile).toBeGreaterThan(-1);
    expect(disclaimer).toBeGreaterThan(profile);
    expect(adultClass).toBeGreaterThan(disclaimer);
  });
});
