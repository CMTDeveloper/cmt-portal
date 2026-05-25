/**
 * Grant / revoke / list admin role.
 *
 * Architecture: roles are keyed by member-id (mid) in Firestore, not by
 * auth-uid. The same person has separate auth uids for email and phone
 * sign-in, but ONE mid. By writing to roleAssignments/{mid}, admin applies
 * regardless of which contact the user OTPs with.
 *
 * Family members → roleAssignments/{mid} (canonical, mid-keyed)
 * Non-family CMT staff (no Bala Vihar family) → legacy auth-claim path
 *   keyed on the contact's canonical-form uid.
 *
 * Usage:
 *   pnpm --filter @cmt/portal exec tsx scripts/grant-admin.ts grant   <email-or-phone>
 *   pnpm --filter @cmt/portal exec tsx scripts/grant-admin.ts revoke  <email-or-phone>
 *   pnpm --filter @cmt/portal exec tsx scripts/grant-admin.ts list
 *
 * Refuses to run unless PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'
 * (override with --allow-prod after explicit confirmation).
 */

import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex } from '@/features/check-in/shared';
import {
  addCapability,
  removeCapability,
  hasCapability,
  type ClaimsShape,
} from '@/lib/auth/role-claims';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import {
  addMemberRole,
  removeMemberRole,
  listMembersWithRole,
} from '@/features/setu/auth/member-roles';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';

type Cmd = 'grant' | 'revoke' | 'list';

function detectType(input: string): 'email' | 'phone' {
  return input.includes('@') ? 'email' : 'phone';
}

function uidOf(type: 'email' | 'phone', value: string): string {
  // Same canonicalization as verify-code/route.ts so legacy auth-claim
  // grants land on the uid that OTP sign-in will create / look up.
  return sha256Hex(normalizeContactForKey(type, value));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const allowProd = rest.includes('--allow-prod');
  const input = rest.find((a) => !a.startsWith('--'));

  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID;
  if (projectId !== 'chinmaya-setu-uat' && !allowProd) {
    console.error(
      `REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${projectId}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`,
    );
    process.exit(1);
  }

  const auth = portalAuth();

  if (cmd === 'list') {
    const memberAdmins = await listMembersWithRole('admin');
    console.log(`\nFamily-member admins in ${projectId} (roleAssignments/*): ${memberAdmins.length}`);
    for (const a of memberAdmins) {
      console.log(`  mid=${a.mid}\tfid=${a.fid}\tgrantedVia=${a.grantedVia ?? '?'}`);
    }

    const legacy: Array<{ uid: string; email: string | null }> = [];
    let token: string | undefined;
    do {
      const page = await auth.listUsers(1000, token);
      for (const u of page.users) {
        const claims = (u.customClaims as ClaimsShape | undefined) ?? null;
        if (hasCapability(claims, 'admin')) {
          const claimsEmail = typeof claims?.email === 'string' ? claims.email : null;
          legacy.push({ uid: u.uid, email: u.email ?? claimsEmail });
        }
      }
      token = page.pageToken;
    } while (token);

    console.log(`\nLegacy auth-claim admins (non-family fallback path): ${legacy.length}`);
    for (const u of legacy) console.log(`  ${u.email ?? '(no email)'}\t${u.uid}`);
    process.exit(0);
  }

  if (!input) {
    console.error(`Usage: ${process.argv[1]} <grant|revoke|list> [email-or-phone] [--allow-prod]`);
    process.exit(1);
  }

  const type = detectType(input);
  const result = await findSetuFamilyByContact(type, input);

  if (cmd === ('grant' as Cmd)) {
    if (result.source === 'setu' && result.fid && result.mid) {
      await addMemberRole({
        mid: result.mid,
        fid: result.fid,
        role: 'admin',
        grantedVia: input,
      });
      console.log(`✓ Granted admin via roleAssignments/${result.mid}`);
      console.log(`  fid=${result.fid}  grantedVia=${input}`);
      console.log(
        `\nNext time they OTP-sign-in (email OR phone), the session will include admin in extraRoles regardless of contact.`,
      );
      process.exit(0);
    }

    // Non-family CMT staff path — legacy auth-claim grant on the canonical
    // uid for the input contact. They sign in directly to /admin (no family).
    const uid = uidOf(type, input);
    let existingClaims: ClaimsShape | null = null;
    try {
      const u = await auth.getUser(uid);
      existingClaims = (u.customClaims as ClaimsShape | undefined) ?? null;
    } catch (err) {
      if ((err as { code?: string }).code === 'auth/user-not-found') {
        const createArg = type === 'email' ? { uid, email: input, disabled: false } : { uid, disabled: false };
        await auth.createUser(createArg);
        console.log(`Created Firebase auth user uid=${uid} (${type}=${input})`);
      } else {
        throw err;
      }
    }
    const newClaims = addCapability(existingClaims, 'admin', type === 'email' ? input : undefined);
    await auth.setCustomUserClaims(uid, newClaims);
    console.log(`✓ Granted admin via auth-claim (no Bala Vihar family found for ${input})`);
    console.log(`  uid=${uid}`);
    console.log(`  Claims: role=${newClaims.role}${newClaims.extraRoles ? ` extraRoles=[${newClaims.extraRoles.join(',')}]` : ''}`);
    process.exit(0);
  }

  if (cmd === ('revoke' as Cmd)) {
    if (result.source === 'setu' && result.mid) {
      await removeMemberRole(result.mid, 'admin');
      console.log(`✓ Revoked admin from roleAssignments/${result.mid}`);
      console.log(`\nNote: any existing session cookie still carries the old claim until expiry.`);
      process.exit(0);
    }

    const uid = uidOf(type, input);
    try {
      const existing = await auth.getUser(uid);
      const existingClaims = (existing.customClaims as ClaimsShape | undefined) ?? null;
      if (!hasCapability(existingClaims, 'admin')) {
        console.log(`No admin role found for ${input} (neither member nor legacy auth-claim).`);
        process.exit(0);
      }
      const newClaims = removeCapability(existingClaims, 'admin');
      await auth.setCustomUserClaims(uid, newClaims);
      console.log(`✓ Revoked admin from legacy auth-claim (uid=${uid})`);
    } catch (err) {
      if ((err as { code?: string }).code === 'auth/user-not-found') {
        console.log(`No admin role found for ${input}.`);
        process.exit(0);
      }
      throw err;
    }
    process.exit(0);
  }

  console.error(`Unknown command: ${cmd}. Use grant | revoke | list.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
