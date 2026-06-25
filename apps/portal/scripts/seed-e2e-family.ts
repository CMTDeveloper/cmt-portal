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
import { normalizeContactForKey, NO_ALLERGIES } from '@cmt/shared-domain/setu';
import {
  resolveSuggestedAmount,
  memberEligibleForProgram,
  type OfferingDoc,
  type ProgramEligibility,
} from '@cmt/shared-domain';
import { registerFamily } from '@/features/setu/registration/register-family';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import { addMemberRole } from '@/features/setu/auth/member-roles';

const EMAIL = process.env['E2E_FAMILY_EMAIL'];
const PASSWORD = process.env['E2E_FAMILY_PASSWORD'];
const PHONE = process.env['E2E_FAMILY_PHONE'] ?? '+15195550100';
const LEGACY_FID = 'E2E-ATT-1';
const CHILD_SID = 'E2E-SID-1';
// Issue #4 — deterministic public ids on the fixture so the public-FID/MID E2E
// (e2e/setu/public-ids.spec.ts) can assert REAL values without running the live
// `migrate:public-ids` backfill. These are additive + idempotent: the backfill
// (scripts/assign-public-ids.ts) skips any doc that already carries its public
// id, so seeding them here never collides with the runtime counters. The
// 4-digit / 5-digit shapes mirror the production allocator (1001+, 50001+);
// '1042' / '50001'+'50002' are reserved-for-fixtures values outside the early
// counter range so they won't clash with a real backfilled family.
const PUBLIC_FID = '1042';
// Stable per-member publicMid. The fixture has exactly two members (manager +
// one child); index 0 → 50001, index 1 → 50002. Assigned by joinedAt order so a
// re-seed maps the same member to the same id every time.
const PUBLIC_MIDS = ['50001', '50002'] as const;
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
      // Gate-complete: gender Male (PreferNotToSay reads as missing to the gate).
      manager: { firstName: 'E2E', lastName: 'Tester', gender: 'Male' },
      additionalMembers: [
        { firstName: 'E2E', lastName: 'Child', type: 'Child', gender: 'Male', schoolGrade: 'Grade 4', birthMonthYear: '2017-03', foodAllergies: NO_ALLERGIES },
      ],
    });
    fid = res.fid;
    managerMid = res.mid;
    console.log(`created family ${fid} (manager mid ${managerMid})`);
  }

  // Tag family + members + contactKeys _test:true (mirrors createTestFamily), set
  // legacyFid so the dashboard reads attendance from family-check-ins/{legacyFid},
  // and pin the deterministic publicFid (issue #4) so the public-ids E2E asserts
  // a real 4-digit value without the live backfill.
  await db.collection('families').doc(fid).set({ legacyFid: LEGACY_FID, publicFid: PUBLIC_FID, _test: true }, { merge: true });
  const membersSnap = await db.collection('families').doc(fid).collection('members').get();
  // Deterministic publicMid assignment (issue #4): sort by joinedAt asc (then mid
  // as a stable tiebreaker) so a re-seed maps the same member to the same id —
  // index 0 → 50001 (the manager, joined first), index 1 → 50002 (the child).
  const orderedMembers = [...membersSnap.docs].sort((a, b) => {
    const aj = toDate((a.data() as { joinedAt?: unknown }).joinedAt).getTime();
    const bj = toDate((b.data() as { joinedAt?: unknown }).joinedAt).getTime();
    if (aj !== bj) return aj - bj;
    return a.id.localeCompare(b.id);
  });
  let childMid: string | null = null;
  let memberIndex = 0;
  for (const m of orderedMembers) {
    const md = m.data() as { mid?: string; type?: string; birthMonthYear?: string | null };
    if (md.type === 'Child' && md.mid) childMid = md.mid;
    // The child needs legacySid = CHILD_SID so the door check-ins
    // (family-check-ins/{legacyFid}, students[].sid = CHILD_SID) link to this
    // member — getFamilyBalaViharAttendance matches door marks by legacySid, so
    // without it the dashboard attendance resolves to 0 (empty state).
    const extra = md.type === 'Child' ? { legacySid: CHILD_SID } : {};
    // Gate-complete every member: registerFamily hardcodes foodAllergies:null /
    // volunteeringSkills:[] and never derives birthMonth, so a freshly-registered
    // (or previously-reused) family would be redirected to /family/complete-profile.
    // ALL → foodAllergies; ADULT → >=1 skill; CHILD → derived birthMonth.
    // gender too: a family reused from an older seed (created before the
    // profile-completion gate required gender) keeps a blank gender otherwise,
    // and the manager would be redirected to /family/complete-profile. 'Male'
    // is gate-valid (PreferNotToSay reads as missing).
    const gate: Record<string, unknown> = { foodAllergies: NO_ALLERGIES, gender: 'Male' };
    if (md.type === 'Adult') {
      gate['volunteeringSkills'] = ['General Volunteer Support (happy to help where needed)'];
    } else if (md.type === 'Child') {
      const month = md.birthMonthYear ? Number(md.birthMonthYear.slice(5, 7)) : NaN;
      if (Number.isInteger(month) && month >= 1 && month <= 12) gate['birthMonth'] = month;
    }
    // Deterministic 5-digit publicMid (issue #4) — additive, idempotent (the
    // backfill skips a member that already carries one). PUBLIC_MIDS has two
    // entries for the two fixture members; guard the index defensively in case a
    // future fixture grows the family.
    const publicMid = PUBLIC_MIDS[memberIndex];
    if (publicMid) gate['publicMid'] = publicMid;
    memberIndex += 1;
    await m.ref.set({ _test: true, ...extra, ...gate }, { merge: true });
  }
  await db.collection('contactKeys').doc(hashContactKey('email', EMAIL)).set({ _test: true }, { merge: true });
  await db.collection('contactKeys').doc(hashContactKey('phone', PHONE)).set({ _test: true }, { merge: true });
  console.log(`set publicFid=${PUBLIC_FID} on family ${fid}; publicMids=${PUBLIC_MIDS.join(',')} (joinedAt order)`);

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

  // 2b) Grant admin to the manager so the SAME single E2E user can drive admin
  //     surfaces too (family-manager primary role + admin in extraRoles, resolved
  //     from roleAssignments/{mid} by build-session-claims). Idempotent.
  await addMemberRole({ mid: managerMid, fid, role: 'admin', grantedVia: EMAIL });
  console.log(`granted admin via roleAssignments/${managerMid}`);

  // 3) Enrollments — BV + no-donation, written directly (NOT via enrollFamily).
  console.log('ensuring enrollments:');
  await ensureEnrollment(db, fid, BV_OID, managerMid);
  await ensureEnrollment(db, fid, NODON_OID, managerMid);

  // 3b) Single-BV invariant. The dashboard's bespoke BV section
  // (selectBalaViharEnrollment) resolves to ONE active bala-vihar enrollment and
  // scopes attendance to its offering window. If the school-year rollover has
  // since created a 2026-27 BV enrollment for this fixture, two active BV
  // enrollments coexist and attendance can resolve to the not-yet-started
  // 2026-27 window → empty state → flaky dashboard E2E. Cancel any active BV
  // enrollment other than BV_OID so the started (2025-26) window always wins.
  const enrSnap = await db.collection('families').doc(fid).collection('enrollments').get();
  for (const d of enrSnap.docs) {
    const e = d.data() as { oid?: string; programKey?: string; status?: string };
    if (e.programKey === 'bala-vihar' && e.oid !== BV_OID && e.status === 'active') {
      await d.ref.set(
        { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp(), cancelledReason: 'e2e-seed: single-BV fixture' },
        { merge: true },
      );
      console.log(`  cancelled conflicting active BV enrollment ${e.oid} (keeps ${BV_OID} as the sole active BV)`);
    }
  }

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

  // 4b) Portal-native attendanceEvents (UAT) for the child. The dashboard's
  //     attendance is door-check-ins ∪ portal teacher-marks. Door records live in
  //     the check-in SOURCE db (checkInSourceFirestore → MASTER/715b8 when
  //     PORTAL≠MASTER), which we must NOT write to — so on the deployed UAT app
  //     the UAT door check-ins above are invisible and attendance would resolve
  //     to 0. These portal attendanceEvents are read by getAttendanceForFamily
  //     from PORTAL (UAT) regardless of the door source, so the BV attendance
  //     renders deterministically. pid = BV_OID matches the dashboard filter
  //     (e.mid === child.mid && e.pid === enrollment.oid).
  if (childMid) {
    for (const date of CHECKIN_DATES) {
      const aid = `${BV_OID}-e2e-${childMid}-${date}`;
      await db.collection('attendanceEvents').doc(aid).set(
        {
          aid,
          levelId: `${BV_OID}-e2e`,
          mid: childMid,
          fid,
          pid: BV_OID,
          date,
          status: 'present',
          isGuest: false,
          markedByUid: 'seed',
          markedByMid: null,
          markedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          _test: true,
        },
        { merge: true },
      );
    }
    console.log(`wrote ${CHECKIN_DATES.length} portal attendanceEvents for child ${childMid} (pid=${BV_OID})`);
  } else {
    console.log('  WARN: no child member found — skipped attendanceEvents seeding');
  }

  // 5) Prasad fixture: a published config + one assignment for the seed family
  //    so the family card / options / move E2E paths are deterministic without
  //    running a full admin publish (which would write ~350 family docs).
  //    Date = the last 2025-26 Brampton class Sunday; the move spec reverts via
  //    a second move, and a re-seed restores this date regardless.
  await db.collection('prasadConfig').doc(BV_OID).set(
    {
      pid: BV_OID,
      capPerSunday: 10,
      publishedAt: FieldValue.serverTimestamp(),
      publishedBy: 'seed-script',
      _test: true,
    },
    { merge: true },
  );
  const prasadPaid = `${BV_OID}-${fid}`;
  await db.collection('prasadAssignments').doc(prasadPaid).set(
    {
      paid: prasadPaid,
      pid: BV_OID,
      fid,
      familyName: 'E2E Test Family',
      location: 'Brampton',
      date: '2026-06-14',
      youngestMid: childMid ?? null,
      youngestName: 'E2E Child',
      birthMonth: 6,
      reason: 'birthday-month',
      source: 'auto',
      status: 'assigned',
      assignedAt: FieldValue.serverTimestamp(),
      movedFrom: null,
      movedAt: null,
      movedBy: null,
      remindedAt: { weekBefore: null, twoDayBefore: null },
      _test: true,
    },
    { merge: true },
  );
  console.log(`wrote prasadConfig/${BV_OID} + prasadAssignments/${prasadPaid} (date=2026-06-14)`);

  console.log(`\n=== done. fid=${fid} uid=${uid} ===\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
