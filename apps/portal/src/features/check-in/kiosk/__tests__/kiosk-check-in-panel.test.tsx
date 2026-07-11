import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KioskCheckInPanel } from '../kiosk-check-in-panel';
import type { Family } from '@cmt/shared-domain/check-in';

const family: Family = {
  fid: '42',
  name: 'Acme',
  paymentStatus: 'paid',
  contacts: [],
  students: [
    { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
    { sid: '2', fid: '42', firstName: 'Bob', lastName: 'Acme', level: '1' },
  ],
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('KioskCheckInPanel', () => {
  it('renders the family name and student rows', () => {
    render(<KioskCheckInPanel family={family} source="legacy" checkInId="42" onDone={() => {}} />);
    expect(screen.getAllByText(/acme/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
  });

  it('defaults all students to checked', () => {
    render(<KioskCheckInPanel family={family} source="legacy" checkInId="42" onDone={() => {}} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    for (const b of boxes) expect(b).toBeChecked();
  });

  it('submits students map to POST endpoint', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, checkInIds: ['a', 'b'] }),
    } as Response);

    render(<KioskCheckInPanel family={family} source="legacy" checkInId="42" onDone={onDone} />);
    await user.click(screen.getAllByRole('checkbox')[1]!);
    await user.click(screen.getByRole('button', { name: /check in/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/families/42/check-in',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ students: { '1': true, '2': false } }),
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('shows an error on server failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal' }),
    } as Response);
    render(<KioskCheckInPanel family={family} source="legacy" checkInId="42" onDone={() => {}} />);
    await user.click(screen.getByRole('button', { name: /check in/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
