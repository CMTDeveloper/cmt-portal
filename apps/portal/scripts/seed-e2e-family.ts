/**
 * UAT-only, idempotent seed for the Playwright E2E family.
 *
 * Provisions one persistent _test family (manager 'E2E Tester' + one child),
 * a Firebase Auth password (so /api/setu/auth/password-sign-in works without
 * OTP), a PROMOTED Bala Vihar enrollment (the 2026-27 offering is the sole
 * ACTIVE bala-vihar, enrolledVia:'promotion' — exactly what the school-year
 * rollover produced; the prior-year 2025-26 BV enrollment is CANCELLED), an
 * active no-donation (om-chanting) enrollment, and a few family-check-ins in the
 * 2025-26 window (which — being window/oid-scoped — do NOT engage the 2026-27
 * enrollment).
 *
 * Because the active BV (2026-27) is enrolledVia:'promotion' with no engagement
 * by default, the dashboard's ground state is "Registered" (issue #23). Pass
 * `--confirm-bv` to additionally write one `_test` COMPLETED donation for the
 * 2026-27 eid, flipping the family to "Enrolled"; a plain re-run deletes that
 * donation and restores "Registered".
 *
 * `--enrolled-via <family-initiated|promotion>` (default 'promotion') sets how the
 * active 2026-27 BV enrollment was created. Slice 1 (Part A) reads a
 * 'family-initiated' active BV as "Enrolled" immediately — a deliberate enroll is
 * affirmative intent — even with $0 donated (donation still shows "Pending"),
 * whereas 'promotion' stays "Registered" until engaged. The active BV also carries
 * a synthetic per-child levelSnapshot ({ levelName:'Level 2', levelId:null }) so
 * the dashboard's "Children" line has a level name.
 *
 * Does NOT call enrollFamily/getProgram/getFamilyByFid (they use Next 'use cache'
 * and throw outside a render context). Writes enrollment docs directly and reads
 * offering/program docs directly; only the PURE shared-domain helpers are used.
 *
 * `--disclaimers <accepted|pending>` (default 'accepted') sets the Slice 2
 * disclaimer-acceptance ground state on the shared fixture. 'accepted' writes an
 * acceptance for the CURRENT (schoolYear, version) so the shared family is NOT
 * gated in sibling setu specs once NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS=true in
 * UAT; 'pending' clears it so the disclaimers spec can exercise the gate.
 *
 * Run: pnpm --filter @cmt/portal seed:e2e-family [--confirm-bv] [--enrolled-via <family-initiated|promotion>] [--disclaimers <accepted|pending>]
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
import { getDisclaimersConfig } from '@/features/setu/disclaimers/config';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';

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
// Prior-year BV offering — the enrollment the rollover CANCELLED on promotion.
// Still referenced by the attendance + prasad fixtures below (their 2025-26 dates
// are intentionally out-of-window for the active 2026-27 enrollment, so they
// never engage it — see the CHECKIN_DATES note).
const BV_OID = 'bv-brampton-2025-26';
// Active promoted BV offering — the sole ACTIVE bala-vihar enrollment (issue #23
// fixture). `selectBalaViharEnrollment` resolves to this, so the dashboard's
// Registered/Enrolled state is decided by THIS enrollment's engagement.
const BV_OID_2026 = 'bv-brampton-2026-27';
const NODON_OID = 'om-chanting-all-2026-summer-om-chanting';
// All 2025-26 dates ON PURPOSE (issue #23): the active BV is now the 2026-27
// enrollment, and getFamilyBalaViharAttendance scopes door marks to that
// offering's window + filters portal marks to its oid — so these 2025-26 marks
// do NOT confirm the 2026-27 enrollment, keeping the ground state "Registered".
const CHECKIN_DATES = ['2025-10-05', '2026-01-11', '2026-03-08'];

type Db = ReturnType<typeof portalFirestore>;

function toDate(v: unknown): Date {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(v as string);
}

type LevelSnapshotSeed = { schoolGrade: string | null; levelId: string | null; levelName: string | null };

async function ensureEnrollment(
  db: Db,
  fid: string,
  oid: string,
  managerMid: string,
  opts: {
    enrolledVia?: 'family-initiated' | 'promotion';
    normalizeActive?: boolean;
    /** Per-mid grade/level snapshot written on the enrollment so the dashboard's
     *  "Children" / Class-Assignments line has data (see EnrollmentDoc.levelSnapshots). */
    levelSnapshots?: Record<string, LevelSnapshotSeed>;
  } = {},
): Promise<void> {
  const enrolledVia = opts.enrolledVia ?? 'family-initiated';
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
  // Issue #23 fixture: the promoted 2026-27 BV enrollment must always converge to
  // ACTIVE + enrolledVia:'promotion', so skip the cheap already-active
  // early-return when normalizeActive is set — a re-seed (or a rollover that
  // wrote it a different way) is then normalized every run.
  if (!opts.normalizeActive && existing.exists && (existing.data() as { status?: string }).status === 'active') {
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
      enrolledVia,
      enrolledByMid: managerMid,
      enrolledMids,
      suggestedAmountSnapshot: resolveSuggestedAmount(offering, now),
      suggestedAmountOverride: null,
      status: 'active',
      cancelledAt: null,
      cancelledReason: null,
      ...(opts.levelSnapshots ? { levelSnapshots: opts.levelSnapshots } : {}),
      _test: true,
    },
    { merge: true },
  );
  console.log(
    `  enrolled in ${oid} (programKey=${programKey}, enrolledMids=${enrolledMids.length}, enrolledVia=${enrolledVia}${
      opts.levelSnapshots ? `, levelSnapshots=${Object.keys(opts.levelSnapshots).length}` : ''
    })`,
  );
}

