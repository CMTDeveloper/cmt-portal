import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

// SetuIcon proxy — any glyph access returns a no-op stub element so the card
// can reference SetuIcon.heart without pinning the test to a specific glyph.
vi.mock('@cmt/ui', () => ({
  SetuIcon: new Proxy(
    {},
    {
      get: () => () => <span data-testid="glyph" />,
    },
  ),
}));

import { SevaProgressCard } from '../seva-progress-card';

describe('SevaProgressCard', () => {
  it('renders the earned-of-target value, a remaining reminder, and the seva link', () => {
    render(
      <SevaProgressCard
        view={{ show: true, pct: 25, remaining: 15, complete: false }}
        hoursEarned={5}
        hoursPerYear={20}
        currentSevaYear="2025-26"
      />,
    );
    expect(screen.getByText(/5 of 20/)).toBeInTheDocument();
    expect(screen.getByText(/15 hours to go/i)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/family/seva');
  });

  it('renders an affirmation when the goal is complete', () => {
    render(
      <SevaProgressCard
        view={{ show: true, pct: 100, remaining: 0, complete: true }}
        hoursEarned={20}
        hoursPerYear={20}
        currentSevaYear="2025-26"
      />,
    );
    expect(screen.getByText(/20 of 20/)).toBeInTheDocument();
    expect(screen.getByText(/goal reached|thank you|complete/i)).toBeInTheDocument();
  });

  it('renders nothing when view.show is false', () => {
    const { container } = render(
      <SevaProgressCard
        view={{ show: false, pct: 0, remaining: 20, complete: false }}
        hoursEarned={0}
        hoursPerYear={20}
        currentSevaYear={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/seva hours/i)).toBeNull();
  });
});
