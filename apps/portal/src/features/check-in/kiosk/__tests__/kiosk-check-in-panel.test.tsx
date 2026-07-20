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
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
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

  it('shows every member including adults, labelled "Adult", all checked by default', () => {
    const withAdults: Family = {
      ...family,
      students: [
        { sid: '10', fid: '42', firstName: 'Dinesh', lastName: 'Acme', level: '', isAdult: true },
        { sid: '11', fid: '42', firstName: 'Noopur', lastName: 'Acme', level: '', isAdult: true },
        ...family.students,
      ],
    };
    render(<KioskCheckInPanel family={withAdults} source="legacy" checkInId="42" onDone={() => {}} />);
    expect(screen.getByText('Dinesh Acme')).toBeInTheDocument();
    expect(screen.getByText('Noopur Acme')).toBeInTheDocument();
    expect(screen.getAllByText('Adult')).toHaveLength(2);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    for (const b of boxes) expect(b).toBeChecked();
  });

  it('shows a child\'s level AND grade, deduped when they are the same (Vaibhav)', () => {
    const withLevels: Family = {
      ...family,
      students: [
        // Distinct level + grade → both shown, level first.
        { sid: '1', fid: '42', firstName: 'Aarav', lastName: 'Acme', level: 'Level 6', grade: 'Grade 6' },
        // Off-season fallback: level == grade → shown once, not "Grade 2 · Grade 2".
        { sid: '2', fid: '42', firstName: 'Isha', lastName: 'Acme', level: 'Grade 2', grade: 'Grade 2' },
      ],
    };
    render(<KioskCheckInPanel family={withLevels} source="setu" checkInId="42" onDone={() => {}} />);
    expect(screen.getByText('Level 6 · Grade 6')).toBeInTheDocument();
    expect(screen.getByText('Grade 2')).toBeInTheDocument();
    expect(screen.queryByText('Grade 2 · Grade 2')).not.toBeInTheDocument();
  });

  it('shows the "tap to mark not present" instruction', () => {
    render(<KioskCheckInPanel family={family} source="legacy" checkInId="42" onDone={() => {}} />);
    expect(screen.getByText(/mark them as not present/i)).toBeInTheDocument();
  });

  it('toggling by clicking anywhere on the member row unchecks that member', async () => {
    const user = userEvent.setup();
    render(<KioskCheckInPanel family={family} source="legacy" checkInId="42" onDone={() => {}} />);
    // Click the member's NAME (not the checkbox) - the whole row is tappable.
    await user.click(screen.getByText('Bob Acme'));
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
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

  it('on a 401 hard-navigates to staff sign-in and does NOT show the generic error', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    } as Response);
    render(<KioskCheckInPanel family={family} source="legacy" checkInId="42" onDone={() => {}} />);
    await user.click(screen.getByRole('button', { name: /check in/i }));
    await vi.waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        '/check-in/staff-sign-in?error=session-expired',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