/**
 * Parse `--enrolled-via <family-initiated|promotion>` (also accepts the
 * `--enrolled-via=<mode>` form) from argv. Defaults to `'promotion'` when absent
 * or invalid, so the existing issue #23 ground state (a promoted active BV that
 * reads "Registered" until engaged) is unchanged. Slice 1 flips a
 * `family-initiated` active BV to "Enrolled" on its own (a deliberate enroll is
 * affirmative intent — see isEnrollmentConfirmed), even with $0 donated.
 */
function parseEnrolledVia(argv: string[]): 'family-initiated' | 'promotion' {
  let raw: string | undefined;
  const idx = argv.indexOf('--enrolled-via');
  if (idx !== -1 && idx + 1 < argv.length) {
    raw = argv[idx + 1];
  } else {
    const eq = argv.find((a) => a.startsWith('--enrolled-via='));
    if (eq) raw = eq.slice('--enrolled-via='.length);
  }
  if (raw === 'family-initiated' || raw === 'promotion') return raw;
  if (raw !== undefined) {
    console.warn(`  WARN: unrecognized --enrolled-via '${raw}' — defaulting to 'promotion'`);
  }
  return 'promotion';
}

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  // --confirm-bv writes a completed donation for the active (2026-27) BV eid so
  // the fixture flips from Registered → Enrolled; a plain run deletes it (below).
  const confirmBv = process.argv.includes('--confirm-bv');
  // --enrolled-via decides how the active 2026-27 BV enrollment was created:
  //   'promotion'        → rollover carry-forward; reads "Registered" until engaged (issue #23 ground state, DEFAULT).
  //   'family-initiated' → the family clicked Enroll; reads "Enrolled" immediately, $0 or not (Slice 1 Part A).
  const enrolledVia = parseEnrolledVia(process.argv);
  // --disclaimers <accepted|pending> (default 'accepted'). 'accepted' writes an
  // acceptance for the CURRENT (schoolYear, version) so the shared fixture is
  // NOT gated in other specs once the flag is on; 'pending' clears it so the
  // disclaimers spec can exercise the gate. Absence/invalid → 'accepted'.
  const disclaimersArg = (() => {
    const i = process.argv.indexOf('--disclaimers');
    const raw = i !== -1 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith('--disclaimers='))?.slice('--disclaimers='.length);
    return raw === 'pending' ? 'pending' : 'accepted';
  })();
  console.log(`\n=== seed-e2e-family — project: ${projectId} (confirmBv=${confirmBv}, enrolledVia=${enrolledVia}, disclaimers=${disclaimersArg}) ===\n`);
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
  let childSchoolGrade: string | null = null;
  let memberIndex = 0;
  for (const m of orderedMembers) {
    const md = m.data() as { mid?: string; type?: string; birthMonthYear?: string | null; schoolGrade?: string | null };
    if (md.type === 'Child' && md.mid) {
      childMid = md.mid;
      childSchoolGrade = md.schoolGrade ?? null;
    }
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
      // The gate's required CHILD field is `birthMonthYear` — SET it (not just
      // derive birthMonth from it). A family reused from an older seed may have a
      // null birthMonthYear, which would redirect /family to /complete-profile and
      // strand every UI walkthrough on this fixture. Default matches the create
      // path's '2017-03'; derive birthMonth (for prasad) from whichever we use.
      const bmy = md.birthMonthYear ?? '2017-03';
      gate['birthMonthYear'] = bmy;
      const month = Number(bmy.slice(5, 7));
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

  // 3) Enrollments — written directly (NOT via enrollFamily). The issue #23
  //    fixture models a PROMOTED family (by default):
  //    - the 2026-27 BV offering is the sole ACTIVE bala-vihar enrollment
  //      (enrolledVia from --enrolled-via, default 'promotion'; normalizeActive so
  //      a re-seed reconverges it),
  //    - the prior-year 2025-26 BV enrollment is CANCELLED (by 3b below), exactly
  //      what the real school-year rollover produced for a promoted family,
  //    - om-chanting stays active (a second, non-BV enrollment — the N≥2 case).
  //    ensureEnrollment mirrors ONE enrollment doc shape for all three, so the
  //    2026-27 write carries the same enrolledMids/snapshot fields as 2025-26.
  console.log('ensuring enrollments:');
  await ensureEnrollment(db, fid, BV_OID, managerMid); // 2025-26 — cancelled in 3b
  // Active 2026-27 BV: enrolledVia comes from --enrolled-via (default 'promotion'
  // = the #23 Registered ground state; 'family-initiated' = Slice 1's Enrolled-
  // on-click). A synthetic levelSnapshot on the enrolled child gives the
  // dashboard's "Children" line a level name ("Level 2"); levelId:null skips the
  // teacher-name resolver (Task 4), so only the level name renders — fine for the
  // fixture. Re-runs overwrite to the same values (idempotent).
  await ensureEnrollment(db, fid, BV_OID_2026, managerMid, {
    enrolledVia,
    normalizeActive: true,
    ...(childMid
      ? { levelSnapshots: { [childMid]: { schoolGrade: childSchoolGrade, levelId: null, levelName: 'Level 2' } } }
      : {}),
  });
  await ensureEnrollment(db, fid, NODON_OID, managerMid);

  // 3b) Single active-BV invariant, pinned to the 2026-27 promoted enrollment.
  // selectBalaViharEnrollment resolves the FIRST active bala-vihar enrollment, so
  // there must be exactly one. Cancel any active BV whose oid !== BV_OID_2026 —
  // this cancels the 2025-26 enrollment (matching the rollover) and keeps the
  // fixture deterministic across re-seeds. Attendance for the active 2026-27
  // enrollment is therefore empty by default → dashboard ground state "Registered".
  const enrSnap = await db.collection('families').doc(fid).collection('enrollments').get();
  for (const d of enrSnap.docs) {
    const e = d.data() as { oid?: string; programKey?: string; status?: string };
    if (e.programKey === 'bala-vihar' && e.oid !== BV_OID_2026 && e.status === 'active') {
      await d.ref.set(
        { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp(), cancelledReason: 'e2e-seed: promoted-family fixture (2026-27 is the sole active BV)' },
        { merge: true },
      );
      console.log(`  cancelled prior-year active BV enrollment ${e.oid} (keeps ${BV_OID_2026} as the sole active BV)`);
    }
  }

  // 3c) Engagement donation (issue #23). The active BV is the 2026-27 promoted
  //     enrollment, whose engagement decides Registered vs Enrolled:
  //     - EVERY run first deletes any _test COMPLETED donation for its eid, so a
  //       plain re-seed deterministically restores the "Registered" ground state
  //       (even after a prior --confirm-bv run).
  //     - --confirm-bv then writes ONE _test completed donation tied to that eid;
  //       isEnrollmentConfirmed sees it and bvState flips to "Enrolled".
  //     Shape mirrors createDonation() (features/setu/donations/create-donation.ts)
  //     so getDonations reads it exactly like a real portal donation. The did is
  //     deterministic → --confirm-bv is idempotent (no duplicate donations).
  const eid2026 = `${fid}-${BV_OID_2026}`;
  // Query by fid only (single-field, index-safe — reuses no composite index) and
  // filter eid + _test in memory before deleting.
  const donSnap = await db.collection('donations').where('fid', '==', fid).get();
  let removed = 0;
  for (const d of donSnap.docs) {
    const dd = d.data() as { eid?: string; _test?: boolean };
    if (dd._test === true && dd.eid === eid2026) {
      await d.ref.delete();
      removed += 1;
    }
  }
  console.log(`removed ${removed} _test donation(s) for eid=${eid2026} (restores Registered ground state)`);

  if (confirmBv) {
    const did = `${eid2026}-e2e-confirm`;
    await db.collection('donations').doc(did).set(
      {
        did,
        fid,
        donorMid: managerMid,
        donorName: 'E2E Tester',
        donorEmail: EMAIL,
        type: 'enrollment',
        programKey: 'bala-vihar',
        programLabel: 'Bala Vihar',
        pid: BV_OID_2026,
        eid: eid2026,
        label: 'Bala Vihar Donation — 2026-27',
        amountCAD: 25,
        coverFee: false,
        feeCAD: 0,
        clientReferenceId: did,
        status: 'completed',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        _test: true,
      },
      { merge: true },
    );
    console.log(`--confirm-bv: wrote completed donation ${did} (amountCAD=25) → bvState 'enrolled'`);
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

  // Disclaimers (Slice 2) ground state on the shared fixture.
  if (disclaimersArg === 'pending') {
    await db.collection('families').doc(fid).set(
      { disclaimersAccepted: FieldValue.delete() },
      { merge: true },
    );
    console.log('disclaimers: cleared acceptance (pending ground state)');
  } else {
    const [cfg, sy] = await Promise.all([getDisclaimersConfig(db), getSchoolYearConfig(db)]);
    await db.collection('families').doc(fid).set(
      {
        disclaimersAccepted: {
          schoolYear: sy.currentYear,
          version: cfg.version,
          acceptedByMid: managerMid,
          acceptedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    console.log(`disclaimers: accepted (schoolYear=${sy.currentYear}, version=${cfg.version})`);
  }

  console.log(`\n=== done. fid=${fid} uid=${uid} ===\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
