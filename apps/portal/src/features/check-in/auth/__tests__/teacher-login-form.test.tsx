import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeacherLoginForm } from '../teacher-login-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('TeacherLoginForm', () => {
  it('renders a single passphrase input', () => {
    render(<TeacherLoginForm />);
    expect(screen.getByLabelText(/passphrase/i)).toBeInTheDocument();
  });

  it('posts passphrase to /api/auth/teacher/signin', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectTo: '/check-in/teacher' }),
    } as Response);

    render(<TeacherLoginForm />);
    await user.type(screen.getByLabelText(/passphrase/i), 'TeacherOM!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/teacher/signin',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ passphrase: 'TeacherOM!' }),
      }),
    );
  });

  it('shows an error on 401', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    } as Response);
    render(<TeacherLoginForm />);
    await user.type(screen.getByLabelText(/passphrase/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/passphrase/i);
  });
});
