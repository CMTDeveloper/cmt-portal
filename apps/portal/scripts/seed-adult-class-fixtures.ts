/**
 * UAT-only, idempotent seed for the Adult Study Class E2E (P4 Task 12).
 *
 * Provisions the program, one open offering, and ONE family per row of the
 * spec's §2.3 scenario matrix. Each family gets its OWN email, because the
 * sign-in rate limit is keyed on the normalized contact
 * (`mint-password-session.ts:49`) - six families therefore have six independent
 * 5-per-15-minute budgets, where six re-shapes of a single shared family would
 * share one and 429 halfway through the run.
 *
 * Why one family per row rather than reshaping one family between phases: the
 * spec is explicit that "a fixture that happens to satisfy both proves neither"
 * (§2.3, row 7). Reshaping in place also means every assertion depends on the
 * previous test's cleanup having worked.
 *
 * ── The matrix (§2.3) ────────────────────────────────────────────────────────
 *  | row | children in BV | adults            | gate fires? | cost |
 *  |  1  | yes            | 2, neither teaches| YES         | $0   |
 *  |  2  | yes            | 1 teacher, 1 not  | YES (1 only)| $0   |
 *  |  3  | yes            | 2 teachers        | no          | n/a  |
 *  |  5  | yes            | 1, does not teach | YES         | $0   |
 *  |  6  | no             | 2, neither teaches| no          | $101 |
 *  |  7  | no             | 2 teachers        | no          | n/a  |
 *
 * Row 4 (single parent who teaches) is deliberately omitted: it resolves through
 * the identical empty-selectable-set mechanism as row 3, differing only in adult
 * count, and row 3 already proves it. Rows 3 and 6 are what make row 7's two
 * independent failures testable in isolation - row 3 isolates "every adult
 * teaches" WITH a paid Bala Vihar enrollment, row 6 isolates "no Bala Vihar"
 * WITH freely selectable adults. Row 7 fails both at once and so, on its own,
 * proves neither.
 *
 * ── What condition 3 actually needs ──────────────────────────────────────────
 * The gate requires the Bala Vihar donation to be PAID, and `isBalaViharPaid`
 * leg (a) is a COMPLETED donation carrying the BV enrollment's `eid`
 * (needs-selection.ts:143). An active enrollment alone leaves the gate shut, so
 * every BV row here gets that donation. Amount is deliberately below the
 * suggested one: the rule is threshold-free (issue #23), and seeding the full
 * amount would let a `>=` regression pass.
 *
 * Mirrors seed-centre-confirmation-family.ts: PURE helpers + direct Firestore
 * writes only (no 'use cache' server fns). Refuses to run unless the target is
 * chinmaya-setu-uat.
 *
 * Run: pnpm --filter @cmt/portal seed:adult-class-fixtures
 */
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex } from '@/features/check-in/shared';
import { ADULT_STUDY_CLASS } from '@cmt/shared-domain';
import { normalizeContactForKey, NO_ALLERGIES } from '@cmt/shared-domain/setu';
import { registerFamily } from '@/features/setu/registration/register-family';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';

const PASSWORD = process.env['E2E_ADULT_CLASS_PASSWORD'] ?? process.env['E2E_FAMILY_PASSWORD'];
const LOCATION = 'Brampton';
const TERM_LABEL = '2026-27';
const ASC_OID = `adult-study-class-${LOCATION.toLowerCase()}-${TERM_LABEL}`;
const ASC_AMOUNT = 101;

/** One `teacherAssignments` level id. `isTeacherAssigned` only asks whether the
 *  doc lists ≥1 level (assignments.ts:31), so the id need not resolve - but a
 *  real one is used when UAT has any, to keep the fixture honest. */
const FALLBACK_LEVEL_ID = 'e2e-adult-class-fixture-level';

interface RowSpec {
  row: number;
  email: string;
  phone: string;
  familyName: string;
  /** Adults BESIDE the manager. */
  coAdult: boolean;
  /** A child + an active, PAID Bala Vihar enrollment. */
  balaVihar: boolean;
  /** Which adults are teacher-assigned. */
  teachers: 'none' | 'co-adult' | 'all';
}

