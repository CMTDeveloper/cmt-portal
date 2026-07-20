import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RosterReportRow } from '@cmt/shared-domain/setu';

// vi.hoisted so the (hoisted) vi.mock factories can reference these mocks.
const { fetchRosterReportClient, fetchMigrationStatusClient, searchFamiliesClient } = vi.hoisted(() => ({
  fetchRosterReportClient: vi.fn(),
  fetchMigrationStatusClient: vi.fn(),
  searchFamiliesClient: vi.fn(),
}));
vi.mock('../roster-client', () => ({ fetchRosterReportClient, fetchMigrationStatusClient }));
vi.mock('@/features/setu/search/search-families-client', () => ({ searchFamiliesClient }));

import { RosterBrowser } from '../roster-browser';

function row(over: Partial<RosterReportRow>): RosterReportRow {
  return {
    fid: 'CMT-A', publicFid: null, legacyFid: null, name: 'A', parentName: 'A Parent', location: 'Brampton',
    memberCount: 2, payment: 'unknown', programs: [], programKeys: [], bvChildren: [], bvEngagement: null, ...over,
  };
}

const RANA = row({
  fid: 'CMT-RANA', publicFid: '1075', legacyFid: '477', name: 'Rana', parentName: 'Vaibhav & Noopur Rana',
  location: 'Brampton', payment: 'paid', bvEngagement: 'confirmed',
  programs: ['Bala Vihar'], programKeys: ['bala-vihar'], bvChildren: [{ grade: '2', levelName: 'Level 2' }],
});
const SHAH = row({
  fid: 'CMT-SHAH', publicFid: '1200', name: 'Shah', parentName: 'Priya Shah', location: 'Scarborough', payment: 'outstanding',
  bvEngagement: 'registered',
  programs: ['Bala Vihar'], programKeys: ['bala-vihar'], bvChildren: [{ grade: '5', levelName: 'Level 4' }],
});
// Never-enrolled family: no publicFid (lazy model), no active program, no BV engagement.
const PENDING = row({
  fid: 'CMT-PENDINGXYZ', publicFid: null, legacyFid: '999', name: 'Anup', parentName: 'Aariyan Anup',
  location: 'Brampton', payment: 'unknown', programs: [], programKeys: [], bvChildren: [], bvEngagement: null,
});

beforeEach(() => {
  fetchRosterReportClient.mockReset();
  fetchMigrationStatusClient.mockReset();
  searchFamiliesClient.mockReset();
  fetchMigrationStatusClient.mockResolvedValue({ legacyTotal: 3, migrated: 3, missing: 0, missingFids: [], checkedAt: 'x' });
  fetchRosterReportClient.mockResolvedValue({ rows: [RANA, SHAH] });
  searchFamiliesClient.mockResolvedValue([]);
});

// NOTE: RosterBrowser renders BOTH a mobile (`block md:hidden`) and a desktop
// (`hidden md:block`) branch - CSS media queries don't apply in jsdom, so every
// element appears twice AND each branch owns independent React state. We use
// getAllBy*/findAllBy* + `.length` (repo convention), and for interaction tests
// we act on EVERY matching control so both branches move together.
// The roster opens filtered to Paid + Enrolled. Clear both back to "All" so a
// test can see the full loaded set (used where the test isn't about that default).
async function clearDefaultFilters() {
  await screen.findAllByRole('combobox', { name: 'Payment' });
  for (const sel of screen.getAllByRole('combobox', { name: 'Payment' })) await userEvent.selectOptions(sel, '');
  for (const sel of screen.getAllByRole('combobox', { name: 'Enrollment' })) await userEvent.selectOptions(sel, '');
}

