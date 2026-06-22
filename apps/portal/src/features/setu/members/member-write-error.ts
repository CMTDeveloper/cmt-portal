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
  forbidden: 'You don’t have access to that member.',
  'not-found': 'That member could no longer be found.',
};

/** Maps a member-write error response to a friendly sentence for a toast. */
export function memberWriteErrorMessage(data: MemberWriteError): string {
  const code = data.error ?? 'unknown';
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
