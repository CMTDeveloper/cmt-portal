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

describe('RegisterFamilyPage — successful submit', () => {
  it('posts to /api/setu/register and navigates to redirectTo', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectTo: '/family' }),
    });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    // Fill family name
    const textInputs = document.querySelectorAll('input[type="text"]');
    // First text input is family name
    await user.type(textInputs[0] as HTMLElement, 'Sharma');

    // Select Mississauga
    const msBtn = screen.getAllByRole('button', { name: 'Mississauga' });
    await user.click(msBtn[0]!);

    // Fill manager first + last name (inputs after family name)
    await user.type(textInputs[1] as HTMLElement, 'Priya');
    await user.type(textInputs[2] as HTMLElement, 'Sharma');

    // Submit
    const submitBtns = screen.getAllByRole('button', { name: /create family/i });
    await user.click(submitBtns[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/setu/register',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Sharma'),
        }),
      );
    });

    await waitFor(() => {
      expect(window.location.href).toBe('/family');
    });
  });

  it('posts email and phone from search params', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectTo: '/family' }),
    });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    const textInputs = document.querySelectorAll('input[type="text"]');
    await user.type(textInputs[0] as HTMLElement, 'Verma');

    const bBtn = screen.getAllByRole('button', { name: 'Brampton' });
    await user.click(bBtn[0]!);

    await user.type(textInputs[1] as HTMLElement, 'Amit');
    await user.type(textInputs[2] as HTMLElement, 'Verma');

    const submitBtns = screen.getAllByRole('button', { name: /create family/i });
    await user.click(submitBtns[0]!);

    await waitFor(() => {
      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as { email?: string; phone?: string };
      expect(body.email).toBe('raj@example.com');
      expect(body.phone).toBe('4165550100');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server validation errors surface as field errors
// ─────────────────────────────────────────────────────────────────────────────

describe('RegisterFamilyPage — server validation errors', () => {
  it('surfaces field errors returned from server', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'validation-error',
        fields: { familyName: 'Family name already taken.' },
      }),
    });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    const textInputs = document.querySelectorAll('input[type="text"]');
    await user.type(textInputs[0] as HTMLElement, 'Patel');

    const bBtn = screen.getAllByRole('button', { name: 'Brampton' });
    await user.click(bBtn[0]!);

    await user.type(textInputs[1] as HTMLElement, 'Raj');
    await user.type(textInputs[2] as HTMLElement, 'Patel');

    const submitBtns = screen.getAllByRole('button', { name: /create family/i });
    await user.click(submitBtns[0]!);

    await waitFor(() => {
      expect(screen.getAllByText(/family name already taken/i).length).toBeGreaterThan(0);
    });
  });

  it('shows the existing fallback toast for an unrecognized server error code', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'some-unmapped-code' }),
    });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    const textInputs = document.querySelectorAll('input[type="text"]');
    await user.type(textInputs[0] as HTMLElement, 'Patel');

    const bBtn = screen.getAllByRole('button', { name: 'Brampton' });
    await user.click(bBtn[0]!);

    await user.type(textInputs[1] as HTMLElement, 'Raj');
    await user.type(textInputs[2] as HTMLElement, 'Patel');

    const submitBtns = screen.getAllByRole('button', { name: /create family/i });
    await user.click(submitBtns[0]!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith('some-unmapped-code');
    });
  });

  it('shows friendly intra-family copy for duplicate-contact-in-form', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'duplicate-contact-in-form' }),
    });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    const textInputs = document.querySelectorAll('input[type="text"]');
    await user.type(textInputs[0] as HTMLElement, 'Patel');
    await user.click(screen.getAllByRole('button', { name: 'Brampton' })[0]!);
    await user.type(textInputs[1] as HTMLElement, 'Raj');
    await user.type(textInputs[2] as HTMLElement, 'Patel');

    await user.click(screen.getAllByRole('button', { name: /create family/i })[0]!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/same email or phone is entered for more than one family member/i),
      );
    });
  });

  it('shows friendly already-registered copy for duplicate-contact', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'duplicate-contact' }),
    });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    const textInputs = document.querySelectorAll('input[type="text"]');
    await user.type(textInputs[0] as HTMLElement, 'Patel');
    await user.click(screen.getAllByRole('button', { name: 'Brampton' })[0]!);
    await user.type(textInputs[1] as HTMLElement, 'Raj');
    await user.type(textInputs[2] as HTMLElement, 'Patel');

    await user.click(screen.getAllByRole('button', { name: /create family/i })[0]!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/already registered.*sign in/i),
      );
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

    // Click "Add another member"
    const addBtns = screen.getAllByRole('button', { name: /add another member/i });
    await user.click(addBtns[0]!);

    // Fill in member details
    const memberFirstInput = screen.getAllByLabelText(/member first name/i);
    const memberLastInput = screen.getAllByLabelText(/member last name/i);
    await user.type(memberFirstInput[0]!, 'Diya');
    await user.type(memberLastInput[0]!, 'Sharma');

    // Click Add member
    const addMemberBtns = screen.getAllByRole('button', { name: /^add member$/i });
    await user.click(addMemberBtns[0]!);

    await waitFor(() => {
      const rows = screen.getAllByTestId('added-member-row');
      expect(rows.some(r => r.textContent?.includes('Diya'))).toBe(true);
    });
  });

  it('can remove an added member', async () => {
    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    // Add a member
    const addBtns = screen.getAllByRole('button', { name: /add another member/i });
    await user.click(addBtns[0]!);

    const memberFirstInput = screen.getAllByLabelText(/member first name/i);
    const memberLastInput = screen.getAllByLabelText(/member last name/i);
    await user.type(memberFirstInput[0]!, 'Arjun');
    await user.type(memberLastInput[0]!, 'Sharma');

    const addMemberBtns = screen.getAllByRole('button', { name: /^add member$/i });
    await user.click(addMemberBtns[0]!);

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

  it('included additional members in POST body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectTo: '/family' }),
    });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    // Fill form
    const textInputs = document.querySelectorAll('input[type="text"]');
    await user.type(textInputs[0] as HTMLElement, 'Gupta');

    const bBtn = screen.getAllByRole('button', { name: 'Scarborough' });
    await user.click(bBtn[0]!);

    await user.type(textInputs[1] as HTMLElement, 'Sunita');
    await user.type(textInputs[2] as HTMLElement, 'Gupta');

    // Add additional member
    const addBtns = screen.getAllByRole('button', { name: /add another member/i });
    await user.click(addBtns[0]!);

    const memberFirstInput = screen.getAllByLabelText(/member first name/i);
    const memberLastInput = screen.getAllByLabelText(/member last name/i);
    await user.type(memberFirstInput[0]!, 'Rahul');
    await user.type(memberLastInput[0]!, 'Gupta');

    const addMemberBtns = screen.getAllByRole('button', { name: /^add member$/i });
    await user.click(addMemberBtns[0]!);

    const submitBtns = screen.getAllByRole('button', { name: /create family/i });
    await user.click(submitBtns[0]!);

    await waitFor(() => {
      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as {
        additionalMembers?: Array<{ firstName: string }>;
      };
      expect(body.additionalMembers?.some(m => m.firstName === 'Rahul')).toBe(true);
    });
  });

  it("includes a member's email and phone in the POST body", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ redirectTo: '/family' }) });

    const user = userEvent.setup();
    render(<RegisterFamilyPage />);

    const textInputs = document.querySelectorAll('input[type="text"]');
    await user.type(textInputs[0] as HTMLElement, 'Gupta');
    await user.click(screen.getAllByRole('button', { name: 'Brampton' })[0]!);
    await user.type(textInputs[1] as HTMLElement, 'Sunita');
    await user.type(textInputs[2] as HTMLElement, 'Gupta');

    await user.click(screen.getAllByRole('button', { name: /add another member/i })[0]!);
    await user.type(screen.getAllByLabelText(/member first name/i)[0]!, 'Anil');
    await user.type(screen.getAllByLabelText(/member last name/i)[0]!, 'Gupta');
    await user.type(screen.getAllByLabelText(/member email/i)[0]!, 'anil@example.com');
    await user.type(screen.getAllByLabelText(/member phone/i)[0]!, '4165559999');
    await user.click(screen.getAllByRole('button', { name: /^add member$/i })[0]!);

    await user.click(screen.getAllByRole('button', { name: /create family/i })[0]!);

    await waitFor(() => {
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
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

    await user.click(screen.getAllByRole('button', { name: /add another member/i })[0]!);
    await user.type(screen.getAllByLabelText(/member first name/i)[0]!, 'Bad');
    await user.type(screen.getAllByLabelText(/member last name/i)[0]!, 'Email');
    await user.type(screen.getAllByLabelText(/member email/i)[0]!, 'not-an-email');
    await user.click(screen.getAllByRole('button', { name: /^add member$/i })[0]!);

    await waitFor(() => {
      expect(screen.getAllByText(/valid email/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('added-member-row')).toBeNull();
  });
});
