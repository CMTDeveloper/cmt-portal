import { cache } from 'react';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isSetuManager, type WithRole } from '@cmt/shared-domain';
import { SetuSessionClaimsSchema } from '@cmt/shared-domain/setu';
import type { FamilyDoc, MemberDoc } from '@cmt/shared-domain/setu';
import { getFamilyByFid } from './get-family-by-fid';

export type FamilyWithMembers = {
  family: FamilyDoc;
  members: MemberDoc[];
  currentMid: string;
  isManager: boolean;
};

export const getCurrentFamily = cache(async function getCurrentFamily(): Promise<FamilyWithMembers | null> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  if (!sessionCookie) return null;

  const raw = await verifyPortalSessionCookie(sessionCookie);
  if (!raw) return null;

  const parsed = SetuSessionClaimsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const claims = parsed.data;
  // family-manager / family-member are the family variants of the discriminated
  // SetuSessionClaims union — narrowing on role both gates non-family sessions
  // and gives us fid/mid. We then derive isManager via the shared isSetuManager
  // helper (NOT raw `claims.role === 'family-manager'`) so this gate and
  // getSessionFamily (the API/Bearer sibling, which already uses the helper)
  // can NEVER disagree on manager scope: e.g. a co-manager whose family-manager
  // capability rides in extraRoles gets manager scope HERE exactly as the form
  // already grants it. A mismatch would scope the form (all members) and the
  // gate (own record) differently and bounce the user /complete-profile ⇄ /family.
  if (claims.role !== 'family-manager' && claims.role !== 'family-member') return null;

  const { fid, mid } = claims;
  if (!fid || !mid) return null;

  const cached = await getFamilyByFid(fid);
  if (!cached) return null;

  const withRole: WithRole = {
    role: claims.role,
    ...(claims.extraRoles ? { extraRoles: claims.extraRoles } : {}),
  };

  return {
    family: cached.family,
    members: cached.members,
    currentMid: mid,
    isManager: isSetuManager(withRole),
  };
});
