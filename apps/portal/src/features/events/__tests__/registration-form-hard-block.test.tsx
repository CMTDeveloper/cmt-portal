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
  enableStripe: true,
  etransferEmail: 'events@chinmayatoronto.org',
};

function mockFetchOnce(body: Record<string, unknown>) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => body,
  } as Response);
}

describe('EventRegistrationForm — hard block on duplicate registration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // Ensure fresh sessionStorage state between tests
    if (typeof window !== 'undefined') window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the form when BV Family email verification returns existingRegistration', async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      isBvFamily: true,
      fid: '42',
      familyEmails: ['parent@example.com'],
      familyPhones: ['4165551234'],
      existingRegistration: { registrationId: 'MD26-ABC1234', paymentStatus: 'completed' },
    });

    render(<EventRegistrationForm config={testConfig} />);

    // Pick BV Family category (button contains "Bala Vihar Family")
    await user.click(screen.getByRole('button', { name: /^Bala Vihar Family$/ }));

    // Enter email in the BV verify input and click the Verify button
    await user.click(screen.getByRole('button', { name: /^Email$/ }));
    const bvEmailInput = screen.getByPlaceholderText(/BV registered email/i);
    await user.type(bvEmailInput, 'parent@example.com');
    await user.click(screen.getByRole('button', { name: /Verify BV Status/i }));

    // Existing Registration banner renders
    await waitFor(() => {
      expect(screen.getByText(/existing registration found/i)).toBeDefined();
    });

    // Banner shows the registration ID
    expect(screen.getByText(/MD26-ABC1234/)).toBeDefined();

    // HARD BLOCK: form body fields must NOT render
    expect(screen.queryByLabelText(/full name/i)).toBeNull();
    expect(screen.queryByLabelText(/phone number/i)).toBeNull();
    // Submit/register-now button must not be present
    expect(screen.queryByRole('button', { name: /continue to payment|register now|submit registration/i })).toBeNull();
  });

  it('shows the form normally when BV verification returns NO existingRegistration', async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      isBvFamily: true,
      fid: '42',
      familyEmails: ['parent@example.com'],
      familyPhones: ['4165551234'],
      // no existingRegistration → form should show
    });

    render(<EventRegistrationForm config={testConfig} />);

    await user.click(screen.getByRole('button', { name: /^Bala Vihar Family$/ }));
    await user.click(screen.getByRole('button', { name: /^Email$/ }));
    const bvEmailInput = screen.getByPlaceholderText(/BV registered email/i);
    await user.type(bvEmailInput, 'parent@example.com');
    await user.click(screen.getByRole('button', { name: /Verify BV Status/i }));

    // Banner should NOT appear
    await waitFor(() => {
      expect(screen.queryByText(/existing registration found/i)).toBeNull();
    });

    // Form fields render (full name label is present when form is visible)
    expect(screen.getByLabelText(/full name/i)).toBeDefined();
  });
});
