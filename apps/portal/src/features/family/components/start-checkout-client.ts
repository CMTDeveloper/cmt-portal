export type EnrollmentCheckoutResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: 'unauthorized' | 'below-suggested' | 'not-configured' | 'manager-required' | 'error';
      suggested?: number;
    };

/**
 * POST the enrollment donation checkout and return the Stripe URL (or a typed
 * failure). Shared by the dashboard/enroll "Complete donation" button AND the
 * post-enrollment redirect, so BOTH go straight to Stripe (skipping the
 * /family/donate amount-picker page). The checkout route re-derives + enforces
 * the suggested-amount floor server-side, so `amountCAD` is just the pre-fill.
 */
export async function startEnrollmentCheckout(
  eid: string,
  amountCAD: number,
  coverFee = false,
): Promise<EnrollmentCheckoutResult> {
  const res = await fetch('/api/setu/donations/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'enrollment', eid, amountCAD, coverFee }),
  });

  if (res.status === 401) return { ok: false, reason: 'unauthorized' };

  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string; suggested?: number };

  if (!res.ok) {
    const reason: Exclude<EnrollmentCheckoutResult, { ok: true }>['reason'] =
      json.error === 'amount-below-suggested'
        ? 'below-suggested'
        : json.error === 'checkout-not-configured'
          ? 'not-configured'
          : json.error === 'manager-required'
            ? 'manager-required'
            : 'error';
    // exactOptionalPropertyTypes: only include `suggested` when present.
    return { ok: false, reason, ...(json.suggested !== undefined ? { suggested: json.suggested } : {}) };
  }

  if (!json.url) return { ok: false, reason: 'error' };
  return { ok: true, url: json.url };
}
