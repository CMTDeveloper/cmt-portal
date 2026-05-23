import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@cmt/ui', () => ({
  SetuIcon: {
    user: () => <span data-testid="user-icon">user</span>,
  },
  toast: { error: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { SignOutButton, signOut } from '../sign-out-button';
import { toast } from '@cmt/ui';

describe('signOut', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    });
  });

  it('redirects to /sign-in on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await signOut();
    expect(mockFetch).toHaveBeenCalledWith('/api/setu/auth/signout', { method: 'POST' });
    expect(window.location.href).toBe('/sign-in');
  });

  it('shows toast error on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    await signOut();
    expect(toast.error).toHaveBeenCalledWith('Sign out failed. Please try again.');
    expect(window.location.href).not.toBe('/sign-in');
  });
});

describe('SignOutButton', () => {
  it('renders sign out button with icon by default', () => {
    render(<SignOutButton/>);
    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.getByTestId('user-icon')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('calls fetch on click', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<SignOutButton/>);
    await user.click(screen.getByRole('button'));
    expect(mockFetch).toHaveBeenCalledWith('/api/setu/auth/signout', { method: 'POST' });
  });
});
