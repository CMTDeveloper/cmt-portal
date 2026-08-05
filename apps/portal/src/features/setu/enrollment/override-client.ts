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
        /** The zero is a Bala-Vihar waiver, not a settlement. Nothing to record. */
        | 'waived'
        /** The family's donation already arrived through the portal. */
        | 'already-paid'
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
  // Three different 409s, and they need three different sentences. Collapsing
  // them to 'not-active' told an admin their enrollment was cancelled when the
  // real answer was "this is a waiver" or "they already paid" - a message that
  // sends someone looking for a problem that does not exist.
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === 'waived-not-settleable') return { ok: false, reason: 'waived' };
    if (body.error === 'already-paid-in-portal') return { ok: false, reason: 'already-paid' };
    return { ok: false, reason: 'not-active' };
  }
  if (res.status === 400) return { ok: false, reason: 'bad-request' };
  return { ok: false, reason: 'error' };
}

export type AdminEnrollResult =
  | { ok: true; eid: string; suggestedAmount: number }
  | {
      ok: false;
      reason:
        | 'unauthorized'
        | 'forbidden'
        /** The family has nobody the program accepts - e.g. no child of eligible grade. */
        | 'no-eligible-members'
        /** The offering is gone, disabled, or past its end date. */
        | 'offering-unavailable'
        | 'not-found'
        | 'error';
    };

/**
 * POST `/api/welcome/enrollments` - enrol a family on their behalf.
 *
 * Admin-only, and the members are chosen by `enrollFamily` from the program's
 * own eligibility rules rather than by the caller: an admin acting for a family
 * at the office should not be picking children by hand, and the family's own
 * enroll page derives the same set.
 */
export async function enrollFamilyAsAdmin(fid: string, oid: string): Promise<AdminEnrollResult> {
  let res: Response;
  try {
    res = await fetch('/api/welcome/enrollments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fid, oid }),
    });
  } catch {
    return { ok: false, reason: 'error' };
  }

  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { eid?: string; suggestedAmount?: number };
    if (!body.eid) return { ok: false, reason: 'error' };
    return { ok: true, eid: body.eid, suggestedAmount: body.suggestedAmount ?? 0 };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) return { ok: false, reason: 'unauthorized' };
  if (res.status === 403) return { ok: false, reason: 'forbidden' };
  if (body.error === 'no-eligible-members') return { ok: false, reason: 'no-eligible-members' };
  // 422 covers offering-disabled / offering-expired / program-not-available -
  // all "this offering cannot be joined", which reads the same to an admin.
  if (res.status === 422) return { ok: false, reason: 'offering-unavailable' };
  if (res.status === 404) return { ok: false, reason: 'not-found' };
  return { ok: false, reason: 'error' };
}
