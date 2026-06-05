import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/features/setu/contacts/contacts-client', () => ({ dismissContactsNudge: vi.fn() }));

import { ContactsNudge } from '../contacts-nudge';
import { dismissContactsNudge } from '@/features/setu/contacts/contacts-client';

beforeEach(() => {
  vi.clearAllMocks();
  (dismissContactsNudge as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
});

describe('ContactsNudge', () => {
  it('renders the prompt with a link to My contacts', () => {
    render(<ContactsNudge />);
    expect(screen.getByText(/other emails/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add contacts/i })).toHaveAttribute('href', '/family/settings/contacts');
  });

  it('dismiss calls the API and hides the banner', async () => {
    const user = userEvent.setup();
    render(<ContactsNudge />);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(dismissContactsNudge).toHaveBeenCalled());
    expect(screen.queryByText(/other emails/i)).toBeNull();
  });
});
