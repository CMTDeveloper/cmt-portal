import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Feature flag ──────────────────────────────────────────────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── Next.js navigation ────────────────────────────────────────────────────────
const mockPush = vi.fn();
const mockBack = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useParams: () => ({ mid: 'FAMA0001ABCD-02' }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    style,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
    style?: React.CSSProperties;
  }) => (
    <a href={href} className={className} style={style}>
      {children}
    </a>
  ),
}));

// ── CMT UI ────────────────────────────────────────────────────────────────────
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuLogo: () => <div data-testid="setu-logo" />,
  SetuAvatar: ({ name }: { name: string }) => <div data-testid="setu-avatar">{name}</div>,
  SetuIcon: {
    back: () => <span>back</span>,
    x: () => <span>x</span>,
    edit: () => <span>edit</span>,
    trash: () => <span>trash</span>,
    check: () => <span>check</span>,
  },
  Rosette: () => <div />,
}));

// ── Chrome atoms ──────────────────────────────────────────────────────────────
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DesktopSidebar: ({ active }: { active: string }) => (
    <nav data-testid="desktop-sidebar" data-active={active} />
  ),
  FieldError: ({ message }: { message?: string }) =>
    message ? <span data-testid="field-error">{message}</span> : null,
}));

// ── Volunteering-skills picker ───────────────────────────────────────────────
// The real picker fetches /api/setu/volunteering-skills on mount, which would
// become fetchMock.mock.calls[0] and break the PATCH-body assertions below.
// It has its own test; stub it to a no-op here.
vi.mock('@/features/setu/members/volunteering-skills-picker', () => ({
  VolunteeringSkillsPicker: () => <div data-testid="volunteering-skills-picker" />,
}));

// ── getCurrentFamilyClient (data source for the edit page) ───────────────────
// The edit page calls getCurrentFamilyClient() (a fetch wrapper) rather than
// the server-only getCurrentFamily. Mocking the client wrapper is what the
// tests need now.
const mockGetCurrentFamily = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/get-current-family-client', () => ({
  getCurrentFamilyClient: mockGetCurrentFamily,
}));

// ── Fetch ─────────────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ── window.location ───────────────────────────────────────────────────────────
const mockAssign = vi.fn();
Object.defineProperty(window, 'location', {
  value: { href: '', assign: mockAssign },
  writable: true,
});

// ── Dialog / confirm mock ─────────────────────────────────────────────────────
vi.stubGlobal('confirm', vi.fn(() => true));

import EditMemberPage from '../page';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MANAGER_MID = 'FAMA0001ABCD-01';
const MEMBER_MID = 'FAMA0001ABCD-02';

// Gate-complete adult: required fields (gender, foodAllergies, email, phone,
// >=1 skill) are all present so existing submit tests pass the client gate.
const MEMBER_02 = {
  mid: MEMBER_MID,
  uid: null,
  firstName: 'Priya',
  lastName: 'Patel',
  type: 'Adult' as const,
  gender: 'Female' as const,
  manager: false,
  joinedAt: new Date('2024-09-01'),
  email: 'priya@example.com',
  phone: '4165559876',
  volunteeringSkills: ['Teaching'],
  foodAllergies: 'None',
  emergencyContacts: [
    { relation: 'Spouse', phone: '4165551234', email: 'raj@example.com' },
    null,
  ] as [{ relation: string; phone: string; email: string }, null],
  schoolGrade: null,
  birthMonthYear: null,
};

