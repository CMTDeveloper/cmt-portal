import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isTeacher, isWelcomeTeam, type SessionClaims } from '@cmt/shared-domain';

// Shared by the /docs layout and pages: who is reading the docs?
// Middleware already gates /docs (welcome-team | teacher | admin), but every
// surface re-verifies the cookie defensively (same pattern as the teacher
// and admin layouts) and the pages need the claims for per-guide filtering.
export async function getDocsViewer(): Promise<SessionClaims | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  if (!sessionCookie) return null;
  const raw = await verifyPortalSessionCookie(sessionCookie);
  if (!raw) return null;
  const claims = raw as unknown as SessionClaims;
  if (!isWelcomeTeam(claims) && !isTeacher(claims)) return null;
  return claims;
}
