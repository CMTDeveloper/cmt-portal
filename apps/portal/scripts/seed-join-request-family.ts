/**
 * UAT-only, idempotent seed for the join-request E2E (the gated co-manager
 * "family lookup classification + join-request" flow shipped 2026-06-22).
 *
 * Provisions ONE persistent _test family with two adults, each a password Auth
 * user (so /api/setu/auth/password-sign-in works without OTP):
 *
 *   1. MANAGER  (E2E_JR_MANAGER_EMAIL) — manager:true, in family.managers,
 *      portalAccess absent (⇒ active). Lookup of this email classifies as
 *      matchAction:'sign-in'.
 *   2. GATED MEMBER (E2E_JR_MEMBER_EMAIL) — manager:false, portalAccess:'pending',
 *      its own email as a contactKey. Lookup classifies as 'request-to-join';
 *      password-sign-in returns { pendingApproval:true } and NO session until the
 *      manager approves the join request.
 *
 * The seed RESETS the flow on every run so the spec is repeatable:
 *   - gated member → manager:false, portalAccess:'pending';
 *   - family.managers → [managerMid] only (drops the member if a prior run
 *     promoted it to co-manager);
 *   - any families/{fid}/joinRequests/* docs are deleted.
 *
 * Pre-creates both Auth users at the contact-derived uid (sha256 of the
 * normalized email — the uid the session resolves to, see build-session-claims)
 * with E2E_JR_PASSWORD.
 *
 * Mirrors seed-e2e-family.ts: PURE shared-domain helpers + direct Firestore
 * writes only (no 'use cache' server fns). Refuses to run unless the target is
 * chinmaya-setu-uat.
 *
 * Run: pnpm --filter @cmt/portal seed:join-request-family
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContactForKey, NO_ALLERGIES } from '@cmt/shared-domain/setu';
import { registerFamily } from '@/features/setu/registration/register-family';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';

const MANAGER_EMAIL = process.env['E2E_JR_MANAGER_EMAIL'] ?? 'e2e-jr-manager@chinmayatoronto.org';
const MEMBER_EMAIL = process.env['E2E_JR_MEMBER_EMAIL'] ?? 'e2e-jr-member@chinmayatoronto.org';
const PASSWORD = process.env['E2E_JR_PASSWORD'] ?? process.env['E2E_FAMILY_PASSWORD'];
const MANAGER_PHONE = process.env['E2E_JR_MANAGER_PHONE'] ?? '+15195550111';
const MEMBER_PHONE = process.env['E2E_JR_MEMBER_PHONE'] ?? '+15195550112';
// A real volunteering skill so the adults satisfy the per-type required matrix.
const SEED_SKILL = 'General Volunteer Support (happy to help where needed)';

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

async function deleteJoinRequests(db: Db, fid: string): Promise<number> {
  const snap = await db.collection('families').doc(fid).collection('joinRequests').get();
  let n = 0;
  for (const d of snap.docs) {
    await d.ref.delete();
    n++;
  }
  return n;
}

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  console.log(`\n=== seed-join-request-family — project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat.');
    process.exit(1);
  }
  if (!PASSWORD) {
    console.error('Set E2E_JR_PASSWORD (or E2E_FAMILY_PASSWORD) in apps/portal/.env.local.');
    process.exit(1);
  }

  const db = portalFirestore();

  // 1) Family — idempotent. Reuse if the manager email already maps to a Setu
  //    family; otherwise register fresh with the gated member as a second adult.
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
      // Dangling contactKey (family deleted by a cleanup sweep). Clear the keys
      // and register fresh so we never merge into a ghost family doc.
      console.log(`contactKey points at deleted family ${existing.fid} — clearing + re-registering`);
      for (const h of [
        hashContactKey('email', MANAGER_EMAIL),
        hashContactKey('phone', MANAGER_PHONE),
        hashContactKey('email', MEMBER_EMAIL),
        hashContactKey('phone', MEMBER_PHONE),
      ]) {
        await db.collection('contactKeys').doc(h).delete();
      }
      ({ fid, managerMid } = await register());
    }
  } else {
    ({ fid, managerMid } = await register());
  }

  async function register(): Promise<{ fid: string; managerMid: string }> {
    const res = await registerFamily({
      email: MANAGER_EMAIL,
      phone: MANAGER_PHONE,
      familyName: 'E2E JoinRequest Family',
      location: 'Brampton',
      // Gate-complete genders (PreferNotToSay reads as missing to the gate).
      manager: { firstName: 'JR', lastName: 'Manager', gender: 'Male' },
      additionalMembers: [
        {
          firstName: 'JR',
          lastName: 'Member',
          type: 'Adult',
          gender: 'Female',
          email: MEMBER_EMAIL,
          phone: MEMBER_PHONE,
          foodAllergies: NO_ALLERGIES,
        },
      ],
    });
    console.log(`created family ${res.fid} (manager mid ${res.mid})`);
    return { fid: res.fid, managerMid: res.mid };
  }

  // 2) Re-assert identity + _test tags. legacyFid marks the family as
  //    "migrated" — matching the production gate's intent (only migrated
  //    families carry pending non-manager adults), though the gate keys off the
  //    member's explicit portalAccess:'pending' that we set below regardless.
  await db.collection('families').doc(fid).set(
    {
      name: 'E2E JoinRequest Family',
      legacyFid: `E2E-JR-${fid}`,
      managers: [managerMid], // RESET — drop a member promoted by a prior run
      searchKeys: ['e2e joinrequest family', fid],
      _test: true,
    },
    { merge: true },
  );

  // 3) Tag members + find the gated member; RESET it to the pre-approval state.
  const membersSnap = await db.collection('families').doc(fid).collection('members').get();
  let memberMid: string | null = null;
  const memberCanonical = normalizeContactForKey('email', MEMBER_EMAIL);
  for (const m of membersSnap.docs) {
    const md = m.data() as { mid?: string; manager?: boolean; email?: string | null };
    if (md.email === memberCanonical && md.manager !== true) memberMid = md.mid ?? m.id;
    // Also catch a member promoted to manager:true by a prior approval run.
    if (md.email === memberCanonical && md.mid !== managerMid) memberMid = md.mid ?? m.id;
    // Gate-complete the manager here (the gated member gets its own write below):
    // registerFamily hardcodes foodAllergies:null / volunteeringSkills:[], and a
    // family reused from an older seed predates the gate's gender requirement —
    // so set gender too, else the manager's /family is stuck on the completion
    // gate and the pending-requests panel never renders.
    if (md.mid === managerMid) {
      await m.ref.set(
        { foodAllergies: NO_ALLERGIES, volunteeringSkills: [SEED_SKILL], gender: 'Male', _test: true },
        { merge: true },
      );
    } else {
      await m.ref.set({ _test: true }, { merge: true });
    }
  }
  if (!memberMid) {
    console.error('Could not locate the gated member by email — aborting.');
    process.exit(1);
  }
  await db.collection('families').doc(fid).collection('members').doc(memberMid).set(
    // Reset the gated-member state AND gate-complete it (foodAllergies + >=1
    // skill — registerFamily hardcodes volunteeringSkills:[]) so that once the
    // manager approves the join request the member passes the profile gate.
    {
      manager: false,
      portalAccess: 'pending',
      foodAllergies: NO_ALLERGIES,
      volunteeringSkills: [SEED_SKILL],
      gender: 'Female',
      _test: true,
    },
    { merge: true },
  );
  console.log(`gated member ${memberMid} reset to manager:false, portalAccess:'pending'`);

  // 4) Tag every contactKey we own _test (cleanup-sweep convention) and ensure
  //    the gated member's email contactKey points at memberMid (so lookup +
  //    create-request resolve fid+mid correctly).
  for (const h of [
    hashContactKey('email', MANAGER_EMAIL),
    hashContactKey('phone', MANAGER_PHONE),
    hashContactKey('phone', MEMBER_PHONE),
  ]) {
    await db.collection('contactKeys').doc(h).set({ _test: true }, { merge: true });
  }
  await db.collection('contactKeys').doc(hashContactKey('email', MEMBER_EMAIL)).set(
    { contactKey: hashContactKey('email', MEMBER_EMAIL), type: 'email', fid, mid: memberMid, _test: true },
    { merge: true },
  );

  // 5) Delete any leftover join requests so the flow starts clean every run.
  const deleted = await deleteJoinRequests(db, fid);
  if (deleted > 0) console.log(`deleted ${deleted} leftover joinRequests/*`);

  // 6) Passwords for both adults at their contact-derived uids.
  const managerUid = await ensureAuthPassword(MANAGER_EMAIL, PASSWORD);
  const memberUid = await ensureAuthPassword(MEMBER_EMAIL, PASSWORD);
  console.log(`auth passwords set — manager uid ${managerUid}, member uid ${memberUid}`);

  console.log(`\n=== done. fid=${fid} managerMid=${managerMid} memberMid=${memberMid} ===`);
  console.log(`    manager: ${MANAGER_EMAIL}  (sign-in)`);
  console.log(`    member : ${MEMBER_EMAIL}  (request-to-join, portalAccess:'pending')\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
