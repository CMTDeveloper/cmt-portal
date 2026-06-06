import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { SevaSignupDoc } from '@cmt/shared-domain';

const toDate = (v: unknown): Date => (v as { toDate?: () => Date })?.toDate?.() ?? new Date(v as string);

function mapSignup(d: FirebaseFirestore.DocumentData): SevaSignupDoc {
  return {
    signupId: d['signupId'], oppId: d['oppId'], fid: d['fid'], mid: d['mid'] ?? null,
    sevaYear: d['sevaYear'], status: d['status'], hoursAwarded: d['hoursAwarded'] ?? 0,
    signedUpAt: toDate(d['signedUpAt']), signedUpByMid: d['signedUpByMid'] ?? null,
    confirmedAt: d['confirmedAt'] ? toDate(d['confirmedAt']) : null,
    confirmedBy: d['confirmedBy'] ?? null,
  };
}

export function signupDocId(oppId: string, fid: string): string { return `${oppId}__${fid}`; }

const ACTIVE_STATUSES = new Set(['signed-up', 'completed']);
export function isActiveSignup(s: { status: string }): boolean { return ACTIVE_STATUSES.has(s.status); }

export async function listFamilySignups(fid: string): Promise<SevaSignupDoc[]> {
  const snap = await portalFirestore().collection('seva_signups').where('fid', '==', fid).get();
  return snap.docs.map((doc) => mapSignup(doc.data()));
}

export async function listSignupsForOpp(oppId: string): Promise<SevaSignupDoc[]> {
  const snap = await portalFirestore().collection('seva_signups').where('oppId', '==', oppId).get();
  return snap.docs.map((doc) => mapSignup(doc.data()));
}

export async function getSignup(signupId: string): Promise<SevaSignupDoc | null> {
  const snap = await portalFirestore().collection('seva_signups').doc(signupId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return data ? mapSignup(data) : null;
}

export function serializeSignup(s: SevaSignupDoc) {
  return {
    ...s,
    signedUpAt: s.signedUpAt.toISOString(),
    confirmedAt: s.confirmedAt ? s.confirmedAt.toISOString() : null,
  };
}
