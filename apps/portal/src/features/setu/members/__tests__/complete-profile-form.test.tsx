import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';

// ── next/navigation ───────────────────────────────────────────────────────────
const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

// ── @cmt/ui toast ─────────────────────────────────────────────────────────────
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

// ── client data wrappers ──────────────────────────────────────────────────────
const getFamily = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-current-family-client', () => ({
  getCurrentFamilyClient: getFamily,
}));
const patchMember = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/patch-member-client', () => ({
  patchMemberClient: patchMember,
}));

// ── VolunteeringSkillsPicker (fetches on mount) → controllable stub ───────────
vi.mock('@/features/setu/members/volunteering-skills-picker', () => ({
  VolunteeringSkillsPicker: ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" data-testid="skills-add" onClick={() => onChange(value.length ? value : ['Kitchen'])}>
      skills ({value.length})
    </button>
  ),
}));

// ── chrome atoms ──────────────────────────────────────────────────────────────
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FieldError: ({ message }: { message?: string }) => (message ? <p role="alert">{message}</p> : null),
}));
vi.mock('@/components/chrome/loading-om', () => ({ LoadingOm: () => <div>loading</div> }));

import { CompleteProfileForm } from '../complete-profile-form';

function manager(over: Partial<MemberDoc> = {}): MemberDoc {
  return {
    mid: 'CMT-1-01',
    uid: 'u1',
    firstName: 'PC',
    lastName: 'Manager',
    type: 'Adult',
    gender: 'Male',
    manager: true,
    joinedAt: new Date(),
    email: 'pc@example.com',
    phone: '+14165551234',
    schoolGrade: null,
    birthMonthYear: null,
    // Incomplete adult: missing foodAllergies + volunteeringSkills.
    foodAllergies: null,
    volunteeringSkills: [],
    emergencyContacts: [null, null],
    ...over,
  } as MemberDoc;
}

function family(members: MemberDoc[]): FamilyWithMembers {
  return {
    family: { fid: 'CMT-1', name: 'PC Family' } as FamilyWithMembers['family'],
    members,
    currentMid: 'CMT-1-01',
    isManager: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CompleteProfileForm — submit flow (regression: the Save button must stay clickable when complete)', () => {
  it('enables Save once the matrix is satisfied, PATCHes the member, and returns to the dashboard', async () => {
    // 1st load: incomplete manager. After PATCH, the refetch returns a complete one.
    getFamily
      .mockResolvedValueOnce(family([manager()]))
      .mockResolvedValueOnce(family([manager({ foodAllergies: 'None', volunteeringSkills: ['Kitchen'] })]));
    patchMember.mockResolvedValue({ ok: true, status: 200 });

    const user = userEvent.setup();
    render(<CompleteProfileForm />);

    // The form renders mobile + desktop trees (jsdom has no CSS to hide one), so
    // every element matches twice; the shared React state means acting on the
    // first copy updates both. Use the first match throughout.
    await waitFor(() => expect(screen.getAllByTestId('member-card-CMT-1-01').length).toBeGreaterThan(0));

    const save = () => screen.getAllByTestId('complete-profile-save')[0]!;
    expect(save()).toBeDisabled(); // nothing filled yet

    // Satisfy foodAllergies via "No known allergies", then pick a skill.
    await user.click(screen.getAllByRole('checkbox', { name: /No known allergies/i })[0]!);
    await user.click(screen.getAllByTestId('skills-add')[0]!);

    // The whole family is now complete → Save must be ENABLED (the bug made it
    // disappear here, leaving no way to persist the drafts).
    await waitFor(() => expect(save()).toBeEnabled());

    await user.click(save());

    // It PATCHes the manager with the filled values, then navigates to /family.
    await waitFor(() => expect(patchMember).toHaveBeenCalledTimes(1));
    const [mid, body] = patchMember.mock.calls[0]!;
    expect(mid).toBe('CMT-1-01');
    expect(body).toMatchObject({ foodAllergies: 'None', volunteeringSkills: ['Kitchen'] });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/family'));
  });

  it('surfaces a field-level toast and does NOT navigate when a PATCH fails', async () => {
    getFamily.mockResolvedValue(family([manager()]));
    patchMember.mockResolvedValue({ ok: false, status: 400, error: 'contact-required' });

    const user = userEvent.setup();
    render(<CompleteProfileForm />);
    await waitFor(() => expect(screen.getAllByTestId('member-card-CMT-1-01').length).toBeGreaterThan(0));

    await user.click(screen.getAllByRole('checkbox', { name: /No known allergies/i })[0]!);
    await user.click(screen.getAllByTestId('skills-add')[0]!);
    const save = () => screen.getAllByTestId('complete-profile-save')[0]!;
    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());

    await waitFor(() => expect(patchMember).toHaveBeenCalled());
    // Friendly copy, not the raw code; and we stay on the completion screen.
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/email and a phone/i)));
    expect(push).not.toHaveBeenCalled();
  });
});
