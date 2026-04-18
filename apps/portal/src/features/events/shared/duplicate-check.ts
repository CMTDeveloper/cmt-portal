import { registrationsCollection } from './firestore-adapter';

export interface ExistingRegistration {
  registrationId: string;
  paymentStatus: string;
}

export async function checkExistingRegistration(
  identifier:
    | { type: 'fid'; value: string }
    | { type: 'email'; value: string; category: 'sevak' | 'non-bv' },
): Promise<ExistingRegistration | null> {
  const col = registrationsCollection();

  let query;
  if (identifier.type === 'fid') {
    query = col.where('fid', '==', identifier.value).limit(1);
  } else {
    query = col
      .where('email', '==', identifier.value)
      .where('category', '==', identifier.category)
      .limit(1);
  }

  const snapshot = await query.get();
  if (snapshot.empty) return null;

  const doc = snapshot.docs[0]!;
  return {
    registrationId: doc.id,
    paymentStatus: doc.data().paymentStatus as string,
  };
}
