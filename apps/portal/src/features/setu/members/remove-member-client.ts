export type RemoveMemberResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'unauthorized'
        /** Signed in, but not an admin. Removing a person is admin-only. */
        | 'forbidden'
        /** A family must keep at least one manager - refused by the write core. */
        | 'last-manager'
        | 'not-found'
        | 'error';
    };

/**
 * DELETE `/api/welcome/families/{fid}/members/{mid}` - remove one member of any
 * family, as staff.
 *
 * ── Why this wrapper exists at all ──────────────────────────────────────────
 * The route has been there since the staff member screens shipped; nothing
 * called it. Families did their own removals from `/family/members/[mid]/edit`
 * until 2026-08-04, when Vaibhav asked for that button to go: *"we do not want
 * families to remove any members. At the very least, they can only disable."*
 * Withdrawing it without giving the office the same capability would have made
 * a mistyped duplicate permanent, so the two changes ship together.
 *
 * A separate module from the component for the repo's usual reason: the
 * control's tests mock THIS, so they can never accidentally assert against a
 * mocked `fetch` instead of the code that reads the response.
 */
export async function removeFamilyMember(fid: string, mid: string): Promise<RemoveMemberResult> {
  let res: Response;
  try {
    res = await fetch(
      `/api/welcome/families/${encodeURIComponent(fid)}/members/${encodeURIComponent(mid)}`,
      { method: 'DELETE', credentials: 'same-origin' },
    );
  } catch {
    return { ok: false, reason: 'error' };
  }

  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, reason: 'unauthorized' };
  if (res.status === 403) return { ok: false, reason: 'forbidden' };
  if (res.status === 404) return { ok: false, reason: 'not-found' };
  // 409 is the last-manager guard. Read the body rather than assuming, so a
  // future conflict on this route cannot inherit copy about managers.
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, reason: body.error === 'last-manager' ? 'last-manager' : 'error' };
  }
  return { ok: false, reason: 'error' };
}