const ROWS: RowSpec[] = [
  { row: 1, email: 'e2e-ac-row1@chinmayatoronto.org', phone: '+15195550171', familyName: 'E2E AdultClass Row1', coAdult: true, balaVihar: true, teachers: 'none' },
  { row: 2, email: 'e2e-ac-row2@chinmayatoronto.org', phone: '+15195550172', familyName: 'E2E AdultClass Row2', coAdult: true, balaVihar: true, teachers: 'co-adult' },
  { row: 3, email: 'e2e-ac-row3@chinmayatoronto.org', phone: '+15195550173', familyName: 'E2E AdultClass Row3', coAdult: true, balaVihar: true, teachers: 'all' },
  { row: 5, email: 'e2e-ac-row5@chinmayatoronto.org', phone: '+15195550175', familyName: 'E2E AdultClass Row5', coAdult: false, balaVihar: true, teachers: 'none' },
  { row: 6, email: 'e2e-ac-row6@chinmayatoronto.org', phone: '+15195550176', familyName: 'E2E AdultClass Row6', coAdult: true, balaVihar: false, teachers: 'none' },
  { row: 7, email: 'e2e-ac-row7@chinmayatoronto.org', phone: '+15195550177', familyName: 'E2E AdultClass Row7', coAdult: true, balaVihar: false, teachers: 'all' },
];

type Db = FirebaseFirestore.Firestore;

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

/**
 * The program doc. `enrollFamily` refuses with 'program-not-available' when this
 * is missing or not active, so the gate would send families to a screen whose
 * Save can never succeed. `memberType: 'adult'` is the first adult program in
 * this system (spec §4.1) - every existing one is 'child'.
 */
async function ensureProgram(db: Db): Promise<void> {
  const ref = db.collection('programs').doc(ADULT_STUDY_CLASS);
  const snap = await ref.get();
  await ref.set(
    {
      programKey: ADULT_STUDY_CLASS,
      label: 'Adult Study Class',
      shortDescription: 'Weekly study class for adults, running alongside Bala Vihar.',
      status: 'active',
      locations: [LOCATION],
      termType: 'term',
      eligibility: { memberType: 'adult' },
      capabilities: {
        usesOfferings: true,
        usesDonation: true,
        usesLevels: false,
        usesCalendar: false,
        attendanceMode: 'none',
      },
      displayOrder: 50,
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: 'seed:adult-class-fixtures' }),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'seed:adult-class-fixtures',
    },
    { merge: true },
  );
  console.log(`program ${ADULT_STUDY_CLASS}: ${snap.exists ? 'updated' : 'created'} (status active, memberType adult)`);
}

/**
 * One open offering at $101.
 *
 * `endDate` is what `getOpenOfferings` filters on (`endDate >= now`), and the
 * single tier's `effectiveFrom` is deliberately in the past so
 * `resolveSuggestedAmount` resolves to 101 whenever the E2E happens to run
 * rather than falling back to the first tier by accident.
 */
async function ensureOffering(db: Db): Promise<void> {
  const ref = db.collection('offerings').doc(ASC_OID);
  const snap = await ref.get();
  await ref.set(
    {
      oid: ASC_OID,
      programKey: ADULT_STUDY_CLASS,
      programLabel: 'Adult Study Class',
      location: LOCATION,
      termLabel: TERM_LABEL,
      termType: 'term',
      startDate: new Date('2026-09-01T04:00:00.000Z'),
      endDate: new Date('2027-06-30T03:59:59.000Z'),
      pricingTiers: [{ effectiveFrom: '2026-01-01', amountCAD: ASC_AMOUNT, label: 'Full year' }],
      paymentSource: 'portal',
      enabled: true,
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: 'seed:adult-class-fixtures' }),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'seed:adult-class-fixtures',
    },
    { merge: true },
  );
  console.log(`offering ${ASC_OID}: ${snap.exists ? 'updated' : 'created'} ($${ASC_AMOUNT}, ${LOCATION}, enabled)`);
}

/** An OPEN Bala Vihar offering for the fixture location, using the app's own
 *  open-offering rule. Fails loudly rather than seeding families whose Bala
 *  Vihar enrollment points at a closed or absent term. */
async function findOpenBvOffering(db: Db): Promise<{ oid: string; label: string }> {
  const snap = await db
    .collection('offerings')
    .where('programKey', '==', 'bala-vihar')
    .where('enabled', '==', true)
    .where('location', '==', LOCATION)
    .orderBy('startDate', 'asc')
    .get();
  const now = new Date();
  const open = snap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((o) => {
      const end = o['endDate'] as { toDate?: () => Date } | null | undefined;
      const endDate = end?.toDate ? end.toDate() : null;
      return endDate == null || endDate >= now;
    });
  const chosen = open[open.length - 1];
  if (!chosen) {
    throw new Error(
      `No OPEN bala-vihar offering at ${LOCATION}. The BV rows need one to enroll into - ` +
        `create it in /admin before running this seed.`,
    );
  }
  return { oid: String(chosen['oid']), label: String(chosen['programLabel'] ?? 'Bala Vihar') };
}

