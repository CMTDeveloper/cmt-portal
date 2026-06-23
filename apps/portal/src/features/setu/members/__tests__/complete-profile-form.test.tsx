import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';

// ── navigate-to (the HARD navigation the form uses to leave the gate) ─────────
// The form no longer uses next/navigation's router — it hard-navigates so a
// stale `use cache` gate read can't bounce it back onto the same route and
// strand "Saving…". The test mocks the wrapper instead of window.location.
const navigateTo = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/navigate-to', () => ({ navigateTo }));

// ── @cmt/ui toast ─────────────────────────────────────────────────────────────
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock, SetuLogo: () => <div data-testid="setu-logo" /> }));

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

// A SECOND incomplete adult (co-manager) so the manager-scope (N>1) path is
// exercised — the exact shape that stranded a real 3-person family on "Saving…".
function coManager(over: Partial<MemberDoc> = {}): MemberDoc {
  return manager({
    mid: 'CMT-1-02',
    firstName: 'Co',
    lastName: 'Manager',
    email: 'co@example.com',
    phone: '+14165559999',
    ...over,
  });
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
    // Incomplete manager on load; on a successful PATCH the form hard-navigates
    // to /family WITHOUT a refetch (the refetch raced the cache revalidation).
    getFamily.mockResolvedValue(family([manager()]));
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

    // It PATCHes the manager with the filled values, then HARD-navigates to /family.
    await waitFor(() => expect(patchMember).toHaveBeenCalledTimes(1));
    const [mid, body] = patchMember.mock.calls[0]!;
    expect(mid).toBe('CMT-1-01');
    expect(body).toMatchObject({ foodAllergies: 'None', volunteeringSkills: ['Kitchen'] });
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/family'));
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
    expect(navigateTo).not.toHaveBeenCalled();
  });

  // Regression for the real 3-person family stranded on "Saving…": a MANAGER's
  // scope is the WHOLE family, so every incomplete member must be PATCHed and the
  // form must hard-navigate exactly ONCE — never re-render/refetch into a loop.
  it('manager scope (N>1): completes every member, then hard-navigates exactly once', async () => {
    getFamily.mockResolvedValue(family([manager(), coManager()]));
    patchMember.mockResolvedValue({ ok: true, status: 200 });

    const user = userEvent.setup();
    render(<CompleteProfileForm />);

    await waitFor(() => expect(screen.getAllByTestId('member-card-CMT-1-01').length).toBeGreaterThan(0));
    const save = () => screen.getAllByTestId('complete-profile-save')[0]!;
    expect(save()).toBeDisabled();

    // Complete member 1 (PC). Its card drops out once satisfied.
    await user.click(screen.getAllByRole('checkbox', { name: /No known allergies for PC/i })[0]!);
    await user.click(within(screen.getAllByTestId('member-card-CMT-1-01')[0]!).getByTestId('skills-add'));

    // Member 2 (Co) is still incomplete → Save stays disabled.
    await waitFor(() => expect(screen.getAllByTestId('member-card-CMT-1-02').length).toBeGreaterThan(0));
    expect(save()).toBeDisabled();

    // Complete member 2 (Co).
    await user.click(screen.getAllByRole('checkbox', { name: /No known allergies for Co/i })[0]!);
    await user.click(within(screen.getAllByTestId('member-card-CMT-1-02')[0]!).getByTestId('skills-add'));

    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());

    // BOTH members PATCHed; exactly one hard navigation (no loop).
    await waitFor(() => expect(patchMember).toHaveBeenCalledTimes(2));
    expect(patchMember.mock.calls.map((c) => c[0]).sort()).toEqual(['CMT-1-01', 'CMT-1-02']);
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/family'));
    expect(navigateTo).toHaveBeenCalledTimes(1);
  });

  // A member missing an UNFILLABLE field (firstName/lastName/type have no input
  // on this screen) must not strand the user on a silent dead-end: explain it and
  // keep Save disabled (never navigate while incomplete → no gate bounce).
  it('explains an unfillable missing field and keeps Save disabled', async () => {
    getFamily.mockResolvedValue(
      family([manager({ firstName: '', foodAllergies: 'None', volunteeringSkills: ['Kitchen'] })]),
    );

    render(<CompleteProfileForm />);
    await waitFor(() => expect(screen.getAllByTestId('member-card-CMT-1-01').length).toBeGreaterThan(0));

    // The explanatory note is shown (firstName can't be edited here)…
    expect(screen.getAllByTestId('member-unfillable-CMT-1-01').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/can't be edited here/i).length).toBeGreaterThan(0);
    // …and there's no way to satisfy it → Save stays disabled and we never navigate.
    expect(screen.getAllByTestId('complete-profile-save')[0]!).toBeDisabled();
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
