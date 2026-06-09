'use client';
import type { SetMemberGradeBody } from '@cmt/shared-domain';

/**
 * Set one child's `schoolGrade` to a canonical ladder rung via the admin
 * endpoint. Throws on a non-OK response so the caller can fire an error toast
 * (matches the throw-on-non-OK convention of the other -client wrappers). A
 * native app hits the same endpoint with the same body.
 */
export async function setGradeClient({ fid, mid, schoolGrade }: SetMemberGradeBody): Promise<void> {
  const res = await fetch('/api/admin/school-year/set-grade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ fid, mid, schoolGrade }),
  });
  if (!res.ok) throw new Error(`set-grade-failed-${res.status}`);
}
