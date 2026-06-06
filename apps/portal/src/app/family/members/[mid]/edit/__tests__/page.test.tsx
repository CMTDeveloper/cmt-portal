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
Object.defineProperty(window, 'location', {
  value: { href: '' },
  writable: true,
});

// ── Dialog / confirm mock ─────────────────────────────────────────────────────
vi.stubGlobal('confirm', vi.fn(() => true));

import EditMemberPage from '../page';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MANAGER_MID = 'FAMA0001ABCD-01';
const MEMBER_MID = 'FAMA0001ABCD-02';

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
  phone: null,
  volunteeringSkills: ['Teaching'],
  foodAllergies: null,
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
}: {
  isManager: boolean;
  currentMid: string;
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
      MEMBER_02,
    ],
    isManager,
    currentMid,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
  window.location.href = '';
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
      expect(mockPush).toHaveBeenCalledWith(`/family/members/${MEMBER_MID}`);
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
// Remove button (managers only) → confirm dialog → DELETE → navigate to roster
// ─────────────────────────────────────────────────────────────────────────────

describe('EditMemberPage — remove member (manager-only)', () => {
  it('manager sees remove button; clicking it confirms then DELETEs', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      const removeBtn = screen.queryByRole('button', { name: /remove from family|remove member|delete/i });
      expect(removeBtn).not.toBeNull();
    });

    const removeBtn = screen.getAllByRole('button', { name: /remove from family|remove member|delete/i })[0];
    await user.click(removeBtn!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/setu/members/${MEMBER_MID}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/family/members');
    });
  });

  it('non-manager editing own profile does NOT see remove button', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: false, currentMid: MEMBER_MID }));

    render(<EditMemberPage />);

    await waitFor(() => {
      expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    });

    const removeBtn = screen.queryByRole('button', { name: /remove from family|remove member|delete/i });
    expect(removeBtn).toBeNull();
  });

  it('cancelling the confirm dialog does not call DELETE', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));
    vi.mocked(confirm).mockReturnValueOnce(false);

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /remove from family|remove member|delete/i })).not.toBeNull();
    });

    const removeBtn = screen.getAllByRole('button', { name: /remove from family|remove member|delete/i })[0];
    await user.click(removeBtn!);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
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

  it('shows last-manager error toast when trying to remove last manager', async () => {
    mockGetCurrentFamily.mockResolvedValue(makeCurrentFamily({ isManager: true, currentMid: MANAGER_MID }));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'last-manager' }),
    });

    const user = userEvent.setup();
    render(<EditMemberPage />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /remove from family|remove member|delete/i })).not.toBeNull();
    });

    const removeBtn = screen.getAllByRole('button', { name: /remove from family|remove member|delete/i })[0];
    await user.click(removeBtn!);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/last manager|cannot remove/i),
      );
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
