import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FamilyPrasadView, MoveOption } from '../family-assignment';

// vi.hoisted so the hoisted vi.mock factories can reference these mocks.
const { fetchMoveOptions, movePrasad, confirmPrasad, refresh, toastSuccess, toastError } = vi.hoisted(() => ({
  fetchMoveOptions: vi.fn(),
  movePrasad: vi.fn(),
  confirmPrasad: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../prasad-client', () => ({ fetchMoveOptions, movePrasad, confirmPrasad }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@cmt/ui', async () => {
  const actual = await vi.importActual<typeof import('@cmt/ui')>('@cmt/ui');
  return { ...actual, toast: { success: toastSuccess, error: toastError } };
});

import { FamilyPrasadCard } from '../family-prasad-card';

const baseAssignment: FamilyPrasadView = {
  paid: 'bv-brampton-2025-26-CMT-100',
  pid: 'bv-brampton-2025-26',
  date: '2026-03-22', // a Sunday
  youngestName: 'Aanya',
  birthMonth: 3,
  reason: 'birthday-month',
  status: 'assigned',
  movable: true,
};

const proposedAssignment: FamilyPrasadView = { ...baseAssignment, status: 'proposed' };

const moveOptions: MoveOption[] = [
  { date: '2026-03-29', seatsLeft: 3 },
  { date: '2026-04-05', seatsLeft: 1 },
];

beforeEach(() => {
  fetchMoveOptions.mockReset();
  movePrasad.mockReset();
  confirmPrasad.mockReset();
  refresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe('FamilyPrasadCard', () => {
  it('renders the formatted date and the birthday why-line', () => {
    render(<FamilyPrasadCard assignment={baseAssignment} />);
    // Date.UTC-based formatter must keep 2026-03-22 as Sunday Mar 22 (no TZ shift).
    expect(screen.getByText('Sun, Mar 22')).toBeTruthy();
    expect(screen.getByText("Aanya's birthday month 🎂")).toBeTruthy();
    expect(screen.getByText('Your prasad Sunday')).toBeTruthy();
  });

  it('falls back to the welcome-team why-line when not a birthday-month placement', () => {
    render(<FamilyPrasadCard assignment={{ ...baseAssignment, reason: 'spill', youngestName: null }} />);
    expect(screen.getByText('Assigned by the welcome team')).toBeTruthy();
    expect(screen.queryByText(/birthday month/)).toBeNull();
  });

  it('renders nothing when assignment is null', () => {
    const { container } = render(<FamilyPrasadCard assignment={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('hides the move button and shows the locked line when not movable', () => {
    render(<FamilyPrasadCard assignment={{ ...baseAssignment, movable: false }} />);
    expect(screen.queryByRole('button', { name: /move my date/i })).toBeNull();
    expect(screen.getByText(/Date locked/)).toBeTruthy();
  });

  it('opens the sheet, lists options, and confirms a move with the picked date', async () => {
    fetchMoveOptions.mockResolvedValue(moveOptions);
    movePrasad.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<FamilyPrasadCard assignment={baseAssignment} />);

    await user.click(screen.getByRole('button', { name: /move my date/i }));

    // Options load and render as radio rows with the seats-left badge.
    await waitFor(() => expect(screen.getByText('Sun, Mar 29')).toBeTruthy());
    expect(screen.getByText('3 spots left')).toBeTruthy();
    expect(screen.getByText('1 spot left')).toBeTruthy(); // singular form

    // Confirm is disabled until a date is picked.
    const confirm = screen.getByRole('button', { name: /confirm move/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    await user.click(screen.getByText('Sun, Mar 29'));
    expect(confirm.disabled).toBe(false);

    await user.click(confirm);
    await waitFor(() => expect(movePrasad).toHaveBeenCalledWith('2026-03-29'));
    expect(toastSuccess).toHaveBeenCalledWith('Prasad day moved');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('shows the target-full toast and reloads options on a target-full rejection', async () => {
    fetchMoveOptions.mockResolvedValue(moveOptions);
    movePrasad.mockRejectedValueOnce(new Error('target-full'));
    const user = userEvent.setup();
    render(<FamilyPrasadCard assignment={baseAssignment} />);

    await user.click(screen.getByRole('button', { name: /move my date/i }));
    await waitFor(() => expect(screen.getByText('Sun, Mar 29')).toBeTruthy());
    await user.click(screen.getByText('Sun, Mar 29'));
    await user.click(screen.getByRole('button', { name: /confirm move/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('That Sunday just filled up — pick another'));
    expect(refresh).not.toHaveBeenCalled();
    // Options are re-fetched (initial load + retry after the full target).
    await waitFor(() => expect(fetchMoveOptions).toHaveBeenCalledTimes(2));
  });

  it('shows the locked toast on a locked rejection', async () => {
    fetchMoveOptions.mockResolvedValue(moveOptions);
    movePrasad.mockRejectedValueOnce(new Error('locked'));
    const user = userEvent.setup();
    render(<FamilyPrasadCard assignment={baseAssignment} />);

    await user.click(screen.getByRole('button', { name: /move my date/i }));
    await waitFor(() => expect(screen.getByText('Sun, Mar 29')).toBeTruthy());
    await user.click(screen.getByText('Sun, Mar 29'));
    await user.click(screen.getByRole('button', { name: /confirm move/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Too close to your date to move it online — please contact the welcome team.',
      ),
    );
  });

  it('shows the generic toast on an unknown rejection', async () => {
    fetchMoveOptions.mockResolvedValue(moveOptions);
    movePrasad.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<FamilyPrasadCard assignment={baseAssignment} />);

    await user.click(screen.getByRole('button', { name: /move my date/i }));
    await waitFor(() => expect(screen.getByText('Sun, Mar 29')).toBeTruthy());
    await user.click(screen.getByText('Sun, Mar 29'));
    await user.click(screen.getByRole('button', { name: /confirm move/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not move your date. Please try again.'),
    );
  });

  it('renders the empty state when no Sundays have room', async () => {
    fetchMoveOptions.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<FamilyPrasadCard assignment={baseAssignment} />);

    await user.click(screen.getByRole('button', { name: /move my date/i }));
    await waitFor(() => expect(screen.getByText(/No other Sundays have room/)).toBeTruthy());
    expect((screen.getByRole('button', { name: /confirm move/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('omits the View details link in the expanded variant', () => {
    const { rerender } = render(<FamilyPrasadCard assignment={baseAssignment} />);
    expect(screen.getByText('View details →')).toBeTruthy();
    rerender(<FamilyPrasadCard assignment={baseAssignment} expanded />);
    expect(screen.queryByText('View details →')).toBeNull();
  });

  describe('proposed state', () => {
    it('renders the suggested heading with confirm + pick CTAs, no locked note, no Move button', () => {
      render(<FamilyPrasadCard assignment={proposedAssignment} />);
      expect(screen.getByText('Suggested prasad Sunday')).toBeTruthy();
      expect(screen.queryByText('Your prasad Sunday')).toBeNull();
      // Same date + why-line + blurb as the assigned state.
      expect(screen.getByText('Sun, Mar 22')).toBeTruthy();
      expect(screen.getByText("Aanya's birthday month 🎂")).toBeTruthy();
      expect(screen.getByText(/Bring prasad for the assembly/)).toBeTruthy();
      // Both CTAs present; assigned-state affordances absent.
      expect(screen.getByTestId('prasad-confirm')).toBeTruthy();
      expect(screen.getByRole('button', { name: /pick a different sunday/i })).toBeTruthy();
      expect(screen.queryByText(/Date locked/)).toBeNull();
      expect(screen.queryByRole('button', { name: /move my date/i })).toBeNull();
      // Compact variant keeps the details link.
      expect(screen.getByText('View details →')).toBeTruthy();
    });

    it('confirms in place: calls confirmPrasad(undefined), toasts, and refreshes', async () => {
      confirmPrasad.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<FamilyPrasadCard assignment={proposedAssignment} />);

      await user.click(screen.getByTestId('prasad-confirm'));

      await waitFor(() => expect(confirmPrasad).toHaveBeenCalledWith(undefined));
      expect(toastSuccess).toHaveBeenCalledWith('Prasad Sunday confirmed — thank you!');
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('shows the already-confirmed toast and re-enables on an already-confirmed rejection', async () => {
      confirmPrasad.mockRejectedValueOnce(new Error('already-confirmed'));
      const user = userEvent.setup();
      render(<FamilyPrasadCard assignment={proposedAssignment} />);

      const confirm = screen.getByTestId('prasad-confirm') as HTMLButtonElement;
      await user.click(confirm);

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Already confirmed.'));
      expect(refresh).not.toHaveBeenCalled();
      await waitFor(() => expect(confirm.disabled).toBe(false));
    });

    it('shows the generic confirm toast and re-enables on an unknown rejection', async () => {
      confirmPrasad.mockRejectedValueOnce(new Error('boom'));
      const user = userEvent.setup();
      render(<FamilyPrasadCard assignment={proposedAssignment} />);

      const confirm = screen.getByTestId('prasad-confirm') as HTMLButtonElement;
      await user.click(confirm);

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not confirm. Please try again.'));
      expect(refresh).not.toHaveBeenCalled();
      await waitFor(() => expect(confirm.disabled).toBe(false));
    });

    it('opens the choose sheet and confirms the picked Sunday via confirmPrasad(date)', async () => {
      fetchMoveOptions.mockResolvedValue(moveOptions);
      confirmPrasad.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<FamilyPrasadCard assignment={proposedAssignment} />);

      await user.click(screen.getByRole('button', { name: /pick a different sunday/i }));

      expect(screen.getByText('Pick your prasad Sunday')).toBeTruthy();
      expect(screen.queryByText('Move your prasad Sunday')).toBeNull();
      await waitFor(() => expect(screen.getByText('Sun, Mar 29')).toBeTruthy());

      const confirm = screen.getByRole('button', { name: /confirm this sunday/i }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);

      await user.click(screen.getByText('Sun, Mar 29'));
      expect(confirm.disabled).toBe(false);

      await user.click(confirm);
      await waitFor(() => expect(confirmPrasad).toHaveBeenCalledWith('2026-03-29'));
      expect(movePrasad).not.toHaveBeenCalled();
      expect(toastSuccess).toHaveBeenCalledWith('Prasad Sunday confirmed — thank you!');
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('maps already-confirmed in the choose sheet to the refresh-hint toast', async () => {
      fetchMoveOptions.mockResolvedValue(moveOptions);
      confirmPrasad.mockRejectedValueOnce(new Error('already-confirmed'));
      const user = userEvent.setup();
      render(<FamilyPrasadCard assignment={proposedAssignment} />);

      await user.click(screen.getByRole('button', { name: /pick a different sunday/i }));
      await waitFor(() => expect(screen.getByText('Sun, Mar 29')).toBeTruthy());
      await user.click(screen.getByText('Sun, Mar 29'));
      await user.click(screen.getByRole('button', { name: /confirm this sunday/i }));

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith('Already confirmed — refresh to see your date.'),
      );
      expect(refresh).not.toHaveBeenCalled();
    });

    it('shows the target-full toast and reloads options on a target-full rejection in the choose sheet', async () => {
      fetchMoveOptions.mockResolvedValue(moveOptions);
      confirmPrasad.mockRejectedValueOnce(new Error('target-full'));
      const user = userEvent.setup();
      render(<FamilyPrasadCard assignment={proposedAssignment} />);

      await user.click(screen.getByRole('button', { name: /pick a different sunday/i }));
      await waitFor(() => expect(screen.getByText('Sun, Mar 29')).toBeTruthy());
      await user.click(screen.getByText('Sun, Mar 29'));
      await user.click(screen.getByRole('button', { name: /confirm this sunday/i }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('That Sunday just filled up — pick another'));
      expect(refresh).not.toHaveBeenCalled();
      await waitFor(() => expect(fetchMoveOptions).toHaveBeenCalledTimes(2));
    });
  });
});
