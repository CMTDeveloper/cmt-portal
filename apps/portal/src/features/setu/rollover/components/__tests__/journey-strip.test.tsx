import { it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { JourneyStrip } from '../journey-strip';
import type { JourneyRow } from '../../get-child-journey';

it('renders newest-first rows with Active/Completed badges and grade · level', () => {
  const rows: JourneyRow[] = [
    { termLabel: '2026-27', schoolGrade: '4', levelName: 'Level 3', active: true },
    { termLabel: '2025-26', schoolGrade: '3', levelName: 'Level 2', active: false },
  ];
  render(<JourneyStrip rows={rows} />);

  const rowEls = screen.getAllByTestId('bv-journey-row');
  expect(rowEls).toHaveLength(2);
  expect(within(rowEls[0]!).getByText('2026-27')).toBeInTheDocument();
  expect(within(rowEls[0]!).getByText('Grade 4 · Level 3')).toBeInTheDocument();
  expect(within(rowEls[0]!).getByText('Active')).toBeInTheDocument();
  expect(within(rowEls[1]!).getByText('Grade 3 · Level 2')).toBeInTheDocument();
  expect(within(rowEls[1]!).getByText('Completed')).toBeInTheDocument();
});

it('shows a subtle empty state with no rows', () => {
  render(<JourneyStrip rows={[]} />);
  expect(screen.queryByTestId('bv-journey-row')).not.toBeInTheDocument();
  expect(screen.getByText('No Bala Vihar history yet.')).toBeInTheDocument();
});

it('falls back to an em dash when grade is missing', () => {
  const rows: JourneyRow[] = [{ termLabel: '2024-25', schoolGrade: null, levelName: null, active: false }];
  render(<JourneyStrip rows={rows} />);
  expect(screen.getByText('—')).toBeInTheDocument();
});
