/**
 * POST the family's enrollment and return a typed result.
 *
 * Extracted from `EnrollCta` so the enroll page's "Choose your donation" block
 * can enrol a family that has not yet joined, WITHOUT duplicating the
 * eight-branch error ladder below. Two copies of that ladder would drift, and
 * the branches that matter most (`no-eligible-members`, `no-selectable-adults`)
 * are the ones a second author is least likely to reproduce.
 *
 * Returns the human-facing message rather than a bare code: every caller shows
 * the same toast, and keeping the wording here is what stops the two surfaces
 * telling a family two different things about the same failure.
 */
export type EnrollResult =
  | { ok: true; eid: string | null; suggestedAmount: number; donateUrl: string | null }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'failed'; message: string };

export async function enrollFamily(oid: string): Promise<EnrollResult> {
  const res = await fetch('/api/setu/enrollments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oid }),
  });

  if (res.status === 401) return { ok: false, reason: 'unauthorized' };

  const json = (await res.json().catch(() => ({}))) as {
    eid?: string;
    suggestedAmount?: number;
    donateUrl?: string;
    error?: string;
  };

  if (!res.ok) return { ok: false, reason: 'failed', message: enrollErrorMessage(json.error) };

  return {
    ok: true,
    eid: json.eid ?? null,
    suggestedAmount: json.suggestedAmount ?? 0,
    donateUrl: json.donateUrl ?? null,
  };
}

/** The family-facing wording for an enrollment failure. */
export function enrollErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'offering-disabled':
      return 'This term is no longer enrolling — please contact the welcome team.';
    case 'offering-expired':
      return 'This term has ended — please contact the welcome team.';
    case 'offering-not-found':
      return 'This term is no longer available — please refresh and try again.';
    case 'program-not-available':
      return 'This program is not available right now — please check back soon.';
    case 'no-selectable-adults':
      // Deterministic and actionable - retrying changes nothing. Every adult in
      // the household is assigned to teach (or there are none), so nobody is
      // left who could attend the class.
      return 'Everyone in your family is already teaching during this class.';
    case 'no-eligible-members':
      // Two causes now, not one. Since 2026-08-03 a family CAN have children
      // and still hit this - anyone marked "no longer participating" is
      // filtered server-side, and the lazy migration marks a child inactive
      // when the legacy roster had no class level for them. "Add a child" told
      // that family to add someone they were looking at.
      return 'No child in your family is taking part right now. Add a child, or bring one back from My family.';
    case 'family-not-found':
    case 'missing-fid':
      console.error('[enrollFamily] unexpected error:', error);
      return 'Something went wrong — please sign out and sign in again.';
    default:
      return 'Enrollment failed — please try again.';
  }
}
