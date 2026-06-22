import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Feature flag ──────────────────────────────────────────────────────────────
const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── Next.js ───────────────────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({ children, href, className, style }: { children: React.ReactNode; href: string; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

// useSearchParams: return email + phone by default
const searchParamsMock = vi.hoisted(() => new URLSearchParams('email=raj%40example.com&phone=4165550100'));
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock,
}));

// ── CMT UI ────────────────────────────────────────────────────────────────────
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuLogo: () => <div data-testid="setu-logo" />,
  SetuAvatar: ({ name }: { name: string }) => <div data-testid="setu-avatar">{name}</div>,
  SetuIcon: {
    back: () => <span>back</span>,
    plus: () => <span>plus</span>,
    edit: () => <span>edit</span>,
  },
  Rosette: () => <div />,
}));

// ── Volunteering skills picker ──────────────────────────────────────────────
// The real picker fetches /api/setu/volunteering-skills in a mount useEffect,
// which would crash (no queued response) and corrupt the OTP fetch ordering the
// tests assert on. Stub it: no fetch, deterministic single-skill add via a
// testid'd button, idempotent so repeated clicks don't grow the array.
vi.mock('@/features/setu/members/volunteering-skills-picker', () => ({
  VolunteeringSkillsPicker: ({
    value,
    onChange,
  }: {
    value: string[];
    onChange: (next: string[]) => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="skills-add"
        onClick={() => {
          if (value.length === 0) onChange(['Teaching / Facilitation']);
        }}
      >
        Add skill
      </button>
      <span data-testid="skills-count">{value.length}</span>
    </div>
  ),
}));

// ── Chrome atoms ──────────────────────────────────────────────────────────────
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StepHeader: ({ step, of, label }: { step: number; of: number; label: string }) => (
    <div data-testid="step-header">Step {step} of {of} · {label}</div>
  ),
  AddedMemberRow: ({ name, type }: { name: string; type: string }) => (
    <div data-testid="added-member-row">{name} — {type}</div>
  ),
}));

// ── Fetch ─────────────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ── window.location ───────────────────────────────────────────────────────────
Object.defineProperty(window, 'location', {
  value: { href: '' },
  writable: true,
});

import RegisterFamilyPage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
  window.location.href = '';
});

// ── Flow helpers ────────────────────────────────────────────────────────────
// Registration is now OTP-gated: fill the form → submit emails a code →
// enter the code → verify-code returns a one-time grant → register creates the
// family. These helpers drive that 3-fetch flow.

type Json = { ok: boolean; status?: number; json: () => Promise<unknown> };

/** Queue: send-code 200, verify-code 200 {registrationGrant}, then `register`. */
function queueOtpThenRegister(register: Json) {
  fetchMock
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ registrationGrant: 'grant-xyz' }) })
    .mockResolvedValueOnce(register);
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  opts: { family: string; location: string; first: string; last: string },
) {
  // The form renders BOTH a mobile (block md:hidden) and desktop (hidden md:block)
  // tree, so every element is duplicated. Index [0] is the mobile copy; React
  // state is shared, so filling the mobile copy updates both. Mobile text-input
  // order: [0]=familyName, [1]=managerFirst, [2]=managerLast, [3]=managerFoodAllergies.
  const textInputs = document.querySelectorAll('input[type="text"]');
  await user.type(textInputs[0] as HTMLElement, opts.family);
  await user.click(screen.getAllByRole('button', { name: opts.location })[0]!);
  await user.type(textInputs[1] as HTMLElement, opts.first);
  await user.type(textInputs[2] as HTMLElement, opts.last);

  // Manager now requires gender + foodAllergies + >=1 volunteering skill before
  // submit is allowed. Fill them so the OTP flow can fire.
  await user.click(screen.getAllByRole('button', { name: 'Male' })[0]!);
  await user.type(textInputs[3] as HTMLElement, 'None known');
  await user.click(screen.getAllByTestId('skills-add')[0]!);
}

/** Click "Verify email & create family", wait for the code step to appear. */
async function submitToCodeStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /verify email & create family/i })[0]!);
  await waitFor(() => expect(screen.getAllByText(/enter your code/i).length).toBeGreaterThan(0));
}

/** Type the code and click "Verify & create my family". (Mobile + desktop trees
 *  both render, so every element is duplicated — pick the first.) */
async function enterCodeAndCreate(user: ReturnType<typeof userEvent.setup>, code = '123456') {
  await user.type(screen.getAllByLabelText(/6-digit verification code/i)[0]!, code);
  await user.click(screen.getAllByRole('button', { name: /verify & create my family/i })[0]!);
}

function registerCallBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/setu/register');
  return JSON.parse((call?.[1]?.body as string) ?? '{}');
}

