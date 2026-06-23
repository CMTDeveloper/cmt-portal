import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/features/setu/rollover/live-school-year', () => ({
  getLiveSchoolYearCached: vi.fn().mockResolvedValue('2025-26'),
}));

import { SchoolYearBadge } from '../school-year-badge';

describe('SchoolYearBadge', () => {
  it('renders the live year', async () => {
    render(await SchoolYearBadge({}));
    expect(screen.getByText(/School year 2025-26/i)).toBeInTheDocument();
  });
});
