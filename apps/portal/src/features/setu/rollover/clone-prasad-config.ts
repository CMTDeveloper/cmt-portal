import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { balaViharSourceOidsForYear } from './school-year';

type Db = FirebaseFirestore.Firestore;

export interface PrasadCopyResult {
  fromYear: string;
  toYear: string;
  created: string[];
  existing: string[];
}

/**
 * Clone the prasad cap-per-Sunday config (`prasadConfig/{pid}`, pid == BV
 * offering oid) from `fromYear`'s Bala Vihar oids to `toYear`'s oids. Optional
 * rollover convenience: idempotent — a missing source is skipped, and an
 * already-present target is reported as existing and NOT overwritten. The doc
 * shape mirrors what publish-assignments.ts writes:
 * `{ pid, capPerSunday, publishedAt, publishedBy }`.
 */
export async function clonePrasadConfig(
  db: Db,
  args: { fromYear: string; toYear: string; dryRun: boolean; actorMid: string },
): Promise<PrasadCopyResult> {
  const fromOids = balaViharSourceOidsForYear(args.fromYear);
  const toOids = balaViharSourceOidsForYear(args.toYear);
  const created: string[] = [];
  const existing: string[] = [];

  // fromOids/toOids are positionally aligned (same length by construction):
  // index i maps brampton→brampton, scarborough→scarborough.
  for (let i = 0; i < fromOids.length; i++) {
    const src = await db.collection('prasadConfig').doc(fromOids[i]!).get();
    if (!src.exists) continue;

    const targetId = toOids[i]!;
    const targetRef = db.collection('prasadConfig').doc(targetId);
    if ((await targetRef.get()).exists) {
      existing.push(targetId);
      continue;
    }

    created.push(targetId);
    if (!args.dryRun) {
      await targetRef.set({
        pid: targetId,
        capPerSunday: src.data()!['capPerSunday'],
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: args.actorMid,
      });
    }
  }

  return { fromYear: args.fromYear, toYear: args.toYear, created, existing };
}
