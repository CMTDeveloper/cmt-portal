import { isSetuFamily, isSetuManager } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getFamilyByFid } from './get-family-by-fid';
import type { FamilyWithMembers } from './get-current-family';

/**
 * Header-based sibling of getCurrentFamily for API ROUTE HANDLERS.
 *
 * getCurrentFamily() re-reads the __session cookie, which silently 401s
 * Bearer (mobile) callers even though middleware already verified their ID
 * token. Middleware forwards the verified claims as x-portal-* request
 * headers for BOTH cookie and Bearer sessions, so route handlers should
 * authenticate from headers — server COMPONENTS (no request object) keep
 * using getCurrentFamily().
 */
export async function getSessionFamily(req: Request): Promise<FamilyWithMembers | null> {
  const session = readSessionFromHeaders(req);
  if (!session || !isSetuFamily(session)) return null;
  const { fid, mid } = session;
  if (!fid || !mid) return null;

  const cached = await getFamilyByFid(fid);
  if (!cached) return null;

  return {
    family: cached.family,
    members: cached.members,
    currentMid: mid,
    isManager: isSetuManager(session),
  };
}
