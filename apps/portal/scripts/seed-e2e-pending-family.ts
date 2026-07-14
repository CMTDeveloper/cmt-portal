/**
 * Seed a dedicated "pending" E2E family for the lazy-publicFid spec
 * (e2e/setu/lazy-publicfid.spec.ts): a fully gate-complete family that has NOT
 * enrolled, so its `publicFid` is unset (Model Y2 - the id is minted at first
 * enrollment, not at creation). Distinct from the main seed:e2e-family fixture,
 * which pins a publicFid and would show the ID value, not the pending nudge.
 *
 * What it guarantees (idempotent - safe to re-run before each spec run):
 *   - a family + one Adult manager + one Child, ALL profile-gate-complete
 *     (so the family lands on /family, not /complete-profile), with a complete
 *     familyAddress;
 *   - the family doc has NO `publicFid` (stripped) and NO active enrollment
 *     (any prior one is cancelled) - i.e. reset to the "pending" state;
 *   - a Firebase Auth password user at the contact-derived uid so
 *     /api/setu/auth/password-sign-in works for the spec.
 *
 * UAT-only by default (refuses unless PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat;
 * --allow-prod to override). All docs carry `_test: true`.
 *
 *   pnpm --filter @cmt/portal seed:e2e-pending-family
 */
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { registerFamily } from '@/features/setu/registration/register-family';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContactForKey, NO_ALLERGIES } from '@cmt/shared-domain/setu';

const EMAIL = 'e2e-pending@test.cmt.invalid';
const PHONE = '+14165550142';
const PASSWORD = process.env.E2E_PENDING_PASSWORD ?? 'PendingTest!2026';
const FAMILY_NAME = 'Pending E2E';
const LOCATION = 'Brampton';

function assertUatOrAllowed(): string {
  const project = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '';
  const allowProd = process.argv.includes('--allow-prod');
  if (project !== 'chinmaya-setu-uat' && !allowProd) {
    throw new Error(
      `REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${project}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`,
    );
  }
  return project;
}

async function main(): Promise<void> {
  const project = assertUatOrAllowed();
  const db = portalFirestore();
  const auth = portalAuth();

  // Reuse the family if it already exists (contactKey lookup), else register it.
  const emailHash = hashContactKey('email', EMAIL);
  const existing = await db.collection('contactKeys').doc(emailHash).get();
  let fid: string;
  let managerMid: string;
  if (existing.exists) {
    fid = (existing.data() as { fid: string; mid: string }).fid;
    managerMid = (existing.data() as { fid: string; mid: string }).mid;
    console.log(`reusing existing pending family ${fid}`);
  } else {
    const res = await registerFamily({
      email: EMAIL,
      phone: PHONE,
      familyName: FAMILY_NAME,
      location: LOCATION,
      familyAddress: { street: '1 Test Street', unit: '', city: 'Brampton', province: 'ON', postalCode: 'L6X 0X0' },
      manager: { firstName: 'Pending', lastName: 'Manager', gender: 'Male' },
      additionalMembers: [],
    });
    fid = res.fid;
    managerMid = res.mid;
    console.log(`registered pending family ${fid}`);
  }

  const familyRef = db.collection('families').doc(fid);
  const membersRef = familyRef.collection('members');

  // Manager: fill the Adult gate fields registerFamily hardcodes to null/[].
  await membersRef.doc(managerMid).set(
    { foodAllergies: NO_ALLERGIES, volunteeringSkills: ['General Volunteer Support (happy to help where needed)'], _test: true },
    { merge: true },
  );

  // Child: one gate-complete Child so the family can enrol (and the roster shows a kid).
  const childMid = `${fid}-child`;
  await membersRef.doc(childMid).set(
    {
      mid: childMid,
      firstName: 'Pending',
      lastName: 'Child',
      type: 'Child',
      gender: 'Male',
      manager: false,
      email: null,
      phone: null,
      foodAllergies: NO_ALLERGIES,
      schoolGrade: 'Grade 4',
      birthMonthYear: '2017-03',
      volunteeringSkills: [],
      joinedAt: FieldValue.serverTimestamp(),
      _test: true,
    },
    { merge: true },
  );

  // Reset to the PENDING state: no publicFid, no active enrollment.
  await familyRef.set(
    { _test: true, familyAddress: { street: '1 Test Street', unit: '', city: 'Brampton', province: 'ON', postalCode: 'L6X 0X0' } },
    { merge: true },
  );
  await familyRef.update({ publicFid: FieldValue.delete() });
  const enrollSnap = await familyRef.collection('enrollments').get();
  for (const doc of enrollSnap.docs) {
    await doc.ref.delete();
  }
  console.log(`reset: stripped publicFid, deleted ${enrollSnap.size} enrollment(s)`);

  // Firebase Auth password user at the contact-derived uid (the uid the session
  // resolves to - see build-session-claims). Create or update.
  const canonical = normalizeContactForKey('email', EMAIL);
  const uid = sha256Hex(canonical);
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { email: canonical, password: PASSWORD, emailVerified: true });
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, email: canonical, password: PASSWORD, emailVerified: true });
    } else {
      throw e;
    }
  }

  console.log(`\n=== done (${project}) ===`);
  console.log(`fid=${fid} uid=${uid}`);
  console.log(`E2E_PENDING_EMAIL=${EMAIL}`);
  console.log(`E2E_PENDING_PASSWORD=${PASSWORD}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
