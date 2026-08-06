import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberEditForm, type MemberEditInitial } from '../member-edit-form';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@cmt/ui', () => ({
  SetuIcon: { x: () => <span>x</span>, back: () => <span>back</span> },
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/features/setu/members/volunteering-skills-picker', () => ({
  VolunteeringSkillsPicker: () => <div data-testid="skills" />,
}));
vi.mock('@/components/chrome/loading-om', () => ({ LoadingOm: () => <div data-testid="loading" /> }));

const PERMS = { canSetManagerFlag: true, canSetParticipation: true, canGraduate: true };

function member(overrides: Partial<MemberEditInitial> = {}): MemberEditInitial {
  return {
    mid: 'CMT-X-02',
    firstName: 'Divina',
    lastName: 'Matta',
    type: 'Child',
    gender: 'Female',
    schoolGrade: 'Grade 2',
    birthMonthYear: '2019-08',
    foodAllergies: null,
    email: null,
    phone: null,
    volunteeringSkills: [],
    manager: false,
    ...overrides,
  };
}

function renderForm(initial: MemberEditInitial | null, loading = false) {
  return render(
    <MemberEditForm
      initial={initial}
      loading={loading}
      permissions={PERMS}
      save={vi.fn(async () => new Response(null, { status: 200 }))}
      onSaved={vi.fn()}
      backHref="/back"
      heading="Edit member"
    />,
  );
}

// The form renders a mobile tree and a desktop tree, so every control appears
// twice in jsdom. Assert across ALL of them - checking only the first would
// pass while the phone showed something different, which this repo has shipped
// before.
const allergyBoxes = () => screen.getAllByTestId('no-allergies') as HTMLInputElement[];
const allergyInputs = () => screen.getAllByLabelText(/food allergies/i) as HTMLInputElement[];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MemberEditForm - seeding', () => {
  it('is already populated on the FIRST render after the member arrives', async () => {
    // Not cosmetic. Seeding in a useEffect renders the form empty for one frame
    // and only fills it after the effect commits - a visible flash for a real
    // person, and it broke two of the family screen's tests. Seeding happens
    // during render instead; this pins that the very first committed frame
    // already has the values.
    renderForm(member({ firstName: 'Divina' }));
    const names = screen.getAllByLabelText('First name') as HTMLInputElement[];
    expect(names.every((n) => n.value === 'Divina')).toBe(true);
  });

  it('shows the loading placeholder and no fields while the caller is loading', () => {
    renderForm(null, true);
    expect(screen.getAllByTestId('loading').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('no-allergies')).toBeNull();
  });

  // ── The one place the extraction is NOT byte-identical to the old page ─────
  //
  // The family page's old seeding effect never called setNoAllergies(false) in
  // its else-branch; the shared form does. That is a deliberate CHANGE, found
  // by review, and it fixes a latent false-negative in the dangerous direction:
  // if the same mounted form is handed a member with 'None' and then a
  // DIFFERENT member who has a real allergy, the stale ticked box would mask
  // the real allergy and blank the field. A false NEGATIVE on allergies is
  // worse than the false-positive incident that produced `recordedAllergy`.
  //
  // Neither the old code nor the new had a test for this, which is why the
  // divergence went unnoticed until Codex diffed the two files.
  it('re-seeds allergies when a DIFFERENT member is handed to the same form', () => {
    const { rerender } = renderForm(member({ mid: 'CMT-X-02', foodAllergies: 'None' }));
    expect(allergyBoxes().every((b) => b.checked)).toBe(true);

    rerender(
      <MemberEditForm
        initial={member({ mid: 'CMT-X-03', firstName: 'Aarav', foodAllergies: 'nuts, pollen' })}
        loading={false}
        permissions={PERMS}
        save={vi.fn(async () => new Response(null, { status: 200 }))}
        onSaved={vi.fn()}
        backHref="/back"
        heading="Edit member"
      />,
    );

    expect(allergyBoxes().every((b) => b.checked), 'stale "no known allergies" masked a real allergy').toBe(false);
    expect(allergyInputs().every((i) => i.value === 'nuts, pollen')).toBe(true);
  });

  it('does NOT re-seed when the same member is re-rendered with a fresh object', () => {
    // The guard is on the mid, not on `initial`'s identity, because callers
    // build it with a `.find()` and hand over a new object every render.
    // Without that, every keystroke would be discarded by the next re-render.
    const { rerender } = renderForm(member({ foodAllergies: 'nuts' }));
    fireEvent.change(allergyInputs()[0]!, { target: { value: 'peanuts specifically' } });

    rerender(
      <MemberEditForm
        initial={member({ foodAllergies: 'nuts' })}
        loading={false}
        permissions={PERMS}
        save={vi.fn(async () => new Response(null, { status: 200 }))}
        onSaved={vi.fn()}
        backHref="/back"
        heading="Edit member"
      />,
    );

    expect(allergyInputs()[0]!.value).toBe('peanuts specifically');
  });
});

describe('MemberEditForm - what each caller may offer', () => {
  it('hides the manager toggle on a Child even when the caller may set it', () => {
    // The server refuses `manager` on a Child (manager-must-be-adult), so the
    // control would only ever be a way to fail.
    renderForm(member({ type: 'Child' }));
    expect(screen.queryByTestId('manager-toggle')).toBeNull();
  });

  it('offers the manager toggle on an Adult when the caller may set it', () => {
    renderForm(member({ type: 'Adult', email: 'a@b.com', phone: '416-555-0100' }));
    expect(screen.getAllByTestId('manager-toggle').length).toBeGreaterThan(0);
  });

  it('withholds every optional control when the caller may offer none', () => {
    render(
      <MemberEditForm
        initial={member({ type: 'Adult' })}
        loading={false}
        permissions={{ canSetManagerFlag: false, canSetParticipation: false, canGraduate: false }}
        save={vi.fn(async () => new Response(null, { status: 200 }))}
        onSaved={vi.fn()}
        backHref="/back"
        heading="Edit member"
      />,
    );
    expect(screen.queryByTestId('manager-toggle')).toBeNull();
    expect(screen.queryByTestId('participation-section')).toBeNull();
    expect(screen.queryByTestId('graduation-section')).toBeNull();
  });

  it('offers graduation only for someone who LOADED as a Child', () => {
    renderForm(member({ type: 'Child' }));
    expect(screen.getAllByTestId('graduation-section').length).toBeGreaterThan(0);
  });

  it('does not offer graduation to someone who loaded as an Adult', () => {
    renderForm(member({ type: 'Adult' }));
    expect(screen.queryByTestId('graduation-section')).toBeNull();
  });
});
