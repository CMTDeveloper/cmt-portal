/**
 * UAT-only, idempotent seed for the single generic KIOSK ACCOUNT that operates
 * the shared door tablet.
 *
 * The portal kiosk check-in endpoint (Slice: kiosk new-ID lookup + auto-enroll)
 * is AUTHENTICATED, not public. A dedicated least-privilege `kiosk` role
 * authorizes it: this one generic email/password account is signed into the
 * tablet once, and its session cookie authorizes check-ins. The `kiosk` role
 * grants nothing else (admin inherits it; nothing inherits admin from it).
 *
 * What this does:
 *   1. Refuses unless PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat', or
 *      --allow-prod is passed. The escape hatch was withheld until the kiosk
 *      cutover and opened on 2026-07-31; see the guard for the hazard it still
 *      carries (a re-run ROTATES the live door password).
 *   2. Reads KIOSK_ACCOUNT_EMAIL + KIOSK_ACCOUNT_PASSWORD from env
 *      (apps/portal/.env.local - never committed; share out-of-band).
 *   3. Creates-or-updates the password Auth user at the contact-derived uid.
 *   4. Writes the `kiosk` capability onto the user's customClaims via
 *      addCapability() - for a fresh account this becomes the primary role
 *      { role: 'kiosk', email }. Re-runs are a no-op (addCapability is
 *      idempotent).
 *
 * Run: pnpm --filter @cmt/portal seed:kiosk-account
 */
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import { addCapability, type ClaimsShape } from '@/lib/auth/role-claims';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';

const EMAIL = process.env['KIOSK_ACCOUNT_EMAIL'];
const PASSWORD = process.env['KIOSK_ACCOUNT_PASSWORD'];
const ALLOW_PROD = process.argv.includes('--allow-prod');

/** Create-or-update the password Auth user at the contact-derived uid. */
async function ensureAuthPassword(email: string, password: string): Promise<string> {
  const auth = portalAuth();
  const canonical = normalizeContactForKey('email', email);
  const uid = sha256Hex(canonical);
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { email: canonical, password, emailVerified: true });
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, email: canonical, password, emailVerified: true });
    } else {
      throw e;
    }
  }
  return uid;
}

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  console.log(`\n=== seed-kiosk-account - project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat' && !ALLOW_PROD) {
    // `--allow-prod` was deliberately withheld until the kiosk cutover, because
    // this creates a SHARED password credential that authorizes writes against
    // real family data, and because §8 puts the kiosk flag last. The runbook's
    // 2026-07-11 entry always anticipated relaxing it here: *"the script hard-
    // refuses non-UAT today, so relax the guard deliberately at cutover"*.
    // Opened 2026-07-31 at the real cutover, on CMT Developer's instruction.
    //
    // ⚠️ The hazard the guard existed for has NOT gone away, so re-read this
    // before running it against prod: `ensureAuthPassword` calls updateUser()
    // on an existing uid, so a re-run ROTATES the live door password to
    // whatever `KIOSK_ACCOUNT_PASSWORD` is in the operator's local .env.local.
    // On a Sunday that locks the tablet out mid-session. Re-run against prod
    // only when you intend to change the password.
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat. Pass --allow-prod to bypass.');
    process.exit(1);
  }
  if (!EMAIL) {
    console.error('Set KIOSK_ACCOUNT_EMAIL in apps/portal/.env.local.');
    process.exit(1);
  }
  if (!PASSWORD) {
    console.error('Set KIOSK_ACCOUNT_PASSWORD in apps/portal/.env.local (min 8 chars, letter+digit).');
    process.exit(1);
  }
  // Enforce the same policy as POST /api/setu/auth/set-password - the Admin
  // SDK floor is only 6 chars with no composition rule, and this is a shared
  // door account with a fixed, committed-adjacent email.
  if (PASSWORD.length < 8 || PASSWORD.length > 128 || !/[a-zA-Z]/.test(PASSWORD) || !/\d/.test(PASSWORD)) {
    console.error('KIOSK_ACCOUNT_PASSWORD must be 8-128 chars with at least one letter and one digit.');
    process.exit(1);
  }

  // Collision guard (mirrors grantStandaloneRole in seed-test-accounts.ts): the
  // kiosk uid is sha256Hex(normalizeContactForKey('email', EMAIL)) - the SAME
  // derivation Setu FAMILY users use. If KIOSK_ACCOUNT_EMAIL maps to a real
  // family's contact, ensureAuthPassword would updateUser() on that family user
  // (resetting their password + emailVerified) and bolt 'kiosk' onto their
  // claims. Refuse before any Auth write. Placed after the UAT + env guards so
  // an unconfigured run still exits without this Firebase read.
  const collision = await findSetuFamilyByContact('email', EMAIL);
  if (collision.source === 'setu') {
    console.error(
      "REFUSING: KIOSK_ACCOUNT_EMAIL must not be an existing family's contact; " +
        'choose a dedicated address like kiosk-tablet@chinmayatoronto.org.',
    );
    process.exit(1);
  }

  const auth = portalAuth();
  const canonical = normalizeContactForKey('email', EMAIL);
  const uid = await ensureAuthPassword(EMAIL, PASSWORD);

  const existing = ((await auth.getUser(uid)).customClaims as ClaimsShape | undefined) ?? null;
  await auth.setCustomUserClaims(uid, addCapability(existing, 'kiosk', canonical));

  console.log(`  kiosk account ready: ${canonical} (uid ${uid}) → role 'kiosk'`);
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
