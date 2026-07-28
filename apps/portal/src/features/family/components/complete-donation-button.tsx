'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { startEnrollmentCheckout, type EnrollmentCheckoutResult } from './start-checkout-client';

export interface CompleteDonationButtonProps {
  /** Enrollment id — the checkout is pinned to this enrollment's offering. */
  eid: string;
  /**
   * The enrollment-resolved suggested amount (CAD), sent verbatim. The checkout
   * route re-derives and enforces the floor server-side, so this is the price the
   * family actually pays — the client value is just the pre-fill.
   */
  amountCAD: number;
  /** Button copy, e.g. "Complete donation" or "Continue to donation →". */
  label: string;
  /** Render full-width (btn--block) — used inside the enroll page's sticky footer. */
  block?: boolean;
}

/**
 * Sends the family straight to Stripe checkout at the enrollment-resolved price,
 * skipping the in-portal amount picker at /family/donate. Give-more and
 * fee-cover are intentionally dropped from this path (owner decision 2026-07-04).
 *
 * NOTE: the /family/donate page carried a (currently DORMANT) Bala Vihar
 * acknowledgements gate. It is force-OFF today, so bypassing the page is not a
 * regression. If those acknowledgements are ever re-enabled, this button MUST
 * route back to /family/donate?eid= instead of going direct to Stripe.
 */
export function CompleteDonationButton({ eid, amountCAD, label, block = false }: CompleteDonationButtonProps) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;

    // Degenerate case (free program / $0 suggested): the checkout API requires
    // amountCAD >= 1, so fall back to the full donate page which handles it.
    if (amountCAD < 1) {
      window.location.href = `/family/donate?eid=${encodeURIComponent(eid)}`;
      return;
    }

    setPending(true);
    let result: EnrollmentCheckoutResult;
    try {
      result = await startEnrollmentCheckout(eid, amountCAD);
    } catch {
      toast.error('Network error — please try again.');
      setPending(false);
      return;
    }

    // Straight to the Stripe-hosted checkout page. Navigation unmounts us — do
    // NOT clear pending (avoids a flash of the idle label before the redirect).
    if (result.ok) {
      window.location.href = result.url;
      return;
    }
    if (result.reason === 'unauthorized') {
      // Session expired mid-click — send to sign-in, back to the dashboard after.
      window.location.href = '/sign-in?from=%2Ffamily';
      return;
    }
    if (result.reason === 'below-suggested') {
      toast.error(`The suggested amount is $${result.suggested}. Please contact the welcome team to give less.`);
    } else if (result.reason === 'not-configured') {
      toast.error('Donations are temporarily unavailable — please try again later.');
    } else if (result.reason === 'manager-required') {
      toast.error('Only the family manager can make a donation through the portal.');
    } else {
      toast.error('Could not start checkout — please try again.');
    }
    setPending(false);
  }

  return (
    <button
      type="button"
      className={`btn btn--p${block ? ' btn--block' : ''}`}
      disabled={pending}
      onClick={handleClick}
      style={block ? { display: 'block', width: '100%', opacity: pending ? 0.7 : 1 } : { opacity: pending ? 0.7 : 1 }}
    >
      {pending ? 'Starting checkout…' : label}
    </button>
  );
}
