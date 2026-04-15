import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminUserList } from '../admin-user-list';

const initial = [
  { uid: 'u1', email: 'admin1@cmt.org' },
  { uid: 'u2', email: 'admin2@cmt.org' },
];

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('AdminUserList', () => {
  it('renders every admin', () => {
    render(<AdminUserList users={initial} currentUid="u1" />);
    expect(screen.getByText(/admin1@cmt.org/)).toBeInTheDocument();
    expect(screen.getByText(/admin2@cmt.org/)).toBeInTheDocument();
  });

  it('disables delete on the current caller', () => {
    render(<AdminUserList users={initial} currentUid="u1" />);
    const buttons = screen.getAllByRole('button', { name: /delete/i });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).not.toBeDisabled();
  });

  it('submits DELETE on non-self click', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    render(<AdminUserList users={initial} currentUid="u1" />);
    const buttons = screen.getAllByRole('button', { name: /delete/i });
    await user.click(buttons[1]!);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/admin/users/u2',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
