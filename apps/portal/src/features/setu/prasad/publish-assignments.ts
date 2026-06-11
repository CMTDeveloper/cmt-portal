import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { proposePrasadAssignments, type PrasadProposal } from '@cmt/shared-domain';
import { loadEngineInput } from './load-engine-input';

export interface PrasadPreviewResult extends PrasadProposal {
  defaultCap: number;
  eligibleSundayCount: number;
}

export async function previewAssignments(pid: string, location: string, cap?: number): Promise<PrasadPreviewResult> {
  const { input, defaultCap, eligibleSundayCount } = await loadEngineInput(pid, location, cap);
  return { ...proposePrasadAssignments(input), defaultCap, eligibleSundayCount };
}

/** Publish = preview + write each NEW row as a PROPOSAL + the config doc. Idempotent:
 *  doc id is `${pid}-${fid}`; existing assignments are never touched (engine keeps
 *  them — rows are NEW-families-only, so this can never downgrade a confirmed doc). */
export async function publishAssignments(pid: string, location: string, cap: number, actorMid: string): Promise<PrasadPreviewResult> {
  const proposal = await previewAssignments(pid, location, cap);
  const db = portalFirestore();
  const batchLimit = 400;
  // Rows are NEW-families-only (any fid holding an assigned OR proposed doc at
  // preview-read is excluded by loadEngineInput), so a re-publish never rewrites
  // an existing row. Residual race: a doc created for the same fid between the
  // preview read and this batch (e.g. a double-clicked concurrent publish)
  // merge-writes identical content — harmless and idempotent.
  for (let i = 0; i < proposal.rows.length; i += batchLimit) {
    const batch = db.batch();
    for (const row of proposal.rows.slice(i, i + batchLimit)) {
      const paid = `${pid}-${row.fid}`;
      batch.set(db.collection('prasadAssignments').doc(paid), {
        paid, pid, fid: row.fid,
        familyName: row.familyName, location: row.location,
        date: row.date,
        youngestMid: row.youngestMid, youngestName: row.youngestName,
        birthMonth: row.birthMonth, reason: row.reason,
        source: 'auto', status: 'proposed',
        assignedAt: FieldValue.serverTimestamp(),
        movedFrom: null, movedAt: null, movedBy: null,
        remindedAt: { weekBefore: null, twoDayBefore: null },
        confirmedAt: null, confirmedBy: null, proposalNotifiedAt: null,
      }, { merge: true });
    }
    await batch.commit();
  }
  await db.collection('prasadConfig').doc(pid).set({
    pid, capPerSunday: cap, publishedAt: FieldValue.serverTimestamp(), publishedBy: actorMid,
  }, { merge: true });
  return proposal;
}