function makeCurrentFamily({
  isManager,
  currentMid,
  memberOverrides,
}: {
  isManager: boolean;
  currentMid: string;
  /** Reshape MEMBER_02 (the member being edited) per test. */
  memberOverrides?: Record<string, unknown>;
}) {
  return {
    family: {
      fid: 'FAMA0001ABCD',
      name: 'Patel',
      location: 'Brampton',
      managers: [MANAGER_MID],
    },
    members: [
      {
        mid: MANAGER_MID,
        firstName: 'Raj',
        lastName: 'Patel',
        type: 'Adult',
        gender: 'Male',
        manager: true,
        joinedAt: new Date('2024-09-01'),
        email: 'raj@example.com',
        phone: '4165551234',
        volunteeringSkills: [],
        foodAllergies: null,
        emergencyContacts: [null, null],
        schoolGrade: null,
        birthMonthYear: null,
      },
      { ...MEMBER_02, ...(memberOverrides ?? {}) },
    ],
    isManager,
    currentMid,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
  window.location.href = '';
  mockAssign.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Renders prefilled with existing member data
// ─────────────────────────────────────────────────────────────────────────────

describe('EditMemberPage — prefilled form', () => {
  it('renders with existing member first and last name prefilled', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));

    render(<EditMemberPage />);

    await waitFor(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('input');
      const values = Array.from(inputs).map((i) => i.value);
      expect(values).toContain('Priya');
      expect(values).toContain('Patel');
    });
  });

  it('prefills email for adult member', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));

    render(<EditMemberPage />);

    await waitFor(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('input');
      const values = Array.from(inputs).map((i) => i.value);
      expect(values).toContain('priya@example.com');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manager-edit shows manager toggle; self-edit hides it
// ─────────────────────────────────────────────────────────────────────────────

describe('EditMemberPage — manager toggle visibility', () => {
  it('manager editing another member sees manager toggle', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));

    render(<EditMemberPage />);

    await waitFor(() => {
      // manager toggle checkbox or button should be visible
      const managerToggle =
        document.querySelector('[data-testid="manager-toggle"]') ??
        screen.queryByRole('checkbox', { name: /manager/i }) ??
        screen.queryByRole('switch', { name: /manager/i });
      expect(managerToggle).not.toBeNull();
    });
  });

  it('non-manager editing own profile does NOT see manager toggle', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: false, currentMid: MEMBER_MID }));

    render(<EditMemberPage />);

    await waitFor(() => {
      const managerToggle =
        document.querySelector('[data-testid="manager-toggle"]') ??
        screen.queryByRole('checkbox', { name: /manager/i }) ??
        screen.queryByRole('switch', { name: /manager/i });
      expect(managerToggle).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Submit PATCH → navigate back to detail
// ─────────────────────────────────────────────────────────────────────────────

describe('EditMemberPage — successful PATCH submit', () => {
  it('PATCHes to /api/setu/members/:mid and navigates to member detail', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mid: MEMBER_MID }),
    });

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('input');
      expect(inputs.length).toBeGreaterThan(0);
    });

    const saveBtn = screen.getAllByRole('button', { name: /save|update/i })[0];
    expect(saveBtn).toBeDefined();
    await user.click(saveBtn!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/setu/members/${MEMBER_MID}`,
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith(`/family/members/${MEMBER_MID}`);
    });
  });

  it('self-edit PATCH does not include manager field in body', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: false, currentMid: MEMBER_MID }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mid: MEMBER_MID }),
    });

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll<HTMLInputElement>('input').length).toBeGreaterThan(0);
    });

    const saveBtn = screen.getAllByRole('button', { name: /save|update/i })[0];
    await user.click(saveBtn!);

    await waitFor(() => {
      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as Record<string, unknown>;
      // self-edit: manager field must not appear
      expect(body).not.toHaveProperty('manager');
      // string→array refactor: the member's existing skills array is sent
      // through verbatim (no comma-split), preloaded from member.volunteeringSkills.
      expect(body.volunteeringSkills).toEqual(['Teaching']);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No remove button - families disable, they do not delete (2026-08-04)
// ─────────────────────────────────────────────────────────────────────────────

describe('EditMemberPage — families cannot remove a member', () => {
  // Vaibhav, 2026-08-04: "please remove the button as we do not want families to
  // remove any members. At the very least, they can only disable."
  //
  // Asserted for a MANAGER, the only role that ever had the button - checking a
  // non-manager could not fail. The reversible control is asserted in the same
  // test: withdrawing the destructive one is only correct because the family
  // still has a way to say someone has stepped away.
  it('a manager editing another member sees no remove control, only the reversible one', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));

    render(<EditMemberPage />);

    // BOTH layout trees, not one: this screen renders mobile and desktop at the
    // same time, and the button being withdrawn was DESKTOP-ONLY - so a family
    // on a phone never had it, and the control that replaces it has to be
    // somewhere they can actually reach.
    await waitFor(() => {
      expect(screen.getAllByTestId('participation-section')).toHaveLength(2);
    });

    expect(
      screen.queryByRole('button', { name: /remove from family|remove member|delete/i }),
    ).toBeNull();
  });

  // The button is gone, so the call it made must be gone too. A handler left
  // wired to nothing is how a withdrawn feature comes back.
  it('never issues a DELETE from this screen', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole('button', { name: /save|update/i })[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as { method?: string } | undefined)?.method).not.toBe('DELETE');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 400 server error surfaces per-field
// ─────────────────────────────────────────────────────────────────────────────

describe('EditMemberPage — server validation errors', () => {
  it('surfaces per-field errors returned from server on 400', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'validation-error',
        fields: { email: 'Email already in use by another member.' },
      }),
    });

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    });

    const saveBtn = screen.getAllByRole('button', { name: /save|update/i })[0];
    await user.click(saveBtn!);

    await waitFor(() => {
      expect(
        screen.getAllByText(/email already in use/i).length,
      ).toBeGreaterThan(0);
    });
  });

  it('shows toast for generic server error (non-field 400)', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'bad-request' }),
    });

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    });

    const saveBtn = screen.getAllByRole('button', { name: /save|update/i })[0];
    await user.click(saveBtn!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Network error
// ─────────────────────────────────────────────────────────────────────────────

describe('EditMemberPage — network error', () => {
  it('shows toast.error on fetch throw during PATCH', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));
    fetchMock.mockRejectedValueOnce(new Error('net::ERR_FAILED'));

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    });

    const saveBtn = screen.getAllByRole('button', { name: /save|update/i })[0];
    await user.click(saveBtn!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/network error/i),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 when mid not in family
// ─────────────────────────────────────────────────────────────────────────────

describe('EditMemberPage — member not found', () => {
  it('calls notFound when mid is not in current family', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));

    // useParams returns a mid that isn't in the family
    vi.doMock('next/navigation', () => ({
      useRouter: () => ({ push: mockPush, back: mockBack }),
      useParams: () => ({ mid: 'FAMZ9999ZZZZ-99' }),
    }));

    // The page should handle the not-found case — render nothing or call notFound()
    // Since notFound() throws in Next.js, we expect the render not to show form fields
    render(<EditMemberPage />);

    await waitFor(() => {
      // The component either renders nothing or an error state for unknown mid
      const inputs = document.querySelectorAll('input');
      expect(inputs.length).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile-completion: gender has exactly Male|Female; foodAllergies shown for
// all members; legacy PreferNotToSay maps to no-selection; required blocks submit.
// ─────────────────────────────────────────────────────────────────────────────

function findGenderSelect(): HTMLSelectElement {
  const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('select'));
  const genderSelect = selects.find((s) =>
    Array.from(s.options).some((o) => o.value === 'Male'),
  );
  if (!genderSelect) throw new Error('gender select not found');
  return genderSelect;
}

describe('EditMemberPage — gender capture (Male|Female only)', () => {
  it('gender select offers exactly two real choices (no PreferNotToSay)', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));

    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    });

    const genderSelect = findGenderSelect();
    const values = Array.from(genderSelect.options).map((o) => o.value);
    // The empty placeholder ('') plus exactly Male + Female; never PreferNotToSay.
    expect(values).not.toContain('PreferNotToSay');
    expect(values.filter((v) => v !== '')).toEqual(['Male', 'Female']);
  });

  it('legacy PreferNotToSay member loads with no gender selected', async () => {
    const fam = makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID });
    // Mutate the edited member (MEMBER_02) to the legacy sentinel.
    (fam.members[1] as { gender: string }).gender = 'PreferNotToSay';
    mockGetCurrentFamily.mockResolvedValue(fam);

    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    });

    const genderSelect = findGenderSelect();
    expect(genderSelect.value).toBe('');
  });
});

describe('EditMemberPage — foodAllergies shown for all members', () => {
  it('renders the food allergies field for an adult member', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));

    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    });

    // Adult MEMBER_02 — the foodAllergies input must be present (it used to be
    // inside the Child-only block). Both mobile + desktop branches render it.
    expect(screen.getAllByLabelText(/food allergies/i).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('no-allergies').length).toBeGreaterThan(0);
  });

  it('ticks "No known allergies" for the stored sentinel', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({
      isManager: true, currentMid: MANAGER_MID,
      memberOverrides: { foodAllergies: 'None' },
    }));

    render(<EditMemberPage />);
    await waitFor(() => expect(document.querySelectorAll('input').length).toBeGreaterThan(0));

    const boxes = screen.getAllByTestId('no-allergies') as HTMLInputElement[];
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it('ticks the box for a hand-typed "n/a" too, and NORMALIZES it to the sentinel on save', async () => {
    // The display surfaces treat "n/a" as "no known allergies" (see
    // `recordedAllergy`), so the form has to agree - otherwise the portal tells
    // a family one thing everywhere and shows them an unticked box with "n/a"
    // in it here.
    //
    // The consequence is deliberate and worth stating plainly: saving ANY edit
    // on such a member rewrites the stored value from "n/a" to 'None'. The
    // meaning is identical and it makes their record match every other
    // family's, but it IS the form normalizing stored data, so it is pinned
    // here rather than left as a surprise. No production member holds such a
    // value today (all 104 hold exactly 'None', measured 2026-08-05).
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({
      isManager: true, currentMid: MANAGER_MID,
      memberOverrides: { foodAllergies: 'n/a' },
    }));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ mid: MEMBER_MID }) });

    const user = userEvent.setup();
    render(<EditMemberPage />);
    await waitFor(() => expect(document.querySelectorAll('input').length).toBeGreaterThan(0));

    const boxes = screen.getAllByTestId('no-allergies') as HTMLInputElement[];
    expect(boxes.every((b) => b.checked)).toBe(true);
    // The free-text box is cleared, so "n/a" is not shown back to them as if it
    // were an allergy they had recorded.
    for (const input of screen.getAllByLabelText(/food allergies/i) as HTMLInputElement[]) {
      expect(input.value).toBe('');
    }

    await user.click(screen.getAllByRole('button', { name: /save|update/i })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.foodAllergies).toBe('None');
  });
});

describe('EditMemberPage — per-type required blocks submit', () => {
  it('does NOT PATCH when a required adult field (phone) is cleared', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: false, currentMid: MEMBER_MID }));

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('input');
      expect(Array.from(inputs).map((i) => i.value)).toContain('4165559876');
    });

    // Clear the phone (a required adult field) → the form must block submit.
    const phoneInput = Array.from(document.querySelectorAll<HTMLInputElement>('input')).find(
      (i) => i.value === '4165559876',
    );
    expect(phoneInput).toBeDefined();
    await user.clear(phoneInput!);

    const saveBtn = screen.getAllByRole('button', { name: /save|update/i })[0];
    await user.click(saveBtn!);

    // No PATCH fires; an inline required marker appears instead (mobile + desktop).
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getAllByText(/phone is required for adults/i).length).toBeGreaterThan(0);
    });
  });
});

// ── Participation (production reports 2026-08-02) ────────────────────────────
// Vaibhav: "option for family to disable member who are no longer active, Not
// to delete as we loose history." Until this, the only thing on this screen for
// a member who had simply finished was "Remove from family".
//
// This is also the ONLY way BACK. /complete-profile can retire someone, but its
// Undo is a draft that is gone the moment they save.
describe('EditMemberPage — no longer participating', () => {
  it('offers the toggle to a manager editing someone else, on the PHONE as well as the desktop', async () => {
    // Not a detail: `removeButton` renders in the desktop tree ONLY, and most
    // families are on a phone. A retire control placed beside it would have
    // been invisible to the people who asked for it. Both trees render at once
    // in jsdom, so TWO nodes is the assertion that proves it.
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));
    render(<EditMemberPage />);
    await waitFor(() => expect(screen.getAllByTestId('participation-toggle').length).toBe(2));
  });

  it('is NOT offered on your own record', async () => {
    // Same rule /complete-profile uses: retiring yourself while signed in and
    // using the portal excuses your own required fields, it does not answer
    // anything about attendance.
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: false, currentMid: MEMBER_MID }));
    render(<EditMemberPage />);
    await waitFor(() => expect(document.querySelectorAll('input').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('participation-toggle')).toBeNull();
  });

  it('sends participation:"inactive" and keeps the member (no DELETE)', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const user = userEvent.setup();
    render(<EditMemberPage />);
    await waitFor(() => expect(screen.getAllByTestId('participation-toggle').length).toBeGreaterThan(0));

    await user.click(screen.getAllByTestId('participation-toggle')[0]!);
    await user.click(screen.getAllByRole('button', { name: /save|update/i })[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(`/api/setu/members/${MEMBER_MID}`);
    expect((init as RequestInit).method).toBe('PATCH'); // never DELETE - the history is the point
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ participation: 'inactive' });
  });

  it('sends participation:"active" when the family brings someone back', async () => {
    mockGetCurrentFamily.mockResolvedValue(
      makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID, memberOverrides: { participation: 'inactive' } }),
    );
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const user = userEvent.setup();
    render(<EditMemberPage />);
    // Seeded from the stored value, so it starts CHECKED.
    await waitFor(() => expect((screen.getAllByTestId('participation-toggle')[0] as HTMLInputElement).checked).toBe(true));

    await user.click(screen.getAllByTestId('participation-toggle')[0]!);
    await user.click(screen.getAllByRole('button', { name: /save|update/i })[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body));
    expect(body).toMatchObject({ participation: 'active' });
  });

  it('stops demanding required fields once the member is marked inactive', async () => {
    // A retired child with no grade: the form would otherwise block a save the
    // SERVER now accepts, on a field the portal has just promised to stop
    // asking for - and the family would have no way to record their answer.
    mockGetCurrentFamily.mockResolvedValue(
      makeCurrentFamily({
        isManager: true,
        currentMid: MANAGER_MID,
        memberOverrides: { type: 'Child', schoolGrade: null, birthMonthYear: null, email: null, phone: null, volunteeringSkills: [] },
      }),
    );
    const user = userEvent.setup();
    render(<EditMemberPage />);
    await waitFor(() => expect(screen.getAllByTestId('participation-toggle').length).toBeGreaterThan(0));

    // Incomplete child ⇒ the submit is blocked and nothing is written.
    await user.click(screen.getAllByRole('button', { name: /save|update/i })[0]!);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    await user.click(screen.getAllByTestId('participation-toggle')[0]!);
    await user.click(screen.getAllByRole('button', { name: /save|update/i })[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body)))
      .toMatchObject({ participation: 'inactive' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Graduation, and the manager toggle a child should never have been offered
// ─────────────────────────────────────────────────────────────────────────────

const CHILD_OVERRIDES = {
  type: 'Child' as const,
  schoolGrade: '12',
  birthMonthYear: '2008-04',
  email: null,
  phone: null,
  volunteeringSkills: [],
};

describe('EditMemberPage — graduated / not in school', () => {
  // Vaibhav, 2026-08-04: "for graduates or children who are no longer in school,
  // can we have a check box instead 'Graduated / Not In School' - so when that
  // is checked then, the child is converted to adult".
  it('offers the graduation checkbox on a CHILD record', async () => {
    mockGetCurrentFamily.mockResolvedValue(
      makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID, memberOverrides: CHILD_OVERRIDES }),
    );

    render(<EditMemberPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId('graduation-toggle').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/graduated \/ not in school/i).length).toBeGreaterThan(0);
  });

  it('does NOT offer it on an adult record', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));

    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('graduation-toggle')).toBeNull();
  });

  // The conversion IS the feature - the checkbox is a findable name for the
  // "Member type: Adult" toggle nobody was using. Asserted through the member
  // TYPE control rather than the checkbox's own state, so a checkbox wired to
  // nothing could not pass.
  it('ticking it switches the member to Adult, and says so before they save', async () => {
    mockGetCurrentFamily.mockResolvedValue(
      makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID, memberOverrides: CHILD_OVERRIDES }),
    );

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId('graduation-toggle').length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByTestId('graduation-toggle')[0]!);

    await waitFor(() => {
      expect(screen.getAllByText(/saved as an adult/i).length).toBeGreaterThan(0);
    });
  });
});

describe('EditMemberPage — the Family manager toggle', () => {
  // Vaibhav, 2026-08-04: "Child record should not have an option 'Family
  // manager'". The server has always refused it (manager-must-be-adult), so the
  // control was offering a click that could only come back as a 409.
  it('is hidden on a child record', async () => {
    mockGetCurrentFamily.mockResolvedValue(
      makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID, memberOverrides: CHILD_OVERRIDES }),
    );

    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('manager-toggle')).toBeNull();
  });

  it('is still offered on an adult record', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));

    render(<EditMemberPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId('manager-toggle').length).toBeGreaterThan(0);
    });
  });

  // Keyed on the LIVE type: a child who is being graduated in this same edit
  // becomes eligible, and a stale tick must never ride into a save the API
  // would reject.
  it('appears once a child is graduated to adult in the same edit', async () => {
    mockGetCurrentFamily.mockResolvedValue(
      makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID, memberOverrides: CHILD_OVERRIDES }),
    );

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId('graduation-toggle').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('manager-toggle')).toBeNull();

    await user.click(screen.getAllByTestId('graduation-toggle')[0]!);

    await waitFor(() => {
      expect(screen.getAllByTestId('manager-toggle').length).toBeGreaterThan(0);
    });
  });
});
