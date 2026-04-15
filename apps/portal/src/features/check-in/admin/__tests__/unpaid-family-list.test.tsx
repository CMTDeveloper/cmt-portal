import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnpaidFamilyList } from '../unpaid-family-list';
import type { Family } from '@cmt/shared-domain/check-in';

const families: Family[] = [
  {
    fid: '1',
    name: 'Acme',
    paymentStatus: 'unpaid',
    contacts: [{ type: 'email', value: 'a@b.com' }],
    students: [],
  },
  {
    fid: '2',
    name: 'Bravo',
    paymentStatus: 'partial',
    contacts: [{ type: 'email', value: 'b@c.com' }],
    students: [],
  },
];

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('UnpaidFamilyList', () => {
  it('renders one row per family', () => {
    render(<UnpaidFamilyList families={families} />);
    expect(screen.getByText(/acme/i)).toBeInTheDocument();
    expect(screen.getByText(/bravo/i)).toBeInTheDocument();
  });

  it('clicking Send donation email calls notifications API', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    render(<UnpaidFamilyList families={families} />);
    const buttons = screen.getAllByRole('button', { name: /send.*donation/i });
    await user.click(buttons[0]!);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/notifications/send-email',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.to).toBe('a@b.com');
    expect(body.template).toBe('donation-thank-you');
  });
});
