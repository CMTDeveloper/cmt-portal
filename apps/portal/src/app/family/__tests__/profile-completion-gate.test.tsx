import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';

// ── next/navigation: redirect throws like the real one so the gate aborts ─────
const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
);
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

// ── Feature flag: gate is active only when setuAuth is on ─────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── The two awaited data sources ──────────────────────────────────────────────
const mockGetCurrentFamily = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-current-family', () => ({
  getCurrentFamily: mockGetCurrentFamily,
}));
const mockGetRequestPathname = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-request-pathname', () => ({
  getRequestPathname: mockGetRequestPathname,
}));

import { ProfileCompletionGate } from '../layout';

// ── Fixtures ──────────────────────────────────────────────────────────────────
function adult(over: Partial<MemberDoc> = {}): MemberDoc {
  return {
    mid: 'm-adult',
    uid: 'u1',
    firstName: 'Asha',
    lastName: 'Rao',
    type: 'Adult',
    gender: 'Female',
    manager: true,
    joinedAt: new Date(),
    email: 'asha@example.com',
    phone: '+14165551234',
    altEmails: [],
    altPhones: [],
    schoolGrade: null,
    birthMonthYear: null,
    volunteeringSkills: ['Kitchen'],
    foodAllergies: 'None',
    emergencyContacts: [{ relation: 'Spouse', phone: '+14165550000', email: 'x@x.com' }, null],
    ...over,
  } as MemberDoc;
}

function child(over: Partial<MemberDoc> = {}): MemberDoc {
  return {
    mid: 'm-child',
    uid: null,
    firstName: 'Dev',
    lastName: 'Rao',
    type: 'Child',
    gender: 'Male',
    manager: false,
    joinedAt: new Date(),
    email: null,
    phone: null,
    altEmails: [],
    altPhones: [],
    schoolGrade: 'Grade 3',
    birthMonthYear: '2017-03',
    birthMonth: 3,
    volunteeringSkills: [],
    foodAllergies: 'None',
    emergencyContacts: [{ relation: 'Mother', phone: '+14165550000', email: 'x@x.com' }, null],
    ...over,
  } as MemberDoc;
}

function family(members: MemberDoc[], over: Partial<FamilyWithMembers> = {}): FamilyWithMembers {
  return {
    family: { fid: 'CMT-1', name: 'Rao Family' } as FamilyWithMembers['family'],
    members,
    currentMid: members[0]?.mid ?? 'm-adult',
    isManager: true,
    ...over,
  };
}

beforeEach(() => {
  mockRedirect.mockClear();
  mockGetCurrentFamily.mockReset();
  mockGetRequestPathname.mockReset();
  flagsMock.setuAuth = true;
  // Default: a normal /family path (not the completion route).
  mockGetRequestPathname.mockResolvedValue('/family');
});

describe('ProfileCompletionGate', () => {
  it('redirects a manager whose family has an incomplete member', async () => {
    // Child missing schoolGrade → whole-family incomplete for the manager.
    mockGetCurrentFamily.mockResolvedValue(
      family([adult(), child({ schoolGrade: null })]),
    );

    await expect(ProfileCompletionGate()).rejects.toThrow('NEXT_REDIRECT:/family/complete-profile');
    expect(mockRedirect).toHaveBeenCalledWith('/family/complete-profile');
  });

  it('redirects a manager whose own record is missing a required field', async () => {
    // Adult manager missing volunteeringSkills.
    mockGetCurrentFamily.mockResolvedValue(
      family([adult({ volunteeringSkills: [] }), child()]),
    );

    await expect(ProfileCompletionGate()).rejects.toThrow('NEXT_REDIRECT:/family/complete-profile');
    expect(mockRedirect).toHaveBeenCalledWith('/family/complete-profile');
  });

  it('does NOT redirect when the family is fully complete', async () => {
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child()]));

    const result = await ProfileCompletionGate();
    expect(result).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('exempts the completion route itself (no infinite loop)', async () => {
    // Family is incomplete, but we are already ON /family/complete-profile.
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child({ schoolGrade: null })]));
    mockGetRequestPathname.mockResolvedValue('/family/complete-profile');

    const result = await ProfileCompletionGate();
    expect(result).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('fails open (no redirect) when the pathname cannot be determined', async () => {
    mockGetCurrentFamily.mockResolvedValue(family([adult(), child({ schoolGrade: null })]));
    mockGetRequestPathname.mockResolvedValue(null);

    const result = await ProfileCompletionGate();
    expect(result).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('gates a plain member only on their OWN record, not siblings', async () => {
    // The signed-in plain member (the adult) is complete; the child is missing
    // a grade. A plain member is NOT responsible for others → no redirect.
    mockGetCurrentFamily.mockResolvedValue(
      family([adult(), child({ schoolGrade: null })], {
        isManager: false,
        currentMid: 'm-adult',
      }),
    );

    const result = await ProfileCompletionGate();
    expect(result).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects a plain member when their OWN record is incomplete', async () => {
    mockGetCurrentFamily.mockResolvedValue(
      family([adult({ phone: null }), child()], {
        isManager: false,
        currentMid: 'm-adult',
      }),
    );

    await expect(ProfileCompletionGate()).rejects.toThrow('NEXT_REDIRECT:/family/complete-profile');
    expect(mockRedirect).toHaveBeenCalledWith('/family/complete-profile');
  });

  it('does nothing when setuAuth is off (mock/prototype path)', async () => {
    flagsMock.setuAuth = false;
    const result = await ProfileCompletionGate();
    expect(result).toBeNull();
    expect(mockGetCurrentFamily).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('does nothing when there is no session (getCurrentFamily null)', async () => {
    mockGetCurrentFamily.mockResolvedValue(null);
    const result = await ProfileCompletionGate();
    expect(result).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
