import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/**
 * The `programKey` of a single offering, or `null` when the doc is missing.
 *
 * The generic enroll route receives only an `oid`, so this is how it learns
 * whether it is being asked to enroll a family in the Adult Study Class - which
 * needs explicit membership, mode and waiver arguments - or in anything else,
 * which must keep behaving exactly as it always has.
 *
 * One doc read on a low-frequency mutation route. `enrollFamily` reads the same
 * document again inside its transaction, deliberately: that read is what pins
 * the amount snapshot, and it must happen under the transaction, not here.
 */
export async function getOfferingProgramKey(oid: string): Promise<string | null> {
  const snap = await portalFirestore().collection('offerings').doc(oid).get();
  if (!snap.exists) return null;
  const key = snap.data()?.['programKey'];
  return typeof key === 'string' ? key : null;
}
