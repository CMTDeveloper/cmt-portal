/**
 * UAT-only, idempotent seed for the profile-completion-gate E2E (shipped
 * 2026-06-22). Provisions ONE persistent _test family whose MANAGER is
 * deliberately GATE-INCOMPLETE, so signing in redirects to
 * `/family/complete-profile`.
 *
 * The manager (E2E_PC_MANAGER_EMAIL) is a password Auth user (so
 * /api/setu/auth/password-sign-in works without OTP) with a real gender + email
 * + phone but **no foodAllergies and no volunteeringSkills** — the two adult
 * required fields the matrix (member-required-fields) treats as MISSING. The
 * family has no other members, so `incompleteMembers()` returns exactly the
 * manager and the gate fires.
 *
 * The seed RESETS the manager to the incomplete state on every run (foodAllergies
 * null, volunteeringSkills []) so the spec is repeatable even after a prior run's
 * completion submit filled them in.
 *
 * Mirrors seed-join-request-family.ts: PURE shared-domain helpers + direct
 * Firestore writes only (no 'use cache' server fns). Refuses to run unless the
 * target is chinmaya-setu-uat.
 *
 * Run: pnpm --filter @cmt/portal seed:profile-completion-family
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import { registerFamily } from '@/features/setu/registration/register-family';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';

const MANAGER_EMAIL = process.env['E2E_PC_MANAGER_EMAIL'] ?? 'e2e-pc-manager@chinmayatoronto.org';
const PASSWORD = process.env['E2E_PC_PASSWORD'] ?? process.env['E2E_FAMILY_PASSWORD'];
const MANAGER_PHONE = process.env['E2E_PC_MANAGER_PHONE'] ?? '+15195550131';

type Db = ReturnType<typeof portalFirestore>;

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
  console.log(`\n=== seed-profile-completion-family — project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat.');
    process.exit(1);
  }
  if (!PASSWORD) {
    console.error('Set E2E_PC_PASSWORD (or E2E_FAMILY_PASSWORD) in apps/portal/.env.local.');
    process.exit(1);
  }

  const db = portalFirestore();

  // 1) Family — idempotent. Reuse if the manager email already maps to a Setu
  //    family; otherwise register fresh (a single-manager family, no children).
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

  async function register(): Promise<{ fid: string; managerMid: string }> {
    // No manager foodAllergies/volunteeringSkills → registerFamily writes
    // foodAllergies:null / volunteeringSkills:[] → an incomplete adult.
    const res = await registerFamily({
      email: MANAGER_EMAIL,
      phone: MANAGER_PHONE,
      familyName: 'E2E ProfileCompletion Family',
      location: 'Brampton',
      manager: { firstName: 'PC', lastName: 'Manager', gender: 'Male' },
      additionalMembers: [],
    });
    console.log(`created family ${res.fid} (manager mid ${res.mid})`);
    return { fid: res.fid, managerMid: res.mid };
  }

  // 2) Re-assert identity + _test tags.
  await db.collection('families').doc(fid).set(
    {
      name: 'E2E ProfileCompletion Family',
      searchKeys: ['e2e profilecompletion family', fid],
      _test: true,
    },
    { merge: true },
  );

  // 3) RESET the manager to the gate-INCOMPLETE state (the whole point of this
  //    fixture): a real gender + email + phone, but NO foodAllergies and NO
  //    volunteeringSkills — the two adult required fields the gate flags. This
  //    undoes any completion the spec performed on a prior run.
  await db.collection('families').doc(fid).collection('members').doc(managerMid).set(
    {
      manager: true,
      gender: 'Male',
      foodAllergies: null,
      volunteeringSkills: [],
      _test: true,
    },
    { merge: true },
  );
  console.log(`manager ${managerMid} reset to INCOMPLETE (foodAllergies:null, volunteeringSkills:[])`);

  // 4) Tag the manager's contactKeys _test (cleanup-sweep convention).
  for (const h of [hashContactKey('email', MANAGER_EMAIL), hashContactKey('phone', MANAGER_PHONE)]) {
    await db.collection('contactKeys').doc(h).set({ _test: true }, { merge: true });
  }

  // 5) Password for the manager at its contact-derived uid.
  const managerUid = await ensureAuthPassword(MANAGER_EMAIL, PASSWORD);
  console.log(`auth password set — manager uid ${managerUid}`);

  console.log(`\n=== done. fid=${fid} managerMid=${managerMid} ===`);
  console.log(`    manager: ${MANAGER_EMAIL}  (signs in → gated to /family/complete-profile)\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
