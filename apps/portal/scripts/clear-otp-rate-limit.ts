/**
 * UAT debug utility: clear the OTP / password-sign-in rate-limit doc for a
 * contact so repeated sign-in repros (E2E + manual testing) aren't blocked by the
 * 5-per-15-min limiter. The doc id is sha256(normalizeContact(type, value)) in the
 * `otp_rate_limit` collection (see features/check-in/shared/rate-limit).
 *
 * Refuses to run unless the target is chinmaya-setu-uat (pass --allow-prod to
 * override — rarely needed; clearing a prod limiter is harmless but UAT-only is
 * the firm default).
 *
 * Run:
 *   pnpm --filter @cmt/portal clear:otp-rate-limit <email-or-phone> [--type phone] [--allow-prod]
 */
import { createHash } from 'node:crypto';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { normalizeContact } from '@/features/check-in/shared';

function parseArgs(argv: string[]): { value: string | null; type: 'email' | 'phone'; allowProd: boolean } {
  let type: 'email' | 'phone' = 'email';
  let allowProd = false;
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === '--allow-prod') {
      allowProd = true;
    } else if (a === '--type') {
      const next = argv[i + 1];
      if (next === 'phone' || next === 'email') type = next;
      i++;
    } else if (!a.startsWith('--')) {
      positionals.push(a);
    }
  }
  return { value: positionals[0] ?? null, type, allowProd };
}

async function main(): Promise<void> {
  const { value, type, allowProd } = parseArgs(process.argv.slice(2));
  if (!value) {
    console.error('Usage: clear:otp-rate-limit <email-or-phone> [--type phone] [--allow-prod]');
    process.exit(1);
  }

  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  console.log(`project: ${projectId}`);
  if (projectId !== 'chinmaya-setu-uat' && !allowProd) {
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat (pass --allow-prod to override).');
    process.exit(1);
  }

  const normalized = normalizeContact(type, value);
  const hash = createHash('sha256').update(normalized).digest('hex');
  const ref = portalFirestore().collection('otp_rate_limit').doc(hash);
  const snap = await ref.get();

  console.log(`contact: ${type}=${value} → normalized=${normalized}`);
  console.log(`doc: otp_rate_limit/${hash} exists=${snap.exists}${snap.exists ? ` data=${JSON.stringify(snap.data())}` : ''}`);
  if (snap.exists) {
    await ref.delete();
    console.log('DELETED — the limiter is cleared; sign-in repros work again immediately.');
  } else {
    console.log('Already clear — no rate-limit doc to delete.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
