export type AbandonPledgeResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'unauthorized'
        /** A mandate may exist at Stripe - clearing the record could double it. */
        | 'mandate-may-exist'
        /** Nothing in flight; the screen is stale. */
        | 'nothing-to-abandon'
        | 'unavailable'
        | 'error';
    };

/**
 * POST `/api/pledges/abandon` - clear an attempt the family never finished.
 *
 * A separate module from the button for the reason the repo requires
 * everywhere: the component's tests mock THIS, so a test can never accidentally
 * assert against a mocked network rather than the code that reads the response.
 *
 * No body. Which pledge is being abandoned is decided server-side from the
 * session's `fid` - a client-supplied pid would let a manager clear a record by
 * guessing its id.
 */
export async function abandonPledge(): Promise<AbandonPledgeResult> {
  const res = await fetch('/api/pledges/abandon', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  if (res.status === 401) return { ok: false, reason: 'unauthorized' };

  const json = (await res.json().catch(() => ({}))) as { error?: string };

  if (!res.ok) {
    // Two different 409s again, and they need different words: one means "we
    // could not rule out a live mandate", the other "there was nothing there".
    if (json.error === 'mandate-may-exist') return { ok: false, reason: 'mandate-may-exist' };
    if (json.error === 'nothing-to-abandon') return { ok: false, reason: 'nothing-to-abandon' };
    if (res.status === 503 || res.status === 404) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'error' };
  }

  return { ok: true };
}
