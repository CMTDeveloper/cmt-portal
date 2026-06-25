import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';

// ── navigate-to (the HARD navigation the form uses to leave the gate) ─────────
// The form hard-navigates so a stale `use cache` gate read can't bounce it back
// onto the same route and strand "Saving…". The test mocks the wrapper.
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

// A COMPLETE adult manager. Tests derive incomplete variants by nulling fields,
// so each test controls EXACTLY which inputs render (the form renders only the
// fields missing at load).
function adult(over: Partial<MemberDoc> = {}): MemberDoc {
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
    foodAllergies: 'None',
    volunteeringSkills: ['Kitchen'],
    emergencyContacts: [null, null],
    ...over,
  } as MemberDoc;
}

// A Child missing only schoolGrade + birthMonthYear (gender + allergies set), so
// the grade dropdown + birth selects are the only inputs that render.
function child(over: Partial<MemberDoc> = {}): MemberDoc {
  return adult({
    mid: 'CMT-1-02',
    uid: 'u2',
    firstName: 'Lil',
    lastName: 'One',
    type: 'Child',
    email: null,
    phone: null,
    volunteeringSkills: [],
    schoolGrade: null,
    birthMonthYear: null,
    ...over,
  });
}

function family(members: MemberDoc[], over: Partial<FamilyWithMembers> = {}): FamilyWithMembers {
  return {
    family: { fid: 'CMT-1', name: 'PC Family' } as FamilyWithMembers['family'],
    members,
    currentMid: 'CMT-1-01',
    isManager: true,
    ...over,
  };
}

const save = () => screen.getAllByTestId('complete-profile-save')[0]!;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CompleteProfileForm — fields stay mounted (issue #18: inputs vanished mid-typing)', () => {
  // Regression for the core report: the form gated each input's visibility on the
  // LIVE draft-derived missing set, so a field unmounted the instant its value
  // satisfied nonEmptyString — i.e. after ONE character. Inputs must persist.
  it('keeps an email input mounted while it is being typed into', async () => {
    getFamily.mockResolvedValue(family([adult({ email: null })])); // only email missing
    const user = userEvent.setup();
    render(<CompleteProfileForm />);

    const emailInput = () => screen.getAllByLabelText(/Email for PC/i)[0]! as HTMLInputElement;
    await waitFor(() => expect(emailInput()).toBeInTheDocument());

    await user.type(emailInput(), 'j');
    expect(emailInput()).toBeInTheDocument(); // did NOT unmount after the first char
    await user.type(emailInput(), 'ane@example.com');
    expect(emailInput().value).toBe('jane@example.com');
  });

  it('keeps the volunteering-skills picker mounted after a skill is selected (multi-select)', async () => {
    getFamily.mockResolvedValue(family([adult({ volunteeringSkills: [] })])); // only skills missing
    const user = userEvent.setup();
    render(<CompleteProfileForm />);

    const skills = () => screen.getAllByTestId('skills-add')[0]!;
    await waitFor(() => expect(skills()).toBeInTheDocument());

    await user.click(skills());
    // Old bug (#18 #2): the picker disappeared as soon as one skill was chosen.
    expect(skills()).toBeInTheDocument();
  });
});

describe('CompleteProfileForm — school grade is a predefined dropdown (issue #18 #3)', () => {
  it('renders a grade <select> with predefined options, not a free-text field', async () => {
    getFamily.mockResolvedValue(family([child()]));
    render(<CompleteProfileForm />);

    const grade = () => screen.getAllByLabelText(/School grade for Lil/i)[0]!;
    await waitFor(() => expect(grade()).toBeInTheDocument());

    expect(grade().tagName).toBe('SELECT');
    // Younger-than-JK children fall under Shishu; school-age uses the grade ladder.
    expect(screen.getAllByRole('option', { name: 'Shishu (younger than JK)' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: 'JK' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: 'Grade 1' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: 'Grade 12' }).length).toBeGreaterThan(0);
  });
});

describe('CompleteProfileForm — Save always gives feedback (issue #18 #4)', () => {
  it('keeps Save enabled on load and surfaces inline errors + a toast on an incomplete submit', async () => {
    // Missing foodAllergies + volunteeringSkills → two fillable inputs render.
    getFamily.mockResolvedValue(family([adult({ foodAllergies: null, volunteeringSkills: [] })]));
    const user = userEvent.setup();
    render(<CompleteProfileForm />);
    await waitFor(() => expect(screen.getAllByTestId('member-card-CMT-1-01').length).toBeGreaterThan(0));

    // Always clickable (the prior disabled button gave NO feedback).
    expect(save()).toBeEnabled();

    await user.click(save());

    // No write, no navigation — just inline errors + a guiding toast.
    expect(patchMember).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/highlighted fields/i));
  });

  it('rejects a malformed email with an inline error and no write, then saves once fixed', async () => {
    getFamily.mockResolvedValue(family([adult({ email: null })])); // only email missing
    patchMember.mockResolvedValue({ ok: true, status: 200 });
    const user = userEvent.setup();
    render(<CompleteProfileForm />);

    const emailInput = () => screen.getAllByLabelText(/Email for PC/i)[0]! as HTMLInputElement;
    await waitFor(() => expect(emailInput()).toBeInTheDocument());

    // 'a@b' passes the browser's type=email check (so submit fires) but fails our
    // stricter no-TLD check — which is what mirrors the server's z.string().email()
    // and stops a silent 400 from blocking the redirect to the dashboard.
    await user.type(emailInput(), 'a@b');
    await user.click(save());
    expect(patchMember).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByText(/valid email/i).length).toBeGreaterThan(0));

    await user.clear(emailInput());
    await user.type(emailInput(), 'pc@example.com');
    await user.click(save());
    await waitFor(() => expect(patchMember).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/family'));
  });
});

