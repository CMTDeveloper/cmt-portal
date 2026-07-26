'use client';
import { GRADE_LADDER, type SetMemberGradeBody } from '@cmt/shared-domain';

/**
 * Set one child's `schoolGrade` via the WELCOME-TEAM staff route.
 *
 * Deliberately separate from `setGradeClient`, which posts to the admin
 * endpoint and is also used by the /admin/school-year rollover preview.
 * Teaching that shared wrapper about the staff route would silently reroute
 * admin rollover through it.
 *
 * The ladder check is not belt-and-braces. The admin endpoint validates the
 * rung through `SetMemberGradeBodySchema`, but the generic member PATCH accepts
 * any string for `schoolGrade`, so without this an off-ladder value would land
 * in the doc and the next rollover could not place the child (decidePromotion
 * works on ladder positions).
 */
export async function setGradeStaffClient({
  fid,
  mid,
  schoolGrade,
}: SetMemberGradeBody): Promise<void> {
  if (!(GRADE_LADDER as readonly string[]).includes(schoolGrade)) {
    throw new Error(`grade-not-on-ladder:${schoolGrade}`);
  }

  const res = await fetch(
    `/api/welcome/families/${encodeURIComponent(fid)}/members/${encodeURIComponent(mid)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ schoolGrade }),
    },
  );
  if (!res.ok) throw new Error(`set-grade-failed-${res.status}`);
}