/** A level id that actually exists, so the teacher fixtures are not phantoms. */
async function findLevelId(db: Db): Promise<string> {
  const snap = await db.collection('levels').limit(1).get();
  return snap.empty ? FALLBACK_LEVEL_ID : snap.docs[0]!.id;
}

async function seedRow(
  db: Db,
  spec: RowSpec,
  bv: { oid: string; label: string },
  levelId: string,
): Promise<void> {
  // 1) Family - reuse when the email already maps to one, else register.
  async function register(): Promise<{ fid: string; managerMid: string }> {
    const res = await registerFamily({
      email: spec.email,
      phone: spec.phone,
      familyName: spec.familyName,
      location: LOCATION,
      manager: { firstName: `Row${spec.row}`, lastName: 'Manager', gender: 'Female' },
      additionalMembers: [],
    });
    return { fid: res.fid, managerMid: res.mid };
  }

  let fid: string;
  let managerMid: string;
  const existing = await findSetuFamilyByContact('email', spec.email);
  if (existing.source === 'setu' && existing.fid && existing.mid) {
    const famSnap = await db.collection('families').doc(existing.fid).get();
    if (famSnap.exists) {
      fid = existing.fid;
      managerMid = existing.mid;
    } else {
      for (const h of [hashContactKey('email', spec.email), hashContactKey('phone', spec.phone)]) {
        await db.collection('contactKeys').doc(h).delete();
      }
      ({ fid, managerMid } = await register());
    }
  } else {
    ({ fid, managerMid } = await register());
  }

  const famRef = db.collection('families').doc(fid);
  const coAdultMid = `${fid}-02`;
  const childMid = `${fid}-03`;

  // 2) The family doc. Address complete + centre confirmed so the EARLIER gates
  //    (profile completion, centre) do not fire - `earlierGatesPending` makes the
  //    adult-class gate defer to them, so an incomplete fixture would test the
  //    profile gate and silently prove nothing about this one.
  await famRef.set(
    {
      name: spec.familyName,
      searchKeys: [spec.familyName.toLowerCase(), fid],
      location: LOCATION,
      locationNeedsConfirmation: false,
      familyAddress: { street: '2 Bramalea Rd', unit: '', city: 'Brampton', province: 'ON', postalCode: 'L6T 2W8' },
      emergencyContacts: [
        { name: 'E2E Emergency', phone: '+15195550100', relationship: 'Friend' },
        null,
      ],
      _test: true,
    },
    { merge: true },
  );

  // 3) Members. Every member fully COMPLETE, for the same reason as above.
  await famRef.collection('members').doc(managerMid).set(
    {
      manager: true,
      gender: 'Female',
      email: normalizeContactForKey('email', spec.email),
      phone: spec.phone,
      foodAllergies: NO_ALLERGIES,
      volunteeringSkills: ['Kitchen'],
      _test: true,
    },
    { merge: true },
  );

  if (spec.coAdult) {
    await famRef.collection('members').doc(coAdultMid).set(
      {
        mid: coAdultMid, uid: null,
        firstName: `Row${spec.row}`, lastName: 'CoAdult', type: 'Adult', gender: 'Male',
        manager: false,
        email: `e2e-ac-row${spec.row}-coadult@chinmayatoronto.org`,
        phone: `+1519555${8000 + spec.row}`,
        schoolGrade: null, birthMonthYear: null,
        foodAllergies: NO_ALLERGIES, volunteeringSkills: ['Setup'],
        emergencyContacts: [null, null],
        _test: true,
      },
      { merge: true },
    );
  } else {
    await famRef.collection('members').doc(coAdultMid).delete();
  }

  if (spec.balaVihar) {
    await famRef.collection('members').doc(childMid).set(
      {
        mid: childMid, uid: null,
        firstName: `Row${spec.row}`, lastName: 'Kid', type: 'Child', gender: 'Female',
        manager: false, email: null, phone: null,
        schoolGrade: 'Grade 4', birthMonthYear: '2016-05', birthMonth: 5,
        foodAllergies: NO_ALLERGIES, volunteeringSkills: [],
        emergencyContacts: [null, null],
        _test: true,
      },
      { merge: true },
    );
  } else {
    await famRef.collection('members').doc(childMid).delete();
  }

  // 4) Bala Vihar enrollment + the COMPLETED donation condition 3 needs. Without
  //    the donation the gate stays shut and every BV row would read as row 3.
  const bvEid = `${fid}-${bv.oid}`;
  if (spec.balaVihar) {
    await famRef.collection('enrollments').doc(bvEid).set(
      {
        eid: bvEid, fid, oid: bv.oid, pid: bv.oid,
        programKey: 'bala-vihar', programLabel: bv.label, termLabel: TERM_LABEL,
        status: 'active', enrolledMids: [childMid], membershipMode: 'auto',
        enrolledVia: 'family-initiated', enrolledByMid: managerMid,
        schoolGrade: 'Grade 4',
        suggestedAmountSnapshot: 500, suggestedAmountOverride: null,
        enrolledAt: FieldValue.serverTimestamp(), cancelledAt: null,
        _test: true,
      },
      { merge: true },
    );
    // Amount deliberately BELOW the suggested 500: the paid rule is
    // threshold-free (issue #23), so a full-amount fixture would let a `>=`
    // regression pass unnoticed.
    await db.collection('donations').doc(`${fid}-e2e-ac-bv`).set(
      { fid, eid: bvEid, status: 'completed', amountCAD: 25, programKey: 'bala-vihar', createdAt: FieldValue.serverTimestamp(), _test: true },
      { merge: true },
    );
  } else {
    await famRef.collection('enrollments').doc(bvEid).delete();
    await db.collection('donations').doc(`${fid}-e2e-ac-bv`).delete();
  }

  // 5) Any adult-class enrollment from a PRIOR run is removed, or condition 4 is
  //    already satisfied and the gate never fires on a re-run.
  await famRef.collection('enrollments').doc(`${fid}-${ASC_OID}`).delete();

  // 6) Teacher assignments. `isTeacherAssigned` is true iff the doc lists ≥1
  //    level, so the absent case must DELETE rather than write an empty list.
  const teacherMids =
    spec.teachers === 'all' ? [managerMid, ...(spec.coAdult ? [coAdultMid] : [])]
    : spec.teachers === 'co-adult' ? [coAdultMid]
    : [];
  for (const mid of [managerMid, coAdultMid]) {
    const ref = db.collection('teacherAssignments').doc(mid);
    if (teacherMids.includes(mid)) {
      await ref.set({ ref: mid, levelIds: [levelId], updatedAt: FieldValue.serverTimestamp(), _test: true }, { merge: true });
    } else {
      await ref.delete();
    }
  }

  // 7) contactKeys tagged _test (cleanup-sweep convention).
  for (const h of [hashContactKey('email', spec.email), hashContactKey('phone', spec.phone)]) {
    await db.collection('contactKeys').doc(h).set({ _test: true }, { merge: true });
  }

  await ensureAuthPassword(spec.email, PASSWORD!);

  const gateFires = spec.balaVihar && teacherMids.length < (spec.coAdult ? 2 : 1);
  console.log(
    `row ${spec.row}: fid=${fid} adults=${spec.coAdult ? 2 : 1} bv=${spec.balaVihar ? 'paid' : 'none'} ` +
      `teachers=${teacherMids.length} → gate ${gateFires ? 'FIRES' : 'silent'}  (${spec.email})`,
  );
}

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  console.log(`\n=== seed-adult-class-fixtures — project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat.');
    process.exit(1);
  }
  if (!PASSWORD) {
    console.error('Set E2E_ADULT_CLASS_PASSWORD (or E2E_FAMILY_PASSWORD) in apps/portal/.env.local.');
    process.exit(1);
  }

  const db = portalFirestore();
  await ensureProgram(db);
  await ensureOffering(db);
  const bv = await findOpenBvOffering(db);
  const levelId = await findLevelId(db);
  console.log(`bala vihar offering: ${bv.oid}\nteacher level id: ${levelId}\n`);

  for (const spec of ROWS) await seedRow(db, spec, bv, levelId);

  console.log(`\n=== done. ${ROWS.length} fixture families, offering ${ASC_OID} at $${ASC_AMOUNT} ===`);
  console.log(`    every family signs in with the same password (E2E_ADULT_CLASS_PASSWORD / E2E_FAMILY_PASSWORD)\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
