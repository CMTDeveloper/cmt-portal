import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RolloverReport } from '@cmt/shared-domain';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@cmt/ui', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  SetuIcon: { back: () => <span>←</span> },
}));
vi.mock('@/features/setu/rollover/rollover-client', () => ({
  startNewYearClient: vi.fn(),
  previewPromotionClient: vi.fn(),
  commitPromotionClient: vi.fn(),
}));
vi.mock('../../set-grade-client', () => ({
  setGradeClient: vi.fn(),
}));

import { RolloverPage, type RolloverPageState } from '../rollover-page';
import { PromotionPreview } from '../promotion-preview';
import { previewPromotionClient, commitPromotionClient } from '@/features/setu/rollover/rollover-client';
import { setGradeClient } from '../../set-grade-client';

function state(over: Partial<RolloverPageState> = {}): RolloverPageState {
  return {
    fromYear: '2025-26',
    toYear: '2026-27',
    nextYearReady: false,
    sourceLevelCount: 18,
    sourceOfferingCount: 2,
    targetLevelCount: 0,
    ...over,
  };
}

const REPORT: RolloverReport = {
  fromYear: '2025-26',
  toYear: '2026-27',
  dryRun: true,
  familiesProcessed: 500,
  familiesSkippedAlreadyPromoted: 0,
  promoted: 480,
  advanced: 471,
  shishuStayed: 9,
  graduated: 18,
  needsAttention: 14,
  byTransition: [
    { label: 'Level 1 → Level 2', count: 53 },
    { label: 'Level 2 → Level 3', count: 23 },
  ],
  graduates: [{ fid: 'F-G1', mid: 'M-G1', childName: 'Aanya R.', location: 'Brampton', outcomeKind: 'graduate', fromGrade: '12', fromLevelName: 'Level 5', toGrade: null, toLevelName: null }],
  attention: [
    { fid: 'FAM-77', mid: 'MID-99', childName: 'Riya S.', location: 'Brampton', outcomeKind: 'needs-grade', fromGrade: null, fromLevelName: null, toGrade: null, toLevelName: null },
  ],
  rows: [],
  affectedFids: [],
};

beforeEach(() => {
  vi.mocked(previewPromotionClient).mockReset();
  vi.mocked(commitPromotionClient).mockReset();
  vi.mocked(setGradeClient).mockReset();
});

it('renders Step 1 and a LOCKED Step 2 when the next year is not ready', () => {
  render(<RolloverPage state={state({ nextYearReady: false })} />);
  expect(screen.getByRole('heading', { name: 'Start 2026-27' })).toBeDefined();
  expect(screen.getByRole('heading', { name: 'Promote families' })).toBeDefined();
  // Step 2 is locked: no actionable "Preview run", and the lock copy is shown.
  expect(screen.getByText(/Complete Step 1 first/i)).toBeDefined();
  expect(screen.queryByRole('button', { name: /preview run/i })).toBeNull();
  expect(screen.getByText('Locked')).toBeDefined();
});

it('clicking "Preview run" calls previewPromotionClient and renders the report', async () => {
  vi.mocked(previewPromotionClient).mockResolvedValue(REPORT);
  const user = userEvent.setup();
  render(<RolloverPage state={state({ nextYearReady: true })} />);

  await user.click(screen.getByRole('button', { name: /preview run/i }));
  expect(previewPromotionClient).toHaveBeenCalledTimes(1);

  // The three headline counts render.
  expect(await screen.findByText('480')).toBeDefined();
  expect(screen.getByText('18')).toBeDefined();
  expect(screen.getByText('14')).toBeDefined();

  // A byTransition row renders.
  expect(screen.getByText('Level 1 → Level 2')).toBeDefined();
  expect(screen.getByText('53')).toBeDefined();

  // The attention row renders with a Review link whose href contains the fid.
  const review = screen.getByRole('link', { name: /review/i });
  expect(review.getAttribute('href')).toContain('FAM-77');
  expect(screen.getByText('Riya S.')).toBeDefined();
  expect(screen.getByText(/no grade set/i)).toBeDefined();
});

it('clicking "Promote 480 students" opens the confirm dialog, and confirming calls commitPromotionClient', async () => {
  vi.mocked(previewPromotionClient).mockResolvedValue(REPORT);
  vi.mocked(commitPromotionClient).mockResolvedValue({ ...REPORT, dryRun: false });
  const user = userEvent.setup();
  render(<RolloverPage state={state({ nextYearReady: true })} />);

  await user.click(screen.getByRole('button', { name: /preview run/i }));
  await user.click(await screen.findByRole('button', { name: /promote 480 students/i }));

  // The confirm dialog is open.
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/promote 480 students to 2026-27/i)).toBeDefined();

  // Confirming inside the dialog commits.
  await user.click(within(dialog).getByRole('button', { name: /^promote$/i }));
  expect(commitPromotionClient).toHaveBeenCalledTimes(1);
});

it('renders Step 1 in its confirmed state and unlocks Step 2 when next year is already ready', () => {
  render(<RolloverPage state={state({ nextYearReady: true })} />);
  expect(screen.getByText(/2026-27 is ready/i)).toBeDefined();
  // Step 2 is unlocked: the "Preview run" action is available, no lock copy.
  expect(screen.getByRole('button', { name: /preview run/i })).toBeDefined();
  expect(screen.queryByText(/Complete Step 1 first/i)).toBeNull();
});

it('inline Set grade on a need-attention row calls setGradeClient and refreshes the preview', async () => {
  vi.mocked(setGradeClient).mockResolvedValue(undefined);
  const onResolved = vi.fn();
  const user = userEvent.setup();
  render(<PromotionPreview report={REPORT} committing={false} onPromote={vi.fn()} onResolved={onResolved} />);

  // The need-attention row keeps its "Review →" link AND gains an inline picker.
  expect(screen.getByRole('link', { name: /review/i })).toBeDefined();

  // Pick a grade for Riya S. (the seeded needs-grade child: fid FAM-77, mid MID-99).
  const select = screen.getByRole('combobox', { name: /set grade for riya s\./i });
  await user.selectOptions(select, '4');

  // Save fires the client with the row's identity + chosen grade, then refreshes.
  await user.click(screen.getByRole('button', { name: /save grade for riya s\./i }));

  expect(setGradeClient).toHaveBeenCalledWith({ fid: 'FAM-77', mid: 'MID-99', schoolGrade: '4' });
  expect(onResolved).toHaveBeenCalledTimes(1);
});

it('Save is disabled until a grade is chosen on a need-attention row', () => {
  render(<PromotionPreview report={REPORT} committing={false} onPromote={vi.fn()} onResolved={vi.fn()} />);
  const save = screen.getByRole('button', { name: /save grade for riya s\./i });
  expect((save as HTMLButtonElement).disabled).toBe(true);
});
