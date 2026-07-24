import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuestCheckInForm } from '../guest-check-in-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

/** Fill the always-required parent fields (first/last/email/phone). */
async function fillContact(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/first name/i), 'Carol');
  await user.type(screen.getByLabelText(/last name/i), 'Visitor');
  await user.type(screen.getByLabelText(/^email$/i), 'c@v.com');
  await user.type(screen.getByLabelText(/^phone$/i), '+16475550100');
}

describe('GuestCheckInForm', () => {
  it('renders the required contact fields and an add-child control', () => {
    render(<GuestCheckInForm />);
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^phone$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/adults/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add child/i })).toBeInTheDocument();
  });

  it('submits contact + per-child name and grade to POST /api/check-in/guests', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, id: 'g-1' }),
    } as Response);

    render(<GuestCheckInForm />);
    await fillContact(user);
    await user.clear(screen.getByLabelText(/adults/i));
    await user.type(screen.getByLabelText(/adults/i), '2');

    // Add one child and give them a name + grade.
    await user.click(screen.getByRole('button', { name: /add child/i }));
    await user.type(screen.getByLabelText(/child 1 name/i), 'Aarav Visitor');
    await user.selectOptions(screen.getByLabelText(/child 1 grade/i), '2');

    await user.click(screen.getByRole('button', { name: /check in as guest/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/guests',
      expect.objectContaining({ method: 'POST' }),
    );
    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const body = JSON.parse((calls[0]![1] as { body: string }).body);
    expect(body.firstName).toBe('Carol');
    expect(body.email).toBe('c@v.com');
    expect(body.phone).toBe('+16475550100');
    expect(body.numberOfAdults).toBe(2);
    expect(body.children).toEqual([{ name: 'Aarav Visitor', grade: '2' }]);
  });

  it('blocks submit and shows an error when a child row is missing its grade', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(global, 'fetch');

    render(<GuestCheckInForm />);
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /add child/i }));
    await user.type(screen.getByLabelText(/child 1 name/i), 'Aarav Visitor');
    // No grade selected.
    await user.click(screen.getByRole('button', { name: /check in as guest/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/name and a grade/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows an adults-only check-in with no children', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, id: 'g-2' }),
    } as Response);

    render(<GuestCheckInForm />);
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /check in as guest/i }));

    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const body = JSON.parse((calls[0]![1] as { body: string }).body);
    expect(body.children).toEqual([]);
    expect(await screen.findByText(/thank you/i)).toBeInTheDocument();
  });

  it('on a 401 hard-navigates to staff sign-in and does NOT show the generic error', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    } as Response);
    render(<GuestCheckInForm />);
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /check in as guest/i }));
    await vi.waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        '/check-in/staff-sign-in?error=session-expired',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
