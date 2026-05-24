/**
 * Grant / revoke / list welcome-team role on Firebase auth users.
 *
 * Welcome-team is a CMT volunteer role that can search any family via /welcome
 * but cannot mutate. Granted manually by admins. uid is sha256Hex of the
 * normalized email — matches /api/setu/auth/verify-code so the user's claims
 * survive their OTP sign-in.
 *
 * Usage:
 *   pnpm --filter @cmt/portal exec tsx scripts/grant-welcome-team.ts grant   <email>
 *   pnpm --filter @cmt/portal exec tsx scripts/grant-welcome-team.ts revoke  <email>
 *   pnpm --filter @cmt/portal exec tsx scripts/grant-welcome-team.ts list
 *
 * Refuses to run unless PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'
 * (override with --allow-prod after explicit confirmation).
 */

import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex, normalizeContact } from '@/features/check-in/shared';

type Cmd = 'grant' | 'revoke' | 'list';

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const allowProd = rest.includes('--allow-prod');
  const email = rest.find((a) => !a.startsWith('--'));

  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID;
  if (projectId !== 'chinmaya-setu-uat' && !allowProd) {
    console.error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${projectId}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`);
    process.exit(1);
  }

  const auth = portalAuth();

  if (cmd === 'list') {
    let page;
    const found: Array<{ uid: string; email: string | null }> = [];
    let token: string | undefined;
    do {
      page = await auth.listUsers(1000, token);
      for (const u of page.users) {
        const claims = (u.customClaims as Record<string, unknown> | undefined) ?? {};
        if (claims.role === 'welcome-team') {
          // Email lives in customClaims, not on the auth record itself.
          const claimsEmail = typeof claims.email === 'string' ? claims.email : null;
          found.push({ uid: u.uid, email: u.email ?? claimsEmail });
        }
      }
      token = page.pageToken;
    } while (token);

    console.log(`\nWelcome-team users in ${projectId}: ${found.length}\n`);
    for (const u of found) {
      console.log(`  ${u.email ?? '(no email)'}\t${u.uid}`);
    }
    process.exit(0);
  }

  if (!email) {
    console.error(`Usage: ${process.argv[1]} <grant|revoke|list> [email] [--allow-prod]`);
    process.exit(1);
  }

  const normalized = normalizeContact('email', email);
  const uid = sha256Hex(normalized);

  if (cmd === 'grant' as Cmd) {
    try {
      await auth.getUser(uid);
    } catch (err) {
      if ((err as { code?: string }).code === 'auth/user-not-found') {
        await auth.createUser({ uid, email, disabled: false });
        console.log(`Created Firebase auth user uid=${uid} email=${email}`);
      } else {
        throw err;
      }
    }
    await auth.setCustomUserClaims(uid, { role: 'welcome-team', email });
    console.log(`✓ Granted welcome-team to ${email} (uid=${uid})`);
    console.log(`  They can now sign in at https://cmt-portal-portal.vercel.app/sign-in (any sign-in route)`);
    console.log(`  and land at /welcome with read access to all families.`);
    process.exit(0);
  }

  if (cmd === 'revoke' as Cmd) {
    try {
      const existing = await auth.getUser(uid);
      const role = (existing.customClaims as Record<string, unknown> | undefined)?.role;
      if (role !== 'welcome-team') {
        console.log(`User ${email} does not have welcome-team role (current role=${role ?? 'none'})`);
        process.exit(0);
      }
      // Drop the role claim entirely. Their session keeps working until expiry
      // (Firebase doesn't auto-revoke), but new sign-ins won't get welcome-team.
      await auth.setCustomUserClaims(uid, {});
      console.log(`✓ Revoked welcome-team from ${email} (uid=${uid})`);
      console.log(`  Note: any existing session cookie is still valid until expiry.`);
      console.log(`  To force-revoke immediately, call auth.revokeRefreshTokens(uid).`);
      process.exit(0);
    } catch (err) {
      if ((err as { code?: string }).code === 'auth/user-not-found') {
        console.log(`User ${email} not found — nothing to revoke.`);
        process.exit(0);
      }
      throw err;
    }
  }

  console.error(`Unknown command: ${cmd}. Use grant | revoke | list.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