/**
 * Open the add-member panel and fill a complete CHILD draft (least index-fragile:
 * no email/phone/skills picker, just grade + birth month + year). The add panel
 * renders in BOTH the mobile + desktop trees, and gender pills exist for both the
 * manager AND the draft — so for 'Male' the order is
 * [mobileManager, mobileDraft, desktopManager, desktopDraft] ⇒ draft is index [1].
 * Returns AFTER "Add member" is clicked (the draft is added to the list).
 */
async function addChildMember(
  user: ReturnType<typeof userEvent.setup>,
  opts: { first: string; last: string },
) {
  await user.click(screen.getAllByRole('button', { name: /add another member/i })[0]!);
  await user.type(screen.getAllByLabelText(/member first name/i)[0]!, opts.first);
  await user.type(screen.getAllByLabelText(/member last name/i)[0]!, opts.last);
  // Switch the draft to Child so grade + birth month/year inputs render.
  await user.click(screen.getAllByRole('button', { name: 'Child' })[0]!);
  // Draft gender pill is the second 'Male' (index [1]) — manager's is first.
  await user.click(screen.getAllByRole('button', { name: 'Male' })[1]!);
  await user.type(screen.getAllByLabelText(/member food allergies/i)[0]!, 'None known');
  await user.type(screen.getAllByLabelText(/member school grade/i)[0]!, 'Grade 3');
  await user.selectOptions(screen.getAllByLabelText(/birth month/i)[0]!, '3');
  await user.selectOptions(
    screen.getAllByLabelText(/birth year/i)[0]!,
    String(new Date().getFullYear() - 8),
  );
  await user.click(screen.getAllByRole('button', { name: /^add member$/i })[0]!);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flag-off: renders prototype
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterFamilyPage — flag off renders prototype', () => {
  it('renders static Patel prototype without calling fetch', () => {
    flagsMock.setuAuth = false;
    render(<RegisterFamilyPage />);

    // Static prototype shows Raj Patel
    expect(screen.getAllByText(/raj patel/i).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prototype "Create family & continue" links to /family', () => {
    flagsMock.setuAuth = false;
    render(<RegisterFamilyPage />);
    const links = screen.getAllByRole('link', { name: /create family/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]?.getAttribute('href')).toBe('/family');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real form — initial state
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterFamilyPage — initial state (flag on)', () => {
  it('shows Step 2 of 2 header', () => {
    render(<RegisterFamilyPage />);
    expect(screen.getAllByTestId('step-header').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/step 2 of 2/i).length).toBeGreaterThan(0);
  });

  it('shows family name input', () => {
    render(<RegisterFamilyPage />);
    const inputs = document.querySelectorAll('input[type="text"]');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('shows location buttons', () => {
    render(<RegisterFamilyPage />);
    expect(screen.getAllByRole('button', { name: 'Brampton' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Mississauga' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Scarborough' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Markham' }).length).toBeGreaterThan(0);
  });

  it('shows "Create family" submit button', () => {
    render(<RegisterFamilyPage />);
    const submitBtns = screen.getAllByRole('button', { name: /create family/i });
    expect(submitBtns.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation: missing required fields surfaces field errors
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterFamilyPage — client-side validation', () => {
  it('clicking submit without filling fields shows field error for family name', async () => {
    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    const submitBtns = screen.getAllByRole('button', { name: /create family/i });
    await user.click(submitBtns[0]!);

    await waitFor(() => {
      expect(screen.getAllByText(/family name is required/i).length).toBeGreaterThan(0);
    });

    // No fetch call since validation failed
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing location shows location error', async () => {
    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    // Fill family name but not location or manager
    const textInputs = document.querySelectorAll('input[type="text"]');
    await user.type(textInputs[0] as HTMLElement, 'Sharma');

    const submitBtns = screen.getAllByRole('button', { name: /create family/i });
    await user.click(submitBtns[0]!);

    await waitFor(() => {
      expect(screen.getAllByText(/please select a primary location/i).length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path submit
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterFamilyPage — successful submit (OTP-gated)', () => {
  it('clicking submit emails a code first (no register yet), then code → register → redirect', async () => {
    queueOtpThenRegister({ ok: true, json: async () => ({ redirectTo: '/family' }) });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);
    await fillForm(user, { family: 'Sharma', location: 'Mississauga', first: 'Priya', last: 'Sharma' });

    await submitToCodeStep(user);
    // The FIRST call is send-code — NOT register (the family isn't created yet).
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/setu/auth/send-code');
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/setu/register')).toBe(false);

    await enterCodeAndCreate(user);

    await waitFor(() => {
      const reg = fetchMock.mock.calls.find((c) => c[0] === '/api/setu/register');
      expect(reg).toBeTruthy();
      expect(reg?.[1]?.body as string).toContain('Sharma');
    });
    await waitFor(() => expect(window.location.href).toBe('/family'));
  });

  it('the register POST carries the email/phone from search params AND the grant', async () => {
    queueOtpThenRegister({ ok: true, json: async () => ({ redirectTo: '/family' }) });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);
    await fillForm(user, { family: 'Verma', location: 'Brampton', first: 'Amit', last: 'Verma' });
    await submitToCodeStep(user);
    await enterCodeAndCreate(user);

    await waitFor(() => {
      const body = registerCallBody();
      expect(body.email).toBe('raj@example.com');
      expect(body.phone).toBe('4165550100');
      expect(body.registrationGrant).toBe('grant-xyz');
    });
  });

  it('a wrong code shows an inline error and never calls register', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) }) // send-code
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'invalid-or-expired' }) }); // verify-code

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);
    await fillForm(user, { family: 'Sharma', location: 'Brampton', first: 'Priya', last: 'Sharma' });
    await submitToCodeStep(user);
    await enterCodeAndCreate(user, '000000');

    await waitFor(() => expect(screen.getAllByText(/invalid or expired/i).length).toBeGreaterThan(0));
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/setu/register')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server validation errors surface as field errors
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterFamilyPage — server validation errors (after OTP)', () => {
  it('surfaces field errors returned by register and returns to the form', async () => {
    queueOtpThenRegister({
      ok: false,
      status: 400,
      json: async () => ({ error: 'validation-error', fields: { familyName: 'Family name already taken.' } }),
    });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);
    await fillForm(user, { family: 'Patel', location: 'Brampton', first: 'Raj', last: 'Patel' });
    await submitToCodeStep(user);
    await enterCodeAndCreate(user);

    await waitFor(() => {
      expect(screen.getAllByText(/family name already taken/i).length).toBeGreaterThan(0);
    });
  });

  it('shows the fallback toast for an unrecognized register error code', async () => {
    queueOtpThenRegister({ ok: false, status: 409, json: async () => ({ error: 'some-unmapped-code' }) });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);
    await fillForm(user, { family: 'Patel', location: 'Brampton', first: 'Raj', last: 'Patel' });
    await submitToCodeStep(user);
    await enterCodeAndCreate(user);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('some-unmapped-code'));
  });

  it('shows friendly intra-family copy for duplicate-contact-in-form', async () => {
    queueOtpThenRegister({ ok: false, status: 409, json: async () => ({ error: 'duplicate-contact-in-form' }) });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);
    await fillForm(user, { family: 'Patel', location: 'Brampton', first: 'Raj', last: 'Patel' });
    await submitToCodeStep(user);
    await enterCodeAndCreate(user);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/same email or phone is entered for more than one family member/i),
      );
    });
  });

  it('shows friendly already-registered copy for duplicate-contact', async () => {
    queueOtpThenRegister({ ok: false, status: 409, json: async () => ({ error: 'duplicate-contact' }) });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);
    await fillForm(user, { family: 'Patel', location: 'Brampton', first: 'Raj', last: 'Patel' });
    await submitToCodeStep(user);
    await enterCodeAndCreate(user);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/already registered.*sign in/i));
    });
  });

  it('an expired grant (registration-unverified) prompts a resend', async () => {
    queueOtpThenRegister({ ok: false, status: 403, json: async () => ({ error: 'registration-unverified' }) });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);
    await fillForm(user, { family: 'Patel', location: 'Brampton', first: 'Raj', last: 'Patel' });
    await submitToCodeStep(user);
    await enterCodeAndCreate(user);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/verification expired.*resend/i));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Network error surfaces toast
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterFamilyPage — network error', () => {
  it('shows toast.error on fetch throw', async () => {
    fetchMock.mockRejectedValueOnce(new Error('net::ERR_FAILED'));

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    const textInputs = document.querySelectorAll('input[type="text"]');
    await user.type(textInputs[0] as HTMLElement, 'Iyer');

    const bBtn = screen.getAllByRole('button', { name: 'Markham' });
    await user.click(bBtn[0]!);

    await user.type(textInputs[1] as HTMLElement, 'Ravi');
    await user.type(textInputs[2] as HTMLElement, 'Iyer');

    // Manager matrix: gender + foodAllergies + >=1 skill, so submit actually
    // fires the (rejected) send-code fetch.
    await user.click(screen.getAllByRole('button', { name: 'Male' })[0]!);
    await user.type(textInputs[3] as HTMLElement, 'None known');
    await user.click(screen.getAllByTestId('skills-add')[0]!);

    const submitBtns = screen.getAllByRole('button', { name: /create family/i });
    await user.click(submitBtns[0]!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/network error/i));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Adding additional members
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterFamilyPage — additional members', () => {
  it('can add an additional member and it appears in the list', async () => {
    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    await addChildMember(user, { first: 'Diya', last: 'Sharma' });

    await waitFor(() => {
      const rows = screen.getAllByTestId('added-member-row');
      expect(rows.some(r => r.textContent?.includes('Diya'))).toBe(true);
    });
  });

  it('can remove an added member', async () => {
    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    await addChildMember(user, { first: 'Arjun', last: 'Sharma' });

    await waitFor(() => {
      expect(screen.getAllByTestId('added-member-row').some(r => r.textContent?.includes('Arjun'))).toBe(true);
    });

    // Remove the member
    const removeBtn = screen.getAllByRole('button', { name: /remove arjun/i });
    await user.click(removeBtn[0]!);

    await waitFor(() => {
      expect(screen.queryByText(/arjun/i)).toBeNull();
    });
  });

  it('included additional members in the register POST body', async () => {
    queueOtpThenRegister({ ok: true, json: async () => ({ redirectTo: '/family' }) });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);
    await addChildMember(user, { first: 'Rahul', last: 'Gupta' });
    await fillForm(user, { family: 'Gupta', location: 'Scarborough', first: 'Sunita', last: 'Gupta' });

    await submitToCodeStep(user);
    await enterCodeAndCreate(user);

    await waitFor(() => {
      const body = registerCallBody() as { additionalMembers?: Array<{ firstName: string }> };
      expect(body.additionalMembers?.some((m) => m.firstName === 'Rahul')).toBe(true);
    });
  });

  it("includes a member's email and phone in the register POST body", async () => {
    queueOtpThenRegister({ ok: true, json: async () => ({ redirectTo: '/family' }) });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);
    // This member must be an Adult so it carries email + phone. Adult drafts also
    // need gender + foodAllergies + >=1 skill before "Add member" is enabled.
    await user.click(screen.getAllByRole('button', { name: /add another member/i })[0]!);
    await user.type(screen.getAllByLabelText(/member first name/i)[0]!, 'Anil');
    await user.type(screen.getAllByLabelText(/member last name/i)[0]!, 'Gupta');
    // Draft gender pill is the second 'Male' (index [1]) — manager's is first.
    await user.click(screen.getAllByRole('button', { name: 'Male' })[1]!);
    await user.type(screen.getAllByLabelText(/member food allergies/i)[0]!, 'None known');
    await user.type(screen.getAllByLabelText(/member email/i)[0]!, 'anil@example.com');
    await user.type(screen.getAllByLabelText(/member phone/i)[0]!, '4165559999');
    // The draft skills stub is the second one (index [1]) — manager's is first.
    await user.click(screen.getAllByTestId('skills-add')[1]!);
    await user.click(screen.getAllByRole('button', { name: /^add member$/i })[0]!);

    await fillForm(user, { family: 'Gupta', location: 'Brampton', first: 'Sunita', last: 'Gupta' });
    await submitToCodeStep(user);
    await enterCodeAndCreate(user);

    await waitFor(() => {
      const body = registerCallBody() as {
        additionalMembers?: Array<{ firstName: string; email?: string; phone?: string }>;
      };
      const anil = body.additionalMembers?.find((m) => m.firstName === 'Anil');
      expect(anil?.email).toBe('anil@example.com');
      expect(anil?.phone).toBe('4165559999');
    });
  });

  it('blocks adding a member with an invalid email and does not add the row', async () => {
    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    // Fill EVERY other required Adult field so the ONLY blocker is the bad email:
    // the "Add member" button is enabled (the draft is otherwise complete — a
    // non-empty email string satisfies the matrix), and handleAddMember's regex
    // rejects the malformed address, so the row is never added.
    await user.click(screen.getAllByRole('button', { name: /add another member/i })[0]!);
    await user.type(screen.getAllByLabelText(/member first name/i)[0]!, 'Bad');
    await user.type(screen.getAllByLabelText(/member last name/i)[0]!, 'Email');
    await user.click(screen.getAllByRole('button', { name: 'Male' })[1]!);
    await user.type(screen.getAllByLabelText(/member food allergies/i)[0]!, 'None known');
    await user.type(screen.getAllByLabelText(/member phone/i)[0]!, '4165559999');
    await user.click(screen.getAllByTestId('skills-add')[1]!);
    await user.type(screen.getAllByLabelText(/member email/i)[0]!, 'not-an-email');
    await user.click(screen.getAllByRole('button', { name: /^add member$/i })[0]!);

    await waitFor(() => {
      expect(screen.getAllByText(/valid email/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('added-member-row')).toBeNull();
  });
});
