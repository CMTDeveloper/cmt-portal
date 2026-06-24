import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/admin/levels',
  useSearchParams: () => new URLSearchParams(''),
}));

import { SchoolYearSwitcher } from '../school-year-switcher';

it('shows the live year and the Preparing strip after switching', async () => {
  const user = userEvent.setup();
  render(<SchoolYearSwitcher years={['2024-25', '2025-26', '2026-27']} liveYear="2025-26" />);
  // Live year shown, no strip (selected == live).
  expect(screen.getByRole('combobox')).toHaveValue('2025-26');
  expect(screen.queryByText(/not live yet|read-only/i)).not.toBeInTheDocument();
  // Selecting a preparing year pushes ?year= and would show the strip on re-render.
  await user.selectOptions(screen.getByRole('combobox'), '2026-27');
  expect(push).toHaveBeenCalledWith('/admin/levels?year=2026-27');
});
