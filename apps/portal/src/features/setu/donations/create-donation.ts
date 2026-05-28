import 'server-only';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import type { DonationDoc, DonationType } from '@cmt/shared-domain';

export interface CreateDonationParams {
  fid: string;
  donorMid: string;
  donorName: string;
  donorEmail: string;
  type: DonationType;
  pid: string | null;
  eid: string | null;
  label: string;
  amountCAD: number;
  coverFee: boolean;
  feeCAD: number;
  clientReferenceId: string;
}

/**
 * Writes a `donations/{did}` doc with status='redirected'. The Firestore
 * auto-id becomes the did. Audit trail + the family's own history; accounting
 * remains the source of truth for what actually settled.
 */
export async function createDonation(params: CreateDonationParams): Promise<DonationDoc> {
  const db = portalFirestore();
  const ref = db.collection('donations').doc();
  const now = new Date();

  const doc: DonationDoc = {
    did: ref.id,
    fid: params.fid,
    donorMid: params.donorMid,
    donorName: params.donorName,
    donorEmail: params.donorEmail,
    type: params.type,
    pid: params.pid,
    eid: params.eid,
    label: params.label,
    amountCAD: params.amountCAD,
    coverFee: params.coverFee,
    feeCAD: params.feeCAD,
    clientReferenceId: params.clientReferenceId,
    status: 'redirected',
    createdAt: now,
    updatedAt: now,
  };

  await ref.set({
    ...doc,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return doc;
}
