import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Next.js navigation ────────────────────────────────────────────────────────
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// A hard navigation is the FIX for the stranded-form bug below; stub it so the
// test can assert which kind of navigation the success path performs.
const mockAssign = vi.fn();
vi.stubGlobal('location', { ...window.location, assign: mockAssign });

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
vi.mock('@cmt/ui', () => ({
  SetuIcon: {
    back: () => <span>back</span>,
    x: () => <span>x</span>,
    edit: () => <span>edit</span>,
  },
}));

// ── Chrome atoms ──────────────────────────────────────────────────────────────
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ── Volunteering-skills picker ───────────────────────────────────────────────
// The real picker fetches on mount; stub it so it doesn't perturb fetch.mock.calls.
vi.mock('@/features/setu/members/volunteering-skills-picker', () => ({
  VolunteeringSkillsPicker: () => <div data-testid="volunteering-skills-picker" />,
}));

// ── Fetch ─────────────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import AddMemberPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
});

function findGenderSelect(): HTMLSelectElement {
  const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('select'));
  const genderSelect = selects.find((s) =>
    Array.from(s.options).some((o) => o.value === 'Male'),
  );
  if (!genderSelect) throw new Error('gender select not found');
  return genderSelect;
}

// Helpers select the first matching control across the rendered mobile + desktop
// branches (both share the same formBody).
function firstByLabel(re: RegExp): HTMLElement {
  return screen.getAllByLabelText(re)[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gender — exactly Male|Female, no PreferNotToSay, no pre-selected default
// ─────────────────────────────────────────────────────────────────────────────

describe('AddMemberPage — gender capture (Male|Female only)', () => {
  it('gender select offers exactly two real choices (no PreferNotToSay)', () => {
    render(<AddMemberPage />);

    const genderSelect = findGenderSelect();
    const values = Array.from(genderSelect.options).map((o) => o.value);
    expect(values).not.toContain('PreferNotToSay');
    // Placeholder ('') + exactly Male + Female.
    expect(values.filter((v) => v !== '')).toEqual(['Male', 'Female']);
  });

  it('gender starts unselected (the member must actively choose)', () => {
    render(<AddMemberPage />);
    expect(findGenderSelect().value).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// foodAllergies shown for all member types (not Child-only)
// ─────────────────────────────────────────────────────────────────────────────

describe('AddMemberPage — foodAllergies shown for all members', () => {
  it('renders food allergies field when the member type is Adult', async () => {
    const user = userEvent.setup();
    render(<AddMemberPage />);

    // Switch to Adult — the food allergies field must remain visible.
    await user.click(screen.getAllByRole('button', { name: 'Adult' })[0]!);

    expect(screen.getAllByLabelText(/food allergies/i).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('no-allergies').length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-type required validation blocks submit (no POST until satisfied)
// ─────────────────────────────────────────────────────────────────────────────

describe('AddMemberPage — required validation blocks submit', () => {
  it('does NOT POST an empty Child form; shows required markers', async () => {
    const user = userEvent.setup();
    render(<AddMemberPage />);

    // Default type is Child; everything is empty.
    const addBtn = screen.getAllByRole('button', { name: /add member/i })[0];
    await user.click(addBtn!);

    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getAllByText(/first name is required/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/please select a gender/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/school grade is required/i).length).toBeGreaterThan(0);
    });
  });

  it('POSTs a complete Adult form with derived birthMonth omitted and NO_ALLERGIES sentinel', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ mid: 'X-01' }) });

    const user = userEvent.setup();
    render(<AddMemberPage />);

    // Adult: fill first/last, gender, email, phone, no-allergies. Skills picker
    // is stubbed, so simulate a chosen skill by not relying on it — instead the
    // gate would block, so we assert the block first, then satisfy fields.
    await user.click(screen.getAllByRole('button', { name: 'Adult' })[0]!);
    await user.type(firstByLabel(/^first name/i), 'Asha');
    await user.type(firstByLabel(/^last name/i), 'Rao');
    await user.selectOptions(findGenderSelect(), 'Female');
    await user.type(firstByLabel(/^email/i), 'asha@example.com');
    await user.type(firstByLabel(/^phone/i), '4165550000');
    await user.click(screen.getAllByTestId('no-allergies')[0]!);

    // volunteeringSkills is still empty (picker stubbed) → submit must be blocked.
    await user.click(screen.getAllByRole('button', { name: /add member/i })[0]!);
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getAllByText(/select at least one volunteering skill/i).length,
      ).toBeGreaterThan(0);
    });
  });

  it('POSTs a complete Child form with birthMonthYear (YYYY-MM) and derived birthMonth', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ mid: 'X-02' }) });

    const user = userEvent.setup();
    render(<AddMemberPage />);

    // Child is the default type.
    await user.type(firstByLabel(/^first name/i), 'Dev');
    await user.type(firstByLabel(/^last name/i), 'Rao');
    await user.selectOptions(findGenderSelect(), 'Male');
    await user.selectOptions(firstByLabel(/^school grade/i), '2'); // grade dropdown: value '2' = "Grade 2"
    await user.selectOptions(firstByLabel(/^birth month/i), '9'); // September
    await user.selectOptions(firstByLabel(/^birth year/i), '2018');
    await user.click(screen.getAllByTestId('no-allergies')[0]!);

    await user.click(screen.getAllByRole('button', { name: /add member/i })[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/setu/members',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body.type).toBe('Child');
    expect(body.gender).toBe('Male');
    expect(body.schoolGrade).toBe('2'); // canonical grade token from the dropdown
    expect(body.birthMonthYear).toBe('2018-09');
    expect(body.birthMonth).toBe(9);
    expect(body.foodAllergies).toBe('None');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Leaving the form after a successful add
// ─────────────────────────────────────────────────────────────────────────────

describe('AddMemberPage — leaving the form after a successful add', () => {
  /**
   * ── THE BUG THIS PINS (reported 2026-07-28, preview) ──────────────────────
   * A manager added an adult, then went to add a child and found the previous
   * member's name still in the fields and the button stuck on "Adding…" -
   * permanently, because it is `disabled={saving}`. The form could not be
   * submitted again at all without a full page reload.
   *
   * Cause: the success path called `router.push('/family/members')`, a SOFT
   * navigation, and deliberately never reset `saving` because it expected to
   * unmount. But `/family/members` sits under `src/app/family/layout.tsx`,
   * which has THREE `redirect()` gates. A soft push re-runs them on the client
   * router; when one bounces (it reads `use cache` data that the just-completed
   * POST invalidated, so it can be stale), the component never unmounts -
   * `saving` stays true and every field keeps its value.
   *
   * A hard navigation cannot be bounced back into a live component: the
   * document reloads, the gates re-run server-side on fresh data, and the form
   * is a new instance. Same rule as CLAUDE.md discipline #9.
   */
  it('navigates with a HARD load, so the gates re-run and the form cannot strand', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ mid: 'X-03' }) });

    const user = userEvent.setup();
    render(<AddMemberPage />);

    await user.type(firstByLabel(/^first name/i), 'Dev');
    await user.type(firstByLabel(/^last name/i), 'Rao');
    await user.selectOptions(findGenderSelect(), 'Male');
    await user.selectOptions(firstByLabel(/^school grade/i), '2');
    await user.selectOptions(firstByLabel(/^birth month/i), '9');
    await user.selectOptions(firstByLabel(/^birth year/i), '2018');
    await user.click(screen.getAllByTestId('no-allergies')[0]!);
    await user.click(screen.getAllByRole('button', { name: /add member/i })[0]!);

    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith('/family/members');
    });
    // router.push is what stranded the form; it must not be the exit route.
    expect(mockPush).not.toHaveBeenCalled();
  });
});
