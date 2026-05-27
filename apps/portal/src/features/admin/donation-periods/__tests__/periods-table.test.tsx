import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CreateDonationPeriodInput } from '@cmt/shared-domain';

// next/navigation mock (PeriodsTable doesn't use it but components in scope may)
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

const BASE_PERIOD: PeriodRow = {
  pid: 'bv-brampton-fall-2026',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  location: 'Brampton',
  periodLabel: 'Fall 2026',
  startDate: '2026-09-01T00:00:00.000Z',
  endDate: '2027-01-25T23:59:59.000Z',
  suggestedAmount: 500,
  amountTiers: [500, 750, 1000, 1500],
  enabled: true,
  createdAt: NOW,
  createdBy: 'admin-uid',
  updatedAt: NOW,
  updatedBy: 'admin-uid',
};

// A period whose endDate is an end-of-day Toronto EDT timestamp.
// 2026-09-15T03:59:59.000Z = 2026-09-14 23:59:59 Toronto EDT.
// The edit modal must show "2026-09-14", not the UTC-sliced "2026-09-15".
const EDT_END_PERIOD: PeriodRow = {
  pid: 'bv-brampton-summer-2026',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  location: 'Brampton',
  periodLabel: 'Summer 2026',
  startDate: '2026-06-01T04:00:00.000Z', // 2026-06-01 00:00 Toronto EDT
  endDate: '2026-09-15T03:59:59.000Z',   // 2026-09-14 23:59:59 Toronto EDT
  suggestedAmount: 500,
  amountTiers: [500, 750, 1000, 1500],
  enabled: true,
  createdAt: NOW,
  createdBy: 'admin-uid',
  updatedAt: NOW,
  updatedBy: 'admin-uid',
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.warning.mockReset();
});

