import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { fetchMigrationStatusClient } = vi.hoisted(() => ({
  fetchMigrationStatusClient: vi.fn(),
}));
vi.mock('../roster-client', () => ({ fetchMigrationStatusClient }));

import { MigrationStrip } from '../migration-strip';

beforeEach(() => {
  fetchMigrationStatusClient.mockReset();
});

// The reconciliation downloads the entire legacy 715b8 roster (billed per GB),
// so the strip must be ON DEMAND: no fetch on mount, only on the button click.
describe('MigrationStrip', () => {
  it('renders idle with a Check button and does NOT fetch on mount', () => {
    render(<MigrationStrip />);
    expect(screen.getByRole('button', { name: /check migration status/i })).toBeTruthy();
    expect(fetchMigrationStatusClient).not.toHaveBeenCalled();
  });

  it('fetches on click and renders the counts', async () => {
    fetchMigrationStatusClient.mockResolvedValue({
      legacyTotal: 867, migrated: 860, missing: 7, missingFids: ['1', '2', '3', '4', '5', '6', '7'], checkedAt: 'x',
    });
    render(<MigrationStrip />);
    await userEvent.click(screen.getByRole('button', { name: /check migration status/i }));
    expect(await screen.findByText(/860 of 867 legacy families migrated/i)).toBeTruthy();
    expect(screen.getByText(/7 not yet in portal/i)).toBeTruthy();
    expect(fetchMigrationStatusClient).toHaveBeenCalledTimes(1);
  });

  it('shows a quiet error with retry when the check fails, and retries on click', async () => {
    fetchMigrationStatusClient
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ legacyTotal: 5, migrated: 5, missing: 0, missingFids: [], checkedAt: 'x' });
    render(<MigrationStrip />);
    await userEvent.click(screen.getByRole('button', { name: /check migration status/i }));
    expect(await screen.findByText(/couldn.t check migration status/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/5 of 5 legacy families migrated/i)).toBeTruthy();
    expect(fetchMigrationStatusClient).toHaveBeenCalledTimes(2);
  });
});
