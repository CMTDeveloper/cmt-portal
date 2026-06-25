import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, searchParams } = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: { value: new URLSearchParams('') },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/admin/levels',
  useSearchParams: () => searchParams.value,
}));
// next/link → plain anchor for assertions.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { SchoolYearScopeBar } from '../school-year-scope-bar';

// N≥2 of every lifecycle: two past (archived), one live, two future (draft).
const YEARS = ['2023-24', '2024-25', '2025-26', '2026-27', '2027-28'];
const LIVE = '2025-26';

function renderBar(props?: Partial<Parameters<typeof SchoolYearScopeBar>[0]>) {
  return render(<SchoolYearScopeBar years={YEARS} liveYear={LIVE} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams(''); // default → live
});

describe('SchoolYearScopeBar — live (default)', () => {
  it('shows the calm "Operating in" strip with the live year + LIVE badge, no warning', () => {
    renderBar();
    const bar = screen.getByTestId('school-year-scope-bar');
    expect(bar).toHaveAttribute('data-status', 'live');
    expect(within(bar).getByText('Operating in')).toBeTruthy();
    expect(within(bar).getByText('2025-26')).toBeTruthy();
    expect(within(bar).getAllByText('LIVE').length).toBeGreaterThan(0);
    // No amber warning copy on the live year.
    expect(within(bar).queryByText(/won't affect the live portal|won't go live/i)).toBeNull();
    expect(within(bar).queryByText(/Switch to .* \(Live\)/)).toBeNull();
  });

  it('shows a "Manage school years →" link to the rollover page when canManage', () => {
    renderBar({ canManage: true });
    const link = screen.getByRole('link', { name: /Manage school years/ });
    expect(link.getAttribute('href')).toBe('/admin/school-year');
  });

  it('hides "Manage school years →" when canManage is false (welcome-team)', () => {
    renderBar({ canManage: false });
    expect(screen.queryByRole('link', { name: /Manage school years/ })).toBeNull();
  });
});

describe('SchoolYearScopeBar — non-live (the payoff)', () => {
  it('turns amber for a PAST (archived) year with read-only copy + Switch-to-Live', () => {
    searchParams.value = new URLSearchParams('year=2024-25');
    renderBar();
    const bar = screen.getByTestId('school-year-scope-bar');
    expect(bar).toHaveAttribute('data-status', 'past');
    expect(within(bar).getByText("You're viewing")).toBeTruthy();
    expect(within(bar).getAllByText('ARCHIVED').length).toBeGreaterThan(0);
    expect(within(bar).getByText(/read-only/i)).toBeTruthy();
    expect(within(bar).getByRole('button', { name: /Switch to 2025-26 \(Live\)/ })).toBeTruthy();
  });

  it('turns amber for a FUTURE (draft) year with the staged-changes copy', () => {
    searchParams.value = new URLSearchParams('year=2026-27');
    renderBar();
    const bar = screen.getByTestId('school-year-scope-bar');
    expect(bar).toHaveAttribute('data-status', 'preparing');
    expect(within(bar).getAllByText('DRAFT').length).toBeGreaterThan(0);
    expect(within(bar).getByText(/staged for next year/i)).toBeTruthy();
  });

  it('"Switch to Live" clears the ?year= param (pushes the bare path)', async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams('year=2024-25');
    renderBar();
    await user.click(screen.getByRole('button', { name: /Switch to 2025-26 \(Live\)/ }));
    expect(push).toHaveBeenCalledWith('/admin/levels');
  });
});

describe('SchoolYearScopeBar — switcher menu', () => {
  it('opens a listbox listing every year with its lifecycle badge', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: /Change school year/ }));
    const list = screen.getByRole('listbox', { name: 'School year' });
    // Live pinned first, then newest → oldest.
    const options = within(list).getAllByRole('option');
    expect(options[0]!).toHaveTextContent('2025-26');
    expect(options[1]!).toHaveTextContent('2027-28'); // newest draft next
    // Two drafts + two archived present in the menu.
    expect(within(list).getAllByText('DRAFT').length).toBe(2);
    expect(within(list).getAllByText('ARCHIVED').length).toBe(2);
    // Selected (live) row is marked.
    const selected = options.find((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveTextContent('2025-26');
  });

  it('picking a future year pushes ?year=', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: /Change school year/ }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /2026-27/ }));
    expect(push).toHaveBeenCalledWith('/admin/levels?year=2026-27');
  });

  it('picking the live year from the menu drops the param', async () => {
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams('year=2024-25'); // start off-live
    renderBar();
    await user.click(screen.getByRole('button', { name: /Change school year/ }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /2025-26/ }));
    expect(push).toHaveBeenCalledWith('/admin/levels');
  });

  it('closes the menu on Escape', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: /Change school year/ }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the menu on an outside click', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: /Change school year/ }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.mouseDown(document.body); // outside the popover
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
