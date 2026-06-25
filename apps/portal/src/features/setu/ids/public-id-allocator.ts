// NOTE: deliberately NO `import 'server-only'`. This allocator is reached by the
// UAT CLIs (the public-id backfill + every seed, via registerFamily / lazy-migrate),
// which run under plain tsx where `server-only` is unresolvable. It is server-side
// by virtue of importing the Firebase Admin SDK below — the same guard the rest of
// `@cmt/firebase-shared/admin/*` relies on — and is never imported by a client
// component.
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

const FAMILY_COUNTER = 'familyPublicId';
const MEMBER_COUNTER = 'memberPublicId';
const FAMILY_START = 1001;
const MEMBER_START = 50001;

async function allocateBlock(counter: string, start: number, count: number): Promise<number[]> {
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  const db = portalFirestore();
  const ref = db.collection('counters').doc(counter);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.next ?? start) : start;
    const base = Number.isFinite(current) ? current : start;
    tx.set(ref, { next: base + count }, { merge: true });
    return Array.from({ length: count }, (_, i) => base + i);
  });
}

export async function allocateFamilyPublicId(): Promise<string> {
  const [n] = await allocateBlock(FAMILY_COUNTER, FAMILY_START, 1);
  return String(n);
}

export async function allocateMemberPublicIds(count: number): Promise<string[]> {
  const ids = await allocateBlock(MEMBER_COUNTER, MEMBER_START, count);
  return ids.map(String);
}
