import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@cmt/ui', async () => {
  const actual = await vi.importActual<typeof import('@cmt/ui')>('@cmt/ui');
  return { ...actual, toast: toastMock };
});

const checkoutMock = vi.hoisted(() => ({ startEnrollmentCheckout: vi.fn(), startPledgeCheckout: vi.fn() }));
vi.mock('@/features/family/components/start-checkout-client', () => ({
  startEnrollmentCheckout: checkoutMock.startEnrollmentCheckout,
}));
vi.mock('@/features/family/components/start-pledge-client', () => ({
  startPledgeCheckout: checkoutMock.startPledgeCheckout,
}));

import { DonationChoice } from '../donation-choice';

const EID = 'CMT-P672RGSS-bv-brampton-2026-27';

const base = {
  eid: EID,
  oneTimeAmountCAD: 500,
  monthlyAmountCAD: 51,
  canStartPledge: true,
  pledgeState: 'none' as const,
};

beforeEach(() => {
  toastMock.error.mockReset();
  checkoutMock.startEnrollmentCheckout.mockReset();
  checkoutMock.startPledgeCheckout.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '', reload: vi.fn() },
  });
});

describe('DonationChoice - the choice itself', () => {
  it('offers both options as one radio group, with the one-time amount preselected', () => {
    render(<DonationChoice {...base} />);
    const full = screen.getByRole('radio', { name: /full donation/i });
    const monthly = screen.getByRole('radio', { name: /monthly pledge/i });
    // getByRole, not getByText: a radio that is present but not perceivable as
    // checked is the bug this asserts against.
    expect(full).toBeChecked();
    expect(monthly).not.toBeChecked();
    // ONE call to action, not two competing buttons - that ambiguity is the
    // whole reason this component replaced the two stacked CTAs.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('sends the family to Stripe checkout when the one-time option is chosen', async () => {
    const user = userEvent.setup();
    checkoutMock.startEnrollmentCheckout.mockResolvedValueOnce({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_live_1' });
    render(<DonationChoice {...base} />);
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_live_1'));
    expect(checkoutMock.startEnrollmentCheckout).toHaveBeenCalledWith(EID, 500);
    expect(checkoutMock.startPledgeCheckout).not.toHaveBeenCalled();
  });

  it('sends the family to the hosted mandate page when the monthly option is chosen', async () => {
    const user = userEvent.setup();
    checkoutMock.startPledgeCheckout.mockResolvedValueOnce({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_pad' });
    render(<DonationChoice {...base} />);
    await user.click(screen.getByRole('radio', { name: /monthly pledge/i }));
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_test_pad'));
    expect(checkoutMock.startPledgeCheckout).toHaveBeenCalledTimes(1);
    // The one-time path must NOT also fire - that would be a double charge.
    expect(checkoutMock.startEnrollmentCheckout).not.toHaveBeenCalled();
  });
});

describe('DonationChoice - who may commit the family to a debit', () => {
  it('does not let a non-manager select the monthly plan', async () => {
    render(<DonationChoice {...base} canStartPledge={false} />);
    expect(screen.getByRole('radio', { name: /monthly pledge/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /full donation/i })).toBeChecked();
  });

  it('says WHY the monthly plan is unavailable rather than just greying it out', () => {
    render(<DonationChoice {...base} canStartPledge={false} />);
    // A disabled control with no explanation reads as a broken page.
    expect(screen.getByText(/only the family manager/i)).toBeInTheDocument();
  });
});

describe('DonationChoice - a pledge that is still confirming', () => {
  // 🔴 The double-charge hole. A mandate takes days to settle. If the family can
  // still pay $500 while it confirms, they are charged BOTH, and the portal
  // cannot undo it: there is no cancel endpoint and cancelPledgeRecord is
  // bookkeeping only. So a pending pledge gets NO payment control whatsoever.
  it('offers no payment control at all while a pledge is confirming', () => {
    render(<DonationChoice {...base} pledgeState="pending" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('reassures rather than instructs, and says how to change course', () => {
    render(<DonationChoice {...base} pledgeState="pending" />);
    expect(screen.getByText(/setting up your monthly/i)).toBeInTheDocument();
    expect(screen.getByText(/temple office/i)).toBeInTheDocument();
  });
});

describe('DonationChoice - a family already giving monthly', () => {
  it('shows the live plan and never asks for money a second time', () => {
    render(<DonationChoice {...base} pledgeState="giving" />);
    expect(screen.getByText(/\$51 a month/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});

describe('DonationChoice - error handling carried over from the two buttons it replaces', () => {
  it('routes an expired session to sign-in instead of showing a toast', async () => {
    const user = userEvent.setup();
    checkoutMock.startEnrollmentCheckout.mockResolvedValueOnce({ ok: false, reason: 'unauthorized' });
    render(<DonationChoice {...base} />);
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));
    await waitFor(() => expect(window.location.href).toBe('/sign-in?from=%2Ffamily'));
  });

  it('reloads on an already-live pledge rather than reporting a failure', async () => {
    const user = userEvent.setup();
    checkoutMock.startPledgeCheckout.mockResolvedValueOnce({ ok: false, reason: 'already-live' });
    render(<DonationChoice {...base} />);
    await user.click(screen.getByRole('radio', { name: /monthly pledge/i }));
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
  });

  it('surfaces a network failure and re-enables the button so the family can retry', async () => {
    const user = userEvent.setup();
    checkoutMock.startEnrollmentCheckout.mockRejectedValueOnce(new Error('offline'));
    render(<DonationChoice {...base} />);
    const cta = screen.getByRole('button', { name: /continue to donation/i });
    await user.click(cta);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(cta).not.toBeDisabled();
  });

  it('cannot be double-submitted while a redirect is in flight', async () => {
    const user = userEvent.setup();
    checkoutMock.startEnrollmentCheckout.mockImplementation(() => new Promise(() => {}));
    render(<DonationChoice {...base} />);
    const cta = screen.getByRole('button', { name: /continue to donation/i });
    await user.click(cta);
    await waitFor(() => expect(cta).toBeDisabled());
    await user.click(cta);
    expect(checkoutMock.startEnrollmentCheckout).toHaveBeenCalledTimes(1);
  });
});
