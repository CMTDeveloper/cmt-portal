import 'server-only';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { buildClientReferenceId } from '@cmt/shared-domain';
import type { DonationDoc, DonationType } from '@cmt/shared-domain';

export interface CreateDonationParams {
  fid: string;
  /**
   * The family's human-readable payment label ("FID-5006"), from
   * `paymentFamilyLabel`. REQUIRED, because the client_reference_id is built
   * here and the caller is the only place that has already loaded the family.
   */
  familyLabel: string;
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
    // What we ACTUALLY send to Stripe, stored so the dashboard row maps 1:1
    // back to this donation doc. It carries the family label as well as the did
    // (2026-08-04) - see buildClientReferenceId. Built here rather than at the
    // route so the stored value and the sent value cannot drift: the field's
    // whole purpose is to be the same string Stripe has.
    clientReferenceId: buildClientReferenceId({ familyLabel: params.familyLabel, recordId: ref.id }),
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
