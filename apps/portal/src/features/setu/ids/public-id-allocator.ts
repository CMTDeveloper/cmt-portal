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

/**
 * True when `candidate` is already some family's legacy check-in id. The kiosk
 * resolves legacy-first, so a publicFid that equals a legacy id would resolve the
 * WRONG family (and the "use your new Family ID" nudge would send the family to
 * someone else). legacyFid is single-field indexed - a cheap equality read.
 */
async function isExistingLegacyId(candidate: string): Promise<boolean> {
  const snap = await portalFirestore()
    .collection('families')
    .where('legacyFid', '==', candidate)
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * Allocate a NEW family publicFid that is NOT any existing legacy check-in id.
 * The raw counter can hand out a number that collides with a legacy id (both are
 * numeric and overlap); we skip those. Legacy ids are a fixed, retiring set and
 * only a handful sit above the counter, so this loops at most a few times. Each
 * skipped candidate simply burns a counter value (ids need not be contiguous).
 */
export async function allocateFamilyPublicId(): Promise<string> {
  for (let attempts = 0; attempts < 100; attempts++) {
    const [n] = await allocateBlock(FAMILY_COUNTER, FAMILY_START, 1);
    const candidate = String(n);
    if (!(await isExistingLegacyId(candidate))) return candidate;
  }
  throw new Error('allocateFamilyPublicId: could not find a non-legacy id in 100 attempts');
}

export async function allocateMemberPublicIds(count: number): Promise<string[]> {
  const ids = await allocateBlock(MEMBER_COUNTER, MEMBER_START, count);
  return ids.map(String);
}
