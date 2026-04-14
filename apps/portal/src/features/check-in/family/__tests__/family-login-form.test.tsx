import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FamilyLoginForm } from '../family-login-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('FamilyLoginForm - contact step', () => {
  it('renders email and phone tabs', () => {
    render(<FamilyLoginForm />);
    expect(screen.getByRole('tab', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /phone/i })).toBeInTheDocument();
  });

  it('submits email -> fetches /api/auth/family/send-code', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    render(<FamilyLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/family/send-code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
      }),
    );
  });

  it('moves to OTP step after successful send', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    render(<FamilyLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
  });

  it('shows error on 404', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'family-not-found' }),
    } as Response);
    render(<FamilyLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
  });

  it('shows throttle message on 429', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate-limited', resetAt: '2026-04-13T20:00:00Z' }),
    } as Response);
    render(<FamilyLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many/i);
  });
});

describe('FamilyLoginForm - OTP step', () => {
  async function reachOtpStep() {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    render(<FamilyLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    await screen.findByLabelText(/verification code/i);
    return user;
  }

  it('submits code -> /api/auth/family/verify-code', async () => {
    const user = await reachOtpStep();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectTo: '/check-in/family' }),
    } as Response);
    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/family/verify-code',
      expect.objectContaining({
        body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '123456' }),
      }),
    );
  });

  it('shows error on invalid code', async () => {
    const user = await reachOtpStep();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid-code' }),
    } as Response);
    await user.type(screen.getByLabelText(/verification code/i), '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
  });
});
