import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PrasadPreviewResult } from '../publish-assignments';

// vi.hoisted so the (hoisted) vi.mock factories can reference these mocks.
const { fetchPrasadPreview, publishPrasad, fetchPrasadAssignments, adminReassignPrasad, toastSuccess, toastError } = vi.hoisted(() => ({
  fetchPrasadPreview: vi.fn(),
  publishPrasad: vi.fn(),
  fetchPrasadAssignments: vi.fn(),
  adminReassignPrasad: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../prasad-client', () => ({ fetchPrasadPreview, publishPrasad, fetchPrasadAssignments, adminReassignPrasad }));

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

beforeEach(() => {
  fetchPrasadPreview.mockReset();
  publishPrasad.mockReset();
  fetchPrasadAssignments.mockReset();
  adminReassignPrasad.mockReset();
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
});
