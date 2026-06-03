/**
 * UAT-only, idempotent seed for the Playwright E2E family.
 *
 * Provisions one persistent _test family (manager 'E2E Tester' + one child),
 * a Firebase Auth password (so /api/setu/auth/password-sign-in works without
 * OTP), an active Bala Vihar enrollment + an active no-donation (om-chanting)
 * enrollment, and a few family-check-ins inside the BV window so the dashboard
 * attendance assertion is deterministic.
 *
 * Does NOT call enrollFamily/getProgram/getFamilyByFid (they use Next 'use cache'
 * and throw outside a render context). Writes enrollment docs directly and reads
 * offering/program docs directly; only the PURE shared-domain helpers are used.
 *
 * Run: pnpm --filter @cmt/portal seed:e2e-family
 */
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import {
  resolveSuggestedAmount,
  memberEligibleForProgram,
  type OfferingDoc,
  type ProgramEligibility,
} from '@cmt/shared-domain';
import { registerFamily } from '@/features/setu/registration/register-family';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';

const EMAIL = process.env['E2E_FAMILY_EMAIL'];
const PASSWORD = process.env['E2E_FAMILY_PASSWORD'];
const PHONE = process.env['E2E_FAMILY_PHONE'] ?? '+15195550100';
const LEGACY_FID = 'E2E-ATT-1';
const CHILD_SID = 'E2E-SID-1';
const BV_OID = 'bv-brampton-2025-26';
const NODON_OID = 'om-chanting-all-2026-summer-om-chanting';
const CHECKIN_DATES = ['2025-10-05', '2026-01-11', '2026-03-08'];

type Db = ReturnType<typeof portalFirestore>;

function toDate(v: unknown): Date {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(v as string);
}

