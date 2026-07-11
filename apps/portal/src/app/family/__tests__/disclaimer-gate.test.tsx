import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
);
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

const flagsMock = vi.hoisted(() => ({ setuAuth: true, setuDisclaimers: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

const mockGetCurrentFamily = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-current-family', () => ({ getCurrentFamily: mockGetCurrentFamily }));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: () => ({}) }));

const mockGetState = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/disclaimers/acceptance', () => ({ getDisclaimerStateForFamily: mockGetState }));

import { DisclaimerGate } from '../layout';

function adult(over: Partial<MemberDoc> = {}): MemberDoc {
  return {
    mid: 'm-adult', uid: 'u1', firstName: 'Asha', lastName: 'Rao', type: 'Adult', gender: 'Female',
    manager: true, joinedAt: new Date(), email: 'a@x.com', phone: '+14165551234', altEmails: [], altPhones: [],
    schoolGrade: null, birthMonthYear: null, volunteeringSkills: ['Kitchen'], foodAllergies: 'None',
    emergencyContacts: [{ relation: 'Spouse', phone: '+14165550000', email: 'x@x.com' }, null], ...over,
  } as MemberDoc;
}
function child(over: Partial<MemberDoc> = {}): MemberDoc {
  return {
    mid: 'm-child', uid: null, firstName: 'Dev', lastName: 'Rao', type: 'Child', gender: 'Male',
    manager: false, joinedAt: new Date(), email: null, phone: null, altEmails: [], altPhones: [],
    schoolGrade: 'Grade 3', birthMonthYear: '2017-03', birthMonth: 3, volunteeringSkills: [], foodAllergies: 'None',
    emergencyContacts: [{ relation: 'Mother', phone: '+14165550000', email: 'x@x.com' }, null], ...over,
  } as MemberDoc;
}
// A complete address so the disclaimer gate's profile-completeness deferral
// (which now also checks the required family home address) doesn't short-circuit.
const COMPLETE_ADDRESS = { street: '1 King St', unit: '', city: 'Toronto', province: 'ON', postalCode: 'M5H 2N2' };

function family(members: MemberDoc[], over: Partial<FamilyWithMembers> = {}): FamilyWithMembers {
  return { family: { fid: 'CMT-1', name: 'Rao', disclaimersAccepted: null, familyAddress: COMPLETE_ADDRESS } as FamilyWithMembers['family'],
    members, currentMid: members[0]?.mid ?? 'm-adult', isManager: true, ...over };
}

beforeEach(() => {
  mockRedirect.mockClear(); mockGetCurrentFamily.mockReset(); mockGetState.mockReset();
  flagsMock.setuAuth = true; flagsMock.setuDisclaimers = true;
});

describe('DisclaimerGate', () => {
  it('redirects a manager who has not accepted the current version', async () => {
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child()]));
    mockGetState.mockResolvedValue({ accepted: false, version: 3, schoolYear: '2026-27', sections: [] });
    await expect(DisclaimerGate()).rejects.toThrow('NEXT_REDIRECT:/disclaimers');
    expect(mockRedirect).toHaveBeenCalledWith('/disclaimers');
  });

  it('does nothing when the manager has accepted', async () => {
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child()]));
    mockGetState.mockResolvedValue({ accepted: true, version: 3, schoolYear: '2026-27', sections: [] });
    expect(await DisclaimerGate()).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('does NOT gate a plain family-member (per-family: manager accepts)', async () => {
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child()], { isManager: false }));
    expect(await DisclaimerGate()).toBeNull();
    expect(mockGetState).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('defers to the profile gate when the family profile is incomplete', async () => {
    // Child missing schoolGrade ⇒ incomplete; the disclaimer gate no-ops so the
    // profile gate (rendered first) sends the user to /complete-profile first.
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child({ schoolGrade: null })]));
    expect(await DisclaimerGate()).toBeNull();
    expect(mockGetState).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('defers to the profile gate when the family home address is missing', async () => {
    // Members complete but no family address ⇒ profile still incomplete, so the
    // disclaimer gate no-ops and lets the profile gate collect the address first.
    mockGetCurrentFamily.mockResolvedValue(
      family([adult(), child()], {
        family: { fid: 'CMT-1', name: 'Rao', disclaimersAccepted: null, familyAddress: null } as FamilyWithMembers['family'],
      }),
    );
    expect(await DisclaimerGate()).toBeNull();
    expect(mockGetState).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('does nothing when the flag is off', async () => {
    flagsMock.setuDisclaimers = false;
    expect(await DisclaimerGate()).toBeNull();
    expect(mockGetCurrentFamily).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('does nothing when there is no session', async () => {
    mockGetCurrentFamily.mockResolvedValue(null);
    expect(await DisclaimerGate()).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
