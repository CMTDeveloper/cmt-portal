import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RosterData, RosterRow } from '../roster-client';
import type { SerializedOpportunity } from '../opportunities-client';

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: new Proxy({}, { get: () => () => <span data-testid="icon" /> }),
}));

const clientMock = vi.hoisted(() => ({
  fetchRoster: vi.fn(),
  confirmSignup: vi.fn(),
}));
vi.mock('../roster-client', () => clientMock);

import { RosterManager } from '../roster-manager';

const opportunity: SerializedOpportunity = {
  oppId: 'opp-1',
  title: 'Diwali hall setup',
  description: 'Help set up the hall',
  date: '2025-11-01T04:00:00.000Z',
  location: 'Brampton',
  defaultHours: 3,
  capacity: 10,
  sevaYear: '2025-26',
  status: 'open',
  createdAt: '2025-10-01T04:00:00.000Z',
  updatedAt: '2025-10-01T04:00:00.000Z',
  createdBy: 'u1',
  updatedBy: 'u1',
};

function makeRow(overrides: Partial<RosterRow> = {}): RosterRow {
  return {
    signupId: 'sig-1',
    fid: 'CMT-100',
    familyName: 'Sharma',
    mid: 'm1',
    memberName: 'Ravi Sharma',
    status: 'signed-up',
    hoursAwarded: 0,
    signedUpAt: '2025-10-15T04:00:00.000Z',
    ...overrides,
  };
}

function makeData(rows: RosterRow[]): RosterData {
  return { opportunity, rows };
}

beforeEach(() => {
  vi.clearAllMocks();
  clientMock.fetchRoster.mockResolvedValue(makeData([makeRow()]));
  clientMock.confirmSignup.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RosterManager', () => {
  it('renders the opportunity title and each row family + member name', () => {
    render(<RosterManager initial={makeData([makeRow()])} />);
    expect(screen.getAllByText('Diwali hall setup').length).toBeGreaterThan(0);
    expect(screen.getByText('Sharma')).toBeInTheDocument();
    expect(screen.getByText(/Ravi Sharma/)).toBeInTheDocument();
  });

  it('shows Mark completed and No-show controls for a signed-up row', () => {
    render(<RosterManager initial={makeData([makeRow()])} />);
    expect(screen.getByRole('button', { name: /mark completed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /no-show/i })).toBeInTheDocument();
  });

  it('Mark completed reveals an hours input prefilled with defaultHours and confirms with that number', async () => {
    const user = userEvent.setup();
    render(<RosterManager initial={makeData([makeRow()])} />);

    await user.click(screen.getByRole('button', { name: /mark completed/i }));
    const hoursInput = screen.getByLabelText(/hours/i) as HTMLInputElement;
    expect(hoursInput.value).toBe('3');

    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(clientMock.confirmSignup).toHaveBeenCalledWith('sig-1', {
        status: 'completed',
        hoursAwarded: 3,
      });
    });
  });

  it('No-show confirms without an hoursAwarded key', async () => {
    const user = userEvent.setup();
    render(<RosterManager initial={makeData([makeRow()])} />);

    await user.click(screen.getByRole('button', { name: /no-show/i }));

    await waitFor(() => {
      expect(clientMock.confirmSignup).toHaveBeenCalledWith('sig-1', { status: 'no-show' });
    });
    const arg = clientMock.confirmSignup.mock.calls[0]![1] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('hoursAwarded');
  });

  it('shows Completed with hoursAwarded and an Edit affordance for a completed row', async () => {
    const user = userEvent.setup();
    render(
      <RosterManager
        initial={makeData([makeRow({ status: 'completed', hoursAwarded: 3 })])}
      />,
    );
    expect(screen.getByText(/Completed · 3 hrs/i)).toBeInTheDocument();
    const editBtn = screen.getByRole('button', { name: /edit/i });
    await user.click(editBtn);
    expect(screen.getByLabelText(/hours/i)).toBeInTheDocument();
  });

  it('re-reads the roster and toasts success after a confirm', async () => {
    const user = userEvent.setup();
    render(<RosterManager initial={makeData([makeRow()])} />);

    await user.click(screen.getByRole('button', { name: /no-show/i }));

    await waitFor(() => {
      expect(clientMock.fetchRoster).toHaveBeenCalledWith('opp-1');
      expect(toastMock.success).toHaveBeenCalled();
    });
  });

  it('maps not-confirmable to a family-cancelled error toast', async () => {
    const user = userEvent.setup();
    clientMock.confirmSignup.mockResolvedValue({ ok: false, error: 'not-confirmable' });
    render(<RosterManager initial={makeData([makeRow()])} />);

    await user.click(screen.getByRole('button', { name: /no-show/i }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/cancelled by the family/i),
      );
    });
  });

  it('shows a friendly empty state when there are no sign-ups', () => {
    render(<RosterManager initial={makeData([])} />);
    expect(screen.getByText(/no sign-ups yet/i)).toBeInTheDocument();
  });

  it('credits the right member name for a multi-row roster', () => {
    render(
      <RosterManager
        initial={makeData([
          makeRow({ signupId: 'sig-1', familyName: 'Sharma', memberName: 'Ravi Sharma' }),
          makeRow({ signupId: 'sig-2', familyName: 'Patel', memberName: 'Mira Patel', mid: 'm2' }),
        ])}
      />,
    );
    const sharma = screen.getByText('Sharma').closest('.card') as HTMLElement;
    expect(within(sharma).getByText(/Ravi Sharma/)).toBeInTheDocument();
    const patel = screen.getByText('Patel').closest('.card') as HTMLElement;
    expect(within(patel).getByText(/Mira Patel/)).toBeInTheDocument();
  });
});
