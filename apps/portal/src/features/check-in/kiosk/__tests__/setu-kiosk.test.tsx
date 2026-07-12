import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KioskHome } from '../kiosk-home';
import type { Family } from '@cmt/shared-domain/check-in';

// A Setu-lookup response (Task 6a) is returned in the exact legacy `Family`
// shape, so the existing panel renders it unchanged. `fid` is the publicFid the
// kiosk resolved from, but the SUBMIT id is the raw entered value (see below).
const setuFamily: Family = {
  fid: '1075',
  name: 'Kumar',
  paymentStatus: 'partial',
  contacts: [],
  students: [
    { sid: '1', fid: '1075', firstName: 'Alice', lastName: 'Kumar', level: 'K' },
    { sid: '2', fid: '1075', firstName: 'Bob', lastName: 'Kumar', level: '1' },
  ],
};

// A legacy-lookup response (fallback path) for a not-yet-migrated family.
const legacyFamily: Family = {
  fid: '477',
  name: 'Old Family',
  paymentStatus: 'paid',
  contacts: [],
  students: [
    { sid: '9', fid: '477', firstName: 'Alice', lastName: 'Old', level: 'K' },
    { sid: '8', fid: '477', firstName: 'Bob', lastName: 'Old', level: '1' },
  ],
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('Setu kiosk flow (KioskHome)', () => {
  it('tries the Setu lookup FIRST and renders the returned children', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => setuFamily,
    } as Response);

    render(<KioskHome />);
    await user.type(screen.getByLabelText(/family id/i), '1075');
    await user.click(screen.getByRole('button', { name: /find/i }));

    expect(global.fetch).toHaveBeenCalledWith('/api/check-in/setu/lookup?id=1075');
    expect(await screen.findByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
  });

  it('falls back to the legacy lookup when the Setu lookup 404s and still renders children', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'family-not-found' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => legacyFamily,
      } as Response);

    render(<KioskHome />);
    await user.type(screen.getByLabelText(/family id/i), '477');
    await user.click(screen.getByRole('button', { name: /find/i }));

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/check-in/setu/lookup?id=477');
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/check-in/families/477');
    expect(await screen.findByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
  });

  it('submits the Setu check-in with { id, students } and shows the enroll confirmation when enroll.created is true', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => setuFamily,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          family: { fid: 'CMT-abc', publicFid: '1075', legacyFid: null, name: 'Kumar' },
          enroll: { enrolled: true, created: true, eid: 'e1' },
          checkInIds: ['a', 'b'],
        }),
      } as Response);

    render(<KioskHome />);
    await user.type(screen.getByLabelText(/family id/i), '1075');
    await user.click(screen.getByRole('button', { name: /find/i }));
    await screen.findByText(/alice/i);

    await user.click(screen.getByRole('button', { name: /check in/i }));

    // Submits the ENTERED id (1075), not family.fid, with the students map.
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/check-in/setu/check-in',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: '1075', students: { '1': true, '2': true } }),
      }),
    );
    expect(await screen.findByText(/added to bala vihar/i)).toBeInTheDocument();
  });

  it('does not show the enroll confirmation when the family was already enrolled (created false)', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => setuFamily,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          family: { fid: 'CMT-abc', publicFid: '1075', legacyFid: null, name: 'Kumar' },
          enroll: { enrolled: true, created: false, eid: 'e1' },
          checkInIds: ['a', 'b'],
        }),
      } as Response);

    render(<KioskHome />);
    await user.type(screen.getByLabelText(/family id/i), '1075');
    await user.click(screen.getByRole('button', { name: /find/i }));
    await screen.findByText(/alice/i);
    await user.click(screen.getByRole('button', { name: /check in/i }));

    // Back to the empty lookup prompt - no confirmation banner for a re-check-in.
    expect(await screen.findByText(/enter your family id/i)).toBeInTheDocument();
    expect(screen.queryByText(/added to bala vihar/i)).not.toBeInTheDocument();
  });

  it('shows the new-Family-ID nudge when a family is resolved by their legacy id', async () => {
    const user = userEvent.setup();
    // Enter the legacy id 477; the Setu lookup resolves the family whose NEW
    // publicFid is 1075. entered (477) !== family.fid (1075) -> nudge.
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => setuFamily,
    } as Response);

    render(<KioskHome />);
    await user.type(screen.getByLabelText(/family id/i), '477');
    await user.click(screen.getByRole('button', { name: /find/i }));
    await screen.findByText(/alice/i);

    expect(screen.getByText(/switching to new family ids/i)).toBeInTheDocument();
    expect(screen.getByText(/instead of 477/i)).toBeInTheDocument();
    // The new id (1075) is rendered prominently (also in the header + sentence).
    expect(screen.getAllByText(/1075/).length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT show the nudge when the family entered their new publicFid already', async () => {
    const user = userEvent.setup();
    // Enter 1075, which IS the family's new publicFid (== family.fid) -> no nudge.
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => setuFamily,
    } as Response);

    render(<KioskHome />);
    await user.type(screen.getByLabelText(/family id/i), '1075');
    await user.click(screen.getByRole('button', { name: /find/i }));
    await screen.findByText(/alice/i);

    expect(screen.queryByText(/switching to new family ids/i)).not.toBeInTheDocument();
  });
});
