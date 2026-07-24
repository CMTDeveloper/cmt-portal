import 'server-only';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import {
  hasCapability,
  removeCapability,
  type Capability,
  type ClaimsShape,
} from '@/lib/auth/role-claims';

/**
 * Force-sign-out primitives for privilege revocation.
 *
 * Portal session cookies live for up to 14 days and carry the role/family/member
 * claims minted at sign-in; middleware verifies them with checkRevoked=true but
 * does NOT re-read live role state. So removing a role/member without revoking
 * refresh tokens leaves the old session fully privileged until it expires.
 *
 * Worse, build-session-claims OR's a member's PERSISTED custom claims
 * (extraRoles) with their live roleAssignments on every sign-in. So for a family
 * member, simply deleting the roleAssignment is not enough — the mirrored
 * capability re-grants itself on the next sign-in (and for a DELETED member,
 * escalates into a standalone admin/welcome-team session). Revocation must
 * therefore also strip the mirrored capability from the member's auth claims.
 */

/**
 * Sevak capabilities that build-session-claims can resurrect from persisted
 * custom claims. These must be stripped from a member's auth uids when their
 * role/membership is removed — not just have their roleAssignment deleted.
 */
export const RESURRECTABLE_SEVAK_CAPS: Capability[] = ['admin', 'welcome-team'];

function uidForContact(contact: string): string {
  const type = contact.includes('@') ? 'email' : 'phone';
  return sha256Hex(normalizeContactForKey(type, contact));
}

/** Revoke a single auth uid's refresh tokens. Best-effort — a missing user is a no-op. */
export async function revokeUidSessions(uid: string): Promise<void> {
  try {
    await portalAuth().revokeRefreshTokens(uid);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') return;
    throw err;
  }
}

/**
 * Force immediate sign-out for a Setu family member across BOTH auth uids
 * (email + phone). A member's roles are mid-keyed and apply to whichever contact
 * the person used for OTP sign-in, so revoking one uid is not enough.
 *
 * When `stripCaps` is provided, each listed capability is first removed from that
 * uid's persisted custom claims (closing the build-session-claims re-grant loop)
 * BEFORE its refresh tokens are revoked. Best-effort per uid; a missing auth user
 * is skipped, never thrown.
 */
export async function revokeMemberSessions(args: {
  email?: string | null;
  phone?: string | null;
  stripCaps?: Capability[];
}): Promise<{ uids: string[] }> {
  const auth = portalAuth();
  const contacts = [args.email, args.phone].filter((c): c is string => Boolean(c));
  const uids = [...new Set(contacts.map(uidForContact))];
  const stripCaps = args.stripCaps ?? [];

  await Promise.all(
    uids.map(async (uid) => {
      if (stripCaps.length > 0) {
        try {
          const existing =
            ((await auth.getUser(uid)).customClaims as ClaimsShape | undefined) ?? null;
          let next: ClaimsShape | null = existing;
          let changed = false;
          for (const cap of stripCaps) {
            if (hasCapability(next, cap)) {
              next = removeCapability(next, cap);
              changed = true;
            }
          }
          if (changed) await auth.setCustomUserClaims(uid, next ?? {});
        } catch (err) {
          if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
        }
      }
      await revokeUidSessions(uid);
    }),
  );

  return { uids };
}
