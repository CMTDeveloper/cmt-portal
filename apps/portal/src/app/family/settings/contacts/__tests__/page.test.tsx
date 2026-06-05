import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: { back: () => <span>back</span>, shield: () => <span>shield</span> },
}));
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/setu/members/get-current-family-client', () => ({
  getCurrentFamilyClient: vi.fn(),
}));
vi.mock('@/features/setu/contacts/contacts-client', () => ({
  sendContactCode: vi.fn(),
  verifyContactCode: vi.fn(),
}));

import ContactsSettingsPage from '../page';
import { getCurrentFamilyClient } from '@/features/setu/members/get-current-family-client';
import { sendContactCode, verifyContactCode } from '@/features/setu/contacts/contacts-client';

beforeEach(() => {
  vi.clearAllMocks();
  (getCurrentFamilyClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    family: { fid: 'CMT-AB12CD34', name: 'Patel' },
    members: [
      { mid: 'CMT-AB12CD34-02', firstName: 'Priya', lastName: 'Patel', email: 'priya@example.com', phone: '+14165550199', altEmails: ['priya.work@example.com'], altPhones: [] },
    ],
    currentMid: 'CMT-AB12CD34-02',
    isManager: false,
  });
  (sendContactCode as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
  (verifyContactCode as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
});

describe('My contacts settings page', () => {
  it('lists the current member primary + alternate contacts', async () => {
    render(<ContactsSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('priya@example.com')).toBeInTheDocument();
      expect(screen.getByText('priya.work@example.com')).toBeInTheDocument();
      expect(screen.getByText('+14165550199')).toBeInTheDocument();
    });
  });

  it('runs the add → OTP → verify flow and shows success', async () => {
    const user = userEvent.setup();
    render(<ContactsSettingsPage />);
    await screen.findByText('priya@example.com');

    await user.click(screen.getByRole('button', { name: /add an email/i }));
    await user.type(screen.getByLabelText(/new email/i), 'priya.alt@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    await waitFor(() => expect(sendContactCode).toHaveBeenCalledWith('email', 'priya.alt@example.com'));

    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() =>
      expect(verifyContactCode).toHaveBeenCalledWith('email', 'priya.alt@example.com', '123456'),
    );
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('shows an error toast when verify reports contact-in-use', async () => {
    (verifyContactCode as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'contact-in-use' });
    const user = userEvent.setup();
    render(<ContactsSettingsPage />);
    await screen.findByText('priya@example.com');

    await user.click(screen.getByRole('button', { name: /add an email/i }));
    await user.type(screen.getByLabelText(/new email/i), 'taken@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => expect(sendContactCode).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
});
