import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Next.js ───────────────────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({ children, href, className, style }: { children: React.ReactNode; href: string; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

// ── CMT UI ────────────────────────────────────────────────────────────────────
vi.mock('@cmt/ui', () => ({
  SetuIcon: {
    search: () => <span>search</span>,
    chevron: () => <span>chevron</span>,
    warn: () => <span>warn</span>,
  },
}));

// ── Client fetch wrapper ───────────────────────────────────────────────────────
const mockSearchFamiliesClient = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/search/search-families-client', () => ({
  searchFamiliesClient: mockSearchFamiliesClient,
}));

import { WelcomeSearch } from '../welcome-search';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WelcomeSearch — initial state', () => {
  it('renders the search input', () => {
    render(<WelcomeSearch />);
    expect(screen.getByTestId('welcome-search-input')).toBeDefined();
  });

  it('shows empty state prompt when no query', () => {
    render(<WelcomeSearch />);
    expect(screen.getByText(/start typing/i)).toBeDefined();
  });
});

describe('WelcomeSearch — debounced search', () => {
  it('calls searchFamiliesClient after 300ms debounce', async () => {
    mockSearchFamiliesClient.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<WelcomeSearch />);
    const input = screen.getByTestId('welcome-search-input');

    await user.type(input, 'patel');

    // Before debounce fires, no call yet
    expect(mockSearchFamiliesClient).not.toHaveBeenCalled();

    // Wait for debounce to fire (300ms + async resolution)
    await waitFor(() => {
      expect(mockSearchFamiliesClient).toHaveBeenCalledWith('patel');
    }, { timeout: 1500 });
  }, 10000);

  it('does not call searchFamiliesClient for whitespace-only query', async () => {
    const user = userEvent.setup();

    render(<WelcomeSearch />);
    const input = screen.getByTestId('welcome-search-input');

    await user.type(input, '   ');

    // Give more than 300ms for any debounce to fire
    await new Promise((r) => setTimeout(r, 500));

    expect(mockSearchFamiliesClient).not.toHaveBeenCalled();
  }, 10000);
});

describe('WelcomeSearch — renders results', () => {
  it('displays family hits returned from search', async () => {
    mockSearchFamiliesClient.mockResolvedValue([
      { fid: 'FAM001', legacyFid: '123', name: 'Patel', location: 'Brampton', memberCount: 3 },
      { fid: 'FAM002', legacyFid: null, name: 'Shah', location: 'Mississauga', memberCount: 2 },
    ]);
    const user = userEvent.setup();

    render(<WelcomeSearch />);
    const input = screen.getByTestId('welcome-search-input');

    await user.type(input, 'pat');

    await waitFor(() => {
      expect(screen.getByTestId('search-results')).toBeDefined();
    }, { timeout: 2000 });

    expect(screen.getByText(/Patel Family/)).toBeDefined();
    expect(screen.getByText(/Shah Family/)).toBeDefined();
  }, 10000);

  it('renders links to /welcome/family/[fid] for each hit', async () => {
    mockSearchFamiliesClient.mockResolvedValue([
      { fid: 'FAM001', legacyFid: null, name: 'Patel', location: 'Brampton', memberCount: 3 },
    ]);
    const user = userEvent.setup();

    render(<WelcomeSearch />);
    const input = screen.getByTestId('welcome-search-input');

    await user.type(input, 'pat');

    await waitFor(() => {
      const link = document.querySelector('a[href="/welcome/family/FAM001"]');
      expect(link).not.toBeNull();
    }, { timeout: 2000 });
  }, 10000);

  it('shows no-results state when hits array is empty', async () => {
    mockSearchFamiliesClient.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<WelcomeSearch />);
    const input = screen.getByTestId('welcome-search-input');

    await user.type(input, 'xyz');

    await waitFor(() => {
      expect(screen.getByText(/no matching families found/i)).toBeDefined();
    }, { timeout: 2000 });
  }, 10000);
});

describe('WelcomeSearch — error state', () => {
  it('shows error message when searchFamiliesClient throws', async () => {
    mockSearchFamiliesClient.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();

    render(<WelcomeSearch />);
    const input = screen.getByTestId('welcome-search-input');

    await user.type(input, 'fail');

    await waitFor(() => {
      expect(screen.getByText(/search failed/i)).toBeDefined();
    }, { timeout: 2000 });
  }, 10000);
});