describe('PeriodsTable — modal save flow', () => {
  it('create: calls onSaved with form-state row (no list-refetch) on POST success', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pid: 'bv-mississauga-spring-2027', overlapWarning: false }),
    } as Response);

    render(<PeriodsTable initialPeriods={[]}/>);

    // Open create modal
    await user.click(screen.getByRole('button', { name: /new period/i }));

    // The modal is rendered but onSaved is internal — re-render with spy isn't
    // straightforward here; instead test via the component's own state update:
    // We verify fetch was called once (no list-refetch second call).
    // Fill form fields
    const periodLabelInput = screen.getByPlaceholderText('Fall 2026');
    await user.type(periodLabelInput, 'Spring 2027');

    // Fill date fields
    const dateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(dateInputs[0] as HTMLElement, '2027-02-01');
    await user.type(dateInputs[1] as HTMLElement, '2027-06-01');

    // Submit
    await user.click(screen.getByRole('button', { name: /create period/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Verify the single fetch was the POST (not a subsequent GET list)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/donation-periods',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(toastMock.success).toHaveBeenCalledWith('Period created.');
  });

  it('create: shows overlap warning toast when overlapWarning=true', async () => {
    const user = userEvent.setup();

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pid: 'bv-brampton-fall-2026', overlapWarning: true }),
    } as Response);

    render(<PeriodsTable initialPeriods={[]}/>);
    await user.click(screen.getByRole('button', { name: /new period/i }));

    const periodLabelInput = screen.getByPlaceholderText('Fall 2026');
    await user.type(periodLabelInput, 'Fall 2026');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(dateInputs[0] as HTMLElement, '2026-09-01');
    await user.type(dateInputs[1] as HTMLElement, '2027-01-25');

    await user.click(screen.getByRole('button', { name: /create period/i }));

    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        expect.stringContaining('overlaps'),
      );
    });
    // Still only one fetch — no list-refetch
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('edit: calls PATCH with changed fields and updates row without list-refetch', async () => {
    const user = userEvent.setup();

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pid: BASE_PERIOD.pid }),
    } as Response);

    render(<PeriodsTable initialPeriods={[BASE_PERIOD]}/>);

    // Open edit modal
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    await user.click(editButtons[0]!);

    // Verify the modal opened (period label field shows existing value)
    expect(screen.getByDisplayValue('Fall 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/admin/donation-periods/${BASE_PERIOD.pid}`,
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(toastMock.success).toHaveBeenCalledWith('Period updated.');
    // No second fetch (list-refetch) — exactly one call total
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('tier-mismatch: shows warning toast when first tier differs from suggested amount', async () => {
    const user = userEvent.setup();

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pid: 'bv-brampton-fall-2026', overlapWarning: false }),
    } as Response);

    render(<PeriodsTable initialPeriods={[]}/>);
    await user.click(screen.getByRole('button', { name: /new period/i }));

    // Fill required fields
    await user.type(screen.getByPlaceholderText('Fall 2026'), 'Fall 2026');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(dateInputs[0] as HTMLElement, '2026-09-01');
    await user.type(dateInputs[1] as HTMLElement, '2027-01-25');

    // Set suggested amount to 600 but leave tiers starting at 500
    const amtInput = screen.getByRole('spinbutton');
    await user.clear(amtInput);
    await user.type(amtInput, '600');

    await user.click(screen.getByRole('button', { name: /create period/i }));

    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("First tier"),
      );
    });
  });

  it('shows toast.error on fetch failure', async () => {
    const user = userEvent.setup();

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'bad-request' }),
    } as Response);

    render(<PeriodsTable initialPeriods={[]}/>);
    await user.click(screen.getByRole('button', { name: /new period/i }));

    await user.type(screen.getByPlaceholderText('Fall 2026'), 'Fall 2026');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(dateInputs[0] as HTMLElement, '2026-09-01');
    await user.type(dateInputs[1] as HTMLElement, '2027-01-25');

    await user.click(screen.getByRole('button', { name: /create period/i }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith('bad-request');
    });
  });

  it('edit modal: date inputs show Toronto-local YYYY-MM-DD, not UTC-sliced date', async () => {
    const user = userEvent.setup();

    render(<PeriodsTable initialPeriods={[EDT_END_PERIOD]}/>);

    // Open the edit modal for the EDT_END_PERIOD row
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    await user.click(editButtons[0]!);

    // The modal should be open — find all date inputs
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs).toHaveLength(2);

    // startDate: 2026-06-01T04:00:00.000Z = 2026-06-01 00:00 Toronto EDT → '2026-06-01'
    expect((dateInputs[0] as HTMLInputElement).value).toBe('2026-06-01');
    // endDate: 2026-09-15T03:59:59.000Z = 2026-09-14 23:59:59 Toronto EDT → '2026-09-14' (not '2026-09-15')
    expect((dateInputs[1] as HTMLInputElement).value).toBe('2026-09-14');
  });

  it('create: POST body uses Toronto midnight, not UTC midnight', async () => {
    const user = userEvent.setup();

    let capturedBody: CreateDonationPeriodInput | null = null;
    vi.spyOn(global, 'fetch').mockImplementationOnce(async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}') as CreateDonationPeriodInput;
      return { ok: true, json: async () => ({ pid: 'bv-brampton-fall-2026', overlapWarning: false }) } as Response;
    });

    render(<PeriodsTable initialPeriods={[]}/>);
    await user.click(screen.getByRole('button', { name: /new period/i }));

    await user.type(screen.getByPlaceholderText('Fall 2026'), 'Fall 2026');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(dateInputs[0] as HTMLElement, '2026-09-01');
    await user.type(dateInputs[1] as HTMLElement, '2027-01-25');

    await user.click(screen.getByRole('button', { name: /create period/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());

    // 2026-09-01 is in EDT (-04:00): Toronto midnight = 04:00 UTC
    expect(capturedBody!.startDate).toBe('2026-09-01T04:00:00.000Z');
    // 2027-01-25 is in EST (-05:00): Toronto 23:59:59 = next day 04:59:59 UTC
    expect(capturedBody!.endDate).toBe('2027-01-26T04:59:59.000Z');
  });
});
