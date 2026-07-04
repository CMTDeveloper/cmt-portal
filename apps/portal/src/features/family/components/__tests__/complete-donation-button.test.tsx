import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

import { CompleteDonationButton } from '../complete-donation-button';

const EID = 'CMT-P672RGSS-bv-brampton-2026-27';

// jsdom does not allow assigning window.location.href (it would navigate), so
// replace location with a plain writable stub the component can set + we can read.
beforeEach(() => {
  toastMock.error.mockReset();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '' },
  });
});

describe('CompleteDonationButton', () => {
  it('POSTs the enrolled amount and redirects straight to Stripe', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' }),
    } as Response);

    render(<CompleteDonationButton eid={EID} amountCAD={500} label="Complete donation" />);

    await user.click(screen.getByRole('button', { name: /complete donation/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/setu/donations/checkout');
    expect(JSON.parse(String(init?.body))).toEqual({
      type: 'enrollment',
      eid: EID,
      amountCAD: 500,
      coverFee: false,
    });

    await waitFor(() =>
      expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_test_123'),
    );
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('toasts and stays on the page when checkout is not configured', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'checkout-not-configured' }),
    } as Response);

    render(<CompleteDonationButton eid={EID} amountCAD={500} label="Complete donation" />);
    await user.click(screen.getByRole('button', { name: /complete donation/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledOnce());
    expect(toastMock.error.mock.calls[0]![0]).toMatch(/temporarily unavailable/i);
    // No redirect — the family stays put and can retry.
    expect(window.location.href).toBe('');
    // The button re-enables after the error.
    expect(screen.getByRole('button', { name: /complete donation/i })).not.toBeDisabled();
  });

  it('sends a 401 (expired session) to sign-in without hitting checkout', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'no-session' }),
    } as Response);

    render(<CompleteDonationButton eid={EID} amountCAD={500} label="Complete donation" />);
    await user.click(screen.getByRole('button', { name: /complete donation/i }));

    await waitFor(() => expect(window.location.href).toBe('/sign-in?from=%2Ffamily'));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('falls back to the donate page for a $0 (free program) amount without calling checkout', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(global, 'fetch');

    render(<CompleteDonationButton eid={EID} amountCAD={0} label="Continue to donation →" />);
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.location.href).toBe(`/family/donate?eid=${encodeURIComponent(EID)}`);
  });
});
