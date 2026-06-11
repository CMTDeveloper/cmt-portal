import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PrasadPreviewResult } from '../publish-assignments';
import type { AdminPrasadAssignment } from '../prasad-client';

// vi.hoisted so the (hoisted) vi.mock factories can reference these mocks.
const { fetchPrasadPreview, publishPrasad, fetchPrasadAssignments, adminReassignPrasad, assignRemainingPrasad, toastSuccess, toastError } = vi.hoisted(() => ({
  fetchPrasadPreview: vi.fn(),
  publishPrasad: vi.fn(),
  fetchPrasadAssignments: vi.fn(),
  adminReassignPrasad: vi.fn(),
  assignRemainingPrasad: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../prasad-client', () => ({ fetchPrasadPreview, publishPrasad, fetchPrasadAssignments, adminReassignPrasad, assignRemainingPrasad }));

vi.mock('@cmt/ui', async () => {
  const actual = await vi.importActual<typeof import('@cmt/ui')>('@cmt/ui');
  return { ...actual, toast: { success: toastSuccess, error: toastError } };
});

import { AdminPrasadScreen } from '../admin-prasad-screen';

// A full preview fixture. cap 10, 2 proposed rows on one Sunday, no unplaced.
function previewFixture(over: Partial<PrasadPreviewResult> = {}): PrasadPreviewResult {
  return {
    pid: 'bv-brampton-2025-26',
    cap: 10,
    rows: [
      { fid: 'CMT-1', familyName: 'Patel', location: 'Brampton', date: '2026-03-22', youngestMid: 'm1', youngestName: 'Aarav', birthMonth: 3, reason: 'birthday-month' },
      { fid: 'CMT-2', familyName: 'Sharma', location: 'Brampton', date: '2026-03-22', youngestMid: 'm2', youngestName: 'Diya', birthMonth: 3, reason: 'spill' },
    ],
    unplaced: [],
    perSunday: [{ date: '2026-03-22', count: 2 }, { date: '2026-03-29', count: 0 }],
    stats: { families: 12, keptExisting: 4, birthdayMonth: 1, spill: 1, noBirthMonth: 0, unplaced: 0 },
    defaultCap: 10,
    eligibleSundayCount: 8,
    ...over,
  };
}

/** A published-assignment fixture for the manage list. All rows share the first
 *  Sunday (2026-03-22) so they render inside the default-open disclosure. */
function assignmentFixture(over: Partial<AdminPrasadAssignment> = {}): AdminPrasadAssignment {
  return {
    paid: 'pa-1',
    fid: 'CMT-1',
    familyName: 'Patel',
    location: 'Brampton',
    date: '2026-03-22',
    youngestName: 'Aarav',
    reason: 'birthday-month',
    source: 'engine',
    status: 'proposed',
    ...over,
  };
}

beforeEach(() => {
  fetchPrasadPreview.mockReset();
  publishPrasad.mockReset();
  fetchPrasadAssignments.mockReset();
  adminReassignPrasad.mockReset();
  assignRemainingPrasad.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  fetchPrasadAssignments.mockResolvedValue([]);
});

// NOTE: The screen renders one logical tree, but assertions use the repo's
// dual-branch convention (getAllBy*/findAllBy* + `.length`) defensively, matching
// roster-browser.test.tsx — so the tests stay robust if a mobile/desktop split
// is ever added.
describe('AdminPrasadScreen', () => {
  it('renders the stat strip from the mocked preview', async () => {
    fetchPrasadPreview.mockResolvedValue(previewFixture());
    render(<AdminPrasadScreen />);
    // 12 families / 4 already assigned all surface in the stat strip.
    expect((await screen.findAllByText('12')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/already assigned/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('prasad-preview').length).toBeGreaterThanOrEqual(1);
    // Proposed schedule groups render per Sunday.
    expect(screen.getAllByTestId('prasad-sunday-group').length).toBeGreaterThanOrEqual(1);
  });

  it('disables publish and shows the raise-the-cap warning when unplaced > 0', async () => {
    fetchPrasadPreview.mockResolvedValue(
      previewFixture({
        unplaced: [{ fid: 'CMT-9', familyName: 'Rao' }, { fid: 'CMT-10', familyName: 'Nair' }],
        stats: { families: 12, keptExisting: 4, birthdayMonth: 1, spill: 1, noBirthMonth: 0, unplaced: 2 },
      }),
    );
    render(<AdminPrasadScreen />);
    const publishBtn = (await screen.findAllByTestId('prasad-publish'))[0]!;
    expect(publishBtn).toBeDisabled();
    expect(screen.getAllByText(/raise the cap/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/2 families don/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the empty-calendar message when eligibleSundayCount === 0', async () => {
    fetchPrasadPreview.mockResolvedValue(previewFixture({ eligibleSundayCount: 0, rows: [], perSunday: [] }));
    render(<AdminPrasadScreen />);
    expect((await screen.findAllByText(/publish the brampton class calendar first/i)).length).toBeGreaterThanOrEqual(1);
    // No publish CTA in the empty state.
    expect(screen.queryByTestId('prasad-publish')).toBeNull();
    // The calendar link is present.
    expect(screen.getAllByRole('link', { name: /class calendar/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('publishes with (pid, cap) when the publish button is clicked', async () => {
    fetchPrasadPreview.mockResolvedValue(previewFixture());
    publishPrasad.mockResolvedValue(previewFixture({ rows: [], stats: { families: 12, keptExisting: 6, birthdayMonth: 0, spill: 0, noBirthMonth: 0, unplaced: 0 } }));
    render(<AdminPrasadScreen />);
    const publishBtn = (await screen.findAllByTestId('prasad-publish'))[0]!;
    await userEvent.click(publishBtn);
    await waitFor(() => expect(publishPrasad).toHaveBeenCalledWith('bv-brampton-2025-26', 10));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('labels the publish CTA "Publish proposals"', async () => {
    fetchPrasadPreview.mockResolvedValue(previewFixture());
    render(<AdminPrasadScreen />);
    const publishBtn = (await screen.findAllByTestId('prasad-publish'))[0]!;
    expect(publishBtn).toHaveTextContent('Publish proposals');
  });

  it('shows a Proposed chip + Assign button on proposed rows, Confirmed chip and no Assign on assigned rows', async () => {
    fetchPrasadPreview.mockResolvedValue(previewFixture());
    fetchPrasadAssignments.mockResolvedValue([
      assignmentFixture({ paid: 'pa-1', fid: 'CMT-1', familyName: 'Patel', status: 'proposed' }),
      assignmentFixture({ paid: 'pa-2', fid: 'CMT-2', familyName: 'Sharma', status: 'assigned' }),
    ]);
    render(<AdminPrasadScreen />);
    expect((await screen.findAllByText('Proposed')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThanOrEqual(1);
    // Exactly the proposed row carries the Assign button.
    const assignButtons = screen.getAllByTestId('prasad-assign');
    expect(assignButtons).toHaveLength(1);
    expect(assignButtons[0]).toHaveAccessibleName('Assign Patel');
  });

  it('clicking Assign calls adminReassignPrasad({ paid, assign: true }) and refreshes the list', async () => {
    fetchPrasadPreview.mockResolvedValue(previewFixture());
    fetchPrasadAssignments.mockResolvedValue([
      assignmentFixture({ paid: 'pa-1', familyName: 'Patel', status: 'proposed' }),
    ]);
    adminReassignPrasad.mockResolvedValue(undefined);
    render(<AdminPrasadScreen />);
    const assignBtn = (await screen.findAllByTestId('prasad-assign'))[0]!;
    await userEvent.click(assignBtn);
    await waitFor(() => expect(adminReassignPrasad).toHaveBeenCalledWith({ paid: 'pa-1', assign: true }));
    // onMutated → load() refetches the assignments (initial + refresh).
    await waitFor(() => expect(fetchPrasadAssignments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('renders status counts and bulk-assigns all unconfirmed after window.confirm', async () => {
    fetchPrasadPreview.mockResolvedValue(previewFixture());
    fetchPrasadAssignments.mockResolvedValue([
      assignmentFixture({ paid: 'pa-1', fid: 'CMT-1', familyName: 'Patel', status: 'assigned' }),
      assignmentFixture({ paid: 'pa-2', fid: 'CMT-2', familyName: 'Sharma', status: 'proposed' }),
      assignmentFixture({ paid: 'pa-3', fid: 'CMT-3', familyName: 'Rao', status: 'proposed' }),
    ]);
    assignRemainingPrasad.mockResolvedValue(2);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<AdminPrasadScreen />);
      const counts = (await screen.findAllByTestId('prasad-status-counts'))[0]!;
      expect(counts).toHaveTextContent('1 confirmed · 2 proposed');
      const bulkBtn = (await screen.findAllByTestId('prasad-assign-remaining'))[0]!;
      expect(bulkBtn).toHaveTextContent('Assign all unconfirmed (2)');
      await userEvent.click(bulkBtn);
      expect(confirmSpy).toHaveBeenCalledWith('Assign all 2 unconfirmed families to their proposed Sundays?');
      await waitFor(() => expect(assignRemainingPrasad).toHaveBeenCalledWith('bv-brampton-2025-26'));
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('2 families assigned'));
      // load() refetch after the bulk flip.
      await waitFor(() => expect(fetchPrasadAssignments).toHaveBeenCalledTimes(2));
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('hides the bulk-assign button when there are no proposed rows', async () => {
    fetchPrasadPreview.mockResolvedValue(previewFixture());
    fetchPrasadAssignments.mockResolvedValue([
      assignmentFixture({ paid: 'pa-1', familyName: 'Patel', status: 'assigned' }),
    ]);
    render(<AdminPrasadScreen />);
    const counts = (await screen.findAllByTestId('prasad-status-counts'))[0]!;
    expect(counts).toHaveTextContent('1 confirmed · 0 proposed');
    expect(screen.queryByTestId('prasad-assign-remaining')).toBeNull();
  });
});
