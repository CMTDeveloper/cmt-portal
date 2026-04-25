import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventRegistrationForm } from '../registration-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const testConfig = {
  eventDisplayName: 'CMT Mothers Day',
  eventPosterUrl: '/event-poster.jpeg',
  eventCampaign: '2026MothersDay',
  pricePerPerson: 10,
  enableStripe: false,
  etransferEmail: 'events@chinmayatoronto.org',
};

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

async function fillNonBvForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Non-Bala Vihar Family$/ }));
  await user.type(screen.getByPlaceholderText(/your full name/i), 'Test User');
  await user.type(screen.getByPlaceholderText(/you@example\.com/i), 'test@example.com');
  // tab away to trigger blur without triggering the verify-registration duplicate check wait
  await user.tab();
  await user.type(screen.getByPlaceholderText(/\+1 \(555\)/i), '4165550000');
}

describe('EventRegistrationForm — server error message surface', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    if (typeof window !== 'undefined') window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('400 with server error message shows that message (not generic) on the form', async () => {
    const user = userEvent.setup();
    // The email blur triggers verify-registration — stub it to return no-op
    mockFetchResponse(200, {});

    render(<EventRegistrationForm config={testConfig} />);
    await fillNonBvForm(user);

    // Now stub the register endpoint to return 400 with a specific error
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Mothers count cannot exceed 1 for this registration' }),
    } as Response);

    await user.click(screen.getByRole('button', { name: /Continue to Payment/i }));

    await waitFor(() => {
      expect(screen.getByText('Mothers count cannot exceed 1 for this registration')).toBeDefined();
    });

    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it('non-OK response without error body falls back to generic message', async () => {
    const user = userEvent.setup();
    // Stub email blur verify-registration
    mockFetchResponse(200, {});

    render(<EventRegistrationForm config={testConfig} />);
    await fillNonBvForm(user);

    // Stub register endpoint to return 500 with empty body
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    await user.click(screen.getByRole('button', { name: /Continue to Payment/i }));

    await waitFor(() => {
      expect(screen.getByText(/something went wrong\. please try again\./i)).toBeDefined();
    });
  });
});
