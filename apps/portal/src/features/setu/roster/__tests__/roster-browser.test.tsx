import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// vi.hoisted so the (hoisted) vi.mock factories can reference these mocks.
const { fetchRosterClient, fetchMigrationStatusClient, searchFamiliesClient } = vi.hoisted(() => ({
  fetchRosterClient: vi.fn(),
  fetchMigrationStatusClient: vi.fn(),
  searchFamiliesClient: vi.fn(),
}));
vi.mock('../roster-client', () => ({ fetchRosterClient, fetchMigrationStatusClient }));
vi.mock('@/features/setu/search/search-families-client', () => ({ searchFamiliesClient }));

import { RosterBrowser } from '../roster-browser';

beforeEach(() => {
  fetchRosterClient.mockReset();
  fetchMigrationStatusClient.mockReset();
  searchFamiliesClient.mockReset();
  fetchMigrationStatusClient.mockResolvedValue({ legacyTotal: 3, migrated: 3, missing: 0, missingFids: [], checkedAt: 'x' });
});

// NOTE: RosterBrowser renders BOTH a mobile (`block md:hidden`) and a desktop
// (`hidden md:block`) branch — CSS media queries don't apply in jsdom, so every
// element appears twice. We therefore use the repo's dual-branch convention
// (getAllBy*/findAllBy* + `.length`), matching e.g. programs-table.test.tsx. The
// assertions still verify exactly the plan's three behaviours: mount→browse
// list, type→search results, nextCursor→Load more.
describe('RosterBrowser', () => {
  it('renders the browse list on mount', async () => {
    fetchRosterClient.mockResolvedValue({
      families: [{ fid: 'CMT-X', legacyFid: '1', name: 'Patel', location: 'Brampton', memberCount: 4, payment: 'paid', programs: ['Bala Vihar'] }],
      nextCursor: null, total: 1,
    });
    render(<RosterBrowser />);
    expect((await screen.findAllByText(/Patel Family/)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/1 famil/i).length).toBeGreaterThanOrEqual(1);
  });

  it('switches to search results when the search box has text', async () => {
    fetchRosterClient.mockResolvedValue({ families: [], nextCursor: null, total: 0 });
    searchFamiliesClient.mockResolvedValue([{ fid: 'CMT-S', legacyFid: null, name: 'Sharma', location: 'Markham', memberCount: 2 }]);
    render(<RosterBrowser />);
    await userEvent.type(screen.getAllByTestId('roster-search-input')[0]!, 'sharma');
    await waitFor(() => expect(screen.getAllByText(/Sharma Family/).length).toBeGreaterThanOrEqual(1));
  });

  it('shows a "Load more" button when nextCursor is present', async () => {
    fetchRosterClient.mockResolvedValue({
      families: [{ fid: 'CMT-X', legacyFid: null, name: 'Patel', location: 'Brampton', memberCount: 1, payment: 'unknown', programs: [] }],
      nextCursor: 'CMT-X', total: 10,
    });
    render(<RosterBrowser />);
    expect((await screen.findAllByRole('button', { name: /load more/i })).length).toBeGreaterThanOrEqual(1);
  });
});
