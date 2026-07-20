import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuestCheckInForm } from '../guest-check-in-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('GuestCheckInForm', () => {
  it('renders required fields', () => {
    render(<GuestCheckInForm />);
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/adults/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/children/i)).toBeInTheDocument();
  });

  it('submits to POST /api/check-in/guests', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, id: 'g-1' }),
    } as Response);

    render(<GuestCheckInForm />);
    await user.type(screen.getByLabelText(/first name/i), 'Carol');
    await user.type(screen.getByLabelText(/last name/i), 'Visitor');
    await user.type(screen.getByLabelText(/email/i), 'c@v.com');
    await user.clear(screen.getByLabelText(/adults/i));
    await user.type(screen.getByLabelText(/adults/i), '2');
    await user.clear(screen.getByLabelText(/children/i));
    await user.type(screen.getByLabelText(/children/i), '1');
    await user.click(screen.getByRole('button', { name: /check in/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/guests',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const body = JSON.parse((calls[0]![1] as { body: string }).body);
    expect(body.firstName).toBe('Carol');
    expect(body.numberOfAdults).toBe(2);
  });

  it('shows success message after submit', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, id: 'g-1' }),
    } as Response);
    render(<GuestCheckInForm />);
    await user.type(screen.getByLabelText(/first name/i), 'Carol');
    await user.type(screen.getByLabelText(/last name/i), 'Visitor');
    await user.click(screen.getByRole('button', { name: /check in/i }));
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
    await user.type(screen.getByLabelText(/first name/i), 'Carol');
    await user.type(screen.getByLabelText(/last name/i), 'Visitor');
    await user.click(screen.getByRole('button', { name: /check in/i }));
    await vi.waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        '/check-in/staff-sign-in?error=session-expired',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
