'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { startPledgeCheckout } from './start-pledge-client';

export interface StartPledgeButtonProps {
  /** e.g. "Give $51 monthly". The amount is server-derived; this is just copy. */
  label: string;
  block?: boolean;
}

/**
 * Sends the family to the Stripe-hosted mandate page.
 *
 * The redirect is a HARD navigation to a third-party origin, so there is no
 * router involved and nothing to keep in sync. On success we deliberately do NOT
 * clear `pending`: the page is on its way out, and flashing the idle label first
 * invites a second click that would mint a second hosted session.
 */
export function StartPledgeButton({ label, block = false }: StartPledgeButtonProps) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    setPending(true);

    let result: Awaited<ReturnType<typeof startPledgeCheckout>>;
    try {
      result = await startPledgeCheckout();
    } catch {
      toast.error('Network error - please try again.');
      setPending(false);
      return;
    }

    if (result.ok) {
      window.location.href = result.checkoutUrl;
      return;
    }

    if (result.reason === 'unauthorized') {
      window.location.href = '/sign-in?from=%2Ffamily';
      return;
    }
    if (result.reason === 'already-live') {
      // The card is stale, not broken. A hard reload re-reads the pledge and
      // shows the state that already exists rather than reporting a failure.
      toast.error('You already have a monthly donation in progress.');
      window.location.reload();
      return;
    }
    if (result.reason === 'enrollment-required') {
      // Actionable, and the action is free - so name it rather than reporting a
      // failure. The server refuses because a monthly plan funds Bala Vihar, and
      // this family has no Bala Vihar to fund.
      toast.error('Enroll in Bala Vihar first - then you can set up a monthly donation.');
    } else if (result.reason === 'no-enrolled-members') {
      // They ARE enrolled - the enrollment just has nobody in it (the usual
      // cause is the only child having been changed to an adult). Naming the
      // real gap is the difference between an action and a mystery.
      toast.error('Your Bala Vihar enrollment has nobody in it - add a child before setting up a monthly donation.');
    } else if (result.reason === 'manager-required') {
      toast.error('Only the family manager can set up a monthly donation.');
    } else if (result.reason === 'no-email') {
      toast.error('Add an email address to your profile first - the bank needs somewhere to confirm.');
    } else if (result.reason === 'unavailable') {
      toast.error('Monthly donations are temporarily unavailable - please try again later.');
    } else {
      toast.error('Could not start the monthly donation - please try again.');
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
      {pending ? 'Starting…' : label}
    </button>
  );
}
