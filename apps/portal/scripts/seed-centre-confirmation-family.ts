/**
 * UAT-only, idempotent seed for the centre-confirmation E2E (spec 1.9c).
 *
 * Provisions ONE persistent _test family in the exact shape that broke: a
 * RETURNING family whose members are COMPLETE and whose home address is
 * COMPLETE, with `locationNeedsConfirmation: true` as the ONLY outstanding
 * item. That combination is the whole point - it satisfies every other
 * condition on /complete-profile, so before the load short-circuit knew about
 * the centre it hard-navigated to /family, the gate sent it back, and the loop
 * was permanent. A fixture that is incomplete in any other way would never
 * exercise it.
 *
 * The family is MULTI-MEMBER (manager + co-adult + child, all complete) so the
 * manager scope is genuinely spanned rather than trivially satisfied by a
 * single-member family.
 *
 * The seed RESETS the flag and re-completes every member on each run, so the
 * spec is repeatable after a prior run saved a centre.
 *
 * Mirrors seed-profile-completion-family.ts: PURE shared-domain helpers + direct
 * Firestore writes only (no 'use cache' server fns). Refuses to run unless the
 * target is chinmaya-setu-uat.
 *
 * Run: pnpm --filter @cmt/portal seed:centre-confirmation-family
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContactForKey, NO_ALLERGIES } from '@cmt/shared-domain/setu';
import { registerFamily } from '@/features/setu/registration/register-family';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';

const MANAGER_EMAIL = process.env['E2E_CENTRE_MANAGER_EMAIL'] ?? 'e2e-centre-manager@chinmayatoronto.org';
const PASSWORD = process.env['E2E_CENTRE_PASSWORD'] ?? process.env['E2E_FAMILY_PASSWORD'];
const MANAGER_PHONE = process.env['E2E_CENTRE_MANAGER_PHONE'] ?? '+15195550141';

// A complete home address. Deliberately a Mississauga one while the defaulted
// centre is Brampton: the address is NOT the centre (a family may live in one
// place and attend another), which is precisely why the centre has to be asked
// rather than inferred.
const COMPLETE_ADDRESS = {
  street: '55 City Centre Dr',
  unit: '',
  city: 'Mississauga',
  province: 'ON',
  postalCode: 'L5B 1M3',
};

/** Create-or-update a password Auth user at the contact-derived uid. */
async function ensureAuthPassword(email: string, password: string): Promise<string> {
  const auth = portalAuth();
  const canonical = normalizeContactForKey('email', email);
  const uid = sha256Hex(canonical);
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { email: canonical, password, emailVerified: true });
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, email: canonical, password, emailVerified: true });
    } else {
      throw e;
    }
  }
  return uid;
}

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  console.log(`\n=== seed-centre-confirmation-family — project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat.');
    process.exit(1);
  }
  if (!PASSWORD) {
    console.error('Set E2E_CENTRE_PASSWORD (or E2E_FAMILY_PASSWORD) in apps/portal/.env.local.');
    process.exit(1);
  }

  const db = portalFirestore();

  async function register(): Promise<{ fid: string; managerMid: string }> {
    const res = await registerFamily({
      email: MANAGER_EMAIL,
      phone: MANAGER_PHONE,
      familyName: 'E2E CentreConfirmation Family',
      location: 'Brampton', // the DEFAULT the migration would have guessed
      manager: { firstName: 'Centre', lastName: 'Manager', gender: 'Female' },
      additionalMembers: [],
    });
    console.log(`created family ${res.fid} (manager mid ${res.mid})`);
    return { fid: res.fid, managerMid: res.mid };
  }

  // 1) Family — idempotent: reuse when the manager email already maps to one.
  let fid: string;
  let managerMid: string;
  const existing = await findSetuFamilyByContact('email', MANAGER_EMAIL);
  if (existing.source === 'setu' && existing.fid && existing.mid) {
    const famSnap = await db.collection('families').doc(existing.fid).get();
    if (famSnap.exists) {
      fid = existing.fid;
      managerMid = existing.mid;
      console.log(`reusing existing family ${fid} (manager mid ${managerMid})`);
    } else {
      console.log(`contactKey points at deleted family ${existing.fid} — clearing + re-registering`);
      for (const h of [hashContactKey('email', MANAGER_EMAIL), hashContactKey('phone', MANAGER_PHONE)]) {
        await db.collection('contactKeys').doc(h).delete();
      }
      ({ fid, managerMid } = await register());
    }
  } else {
    ({ fid, managerMid } = await register());
  }

  // 2) The family doc: complete address, defaulted centre, flag RESET to true so
  //    the spec is repeatable after a prior run cleared it.
  await db.collection('families').doc(fid).set(
    {
      name: 'E2E CentreConfirmation Family',
      searchKeys: ['e2e centreconfirmation family', fid],
      familyAddress: COMPLETE_ADDRESS,
      location: 'Brampton',
      locationNeedsConfirmation: true,
      _test: true,
    },
    { merge: true },
  );
  console.log(`family ${fid}: address COMPLETE, location=Brampton, locationNeedsConfirmation=TRUE`);

  // 3) Every member fully COMPLETE. The centre must be the ONLY thing missing,
  //    or the spec would pass for the wrong reason - a member gap alone would
  //    hold the family on /complete-profile and prove nothing about the centre.
  const coAdultMid = `${fid}-02`;
  const childMid = `${fid}-03`;

  await db.collection('families').doc(fid).collection('members').doc(managerMid).set(
    {
      manager: true,
      gender: 'Female',
      email: normalizeContactForKey('email', MANAGER_EMAIL),
      phone: MANAGER_PHONE,
      foodAllergies: NO_ALLERGIES,
      volunteeringSkills: ['Kitchen'],
      _test: true,
    },
    { merge: true },
  );

  await db.collection('families').doc(fid).collection('members').doc(coAdultMid).set(
    {
      mid: coAdultMid,
      uid: null,
      firstName: 'Centre',
      lastName: 'CoAdult',
      type: 'Adult',
      gender: 'Male',
      manager: false,
      email: 'e2e-centre-coadult@chinmayatoronto.org',
      phone: '+15195550142',
      schoolGrade: null,
      birthMonthYear: null,
      foodAllergies: NO_ALLERGIES,
      volunteeringSkills: ['Setup'],
      emergencyContacts: [null, null],
      _test: true,
    },
    { merge: true },
  );

  await db.collection('families').doc(fid).collection('members').doc(childMid).set(
    {
      mid: childMid,
      uid: null,
      firstName: 'Centre',
      lastName: 'Kid',
      type: 'Child',
      gender: 'Female',
      manager: false,
      email: null,
      phone: null,
      schoolGrade: 'Grade 4',
      birthMonthYear: '2016-05',
      birthMonth: 5,
      foodAllergies: NO_ALLERGIES,
      volunteeringSkills: [],
      emergencyContacts: [null, null],
      _test: true,
    },
    { merge: true },
  );
  console.log(`3 members COMPLETE — manager ${managerMid}, adult ${coAdultMid}, child ${childMid}`);

  // 4) Tag the manager's contactKeys _test (cleanup-sweep convention).
  for (const h of [hashContactKey('email', MANAGER_EMAIL), hashContactKey('phone', MANAGER_PHONE)]) {
    await db.collection('contactKeys').doc(h).set({ _test: true }, { merge: true });
  }

  // 5) Password for the manager at its contact-derived uid.
  const managerUid = await ensureAuthPassword(MANAGER_EMAIL, PASSWORD);
  console.log(`auth password set — manager uid ${managerUid}`);

  console.log(`\n=== done. fid=${fid} managerMid=${managerMid} ===`);
  console.log(`    manager: ${MANAGER_EMAIL}`);
  console.log(`    signs in → /complete-profile, centre selector ONLY (everything else complete)\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
