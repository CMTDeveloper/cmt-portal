// Human-readable copy for the member write routes' error CODES.
//
// POST/PATCH /api/setu/members (and the register guards) return a TOP-LEVEL
// `{ error: '<code>' }` — never a per-field `fields` map. Client surfaces that
// PATCH/POST a member funnel their non-OK response through this helper instead
// of toasting a raw code like "contact-required" at the user. The required-field
// codes mirror the shared member-required-fields matrix.

export interface MemberWriteError {
  error?: string | undefined;
  issues?: Array<{ path?: (string | number)[]; message?: string }> | undefined;
  field?: string | undefined;
}

const MESSAGES: Record<string, string> = {
  'bad-request': 'Please check your inputs and try again.',
  'no-session': 'Your session expired. Please sign in again.',
  'manager-required': 'Only family managers can do that.',
  'manager-flag-requires-manager-role': 'Only a manager can change manager access.',
  'missing-fid': 'Your session is missing family info. Please sign in again.',
  'family-not-found': "We couldn't find your family record. Try signing in again.",
  'skills-required': 'Adults need at least one volunteering skill.',
  'contact-required': 'Adults need both an email and a phone number.',
  'foodAllergies-required': 'Please record food allergies (or pick “No known allergies”).',
  'grade-required': 'Children need a school grade.',
  'birthmonth-required': 'Children need a birth month and year.',
  'last-manager': 'A family must keep at least one manager.',
  // The three participation guards in write-member.ts. Without copy here they
  // fell through to "Something went wrong", which tells a family nothing about
  // an action they CAN complete once they know the order to do it in.
  'enrolled-cannot-deactivate':
    'They are still enrolled in a program this year. Cancel that enrollment first, then mark them as no longer participating.',
  'last-manager-cannot-deactivate':
    'A family must keep at least one manager who takes part. Make someone else a manager first.',
  'manager-must-be-adult': 'Only an adult can be a family manager.',
  'participation-requires-another-member':
    'You can’t change your own participation — ask another family manager to do it.',
  forbidden: 'You don’t have access to that member.',
  'not-found': 'That member could no longer be found.',
};

/**
 * Copy that differs when the person reading it is STAFF rather than the family.
 *
 * Only where the instruction itself changes. The family default for
 * `enrolled-cannot-deactivate` is "Cancel that enrollment first" - true for a
 * family manager, who owns their own enrollments, and false for a welcome-team
 * volunteer: clearing an enrollment goes through /api/welcome/enrollments/*,
 * which is admin-only (can-access-route.ts). Telling the front desk to do
 * something the server will refuse is worse than telling them nothing, because
 * they will try it, fail, and have no idea who can help.
 *
 * This is the desk's most likely subject - a parent ringing to say their
 * enrolled child has stopped coming - so it is the one code worth splitting.
 */
const STAFF_MESSAGES: Record<string, string> = {
  'enrolled-cannot-deactivate':
    'They are still enrolled in a program this year. An admin needs to cancel that enrollment first - the front desk cannot.',
};

/** Maps a member-write error response to a friendly sentence for a toast. */
export function memberWriteErrorMessage(
  data: MemberWriteError,
  audience: 'family' | 'staff' = 'family',
): string {
  const code = data.error ?? 'unknown';
  if (audience === 'staff' && STAFF_MESSAGES[code]) return STAFF_MESSAGES[code];
  if (code === 'bad-request' && Array.isArray(data.issues) && data.issues.length > 0) {
    const issues = data.issues
      .map((i) => `${(i.path ?? []).join('.') || 'field'}: ${i.message ?? 'invalid'}`)
      .join(' · ');
    return `Some fields look off — ${issues}`;
  }
  if (code === 'contact-already-registered') {
    const field = data.field ?? 'contact';
    return `This ${field} is already linked to another family. Use a different ${field}.`;
  }
  return MESSAGES[code] ?? 'Something went wrong. Please try again.';
}
