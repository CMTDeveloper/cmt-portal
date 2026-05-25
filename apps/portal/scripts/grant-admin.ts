/**
 * Grant / revoke / list admin role on Firebase auth users.
 *
 * Admin is the highest CMT staff role — can manage users, grant welcome-team,
 * see reports, etc. Sign-in is OTP via /sign-in (no password). uid is
 * sha256Hex of the normalized contact value so claims survive sign-in.
 *
 * Same person, multiple uids: a family manager has separate Firebase auth
 * users for their email and phone (uid = sha256Hex(normalize(contact))). To
 * make admin "stick" regardless of which contact they sign in with, this
 * script grants on EVERY uid derivable from the matched family member's
 * email + phone — so they get admin whether they OTP via email or phone.
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
import { addCapability, removeCapability, hasCapability, type ClaimsShape } from '@/lib/auth/role-claims';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';

type Cmd = 'grant' | 'revoke' | 'list';

interface ContactTarget {
  type: 'email' | 'phone';
  value: string;
  uid: string;
}

function detectType(input: string): 'email' | 'phone' {
  return input.includes('@') ? 'email' : 'phone';
}

function uidOf(type: 'email' | 'phone', value: string): string {
  // Must match the verify-code/route.ts uid derivation exactly so grants
  // attach to the same auth user the OTP sign-in flow creates.
  return sha256Hex(normalizeContactForKey(type, value));
}

async function resolveTargets(input: string): Promise<ContactTarget[]> {
  const type = detectType(input);
  const result = await findSetuFamilyByContact(type, input);

  const targets: ContactTarget[] = [];
  const seen = new Set<string>();
  const add = (t: 'email' | 'phone', v: string | null | undefined) => {
    if (!v) return;
    const uid = uidOf(t, v);
    if (seen.has(uid)) return;
    seen.add(uid);
    targets.push({ type: t, value: v, uid });
  };

  // Always include the input contact (in case the family isn't found OR the
  // input isn't the canonical form stored on the member doc).
  add(type, input);

  if (result.source === 'setu' && result.member) {
    const m = result.member as { email?: string | null; phone?: string | null };
    add('email', m.email);
    add('phone', m.phone);
  }

  return targets;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const allowProd = rest.includes('--allow-prod');
  const input = rest.find((a) => !a.startsWith('--'));

  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID;
  if (projectId !== 'chinmaya-setu-uat' && !allowProd) {
    console.error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${projectId}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`);
    process.exit(1);
  }

  const auth = portalAuth();

  if (cmd === 'list') {
    const found: Array<{ uid: string; email: string | null }> = [];
    let token: string | undefined;
    do {
      const page = await auth.listUsers(1000, token);
      for (const u of page.users) {
        const claims = (u.customClaims as ClaimsShape | undefined) ?? null;
        if (hasCapability(claims, 'admin')) {
          const claimsEmail = typeof claims?.email === 'string' ? claims.email : null;
          found.push({ uid: u.uid, email: u.email ?? claimsEmail });
        }
      }
      token = page.pageToken;
    } while (token);

    console.log(`\nAdmins in ${projectId}: ${found.length}\n`);
    for (const u of found) {
      console.log(`  ${u.email ?? '(no email)'}\t${u.uid}`);
    }
    process.exit(0);
  }

  if (!input) {
    console.error(`Usage: ${process.argv[1]} <grant|revoke|list> [email-or-phone] [--allow-prod]`);
    process.exit(1);
  }

  const targets = await resolveTargets(input);
  console.log(`Resolved ${targets.length} contact uid(s) for "${input}":`);
  for (const t of targets) console.log(`  • ${t.type}=${t.value}  uid=${t.uid}`);
  console.log('');

  if (cmd === 'grant' as Cmd) {
    for (const t of targets) {
      let existingClaims: ClaimsShape | null = null;
      try {
        const u = await auth.getUser(t.uid);
        existingClaims = (u.customClaims as ClaimsShape | undefined) ?? null;
      } catch (err) {
        if ((err as { code?: string }).code === 'auth/user-not-found') {
          const createArg = t.type === 'email' ? { uid: t.uid, email: t.value, disabled: false } : { uid: t.uid, disabled: false };
          await auth.createUser(createArg);
          console.log(`  Created Firebase auth user uid=${t.uid} (${t.type}=${t.value})`);
        } else {
          throw err;
        }
      }
      const newClaims = addCapability(existingClaims, 'admin', t.type === 'email' ? t.value : undefined);
      await auth.setCustomUserClaims(t.uid, newClaims);
      console.log(`  ✓ Granted admin to ${t.type}=${t.value} (uid=${t.uid})`);
      console.log(`    Claims: role=${newClaims.role}${newClaims.extraRoles ? ` extraRoles=[${newClaims.extraRoles.join(',')}]` : ''}`);
    }
    console.log(`\nThey can now OTP-sign-in via any of those contacts and get admin capability.`);
    process.exit(0);
  }

  if (cmd === 'revoke' as Cmd) {
    for (const t of targets) {
      try {
        const existing = await auth.getUser(t.uid);
        const existingClaims = (existing.customClaims as ClaimsShape | undefined) ?? null;
        if (!hasCapability(existingClaims, 'admin')) {
          console.log(`  - ${t.type}=${t.value} (uid=${t.uid}) does not have admin (role=${existingClaims?.role ?? 'none'})`);
          continue;
        }
        const newClaims = removeCapability(existingClaims, 'admin');
        await auth.setCustomUserClaims(t.uid, newClaims);
        console.log(`  ✓ Revoked admin from ${t.type}=${t.value} (uid=${t.uid})`);
      } catch (err) {
        if ((err as { code?: string }).code === 'auth/user-not-found') {
          console.log(`  - ${t.type}=${t.value} (uid=${t.uid}) not found — nothing to revoke.`);
          continue;
        }
        throw err;
      }
    }
    console.log(`\nNote: any existing session cookie is still valid until expiry.`);
    process.exit(0);
  }

  console.error(`Unknown command: ${cmd}. Use grant | revoke | list.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
