import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FamilyLookupForm } from '../family-lookup-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('FamilyLookupForm', () => {
  it('renders email/phone tabs and contact input', () => {
    render(<FamilyLookupForm />);
    expect(screen.getByRole('tab', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /phone/i })).toBeInTheDocument();
  });

  it('submits email → /api/check-in/lookup and shows family ID on success', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ familyId: '42' }),
    } as Response);

    render(<FamilyLookupForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /look up/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/lookup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
      }),
    );
    expect(await screen.findByText(/42/)).toBeInTheDocument();
  });

  it('leads with the NEW Family ID and marks the legacy id as retiring (Vaibhav)', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ familyId: '477', publicFid: '5891' }),
    } as Response);

    render(<FamilyLookupForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /look up/i }));

    // New id shown prominently (appears as the big number AND in the "enter …"
    // sentence).
    expect(await screen.findByText('Your new Family ID')).toBeInTheDocument();
    expect(screen.getAllByText('5891').length).toBeGreaterThan(0);
    // Legacy id called out as the one to stop using.
    expect(screen.getByText(/instead of 477/)).toBeInTheDocument();
  });

  it('shows error on 404', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not-found' }),
    } as Response);
    render(<FamilyLookupForm />);
    await user.type(screen.getByLabelText(/email/i), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: /look up/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('on a 401 hard-navigates to staff sign-in and does NOT show a 404 error', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    } as Response);
    render(<FamilyLookupForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /look up/i }));
    await vi.waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        '/check-in/staff-sign-in?error=session-expired',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
