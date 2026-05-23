import { cache } from 'react';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
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
  if (claims.role !== 'family-manager' && claims.role !== 'family-member') return null;

  const { fid, mid } = claims;

  const cached = await getFamilyByFid(fid);
  if (!cached) return null;

  return {
    family: cached.family,
    members: cached.members,
    currentMid: mid,
    isManager: claims.role === 'family-manager',
  };
});
