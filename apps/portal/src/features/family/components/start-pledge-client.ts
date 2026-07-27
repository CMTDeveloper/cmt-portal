export type StartPledgeClientResult =
  | { ok: true; checkoutUrl: string }
  | {
      ok: false;
      reason: 'unauthorized' | 'manager-required' | 'no-email' | 'already-live' | 'unavailable' | 'error';
    };

/**
 * POST `/api/pledges/start` and hand back the Stripe-hosted mandate URL.
 *
 * A separate module from the button for the reason the repo requires everywhere:
 * the component's tests mock THIS, not `fetch`, so a test can never accidentally
 * assert against a mocked network rather than the code that reads the response.
 *
 * Note there is no amount in the request. The amount lives in server env and at
 * Stripe; a client-supplied figure could only ever disagree with what is
 * actually charged.
 */
export async function startPledgeCheckout(): Promise<StartPledgeClientResult> {
  const res = await fetch('/api/pledges/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  if (res.status === 401) return { ok: false, reason: 'unauthorized' };

  const json = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };

  if (!res.ok) {
    // 409 means a pledge is already `started` or `active`. Not an error the
    // family can act on - the card is simply stale, so the honest move is to
    // reload it rather than report a failure.
    if (res.status === 409) return { ok: false, reason: 'already-live' };
    if (json.error === 'manager-required') return { ok: false, reason: 'manager-required' };
    if (json.error === 'no-email') return { ok: false, reason: 'no-email' };
    if (res.status === 503 || res.status === 404) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'error' };
  }

  if (!json.checkoutUrl) return { ok: false, reason: 'error' };
  return { ok: true, checkoutUrl: json.checkoutUrl };
}
