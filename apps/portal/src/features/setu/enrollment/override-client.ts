export type OverrideResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'unauthorized'
        /** Signed in, but not an admin. Only admins may rewrite what a family owes. */
        | 'forbidden'
        /** The enrollment is cancelled - there is nothing live to mark paid. */
        | 'not-active'
        | 'not-found'
        /** The note failed validation (blank, or under 3 characters after trim). */
        | 'bad-request'
        | 'error';
    };

/**
 * PATCH `/api/welcome/enrollments/{eid}/override` - change what a family is
 * asked to give, with a reason.
 *
 * A separate module from the component for the reason the repo requires
 * everywhere: the control's tests mock THIS, not `fetch`, so a test can never
 * accidentally assert against a mocked network instead of the code that reads
 * the response.
 *
 * `note` is required by the schema, not just by the form. A UI-only rule is not
 * a rule - the same lesson `participation` taught when both screens refused to
 * offer it and the route accepted it anyway.
 */
export async function setEnrollmentOverride(
  eid: string,
  suggestedAmountOverride: number | null,
  note: string,
): Promise<OverrideResult> {
  let res: Response;
  try {
    res = await fetch(`/api/welcome/enrollments/${encodeURIComponent(eid)}/override`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ suggestedAmountOverride, note }),
    });
  } catch {
    return { ok: false, reason: 'error' };
  }

  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, reason: 'unauthorized' };
  if (res.status === 403) return { ok: false, reason: 'forbidden' };
  if (res.status === 404) return { ok: false, reason: 'not-found' };
  if (res.status === 409) return { ok: false, reason: 'not-active' };
  if (res.status === 400) return { ok: false, reason: 'bad-request' };
  return { ok: false, reason: 'error' };
}
