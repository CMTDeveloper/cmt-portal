import 'server-only';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import type { GrantableRole } from '@cmt/shared-domain';
import {
  addCapability,
  removeCapability,
  hasCapability,
  type ClaimsShape,
  type Capability,
} from '@/lib/auth/role-claims';
import { findSetuFamilyByContact } from './find-family-by-contact';
import { addMemberRole, removeMemberRole } from './member-roles';

/**
 * Dual-path role management, extracted from scripts/grant-admin.ts and
 * generalized from the hardcoded 'admin' to any GrantableRole. Both the CLI
 * and the /api/admin/users routes call these so the grant/revoke routing
 * stays identical everywhere.
 *
 * Family members → roleAssignments/{mid} (mid-keyed, applies across the
 *   person's email + phone auth uids).
 * Non-family CMT staff → legacy auth-claim path keyed on the canonical-form
 *   uid for the contact.
 */

function detectType(c: string): 'email' | 'phone' {
  return c.includes('@') ? 'email' : 'phone';
}

function uidOf(type: 'email' | 'phone', value: string): string {
  // Same canonicalization as verify-code so legacy auth-claim grants land on
  // the uid that OTP sign-in will create / look up.
  return sha256Hex(normalizeContactForKey(type, value));
}

export interface GrantResult {
  path: 'roleAssignments' | 'auth-claim';
  mid: string | null;
  fid: string | null;
  uid: string | null;
}

export async function grantRole(args: {
  contact: string;
  role: GrantableRole;
}): Promise<GrantResult> {
  const type = detectType(args.contact);
  const result = await findSetuFamilyByContact(type, args.contact);

  if (result.source === 'setu' && result.fid && result.mid) {
    await addMemberRole({
      mid: result.mid,
      fid: result.fid,
      role: args.role,
      grantedVia: args.contact,
    });
    return { path: 'roleAssignments', mid: result.mid, fid: result.fid, uid: null };
  }

  // Non-family → auth claim on the canonical uid.
  const auth = portalAuth();
  const uid = uidOf(type, args.contact);
  let existing: ClaimsShape | null = null;
  try {
    existing = ((await auth.getUser(uid)).customClaims as ClaimsShape | undefined) ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser(
        type === 'email'
          ? { uid, email: args.contact, disabled: false }
          : { uid, disabled: false },
      );
    } else {
      throw err;
    }
  }
  const next = addCapability(
    existing,
    args.role as Capability,
    type === 'email' ? args.contact : undefined,
  );
  await auth.setCustomUserClaims(uid, next);
  return { path: 'auth-claim', mid: null, fid: null, uid };
}

export async function revokeRole(args: {
  contact: string;
  role: GrantableRole;
}): Promise<{ path: GrantResult['path']; revoked: boolean }> {
  const type = detectType(args.contact);
  const result = await findSetuFamilyByContact(type, args.contact);

  if (result.source === 'setu' && result.mid) {
    await removeMemberRole(result.mid, args.role);
    return { path: 'roleAssignments', revoked: true };
  }

  const auth = portalAuth();
  const uid = uidOf(type, args.contact);
  try {
    const existing = ((await auth.getUser(uid)).customClaims as ClaimsShape | undefined) ?? null;
    if (!hasCapability(existing, args.role as Capability)) {
      return { path: 'auth-claim', revoked: false };
    }
    await auth.setCustomUserClaims(uid, removeCapability(existing, args.role as Capability));
    return { path: 'auth-claim', revoked: true };
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      return { path: 'auth-claim', revoked: false };
    }
    throw err;
  }
}
