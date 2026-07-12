import { sha256Hex } from '@/features/check-in/shared';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import { findSetuFamilyByContact } from './find-family-by-contact';
import { getMemberRoles } from './member-roles';
import { isTeacherAssigned } from '@/features/setu/teacher/assignments';
import { lazyMigrateLegacyFamily } from '@/features/setu/registration/lazy-migrate';

export interface BuildSessionClaimsArgs {
  type: 'email' | 'phone';
  value: string;
  contactProvenance: 'otp' | 'magic-link' | 'password';
}

export type BuildSessionClaimsResult =
  | { uid: string; claims: Record<string, unknown>; redirectTo: string }
  | { pendingApproval: true; pendingFid: string; pendingMatchedMid: string }
  | { redirectTo: '/register?contact=verified' };

export function hasSession(
  result: BuildSessionClaimsResult,
): result is { uid: string; claims: Record<string, unknown>; redirectTo: string } {
  return 'uid' in result;
}

/**
 * A matched member whose `portalAccess === 'pending'` (and is NOT a manager) is
 * "gated": we recognize the family/member but must NOT mint family claims until
 * a manager approves the join request. The verify-code route surfaces this so
 * the sign-in UI can show "access pending your manager's approval".
 */
export function isPendingApproval(
  result: BuildSessionClaimsResult,
): result is { pendingApproval: true; pendingFid: string; pendingMatchedMid: string } {
  return 'pendingApproval' in result;
}

/** A member is gated iff portalAccess === 'pending' AND it is not a manager. */
function isMemberGated(member: Record<string, unknown> | undefined): boolean {
  if (!member) return false;
  if (member.manager === true) return false;
  return member.portalAccess === 'pending';
}

