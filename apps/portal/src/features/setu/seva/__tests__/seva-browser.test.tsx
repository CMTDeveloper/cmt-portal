import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SevaOppView, SevaMySignup } from '../seva-browser-client';

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: new Proxy({}, { get: () => () => <span data-testid="icon" /> }),
}));

const clientMock = vi.hoisted(() => ({
  fetchOpportunities: vi.fn(),
  fetchMySignups: vi.fn(),
  signUp: vi.fn(),
  cancelSignup: vi.fn(),
}));
vi.mock('../seva-browser-client', () => clientMock);

import { SevaBrowser } from '../seva-browser';

function makeOpp(overrides: Partial<SevaOppView> = {}): SevaOppView {
  return {
    oppId: 'opp-1',
    title: 'Diwali hall setup',
    description: 'Help set up the hall',
    date: '2025-11-01T04:00:00.000Z',
    location: 'Brampton',
    defaultHours: 4,
    capacity: 10,
    sevaYear: '2025-26',
    status: 'open',
    mySignupStatus: null,
    spotsLeft: 5,
    ...overrides,
  };
}

const members = [
  { mid: 'm1', name: 'Asha Rao' },
  { mid: 'm2', name: 'Dev Rao' },
];

beforeEach(() => {
  vi.clearAllMocks();
  clientMock.fetchOpportunities.mockResolvedValue({
    opportunities: [],
    currentSevaYear: '2025-26',
    hoursPerYear: 20,
  });
  clientMock.fetchMySignups.mockResolvedValue([]);
  clientMock.signUp.mockResolvedValue({ ok: true });
  clientMock.cancelSignup.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SevaBrowser', () => {
  it('renders the goal header with earned progress against the target', () => {
    render(
      <SevaBrowser
        currentSevaYear="2025-26"
        hoursPerYear={20}
        hoursEarned={6}
        initialOpportunities={[]}
        initialMySignups={[]}
        members={members}
      />,
    );
    expect(screen.getByText(/6 of 20/)).toBeInTheDocument();
    expect(screen.getByText(/hours of seva this year/i)).toBeInTheDocument();
  });

  it('renders an open opportunity title from the initial list', () => {
    render(
      <SevaBrowser
        currentSevaYear="2025-26"
        hoursPerYear={20}
        hoursEarned={0}
        initialOpportunities={[makeOpp()]}
        initialMySignups={[]}
        members={members}
      />,
    );
    expect(screen.getByText('Diwali hall setup')).toBeInTheDocument();
  });

  it('shows a Completed indicator and no Sign up button for a completed opportunity', () => {
    render(
      <SevaBrowser
        currentSevaYear="2025-26"
        hoursPerYear={20}
        hoursEarned={4}
        initialOpportunities={[makeOpp({ mySignupStatus: 'completed' })]}
        initialMySignups={[]}
        members={members}
      />,
    );
    expect(screen.getByText(/^completed$/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^sign up$/i })).not.toBeInTheDocument();
  });

  it('lists a completed signup with its awarded hours and no Cancel button', () => {
    render(
      <SevaBrowser
        currentSevaYear="2025-26"
        hoursPerYear={20}
        hoursEarned={4}
        initialOpportunities={[]}
        initialMySignups={[
          {
            signupId: 'sig-done',
            oppId: 'opp-1',
            mid: null,
            status: 'completed',
            hoursAwarded: 4,
            signedUpAt: '2025-10-15T04:00:00.000Z',
            opportunity: { title: 'Diwali hall setup', date: '2025-11-01T04:00:00.000Z', defaultHours: 4 },
          } satisfies SevaMySignup,
        ]}
        members={members}
      />,
    );
    expect(screen.getByText('Diwali hall setup')).toBeInTheDocument();
    expect(screen.getByText(/4 hrs/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  it('still shows Cancel for a signed-up entry under My sign-ups', () => {
    render(
      <SevaBrowser
        currentSevaYear="2025-26"
        hoursPerYear={20}
        hoursEarned={0}
        initialOpportunities={[]}
        initialMySignups={[
          {
            signupId: 'sig-1',
            oppId: 'opp-1',
            mid: null,
            status: 'signed-up',
            hoursAwarded: 0,
            signedUpAt: '2025-10-15T04:00:00.000Z',
            opportunity: { title: 'Diwali hall setup', date: '2025-11-01T04:00:00.000Z', defaultHours: 4 },
          } satisfies SevaMySignup,
        ]}
        members={members}
      />,
    );
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('signs up for the whole family when the member select is left on "Whole family"', async () => {
    const user = userEvent.setup();
    render(
      <SevaBrowser
        currentSevaYear="2025-26"
        hoursPerYear={20}
        hoursEarned={0}
        initialOpportunities={[makeOpp()]}
        initialMySignups={[]}
        members={members}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^sign up$/i }));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(clientMock.signUp).toHaveBeenCalledWith('opp-1', null);
    });
  });

  it('cancels an existing signup after confirm', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(
      <SevaBrowser
        currentSevaYear="2025-26"
        hoursPerYear={20}
        hoursEarned={0}
        initialOpportunities={[makeOpp({ mySignupStatus: 'signed-up' })]}
        initialMySignups={[
          {
            signupId: 'sig-1',
            oppId: 'opp-1',
            mid: null,
            status: 'signed-up',
            hoursAwarded: 0,
            signedUpAt: '2025-10-15T04:00:00.000Z',
            opportunity: { title: 'Diwali hall setup', date: '2025-11-01T04:00:00.000Z', defaultHours: 4 },
          } satisfies SevaMySignup,
        ]}
        members={members}
      />,
    );

    const cancelButtons = screen.getAllByRole('button', { name: /^cancel$/i });
    await user.click(cancelButtons[0]!);

    await waitFor(() => {
      expect(clientMock.cancelSignup).toHaveBeenCalledWith('sig-1');
    });
  });

  it('shows "Full" and disables sign-up when spotsLeft is 0', () => {
    render(
      <SevaBrowser
        currentSevaYear="2025-26"
        hoursPerYear={20}
        hoursEarned={0}
        initialOpportunities={[makeOpp({ spotsLeft: 0, capacity: 10 })]}
        initialMySignups={[]}
        members={members}
      />,
    );
    const fullBtn = screen.getByRole('button', { name: /^full$/i });
    expect(fullBtn).toBeDisabled();
  });

  it('renders the empty state when there is no current seva year', () => {
    render(
      <SevaBrowser
        currentSevaYear={null}
        hoursPerYear={20}
        hoursEarned={0}
        initialOpportunities={[]}
        initialMySignups={[]}
        members={members}
      />,
    );
    expect(screen.getByText(/no seva opportunities/i)).toBeInTheDocument();
  });
});
