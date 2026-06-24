import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SerializedOpportunity, SevaRequirement } from '../opportunities-client';

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: new Proxy({}, { get: () => () => <span data-testid="icon" /> }),
}));

const clientMock = vi.hoisted(() => ({
  listOpportunities: vi.fn(),
  createOpportunity: vi.fn(),
  updateOpportunity: vi.fn(),
  saveRequirement: vi.fn(),
}));
vi.mock('../opportunities-client', () => clientMock);

import { SevaManager } from '../seva-manager';

const reqWithYear: SevaRequirement = { hoursPerYear: 20, currentSevaYear: '2025-26' };

function makeOpp(overrides: Partial<SerializedOpportunity> = {}): SerializedOpportunity {
  return {
    oppId: 'opp-1',
    title: 'Diwali setup',
    description: 'Help set up the hall',
    date: '2025-11-01T04:00:00.000Z',
    location: 'Brampton',
    defaultHours: 4,
    capacity: 10,
    sevaYear: '2025-26',
    status: 'open',
    createdAt: '2025-10-01T04:00:00.000Z',
    updatedAt: '2025-10-01T04:00:00.000Z',
    createdBy: 'u1',
    updatedBy: 'u1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clientMock.listOpportunities.mockResolvedValue([]);
  clientMock.createOpportunity.mockResolvedValue({ ok: true, oppId: 'opp-new' });
  clientMock.updateOpportunity.mockResolvedValue({ ok: true });
  clientMock.saveRequirement.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SevaManager', () => {
  it('renders the current seva year and hours target', () => {
    render(
      <SevaManager
        initialRequirement={reqWithYear}
        initialOpportunities={[]}
        canEditRequirement={false}
      />,
    );
    expect(screen.getByText(/2025-26/)).toBeInTheDocument();
    expect(screen.getByText(/20 hrs \/ family \/ year/)).toBeInTheDocument();
  });

  it('renders an opportunity title from the initial list', () => {
    render(
      <SevaManager
        initialRequirement={reqWithYear}
        initialOpportunities={[makeOpp()]}
        canEditRequirement={false}
      />,
    );
    expect(screen.getAllByText('Diwali setup').length).toBeGreaterThan(0);
  });

  it('reveals the create form when "New opportunity" is clicked', async () => {
    const user = userEvent.setup();
    render(
      <SevaManager
        initialRequirement={reqWithYear}
        initialOpportunities={[]}
        canEditRequirement={false}
      />,
    );
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /new opportunity/i }));
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });

  it('calls createOpportunity with the entered values on submit', async () => {
    const user = userEvent.setup();
    render(
      <SevaManager
        initialRequirement={reqWithYear}
        initialOpportunities={[]}
        canEditRequirement={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: /new opportunity/i }));
    await user.type(screen.getByLabelText('Title'), 'Kitchen seva');
    await user.clear(screen.getByLabelText('Default hours'));
    await user.type(screen.getByLabelText('Default hours'), '3');
    // type=date input — set the value directly
    const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
    await user.type(dateInput, '2025-12-15');
    await user.click(screen.getByRole('button', { name: /create opportunity/i }));
    await waitFor(() => {
      expect(clientMock.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Kitchen seva', date: '2025-12-15', defaultHours: 3 }),
      );
    });
  });

  it('renders a "Compliance report" link to the compliance page', () => {
    render(
      <SevaManager
        initialRequirement={reqWithYear}
        initialOpportunities={[]}
        canEditRequirement={false}
      />,
    );
    const link = screen.getByRole('link', { name: /compliance report/i });
    expect(link).toHaveAttribute('href', '/welcome/seva/compliance');
  });

  it('renders a "View roster" link to the opportunity roster page', () => {
    render(
      <SevaManager
        initialRequirement={reqWithYear}
        initialOpportunities={[makeOpp()]}
        canEditRequirement={false}
      />,
    );
    const link = screen.getByRole('link', { name: /view roster/i });
    expect(link).toHaveAttribute('href', '/welcome/seva/opp-1');
  });

  it('closes an open opportunity via updateOpportunity', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const user = userEvent.setup();
    render(
      <SevaManager
        initialRequirement={reqWithYear}
        initialOpportunities={[makeOpp()]}
        canEditRequirement={false}
      />,
    );
    const closeButtons = screen.getAllByRole('button', { name: /^close$/i });
    await user.click(closeButtons[0]!);
    await waitFor(() => {
      expect(clientMock.updateOpportunity).toHaveBeenCalledWith('opp-1', { status: 'closed' });
    });
  });

  it('saves the requirement when editable', async () => {
    const user = userEvent.setup();
    render(
      <SevaManager
        initialRequirement={reqWithYear}
        initialOpportunities={[]}
        canEditRequirement
      />,
    );
    await user.click(screen.getByRole('button', { name: /edit requirement/i }));
    await user.clear(screen.getByLabelText('Hours per family per year'));
    await user.type(screen.getByLabelText('Hours per family per year'), '25');
    await user.click(screen.getByRole('button', { name: /save requirement/i }));
    await waitFor(() => {
      expect(clientMock.saveRequirement).toHaveBeenCalledWith(
        expect.objectContaining({ hoursPerYear: 25, currentSevaYear: '2025-26' }),
      );
    });
  });

  it('hides the requirement edit control when not editable', () => {
    render(
      <SevaManager
        initialRequirement={reqWithYear}
        initialOpportunities={[]}
        canEditRequirement={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /edit requirement/i })).not.toBeInTheDocument();
  });

  it('disables the "New opportunity" control when readOnly (viewing a past year)', () => {
    render(
      <SevaManager
        initialRequirement={reqWithYear}
        initialOpportunities={[]}
        canEditRequirement
        readOnly
      />,
    );
    expect(screen.getByText('Viewing a past year — read-only.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new opportunity/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /edit requirement/i })).toBeDisabled();
  });
});