export async function buildSessionClaimsForContact(
  args: BuildSessionClaimsArgs,
): Promise<BuildSessionClaimsResult> {
  const { type, value } = args;

  const canonicalContact = normalizeContactForKey(type, value);
  const contactClaim = type === 'email' ? { email: canonicalContact } : { phone: canonicalContact };

  const result = await findSetuFamilyByContact(type, value);

  // No Setu/legacy family found — check for pending invite (email only).
  // Invitees need a session (role='family') to call POST /api/setu/invite/accept.
  let hasPendingInvite = false;
  if (result.source === null && type === 'email') {
    try {
      const db = portalFirestore();
      const snap = await db
        .collectionGroup('invites')
        .where('email', '==', canonicalContact)
        .where('acceptedAt', '==', null)
        .limit(1)
        .get();
      if (!snap.empty) {
        const data = snap.docs[0]?.data() as
          | { expiresAt?: { toDate?: () => Date } | string }
          | undefined;
        const expiresAt =
          data?.expiresAt && typeof data.expiresAt === 'object' && data.expiresAt.toDate
            ? data.expiresAt.toDate()
            : data?.expiresAt
              ? new Date(data.expiresAt as string)
              : null;
        if (expiresAt && expiresAt > new Date()) hasPendingInvite = true;
      }
    } catch (err) {
      console.error('[build-session-claims] invite lookup failed:', err);
    }
  }

  // Resolve Firebase auth user. Create if absent.
  const uid = sha256Hex(canonicalContact);
  const auth = portalAuth();
  let existingPrimaryRole: string | undefined;
  let existingExtraRoles: string[] = [];
  try {
    const existing = await auth.getUser(uid);
    const c = (existing.customClaims as Record<string, unknown> | undefined) ?? {};
    if (typeof c.role === 'string') existingPrimaryRole = c.role;
    if (Array.isArray(c.extraRoles)) {
      existingExtraRoles = c.extraRoles.filter((r): r is string => typeof r === 'string');
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, disabled: false });
    } else {
      throw err;
    }
  }

  const allExistingRoles = new Set<string>([
    ...(existingPrimaryRole ? [existingPrimaryRole] : []),
    ...existingExtraRoles,
  ]);

  const memberRoles = result.mid ? await getMemberRoles(result.mid) : [];
  const isAdminUser = allExistingRoles.has('admin') || memberRoles.includes('admin');
  const isWelcomeTeamUser =
    allExistingRoles.has('welcome-team') || memberRoles.includes('welcome-team');
  // Teacher capability is mid-keyed in teacherAssignments (carries levelIds),
  // so it's computed here at session-build time rather than pushed to claims at
  // assignment time. A parent-teacher keeps their family primary role + gains
  // 'teacher' in extraRoles; admin already inherits teacher via isTeacher.
  const isTeacherUser =
    allExistingRoles.has('teacher') || (result.mid ? await isTeacherAssigned(result.mid) : false);
  // Kiosk is a dedicated staff role that lives ONLY on the account's custom
  // claims (a generic tablet account with no family/member), so it comes solely
  // from allExistingRoles - never from a member-role or family resolution.
  const isKioskUser = allExistingRoles.has('kiosk');

  function preservedExtras(): string[] {
    const extras: string[] = [];
    if (isAdminUser) extras.push('admin');
    if (isWelcomeTeamUser && !isAdminUser) extras.push('welcome-team');
    if (isTeacherUser && !isAdminUser) extras.push('teacher');
    return extras;
  }

  // Brand-new user with no invite and no sevak role - no session, redirect to register.
  if (
    result.source === null &&
    !hasPendingInvite &&
    !isWelcomeTeamUser &&
    !isAdminUser &&
    !isKioskUser
  ) {
    return { redirectTo: '/register?contact=verified' };
  }

  let claims: Record<string, unknown> = { role: 'family', familyId: '', ...contactClaim };
  let redirectTo: string = '/register?contact=verified';

  if (result.source === 'setu' && result.fid && result.mid) {
    // Gated member (portalAccess === 'pending', non-manager): recognized but not
    // yet approved. Do NOT mint family claims — return the pending signal so the
    // sign-in UI can show "access pending your manager's approval". A pending
    // member who also carries a sevak (admin/welcome-team) role still gets gated
    // here for their family identity; sevak access is granted via the auth-claim
    // path (no family fid), not via this Setu-member resolution.
    if (isMemberGated(result.member) && !isAdminUser && !isWelcomeTeamUser) {
      return { pendingApproval: true, pendingFid: result.fid, pendingMatchedMid: result.mid };
    }
    const isManager = result.member?.manager === true;
    const extras = preservedExtras();
    claims = {
      role: isManager ? 'family-manager' : 'family-member',
      fid: result.fid,
      mid: result.mid,
      ...contactClaim,
      ...(extras.length > 0 ? { extraRoles: extras } : {}),
    };
    redirectTo = '/family';
  } else {
    // Legacy hit — attempt lazy single-family migration to Setu on first sign-in.
    const legacyFid = result.legacyFid ?? '';
    let migratedToSetu = false;

    if (legacyFid) {
      try {
        await lazyMigrateLegacyFamily(legacyFid);
        const setuResult = await findSetuFamilyByContact(type, value);
        if (setuResult.source === 'setu' && setuResult.fid && setuResult.mid) {
          // A freshly lazy-migrated non-primary adult is portalAccess:'pending'
          // → gated. Short-circuit before minting any family claims.
          if (isMemberGated(setuResult.member) && !isAdminUser && !isWelcomeTeamUser) {
            return {
              pendingApproval: true,
              pendingFid: setuResult.fid,
              pendingMatchedMid: setuResult.mid,
            };
          }
          const extras = preservedExtras();
          claims = {
            role: setuResult.member?.manager === true ? 'family-manager' : 'family-member',
            fid: setuResult.fid,
            mid: setuResult.mid,
            ...contactClaim,
            ...(extras.length > 0 ? { extraRoles: extras } : {}),
          };
          redirectTo = '/family';
          migratedToSetu = true;
        }
      } catch (err) {
        console.error('[build-session-claims] lazyMigrateLegacyFamily failed', err);
      }
    }

    if (!migratedToSetu) {
      claims = { role: 'family', familyId: legacyFid, ...contactClaim };
      redirectTo = '/register?contact=verified';
    }
  }

  // Admin / welcome-team: only applies when user has no family.
  // Family-manager who also has admin claim stays in their family role.
  if (result.source === null && !hasPendingInvite) {
    if (isAdminUser) {
      claims = { role: 'admin', ...contactClaim };
      redirectTo = '/admin';
    } else if (isWelcomeTeamUser) {
      claims = { role: 'welcome-team', ...contactClaim };
      redirectTo = '/welcome';
    } else if (isKioskUser) {
      // Generic kiosk tablet account: mint a kiosk session and land on the
      // check-in kiosk. isKiosk() inherits admin, so an admin above wins first.
      claims = { role: 'kiosk', ...contactClaim };
      redirectTo = '/check-in';
    }
  }

  return { uid, claims, redirectTo };
}
