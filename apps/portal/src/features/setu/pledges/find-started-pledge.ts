import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { PledgeStatus } from '@cmt/shared-domain/setu';

export interface StartedPledge {
  pid: string;
  /** The hosted session to ask the provider about. Absent if start never landed. */
  setupSessionId: string | null;
}

/**
 * The family's in-flight pledge - the one still awaiting the hosted page.
 *
 * Lives in the pledges feature rather than in the route that needs it, because
 * `pledge-isolation.test.ts` holds that this feature is the ONLY thing that
 * reads the `pledges` collection. That invariant is what stops pledge state
 * leaking into surfaces that have not thought about what `started` means, and
 * it caught this query the moment it was written in an API route instead.
 *
 * `started` ONLY. An `active` plan is not in flight and must never be swept up
 * by a caller looking for something to cancel; `failed`/`cancelled` are already
 * terminal and there is nothing to end.
 *
 * Queried by `fid` alone - a single-field equality Firestore indexes
 * automatically - with the status filtered in memory, exactly as `startPledge`
 * does. A family has a handful of pledge rows at most, and a second `where`
 * would need a composite index this feature otherwise does not require.
 */
export async function findStartedPledge(fid: string): Promise<StartedPledge | null> {
  const snap = await portalFirestore().collection('pledges').where('fid', '==', fid).get();
  for (const doc of snap.docs) {
    const d = doc.data() as { status?: PledgeStatus; setupSessionId?: string };
    if (d.status === 'started') {
      return { pid: doc.id, setupSessionId: d.setupSessionId ?? null };
    }
  }
  return null;
}
