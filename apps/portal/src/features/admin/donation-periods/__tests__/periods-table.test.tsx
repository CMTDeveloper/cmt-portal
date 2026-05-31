import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CreateOfferingInput } from '@cmt/shared-domain';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: { check: () => null, edit: () => null, back: () => null },
  SetuAvatar: () => null,
  SetuLogo: () => null,
}));

import { PeriodsTable, type PeriodRow } from '../periods-table';

const NOW = new Date().toISOString();

const PRICING = [
  { effectiveFrom: '2025-09-01', amountCAD: 500, label: 'Full year' },
  { effectiveFrom: '2025-12-01', amountCAD: 300, label: 'Joined winter' },
];

const BASE_PERIOD: PeriodRow = {
  pid: 'bv-brampton-2025-26',
  oid: 'bv-brampton-2025-26',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  location: 'Brampton',
  periodLabel: '2025-26',
  termLabel: '2025-26',
  termType: 'term',
  startDate: '2025-09-07T04:00:00.000Z',
  endDate: '2026-06-14T03:59:59.000Z',
  pricingTiers: PRICING,
  enabled: true,
  createdAt: NOW,
  createdBy: 'admin-uid',
  updatedAt: NOW,
  updatedBy: 'admin-uid',
};

// endDate is an end-of-day Toronto EDT timestamp:
// 2026-09-15T03:59:59.000Z = 2026-09-14 23:59:59 Toronto EDT.
// The edit modal must show "2026-09-14", not the UTC-sliced "2026-09-15".
const EDT_END_PERIOD: PeriodRow = {
  pid: 'bv-brampton-summer',
  oid: 'bv-brampton-summer',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  location: 'Brampton',
  periodLabel: 'Summer',
  termLabel: 'Summer',
  termType: 'term',
  startDate: '2026-06-01T04:00:00.000Z',
  endDate: '2026-09-15T03:59:59.000Z',
  pricingTiers: [{ effectiveFrom: '2026-06-01', amountCAD: 200, label: 'Summer' }],
  enabled: true,
  createdAt: NOW,
  createdBy: 'admin-uid',
  updatedAt: NOW,
  updatedBy: 'admin-uid',
};

// Fill the create form. The modal renders: [0] start, [1] end, [2] tier
// effectiveFrom (the single default tier row). Tier amount defaults to 500.
async function fillCreateForm(user: ReturnType<typeof userEvent.setup>, label = '2026-27') {
  await user.type(screen.getByPlaceholderText('2025-26'), label);
  const dateInputs = document.querySelectorAll('input[type="date"]');
  await user.type(dateInputs[0] as HTMLElement, '2026-09-01');
  await user.type(dateInputs[1] as HTMLElement, '2027-06-01');
  await user.type(dateInputs[2] as HTMLElement, '2026-09-01'); // tier effectiveFrom
}

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.warning.mockReset();
});

describe('PeriodsTable — modal save flow', () => {
  it('create: single POST (no list-refetch) on success', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pid: 'bv-scarborough-2026-27', overlapWarning: false }),
    } as Response);

    render(<PeriodsTable initialPeriods={[]}/>);
    await user.click(screen.getByRole('button', { name: /new period/i }));
    await fillCreateForm(user);
    await user.click(screen.getByRole('button', { name: /create period/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/donation-periods',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(toastMock.success).toHaveBeenCalledWith('Period created.');
  });

  it('create: POST body carries pricingTiers', async () => {
    const user = userEvent.setup();
    let body: CreateOfferingInput | null = null;
    vi.spyOn(global, 'fetch').mockImplementationOnce(async (_u, init) => {
      body = JSON.parse((init?.body as string) ?? '{}') as CreateOfferingInput;
      return { ok: true, json: async () => ({ pid: 'x', overlapWarning: false }) } as Response;
    });

    render(<PeriodsTable initialPeriods={[]}/>);
    await user.click(screen.getByRole('button', { name: /new period/i }));
    await fillCreateForm(user);
    await user.click(screen.getByRole('button', { name: /create period/i }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.pricingTiers).toEqual([
      { effectiveFrom: '2026-09-01', amountCAD: 500, label: 'Full year' },
    ]);
    // Toronto midnight, not UTC: 2026-09-01 EDT = 04:00 UTC
    expect(body!.startDate).toBe('2026-09-01T04:00:00.000Z');
  });

  it('create: overlap warning toast when overlapWarning=true', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pid: 'x', overlapWarning: true }),
    } as Response);

    render(<PeriodsTable initialPeriods={[]}/>);
    await user.click(screen.getByRole('button', { name: /new period/i }));
    await fillCreateForm(user);
    await user.click(screen.getByRole('button', { name: /create period/i }));

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith(expect.stringContaining('overlaps')));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('edit: PATCH and single fetch', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pid: BASE_PERIOD.pid }),
    } as Response);

    render(<PeriodsTable initialPeriods={[BASE_PERIOD]}/>);
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    await user.click(editButtons[0]!);
    expect(screen.getByDisplayValue('2025-26')).toBeInTheDocument();

    // change the period label so the PATCH body is non-trivial
    const label = screen.getByDisplayValue('2025-26');
    await user.clear(label);
    await user.type(label, '2025-2026');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/admin/donation-periods/${BASE_PERIOD.pid}`,
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(toastMock.success).toHaveBeenCalledWith('Period updated.');
  });

  it('shows toast.error on fetch failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'bad-request' }),
    } as Response);

    render(<PeriodsTable initialPeriods={[]}/>);
    await user.click(screen.getByRole('button', { name: /new period/i }));
    await fillCreateForm(user);
    await user.click(screen.getByRole('button', { name: /create period/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('bad-request'));
  });

  it('edit modal: start/end date inputs show Toronto-local YYYY-MM-DD, not UTC-sliced', async () => {
    const user = userEvent.setup();
    render(<PeriodsTable initialPeriods={[EDT_END_PERIOD]}/>);
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    await user.click(editButtons[0]!);

    const dateInputs = document.querySelectorAll('input[type="date"]');
    // [0] start, [1] end, [2] the single tier effectiveFrom
    expect((dateInputs[0] as HTMLInputElement).value).toBe('2026-06-01');
    expect((dateInputs[1] as HTMLInputElement).value).toBe('2026-09-14'); // not 2026-09-15
  });
});