describe('CompleteProfileForm — submit flow', () => {
  it('completes an adult, PATCHes, and hard-navigates to the dashboard', async () => {
    getFamily.mockResolvedValue(family([adult({ foodAllergies: null, volunteeringSkills: [] })]));
    patchMember.mockResolvedValue({ ok: true, status: 200 });
    const user = userEvent.setup();
    render(<CompleteProfileForm />);
    await waitFor(() => expect(screen.getAllByTestId('member-card-CMT-1-01').length).toBeGreaterThan(0));

    await user.click(screen.getAllByRole('checkbox', { name: /No known allergies/i })[0]!);
    await user.click(screen.getAllByTestId('skills-add')[0]!);
    await user.click(save());

    await waitFor(() => expect(patchMember).toHaveBeenCalledTimes(1));
    const [mid, body] = patchMember.mock.calls[0]!;
    expect(mid).toBe('CMT-1-01');
    expect(body).toMatchObject({ foodAllergies: 'None', volunteeringSkills: ['Kitchen'] });
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/family'));
  });

  it('surfaces a friendly toast and does NOT navigate when a PATCH fails', async () => {
    getFamily.mockResolvedValue(family([adult({ foodAllergies: null, volunteeringSkills: [] })]));
    patchMember.mockResolvedValue({ ok: false, status: 400, error: 'contact-required' });
    const user = userEvent.setup();
    render(<CompleteProfileForm />);
    await waitFor(() => expect(screen.getAllByTestId('member-card-CMT-1-01').length).toBeGreaterThan(0));

    await user.click(screen.getAllByRole('checkbox', { name: /No known allergies/i })[0]!);
    await user.click(screen.getAllByTestId('skills-add')[0]!);
    await user.click(save());

    await waitFor(() => expect(patchMember).toHaveBeenCalled());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/email and a phone/i)));
    expect(navigateTo).not.toHaveBeenCalled();
  });

  // Manager scope is the WHOLE family: every incomplete member must be PATCHed and
  // the form must hard-navigate exactly ONCE (the shape that stranded a real
  // 3-person family on "Saving…").
  it('manager scope (N>1): completes every member, then hard-navigates exactly once', async () => {
    const a = adult({ foodAllergies: null, volunteeringSkills: [] });
    const b = adult({ mid: 'CMT-1-03', firstName: 'Co', foodAllergies: null, volunteeringSkills: [] });
    getFamily.mockResolvedValue(family([a, b]));
    patchMember.mockResolvedValue({ ok: true, status: 200 });
    const user = userEvent.setup();
    render(<CompleteProfileForm />);

    await waitFor(() => expect(screen.getAllByTestId('member-card-CMT-1-01').length).toBeGreaterThan(0));

    // Complete member 1 (PC) — its card STAYS (frozen), so target by card.
    await user.click(screen.getAllByRole('checkbox', { name: /No known allergies for PC/i })[0]!);
    await user.click(within(screen.getAllByTestId('member-card-CMT-1-01')[0]!).getByTestId('skills-add'));

    // Member 2 still incomplete → submit gives feedback, no write yet.
    await user.click(save());
    expect(patchMember).not.toHaveBeenCalled();

    // Complete member 2 (Co).
    await user.click(screen.getAllByRole('checkbox', { name: /No known allergies for Co/i })[0]!);
    await user.click(within(screen.getAllByTestId('member-card-CMT-1-03')[0]!).getByTestId('skills-add'));
    await user.click(save());

    await waitFor(() => expect(patchMember).toHaveBeenCalledTimes(2));
    expect(patchMember.mock.calls.map((c) => c[0]).sort()).toEqual(['CMT-1-01', 'CMT-1-03']);
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/family'));
    expect(navigateTo).toHaveBeenCalledTimes(1);
  });

  // A member missing an UNFILLABLE field (firstName/lastName/type have no input)
  // must not strand the user: explain it, and on Save toast that a sevak is needed
  // rather than navigating into a gate bounce.
  it('explains an unfillable missing field and never navigates', async () => {
    getFamily.mockResolvedValue(family([adult({ firstName: '' })])); // only firstName missing
    const user = userEvent.setup();
    render(<CompleteProfileForm />);
    await waitFor(() => expect(screen.getAllByTestId('member-card-CMT-1-01').length).toBeGreaterThan(0));

    expect(screen.getAllByTestId('member-unfillable-CMT-1-01').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/can't be edited here/i).length).toBeGreaterThan(0);

    await user.click(save());
    expect(patchMember).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/sevak/i)));
  });

  it('redirects straight to the dashboard when everything in scope is already complete', async () => {
    getFamily.mockResolvedValue(family([adult()])); // fully complete
    render(<CompleteProfileForm />);
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/family'));
    expect(screen.queryByTestId('member-card-CMT-1-01')).toBeNull();
  });
});
