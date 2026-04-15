import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FamilyLookupForm } from '../family-lookup-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
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
  });
});
