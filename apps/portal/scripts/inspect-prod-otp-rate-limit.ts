/**
 * READ-ONLY. The §3 pre-cutover audit found `otp_rate_limit` already holding
 * documents in prod 715b8, which the runbook lists as PORTAL-owned and expects
 * to be absent. This prints enough of the existing docs to decide whether that
 * is a genuine collision with the standalone door app.
 *
 * What matters is the SHAPE and the doc-ID scheme, not the contents:
 *   - the portal writes `{ count: number, windowStart: number }` at
 *     doc id `sha256(contact)` (features/check-in/shared/rate-limit)
 *   - a different shape means a different writer, and the portal's reader would
 *     compute `NaN` from it rather than fail loudly
 *   - the SAME shape and scheme means both apps share one 5-per-15-min bucket
 *     per contact, so a family that used the kiosk could be refused by the portal
 *
 * No contact value is printed — the doc id is a hash and stays a hash.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getMasterApp } from '@cmt/firebase-shared/admin/apps';

async function main() {
  const db = getFirestore(getMasterApp());
  console.log(`project: ${process.env.MASTER_FIREBASE_PROJECT_ID}`);

  const snap = await db.collection('otp_rate_limit').limit(25).get();
  const total = await db.collection('otp_rate_limit').count().get();
  console.log(`otp_rate_limit: ${total.data().count} doc(s) total, sampling ${snap.size}\n`);

  const shapes = new Map<string, number>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const keys = Object.keys(data).sort().join(',');
    shapes.set(keys, (shapes.get(keys) ?? 0) + 1);
  }

  console.log('field shapes present:');
  for (const [keys, n] of shapes) console.log(`   ${nPadded(n)}× {${keys}}`);

  console.log('\nsample docs (id truncated; ids are already hashes):');
  for (const doc of snap.docs.slice(0, 8)) {
    const d = doc.data();
    const ws = typeof d.windowStart === 'number' ? new Date(d.windowStart).toISOString() : String(d.windowStart);
    console.log(`   ${doc.id.slice(0, 12)}…  len=${doc.id.length}  count=${String(d.count)}  windowStart=${ws}`);
  }

  // Age tells us whether this is live traffic or an old artifact.
  const withTimes = snap.docs
    .map((d) => d.data().windowStart)
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => b - a);
  if (withTimes.length > 0) {
    const newest = withTimes[0]!;
    const oldest = withTimes[withTimes.length - 1]!;
    const days = (t: number) => ((Date.now() - t) / 86_400_000).toFixed(1);
    console.log(`\nnewest windowStart: ${new Date(newest).toISOString()} (${days(newest)} days ago)`);
    console.log(`oldest windowStart: ${new Date(oldest).toISOString()} (${days(oldest)} days ago)`);
  }
}

function nPadded(n: number): string {
  return String(n).padStart(3);
}

void main();
