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

/** Publish = preview + write each NEW row + the config doc. Idempotent: doc id
 *  is `${pid}-${fid}`; existing assignments are never touched (engine keeps them). */
export async function publishAssignments(pid: string, location: string, cap: number, actorMid: string): Promise<PrasadPreviewResult> {
  const proposal = await previewAssignments(pid, location, cap);
  const db = portalFirestore();
  const batchLimit = 400;
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
        source: 'auto', status: 'assigned',
        assignedAt: FieldValue.serverTimestamp(),
        movedFrom: null, movedAt: null, movedBy: null,
        remindedAt: { weekBefore: null, twoDayBefore: null },
      }, { merge: true });
    }
    await batch.commit();
  }
  await db.collection('prasadConfig').doc(pid).set({
    pid, capPerSunday: cap, publishedAt: FieldValue.serverTimestamp(), publishedBy: actorMid,
  }, { merge: true });
  return proposal;
}
