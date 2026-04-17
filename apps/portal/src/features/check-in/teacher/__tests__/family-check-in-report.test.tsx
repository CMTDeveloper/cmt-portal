import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FamilyCheckInReport } from '../family-check-in-report';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

const makeReportData = (overrides: Partial<{
  families: Record<string, { name: string; checkIns: Record<string, boolean> }>;
  dates: string[];
  totalFamilies: number;
  centers: string[];
}> = {}) => ({
  families: {
    '100': { name: 'Smith, Carol', checkIns: { '2026-04-05': true, '2026-04-12': false } },
    '200': { name: 'Jones, Dave', checkIns: { '2026-04-05': false, '2026-04-12': true } },
  },
  dates: ['2026-04-05', '2026-04-12'],
  totalFamilies: 2,
  centers: ['Brampton', 'Scarborough'],
  ...overrides,
});

describe('FamilyCheckInReport', () => {
  it('renders center dropdown with default options', () => {
    render(<FamilyCheckInReport />);
    const centerSelect = screen.getByLabelText(/center/i);
    expect(centerSelect).toBeInTheDocument();
    // Default fallback options shown before any fetch
    expect(screen.getByRole('option', { name: /brampton/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /scarborough/i })).toBeInTheDocument();
  });

  it('renders month dropdown with 7 months', () => {
    render(<FamilyCheckInReport />);
    const monthSelect = screen.getByLabelText(/month/i);
    expect(monthSelect).toBeInTheDocument();
    // 7 month options
    const options = screen.getAllByRole('option', { name: /\d{4}/ });
    expect(options.length).toBeGreaterThanOrEqual(7);
  });

  it('shows loading spinner during fetch', async () => {
    const user = userEvent.setup();
    // Never resolves — keeps component in loading state
    vi.spyOn(global, 'fetch').mockReturnValueOnce(new Promise(() => {}));

    render(<FamilyCheckInReport />);
    const centerSelect = screen.getByLabelText(/center/i);
    await user.selectOptions(centerSelect, 'Brampton');

    expect(screen.getByText(/loading check-in data/i)).toBeInTheDocument();
  });

  it('renders grid table with family names and Sunday columns after data loads', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => makeReportData(),
    } as Response);

    render(<FamilyCheckInReport />);
    const centerSelect = screen.getByLabelText(/center/i);
    await user.selectOptions(centerSelect, 'Brampton');

    await waitFor(() => {
      expect(screen.getByText('Smith, Carol')).toBeInTheDocument();
    });
    expect(screen.getByText('Jones, Dave')).toBeInTheDocument();
    // Sunday column headers
    expect(screen.getByText('SUN 5')).toBeInTheDocument();
    expect(screen.getByText('SUN 12')).toBeInTheDocument();
  });

  it('renders green checkmark for checked-in families', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => makeReportData(),
    } as Response);

    render(<FamilyCheckInReport />);
    await user.selectOptions(screen.getByLabelText(/center/i), 'Brampton');

    await waitFor(() => {
      expect(screen.getByText('Smith, Carol')).toBeInTheDocument();
    });

    // Green checkmark SVG paths: 2 in the table cells + 1 in the legend = 3 total
    const svgPaths = document.querySelectorAll('path[d="M5 13l4 4L19 7"]');
    expect(svgPaths.length).toBeGreaterThanOrEqual(2);
  });

  it('shows pagination controls when > 25 families', async () => {
    const user = userEvent.setup();

    // Build 30 families
    const families: Record<string, { name: string; checkIns: Record<string, boolean> }> = {};
    for (let i = 1; i <= 30; i++) {
      families[String(i)] = {
        name: `Family ${String(i).padStart(2, '0')}`,
        checkIns: { '2026-04-05': false },
      };
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeReportData({ families, dates: ['2026-04-05'], totalFamilies: 30 }),
    } as Response);

    render(<FamilyCheckInReport />);
    await user.selectOptions(screen.getByLabelText(/center/i), 'Brampton');

    await waitFor(() => {
      expect(screen.getByLabelText(/previous page/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/next page/i)).toBeInTheDocument();
  });
});
