/**
 * Grant / revoke / list admin role.
 *
 * Architecture: roles are keyed by member-id (mid) in Firestore, not by
 * auth-uid. The same person has separate auth uids for email and phone
 * sign-in, but ONE mid. By writing to roleAssignments/{mid}, admin applies
 * regardless of which contact the user OTPs with.
 *
 * Family members → roleAssignments/{mid} (canonical, mid-keyed)
 * Non-family CMT sevaks (no Bala Vihar family) → legacy auth-claim path
 *   keyed on the contact's canonical-form uid.
 *
 * The grant/revoke routing lives in the shared
 * features/setu/auth/manage-roles module (grantRole/revokeRole) so the CLI and
 * the /api/admin/users routes stay in lockstep. This script keeps the CLI
 * surface (output + the UAT/--allow-prod guard) and the `list` command.
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
import { hasCapability, type ClaimsShape } from '@/lib/auth/role-claims';
import { listMembersWithRole } from '@/features/setu/auth/member-roles';
import { grantRole, revokeRole } from '@/features/setu/auth/manage-roles';

type Cmd = 'grant' | 'revoke' | 'list';

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

  if (cmd === ('grant' as Cmd)) {
    const res = await grantRole({ contact: input, role: 'admin' });
    if (res.path === 'roleAssignments') {
      console.log(`✓ Granted admin via roleAssignments/${res.mid}`);
      console.log(`  fid=${res.fid}  grantedVia=${input}`);
      console.log(
        `\nNext time they OTP-sign-in (email OR phone), the session will include admin in extraRoles regardless of contact.`,
      );
    } else {
      console.log(`✓ Granted admin via auth-claim (no Bala Vihar family found for ${input})`);
      console.log(`  uid=${res.uid}`);
    }
    process.exit(0);
  }

  if (cmd === ('revoke' as Cmd)) {
    const res = await revokeRole({ contact: input, role: 'admin' });
    if (res.path === 'roleAssignments') {
      console.log(`✓ Revoked admin from roleAssignments`);
      console.log(`\nNote: any existing session cookie still carries the old claim until expiry.`);
    } else if (res.revoked) {
      console.log(`✓ Revoked admin from legacy auth-claim`);
    } else {
      console.log(`No admin role found for ${input} (neither member nor legacy auth-claim).`);
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
