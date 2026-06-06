import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { SevaComplianceData } from '../compliance-client';

vi.mock('@cmt/ui', () => ({
  SetuIcon: new Proxy({}, { get: () => () => <span data-testid="icon" /> }),
}));
vi.mock('../compliance-client', () => ({}));

import { ComplianceReport } from '../compliance-report';

const withYear: SevaComplianceData = {
  currentSevaYear: '2025-26',
  hoursPerYear: 5,
  rows: [
    { fid: 'F2', name: 'Patel', hoursEarned: 0, met: false },
    { fid: 'F1', name: 'Sharma', hoursEarned: 7, met: true },
  ],
  summary: { totalFamilies: 2, metCount: 1, shortCount: 1 },
};

const noYear: SevaComplianceData = {
  currentSevaYear: null,
  hoursPerYear: 20,
  rows: [],
  summary: { totalFamilies: 0, metCount: 0, shortCount: 0 },
};

describe('ComplianceReport', () => {
  it('renders the active seva year', () => {
    render(<ComplianceReport initial={withYear} />);
    expect(screen.getByText(/2025-26/)).toBeInTheDocument();
  });

  it('renders the met-of-total summary', () => {
    render(<ComplianceReport initial={withYear} />);
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
  });

  it('renders each family row with hours-of-target and a met/short badge', () => {
    render(<ComplianceReport initial={withYear} />);

    // Patel — short
    const patelRow = screen.getByRole('link', { name: /Patel/ });
    expect(within(patelRow).getByText(/0 of 5/)).toBeInTheDocument();
    expect(within(patelRow).getByText('Short')).toBeInTheDocument();

    // Sharma — met
    const sharmaRow = screen.getByRole('link', { name: /Sharma/ });
    expect(within(sharmaRow).getByText(/7 of 5/)).toBeInTheDocument();
    expect(within(sharmaRow).getByText('Met')).toBeInTheDocument();
  });

  it('links each family row to the welcome family detail page', () => {
    render(<ComplianceReport initial={withYear} />);
    const sharmaLink = screen.getByRole('link', { name: /Sharma/ });
    expect(sharmaLink).toHaveAttribute('href', '/welcome/family/F1');
  });

  it('renders short-first order from the server (no client re-sort)', () => {
    render(<ComplianceReport initial={withYear} />);
    const links = screen.getAllByRole('link');
    expect(within(links[0]!).getByText('Patel')).toBeInTheDocument();
    expect(within(links[1]!).getByText('Sharma')).toBeInTheDocument();
  });

  it('shows a friendly empty state when no seva year is set', () => {
    render(<ComplianceReport initial={noYear} />);
    expect(screen.queryByText('Met')).not.toBeInTheDocument();
    expect(screen.getByText(/no seva year set/i)).toBeInTheDocument();
  });
});
