import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { NO_ALLERGIES } from '@cmt/shared-domain/setu';
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
      // Gate-complete: the profile-completion gate treats PreferNotToSay/null as
      // missing, so a default-built fixture family would be redirected away from
      // the dashboard and break every E2E that reuses it. Default to a real gender.
      gender: input.managerGender && input.managerGender !== 'PreferNotToSay'
        ? input.managerGender
        : 'Male',
    },
    additionalMembers: [],
  });

  const db = portalFirestore();
  const { fid, mid } = result;

  // Tag family doc with _test: true
  await db.collection('families').doc(fid).set({ _test: true }, { merge: true });

  // Tag manager member doc with _test: true AND fill the remaining required
  // adult fields (foodAllergies + >=1 volunteeringSkill) that registerFamily
  // hardcodes to null/[] — email + phone already come from the form input — so
  // the manager satisfies the new per-type required matrix (the gate).
  await db
    .collection('families')
    .doc(fid)
    .collection('members')
    .doc(mid)
    .set(
      {
        foodAllergies: NO_ALLERGIES,
        volunteeringSkills: ['General Volunteer Support (happy to help where needed)'],
        _test: true,
      },
      { merge: true },
    );

  // Tag contactKeys with _test: true so cleanup can find them
  const { hashContactKey } = await import('@/features/setu/registration/hash-contact-key');
  const emailHash = hashContactKey('email', input.email);
  const phoneHash = hashContactKey('phone', input.phone);
  await db.collection('contactKeys').doc(emailHash).set({ _test: true }, { merge: true });
  await db.collection('contactKeys').doc(phoneHash).set({ _test: true }, { merge: true });

  return { fid, mid };
}
