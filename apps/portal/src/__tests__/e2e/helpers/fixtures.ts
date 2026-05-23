import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { registerFamily } from '@/features/setu/registration/register-family';
import type { Location, Gender } from '@/features/setu/registration/register-family';

export interface TestFamilyInput {
  name: string;
  email: string;
  phone: string;
  location?: Location;
  managerFirstName?: string;
  managerLastName?: string;
  managerGender?: Gender;
}

export interface TestFamilyResult {
  fid: string;
  mid: string;
}

/**
 * Creates a real test family in UAT Firestore via the registerFamily server function.
 * Tags both the family doc and all member docs with `_test: true` for cleanup.
 */
export async function createTestFamily(input: TestFamilyInput): Promise<TestFamilyResult> {
  const result = await registerFamily({
    email: input.email,
    phone: input.phone,
    familyName: input.name,
    location: input.location ?? 'Brampton',
    manager: {
      firstName: input.managerFirstName ?? 'Test',
      lastName: input.managerLastName ?? 'Manager',
      gender: input.managerGender ?? 'PreferNotToSay',
    },
    additionalMembers: [],
  });

  const db = portalFirestore();
  const { fid, mid } = result;

  // Tag family doc with _test: true
  await db.collection('families').doc(fid).set({ _test: true }, { merge: true });

  // Tag manager member doc with _test: true
  await db
    .collection('families')
    .doc(fid)
    .collection('members')
    .doc(mid)
    .set({ _test: true }, { merge: true });

  // Tag contactKeys with _test: true so cleanup can find them
  const { hashContactKey } = await import('@/features/setu/registration/hash-contact-key');
  const emailHash = hashContactKey('email', input.email);
  const phoneHash = hashContactKey('phone', input.phone);
  await db.collection('contactKeys').doc(emailHash).set({ _test: true }, { merge: true });
  await db.collection('contactKeys').doc(phoneHash).set({ _test: true }, { merge: true });

  return { fid, mid };
}
