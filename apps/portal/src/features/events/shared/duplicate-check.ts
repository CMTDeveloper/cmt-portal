import { registrationsCollection } from './firestore-adapter';

export interface ExistingRegistration {
  registrationId: string;
  paymentStatus: string;
}

export async function checkExistingRegistration(
  identifier:
    | { type: 'fid'; value: string }
    | { type: 'email'; value: string; category: 'sevak' | 'non-bv' | 'bv-family' }
    | { type: 'bvFamilyEmail'; value: string },
): Promise<ExistingRegistration | null> {
  const col = registrationsCollection();

  if (identifier.type === 'bvFamilyEmail') {
    // Match BV Family registrations by email — handles both old records (isBvFamily:true,
    // no category field) and new records (category: "bv-family").
    const snapshot = await col.where('email', '==', identifier.value).get();
    const match = snapshot.docs.find((d) => {
      const data = d.data();
      return data['isBvFamily'] === true || data['category'] === 'bv-family';
    });
    if (!match) return null;
    return {
      registrationId: match.id,
      paymentStatus: (match.data()['paymentStatus'] as string) ?? 'pending',
    };
  }

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
    paymentStatus: doc.data()['paymentStatus'] as string,
  };
}
