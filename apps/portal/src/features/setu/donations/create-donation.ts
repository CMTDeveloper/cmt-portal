import 'server-only';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import type { DonationDoc, DonationType } from '@cmt/shared-domain';

export interface CreateDonationParams {
  fid: string;
  donorMid: string;
  donorName: string;
  donorEmail: string;
  type: DonationType;
  programKey: string | null;
  programLabel: string | null;
  pid: string | null;
  eid: string | null;
  label: string;
  amountCAD: number;
  coverFee: boolean;
  feeCAD: number;
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
    programKey: params.programKey,
    programLabel: params.programLabel,
    pid: params.pid,
    eid: params.eid,
    label: params.label,
    amountCAD: params.amountCAD,
    coverFee: params.coverFee,
    feeCAD: params.feeCAD,
    // The did IS the client_reference_id we send to Stripe — store it so the
    // Stripe dashboard row maps 1:1 back to this donation doc.
    clientReferenceId: ref.id,
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
