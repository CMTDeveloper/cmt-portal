import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FamilyIdLookupForm } from '../family-id-lookup-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('FamilyIdLookupForm', () => {
  it('renders a family-id input and submit button', () => {
    render(<FamilyIdLookupForm onFamily={() => {}} />);
    expect(screen.getByLabelText(/family id/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find/i })).toBeInTheDocument();
  });

  it('calls GET /api/check-in/families/:familyId on submit', async () => {
    const user = userEvent.setup();
    const onFamily = vi.fn();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ fid: '42', name: 'Acme', paymentStatus: 'paid', contacts: [], students: [] }),
    } as Response);

    render(<FamilyIdLookupForm onFamily={onFamily} />);
    await user.type(screen.getByLabelText(/family id/i), '42');
    await user.click(screen.getByRole('button', { name: /find/i }));

    expect(global.fetch).toHaveBeenCalledWith('/api/check-in/families/42');
    expect(onFamily).toHaveBeenCalledWith(expect.objectContaining({ fid: '42' }));
  });

  it('shows error on 404', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'family-not-found' }),
    } as Response);
    render(<FamilyIdLookupForm onFamily={() => {}} />);
    await user.type(screen.getByLabelText(/family id/i), '999');
    await user.click(screen.getByRole('button', { name: /find/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
  });

  it('rejects non-numeric input', async () => {
    const user = userEvent.setup();
    render(<FamilyIdLookupForm onFamily={() => {}} />);
    await user.type(screen.getByLabelText(/family id/i), 'abc');
    await user.click(screen.getByRole('button', { name: /find/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid number/i);
  });
});
