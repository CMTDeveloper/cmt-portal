/**
 * One-shot: confirm whether a phone number normalizes to a contactKey hash
 * that actually exists in Setu Firestore. Prints the canonical form, the
 * computed hash, and what (if anything) is at that doc.
 *
 * Usage:
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local \
 *     scripts/debug-phone-lookup.ts --phone "+14379712609"
 */

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';

async function main() {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--phone');
  const input = idx >= 0 ? argv[idx + 1] : null;
  if (!input) {
    console.error('Usage: --phone "+14379712609"');
    process.exit(1);
  }

  const canonical = normalizeContactForKey('phone', input);
  const hash = hashContactKey('phone', input);
  console.log(`input      : ${input}`);
  console.log(`canonical  : ${canonical}`);
  console.log(`hash       : ${hash}`);

  const db = portalFirestore();
  const snap = await db.collection('contactKeys').doc(hash).get();
  if (snap.exists) {
    console.log(`\n✓ contactKey EXISTS → ${JSON.stringify(snap.data())}`);
    const data = snap.data() as { fid?: string };
    if (data.fid) {
      const fam = await db.collection('families').doc(data.fid).get();
      console.log(`\nFamily: ${JSON.stringify(fam.data())}`);
    }
    return;
  }

  console.log(`\n✗ contactKey MISSING.`);

  // Try alternate forms to diagnose hash skew
  const digits = input.replace(/\D/g, '');
  const variants = [
    digits,
    digits.length === 10 ? `1${digits}` : null,
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : null,
  ].filter((v): v is string => Boolean(v));

  for (const v of variants) {
    const altHash = hashContactKey('phone', v);
    const altSnap = await db.collection('contactKeys').doc(altHash).get();
    if (altSnap.exists) {
      console.log(`  → BUT a hash for "${v}" DOES exist: ${altHash}`);
      console.log(`    ${JSON.stringify(altSnap.data())}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