async function ensureEnrollment(db: Db, fid: string, oid: string, managerMid: string): Promise<void> {
  const offeringSnap = await db.collection('offerings').doc(oid).get();
  if (!offeringSnap.exists) {
    console.log(`  offering ${oid} not found in UAT — skipping enrollment`);
    return;
  }
  const od = offeringSnap.data() as Record<string, unknown>;
  const programKey = od['programKey'] as string;

  const programSnap = await db.collection('programs').doc(programKey).get();
  if (!programSnap.exists) {
    console.log(`  program ${programKey} not found — skipping ${oid}`);
    return;
  }
  const eligibility = (programSnap.data() as Record<string, unknown>)['eligibility'] as ProgramEligibility;

  const now = new Date();
  const offering = {
    oid,
    programKey,
    programLabel: od['programLabel'] as string,
    location: (od['location'] ?? null) as OfferingDoc['location'],
    termLabel: od['termLabel'] as string,
    termType: od['termType'] as OfferingDoc['termType'],
    startDate: toDate(od['startDate']),
    endDate: od['endDate'] != null ? toDate(od['endDate']) : null,
    pricingTiers: (od['pricingTiers'] as OfferingDoc['pricingTiers']) ?? [],
    ...(od['amountTiers'] !== undefined ? { amountTiers: od['amountTiers'] as number[] } : {}),
    ...(od['paymentSource'] !== undefined ? { paymentSource: od['paymentSource'] as OfferingDoc['paymentSource'] } : {}),
    enabled: od['enabled'] as boolean,
    createdAt: now,
    createdBy: 'seed',
    updatedAt: now,
    updatedBy: 'seed',
  } as OfferingDoc;

  const membersSnap = await db.collection('families').doc(fid).collection('members').get();
  const enrolledMids: string[] = [];
  for (const doc of membersSnap.docs) {
    const m = doc.data() as { mid?: string; type?: 'Adult' | 'Child'; birthMonthYear?: string | null };
    if (!m.mid || !m.type) continue;
    if (memberEligibleForProgram({ type: m.type, birthMonthYear: m.birthMonthYear ?? null }, eligibility, now)) {
      enrolledMids.push(m.mid);
    }
  }

  const eid = `${fid}-${oid}`;
  const ref = db.collection('families').doc(fid).collection('enrollments').doc(eid);
  const existing = await ref.get();
  if (existing.exists && (existing.data() as { status?: string }).status === 'active') {
    console.log(`  enrollment ${eid} already active — ok`);
    return;
  }

  await ref.set(
    {
      eid,
      fid,
      oid,
      programKey,
      programLabel: offering.programLabel,
      termLabel: offering.termLabel,
      location: offering.location,
      enrolledAt: FieldValue.serverTimestamp(),
      enrolledVia: 'family-initiated',
      enrolledByMid: managerMid,
      enrolledMids,
      suggestedAmountSnapshot: resolveSuggestedAmount(offering, now),
      suggestedAmountOverride: null,
      status: 'active',
      cancelledAt: null,
      cancelledReason: null,
      _test: true,
    },
    { merge: true },
  );
  console.log(`  enrolled in ${oid} (programKey=${programKey}, enrolledMids=${enrolledMids.length})`);
}

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  console.log(`\n=== seed-e2e-family — project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat.');
    process.exit(1);
  }
  if (!EMAIL || !PASSWORD) {
    console.error('Set E2E_FAMILY_EMAIL and E2E_FAMILY_PASSWORD in .env.local.');
    process.exit(1);
  }

  const db = portalFirestore();
  const auth = portalAuth();

  // 1) Family — idempotent. Reuse if the email already maps to a Setu family.
  let fid: string;
  let managerMid: string;
  const existing = await findSetuFamilyByContact('email', EMAIL);
  if (existing.source === 'setu' && existing.fid && existing.mid) {
    fid = existing.fid;
    managerMid = existing.mid;
    console.log(`reusing existing family ${fid} (manager mid ${managerMid})`);
  } else {
    const res = await registerFamily({
      email: EMAIL,
      phone: PHONE,
      familyName: 'E2E Test Family',
      location: 'Brampton',
      manager: { firstName: 'E2E', lastName: 'Tester', gender: 'PreferNotToSay' },
      additionalMembers: [
        { firstName: 'E2E', lastName: 'Child', type: 'Child', gender: 'Male', schoolGrade: 'Grade 4', birthMonthYear: '2017-03' },
      ],
    });
    fid = res.fid;
    managerMid = res.mid;
    console.log(`created family ${fid} (manager mid ${managerMid})`);
  }

  // Tag family + members + contactKeys _test:true (mirrors createTestFamily), and
  // set legacyFid so the dashboard reads attendance from family-check-ins/{legacyFid}.
  await db.collection('families').doc(fid).set({ legacyFid: LEGACY_FID, _test: true }, { merge: true });
  const membersSnap = await db.collection('families').doc(fid).collection('members').get();
  for (const m of membersSnap.docs) {
    await m.ref.set({ _test: true }, { merge: true });
  }
  await db.collection('contactKeys').doc(hashContactKey('email', EMAIL)).set({ _test: true }, { merge: true });
  await db.collection('contactKeys').doc(hashContactKey('phone', PHONE)).set({ _test: true }, { merge: true });

  // 2) Firebase Auth user WITH PASSWORD at the contact-derived uid (the uid the
  //    session resolves to — see build-session-claims). Create or update.
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
  console.log(`auth user ${uid} password set`);

  // 3) Enrollments — BV + no-donation, written directly (NOT via enrollFamily).
  console.log('ensuring enrollments:');
  await ensureEnrollment(db, fid, BV_OID, managerMid);
  await ensureEnrollment(db, fid, NODON_OID, managerMid);

  // 4) family-check-ins inside the BV window (family-level attendance source).
  for (const date of CHECKIN_DATES) {
    await db
      .collection('family-check-ins')
      .doc(LEGACY_FID)
      .collection('checkIns')
      .doc(date)
      .set(
        { date, checkedInBy: 'seed', students: [{ sid: CHILD_SID, isCheckedIn: true }], _test: true },
        { merge: true },
      );
  }
  console.log(`wrote ${CHECKIN_DATES.length} check-ins under family-check-ins/${LEGACY_FID}`);

  console.log(`\n=== done. fid=${fid} uid=${uid} ===\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