describe('RosterBrowser', () => {
  it('opens filtered to Paid + Enrolled by default', async () => {
    // RANA = paid + enrolled → shown; SHAH = outstanding + registered → hidden.
    fetchRosterReportClient.mockResolvedValue({ rows: [RANA, SHAH, PENDING] });
    render(<RosterBrowser locationOptions={['Brampton', 'Scarborough']} />);
    expect((await screen.findAllByText('Vaibhav & Noopur Rana')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Priya Shah')).not.toBeInTheDocument();
    expect(screen.queryByText('Aariyan Anup')).not.toBeInTheDocument();
    // The Payment + Enrollment dropdowns reflect the active default.
    for (const sel of screen.getAllByRole('combobox', { name: 'Payment' })) expect((sel as HTMLSelectElement).value).toBe('paid');
    for (const sel of screen.getAllByRole('combobox', { name: 'Enrollment' })) expect((sel as HTMLSelectElement).value).toBe('enrolled');
  });

  it('bulk-loads the dataset, renders PARENT names as the card title, and shows the live summary', async () => {
    render(<RosterBrowser locationOptions={['Brampton', 'Scarborough']} />);
    await screen.findAllByText('Vaibhav & Noopur Rana');
    await clearDefaultFilters(); // widen from the Paid+Enrolled default to see both families
    // Card title is the parents' name, NOT "Rana family Family".
    expect(screen.getAllByText('Vaibhav & Noopur Rana').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Priya Shah').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/family Family/i)).not.toBeInTheDocument();
    // The displayed Family ID is the 4-digit publicFid (via displayFid).
    expect(screen.getAllByText(/FID 1075/).length).toBeGreaterThanOrEqual(1);
    // Summary: 2 families, 2 BV children total.
    expect(screen.getAllByText(/2 families/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/2 Bala Vihar children/i).length).toBeGreaterThanOrEqual(1);
  });

  it('filters the list by Level (client-side, over the loaded dataset)', async () => {
    render(<RosterBrowser locationOptions={['Brampton', 'Scarborough']} />);
    await screen.findAllByText('Vaibhav & Noopur Rana');
    await clearDefaultFilters(); // SHAH is registered/outstanding — widen so it's visible to filter on
    // Pick "Level 4" in every Level dropdown (mobile + desktop) so both branches filter.
    for (const sel of screen.getAllByRole('combobox', { name: 'Level' })) {
      await userEvent.selectOptions(sel, 'Level 4');
    }
    await waitFor(() => expect(screen.queryByText('Vaibhav & Noopur Rana')).not.toBeInTheDocument());
    expect(screen.getAllByText('Priya Shah').length).toBeGreaterThanOrEqual(1);
  });

  it('a family without a publicFid shows its legacy id, never the internal CMT- fid', async () => {
    fetchRosterReportClient.mockResolvedValue({ rows: [PENDING] });
    render(<RosterBrowser locationOptions={['Brampton', 'Scarborough']} />);
    await clearDefaultFilters(); // PENDING is unknown/not-enrolled — widen to see it
    await screen.findAllByText('Aariyan Anup');
    // The card meta line shows "Legacy 999" and NEVER leaks the CMT- doc id.
    expect(screen.getAllByText(/Legacy 999/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/CMT-PENDINGXYZ/)).not.toBeInTheDocument();
    expect(screen.queryByText(/FID CMT-/)).not.toBeInTheDocument();
  });

  it('Enrollment filter: "Registered" keeps only carry-forwards (not Enrolled or Not-enrolled)', async () => {
    // RANA = confirmed (Enrolled), SHAH = registered, PENDING = null (Not enrolled).
    fetchRosterReportClient.mockResolvedValue({ rows: [RANA, SHAH, PENDING] });
    render(<RosterBrowser locationOptions={['Brampton', 'Scarborough']} />);
    // Isolate the Enrollment filter: clear the Payment default (SHAH is outstanding)
    // so payment doesn't also filter it out.
    await screen.findAllByRole('combobox', { name: 'Payment' });
    for (const sel of screen.getAllByRole('combobox', { name: 'Payment' })) await userEvent.selectOptions(sel, '');
    // Under the Enrolled default only RANA shows; switching to Registered swaps to SHAH.
    await screen.findAllByText('Vaibhav & Noopur Rana');
    for (const sel of screen.getAllByRole('combobox', { name: 'Enrollment' })) {
      await userEvent.selectOptions(sel, 'registered');
    }
    await waitFor(() => expect(screen.queryByText('Vaibhav & Noopur Rana')).not.toBeInTheDocument());
    expect(screen.queryByText('Aariyan Anup')).not.toBeInTheDocument();
    expect(screen.getAllByText('Priya Shah').length).toBeGreaterThanOrEqual(1);
  });

  it('switches to search results when the search box has text (parent name on hits too)', async () => {
    searchFamiliesClient.mockResolvedValue([
      { fid: 'CMT-S', publicFid: '2050', legacyFid: null, name: 'Sharma', parentName: 'Ravi Sharma', location: 'Markham', memberCount: 2 },
    ]);
    render(<RosterBrowser locationOptions={['Brampton', 'Scarborough']} />);
    await screen.findAllByText('Vaibhav & Noopur Rana');
    await userEvent.type(screen.getAllByTestId('roster-search-input')[0]!, 'sharma');
    await waitFor(() => expect(screen.getAllByText('Ravi Sharma').length).toBeGreaterThanOrEqual(1));
  });

  it('shows a "Load more" button when the filtered set exceeds the initial window', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      row({ fid: `CMT-${i}`, name: `Fam${i}`, parentName: `Parent ${i}`, programs: ['Bala Vihar'], programKeys: ['bala-vihar'] }),
    );
    fetchRosterReportClient.mockResolvedValue({ rows: many });
    render(<RosterBrowser locationOptions={['Brampton', 'Scarborough']} />);
    await clearDefaultFilters(); // fixtures are unknown/not-enrolled — widen so all 60 show
    expect((await screen.findAllByRole('button', { name: /load more/i })).length).toBeGreaterThanOrEqual(1);
  });
});
