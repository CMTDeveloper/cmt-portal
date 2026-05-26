import { randomBytes } from 'node:crypto';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';

const COLLECTION = 'magicLinks';
const TTL_MINUTES = 10;

interface MagicLinkDoc {
  email: string;
  expiresAt: FirebaseFirestore.Timestamp | Date;
  usedAt: FirebaseFirestore.Timestamp | null;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface MagicLinkResult {
  token: string;
  expiresAt: Date;
}

export interface ConsumeResult {
  email: string;
}

export async function createMagicLink(email: string): Promise<MagicLinkResult> {
  const canonical = normalizeContactForKey('email', email);
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

  await portalFirestore()
    .collection(COLLECTION)
    .doc(token)
    .set({
      email: canonical,
      expiresAt,
      usedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });

  return { token, expiresAt };
}

export async function consumeMagicLink(token: string): Promise<ConsumeResult | null> {
  const db = portalFirestore();
  const ref = db.collection(COLLECTION).doc(token);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const data = snap.data() as MagicLinkDoc;
    if (data.usedAt !== null) return null;

    const expiresAt =
      data.expiresAt instanceof Date ? data.expiresAt : (data.expiresAt as FirebaseFirestore.Timestamp).toDate();
    if (expiresAt <= new Date()) return null;

    tx.update(ref, { usedAt: FieldValue.serverTimestamp() });
    return { email: data.email };
  });
}
