/**
 * UAT-only, idempotent seed for the role-persona TEST ACCOUNTS used by the
 * manual-testing team and (later) role-based Playwright E2E specs.
 *
 * Personas (all password sign-in via /sign-in → "Have a password?" toggle):
 *   1. setu-test-parent-brampton@…      family-manager, Brampton, 2 children
 *      (Grade 1 → Level 1, Grade 4 → Level 3), active BV enrollment.
 *   2. setu-test-member-brampton@…      family-member (second adult) of #1.
 *   3. setu-test-parent-scarborough@…   family-manager, Scarborough, 2 children
 *      (Grade 1 → Level A, Grade 3 → Level B), active BV enrollment.
 *   4. setu-test-teacher-brampton@…     parent-teacher assigned to Brampton
 *      Level 1 (the 53-student backfilled roster).
 *   5. setu-test-teacher-scarborough@…  parent-teacher assigned to Scarborough
 *      Level A.
 *   6. setu-test-teacher-universal@…    "universal teacher" — assigned to EVERY
 *      enabled level across both locations and periods. (There is no universal-
 *      teacher concept in code; assignment-to-all-levels is the modelling.)
 *   7. setu-test-sevak@…                standalone welcome-team (no family),
 *      via the legacy auth-claim grant path → lands on /welcome.
 *   8. setu-test-admin@…                standalone admin (no family) → /admin.
 *
 * All docs are tagged _test:true (same convention as seed-e2e-family.ts), so
 * the vitest integration suite's cleanupTestData() sweep DELETES the families —
 * re-run this seed afterwards. teacherAssignments/roleAssignments and the Auth
 * users persist across wipes; the seed re-points them at the recreated mids.
 *
 * Enrollment docs carry `pid: oid` (like backfill-bv-enrollments.ts, unlike
 * seed-e2e-family.ts) so the children appear in deriveRoster teacher rosters.
 *
 * Requires TEST_ACCOUNTS_PASSWORD in apps/portal/.env.local (never committed;
 * share with the team out-of-band). One password for all eight accounts.
 *
 * Run: pnpm --filter @cmt/portal seed:test-accounts
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
import { registerFamily, type AdditionalMember } from '@/features/setu/registration/register-family';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import { addCapability, type ClaimsShape } from '@/lib/auth/role-claims';
import { assignTeacher } from '@/features/setu/teacher/assignments';

const PASSWORD = process.env['TEST_ACCOUNTS_PASSWORD'];
const DOMAIN = 'chinmayatoronto.org';
const SEED_BY = 'seed-test-accounts';

let failures = 0;

type Db = ReturnType<typeof portalFirestore>;

interface ChildSpec {
  firstName: string;
  lastName: string;
  gender: 'Male' | 'Female';
  schoolGrade: string;
  birthMonthYear: string; // 'YYYY-MM'
}

type LevelPick =
  | { type: 'named'; location: 'Brampton' | 'Scarborough'; pid: string; levelName: string }
  | { type: 'all' };

interface FamilyPersona {
  kind: 'family';
  key: string;
  email: string;
  phone: string;
  familyName: string;
  location: 'Brampton' | 'Scarborough';
  manager: { firstName: string; lastName: string };
  secondAdult?: { firstName: string; lastName: string; email: string };
  children: ChildSpec[];
  enrollOid?: string; // BV offering to keep active (with pid for rosters)
  teacherLevels?: LevelPick;
  landing: string;
}

interface StandalonePersona {
  kind: 'standalone';
  key: string;
  email: string;
  role: 'admin' | 'welcome-team';
  landing: string;
}

type Persona = FamilyPersona | StandalonePersona;

const PERSONAS: Persona[] = [
  {
    kind: 'family',
    key: 'parent-brampton',
    email: `setu-test-parent-brampton@${DOMAIN}`,
    phone: '+15195550201',
    familyName: 'Test Family Brampton',
    location: 'Brampton',
    manager: { firstName: 'Test', lastName: 'Parent Brampton' },
    secondAdult: {
      firstName: 'Test',
      lastName: 'Member Brampton',
      email: `setu-test-member-brampton@${DOMAIN}`,
    },
    children: [
      { firstName: 'Test', lastName: 'Child One', gender: 'Female', schoolGrade: 'Grade 1', birthMonthYear: '2019-09' },
      { firstName: 'Test', lastName: 'Child Two', gender: 'Male', schoolGrade: 'Grade 4', birthMonthYear: '2016-04' },
    ],
    enrollOid: 'bv-brampton-2025-26',
    landing: '/family',
  },
  {
    kind: 'family',
    key: 'parent-scarborough',
    email: `setu-test-parent-scarborough@${DOMAIN}`,
    phone: '+15195550202',
    familyName: 'Test Family Scarborough',
    location: 'Scarborough',
    manager: { firstName: 'Test', lastName: 'Parent Scarborough' },
    children: [
      { firstName: 'Test', lastName: 'Child Three', gender: 'Male', schoolGrade: 'Grade 1', birthMonthYear: '2019-11' },
      { firstName: 'Test', lastName: 'Child Four', gender: 'Female', schoolGrade: 'Grade 3', birthMonthYear: '2017-02' },
    ],
    enrollOid: 'bv-scarborough-2025-26',
    landing: '/family',
  },
  {
    kind: 'family',
    key: 'teacher-brampton',
    email: `setu-test-teacher-brampton@${DOMAIN}`,
    phone: '+15195550203',
    familyName: 'Test Teacher Family Brampton',
    location: 'Brampton',
    manager: { firstName: 'Test', lastName: 'Teacher Brampton' },
    children: [],
    teacherLevels: { type: 'named', location: 'Brampton', pid: 'bv-brampton-2025-26', levelName: 'Level 1' },
    landing: '/family (→ /teacher via nav)',
  },
  {
    kind: 'family',
    key: 'teacher-scarborough',
    email: `setu-test-teacher-scarborough@${DOMAIN}`,
    phone: '+15195550204',
    familyName: 'Test Teacher Family Scarborough',
    location: 'Scarborough',
    manager: { firstName: 'Test', lastName: 'Teacher Scarborough' },
    children: [],
    teacherLevels: { type: 'named', location: 'Scarborough', pid: 'bv-scarborough-2025-26', levelName: 'Level A' },
    landing: '/family (→ /teacher via nav)',
  },
  {
    kind: 'family',
    key: 'teacher-universal',
    email: `setu-test-teacher-universal@${DOMAIN}`,
    phone: '+15195550205',
    familyName: 'Test Teacher Family Universal',
    location: 'Brampton',
    manager: { firstName: 'Test', lastName: 'Teacher Universal' },
    children: [],
    teacherLevels: { type: 'all' },
    landing: '/family (→ /teacher via nav)',
  },
  {
    kind: 'standalone',
    key: 'sevak',
    email: `setu-test-sevak@${DOMAIN}`,
    role: 'welcome-team',
    landing: '/welcome',
  },
  {
    kind: 'standalone',
    key: 'admin',
    email: `setu-test-admin@${DOMAIN}`,
    role: 'admin',
    landing: '/admin',
  },
];

/** Month (1-12) from a 'YYYY-MM' birthMonthYear — feeds members.birthMonth (prasad). */
function monthOf(birthMonthYear: string): number | null {
  const m = Number(birthMonthYear.slice(5, 7));
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
}

/**
 * Standalone (no-family) sevak grant via the legacy auth-claim path. Mirrors
 * grantRole()'s non-family branch in features/setu/auth/manage-roles.ts —
 * inlined because that module imports 'server-only', which Next aliases at
 * build time but plain tsx cannot resolve.
 */
async function grantStandaloneRole(email: string, role: 'admin' | 'welcome-team'): Promise<void> {
  const result = await findSetuFamilyByContact('email', email);
  if (result.source === 'setu') {
    throw new Error(`${email} unexpectedly maps to a Setu family — standalone grant aborted`);
  }
  const auth = portalAuth();
  const canonical = normalizeContactForKey('email', email);
  const uid = sha256Hex(canonical);
  let existing: ClaimsShape | null = null;
  try {
    existing = ((await auth.getUser(uid)).customClaims as ClaimsShape | undefined) ?? null;
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, email: canonical, disabled: false });
    } else {
      throw e;
    }
  }
  await auth.setCustomUserClaims(uid, addCapability(existing, role, canonical));
}

/** Create-or-update the password Auth user at the contact-derived uid. */
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

interface MemberRow {
  mid: string;
  type: 'Adult' | 'Child';
  firstName: string;
  lastName: string;
  email: string | null;
  birthMonthYear: string | null;
}

async function readMembers(db: Db, fid: string): Promise<MemberRow[]> {
  const snap = await db.collection('families').doc(fid).collection('members').get();
  const rows: MemberRow[] = [];
  for (const d of snap.docs) {
    const m = d.data() as Partial<MemberRow>;
    if (!m.mid || !m.type) continue;
    rows.push({
      mid: m.mid,
      type: m.type,
      firstName: m.firstName ?? '',
      lastName: m.lastName ?? '',
      email: m.email ?? null,
      birthMonthYear: m.birthMonthYear ?? null,
    });
  }
  return rows;
}

/** Ensure a contactKeys/{hash} doc maps a contact to {fid, mid}; refuses theft. */
async function ensureContactKey(
  db: Db,
  type: 'email' | 'phone',
  value: string,
  fid: string,
  mid: string,
): Promise<void> {
  const hash = hashContactKey(type, value);
  const ref = db.collection('contactKeys').doc(hash);
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() as { fid?: string };
    if (data.fid && data.fid !== fid) {
      throw new Error(`contactKey for ${value} is owned by another family (${data.fid}) — refusing`);
    }
  }
  await ref.set({ contactKey: hash, type, fid, mid, _test: true }, { merge: true });
}

/**
 * Ensure the persona family exists with the expected members. Reuses the
 * family the manager email maps to; reconciles members by name (children) /
 * email (second adult), creating any that are missing (e.g. after a partial
 * wipe). Returns the fid + the manager mid.
 */
async function ensureFamily(db: Db, p: FamilyPersona): Promise<{ fid: string; managerMid: string }> {
  let fid: string;
  let managerMid: string;

  const existing = await findSetuFamilyByContact('email', p.email);
  if (existing.source === 'setu' && existing.fid && existing.mid) {
    fid = existing.fid;
    managerMid = existing.mid;
    console.log(`  [${p.key}] reusing family ${fid}`);
  } else {
    const additionalMembers: AdditionalMember[] = [
      ...(p.secondAdult
        ? [{ ...p.secondAdult, type: 'Adult' as const, gender: 'PreferNotToSay' as const }]
        : []),
      ...p.children.map((c) => ({
        firstName: c.firstName,
        lastName: c.lastName,
        type: 'Child' as const,
        gender: c.gender,
        schoolGrade: c.schoolGrade,
        birthMonthYear: c.birthMonthYear,
      })),
    ];
    const res = await registerFamily({
      email: p.email,
      phone: p.phone,
      familyName: p.familyName,
      location: p.location,
      manager: { ...p.manager, gender: 'PreferNotToSay' },
      additionalMembers,
    });
    fid = res.fid;
    managerMid = res.mid;
    console.log(`  [${p.key}] created family ${fid}`);
  }

  // Tag the family _test:true (cleanup-sweep convention).
  await db.collection('families').doc(fid).set({ _test: true }, { merge: true });

  // Reconcile members: tag _test, re-assert grades + birthMonth, create missing.
  const members = await readMembers(db, fid);
  const nameOf = (first: string, last: string) => `${first} ${last}`.toLowerCase();
  let nextSeq = members.length + 1;

  for (const c of p.children) {
    const found = members.find(
      (m) => m.type === 'Child' && nameOf(m.firstName, m.lastName) === nameOf(c.firstName, c.lastName),
    );
    const birthMonth = monthOf(c.birthMonthYear);
    if (found) {
      await db.collection('families').doc(fid).collection('members').doc(found.mid).set(
        { schoolGrade: c.schoolGrade, birthMonthYear: c.birthMonthYear, birthMonth, _test: true },
        { merge: true },
      );
    } else {
      const mid = `${fid}-${String(nextSeq++).padStart(2, '0')}`;
      await db.collection('families').doc(fid).collection('members').doc(mid).set({
        mid,
        uid: null,
        firstName: c.firstName,
        lastName: c.lastName,
        type: 'Child',
        gender: c.gender,
        manager: false,
        joinedAt: FieldValue.serverTimestamp(),
        email: null,
        phone: null,
        schoolGrade: c.schoolGrade,
        birthMonthYear: c.birthMonthYear,
        birthMonth,
        volunteeringSkills: [],
        foodAllergies: null,
        emergencyContacts: [null, null],
        _test: true,
      });
      console.log(`  [${p.key}] created missing child member ${mid} (${c.firstName} ${c.lastName})`);
    }
  }

  let secondAdultMid: string | null = null;
  if (p.secondAdult) {
    const sa = p.secondAdult;
    const found = members.find((m) => m.type === 'Adult' && m.email === normalizeContactForKey('email', sa.email));
    if (found) {
      secondAdultMid = found.mid;
      await db.collection('families').doc(fid).collection('members').doc(found.mid).set({ _test: true }, { merge: true });
    } else {
      const mid = `${fid}-${String(nextSeq++).padStart(2, '0')}`;
      secondAdultMid = mid;
      await db.collection('families').doc(fid).collection('members').doc(mid).set({
        mid,
        uid: null,
        firstName: sa.firstName,
        lastName: sa.lastName,
        type: 'Adult',
        gender: 'PreferNotToSay',
        manager: false,
        joinedAt: FieldValue.serverTimestamp(),
        email: normalizeContactForKey('email', sa.email),
        phone: null,
        schoolGrade: null,
        birthMonthYear: null,
        volunteeringSkills: [],
        foodAllergies: null,
        emergencyContacts: [null, null],
        _test: true,
      });
      console.log(`  [${p.key}] created missing adult member ${mid} (${sa.email})`);
    }
  }

  // Tag remaining members (manager) + ensure contactKeys map and are tagged.
  const managerRef = db.collection('families').doc(fid).collection('members').doc(managerMid);
  await managerRef.set({ _test: true }, { merge: true });
  await ensureContactKey(db, 'email', p.email, fid, managerMid);
  await ensureContactKey(db, 'phone', p.phone, fid, managerMid);
  if (p.secondAdult && secondAdultMid) {
    await ensureContactKey(db, 'email', p.secondAdult.email, fid, secondAdultMid);
  }

  return { fid, managerMid };
}

/**
 * Upsert an ACTIVE BV enrollment carrying `pid: oid` (the field deriveRoster
 * queries — collectionGroup('enrollments').where('pid','==',level.pid)), then
 * enforce the single-active-BV invariant (mirrors seed-e2e-family.ts §3b).
 */
async function ensureEnrollmentWithPid(
  db: Db,
  fid: string,
  oid: string,
  managerMid: string,
  key: string,
): Promise<void> {
  const offeringSnap = await db.collection('offerings').doc(oid).get();
  if (!offeringSnap.exists) {
    console.error(`  [${key}] REFUSED: offering ${oid} not found in UAT`);
    failures++;
    return;
  }
  const od = offeringSnap.data() as Record<string, unknown>;
  const programKey = od['programKey'] as string;

  const programSnap = await db.collection('programs').doc(programKey).get();
  if (!programSnap.exists) {
    console.error(`  [${key}] REFUSED: program ${programKey} not found in UAT`);
    failures++;
    return;
  }
  const eligibility = (programSnap.data() as Record<string, unknown>)['eligibility'] as ProgramEligibility;

  const toDate = (v: unknown): Date => {
    if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
      return (v as { toDate: () => Date }).toDate();
    }
    return v instanceof Date ? v : new Date(v as string);
  };
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
    enabled: od['enabled'] as boolean,
    createdAt: now,
    createdBy: SEED_BY,
    updatedAt: now,
    updatedBy: SEED_BY,
  } as OfferingDoc;

  // enrolledMids = eligible CHILDREN only (mirrors backfill-bv-enrollments).
  const members = await readMembers(db, fid);
  const enrolledMids = members
    .filter((m) => m.type === 'Child')
    .filter((m) => memberEligibleForProgram({ type: m.type, birthMonthYear: m.birthMonthYear }, eligibility, now))
    .map((m) => m.mid);

  const eid = `${fid}-${oid}`;
  await db.collection('families').doc(fid).collection('enrollments').doc(eid).set(
    {
      eid,
      fid,
      oid,
      pid: oid, // ★ REQUIRED for teacher rosters (deriveRoster queries pid)
      programKey,
      programLabel: offering.programLabel,
      termLabel: offering.termLabel,
      location: offering.location,
      enrolledAt: FieldValue.serverTimestamp(),
      enrolledVia: 'welcome-team',
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
  console.log(`  [${key}] enrolled in ${oid} (${enrolledMids.length} children)`);

  // Single-active-BV invariant: cancel any OTHER active bala-vihar enrollment
  // (e.g. one the school-year rollover created for the next pid).
  const enrSnap = await db.collection('families').doc(fid).collection('enrollments').get();
  for (const d of enrSnap.docs) {
    const e = d.data() as { oid?: string; programKey?: string; status?: string };
    if (e.programKey === 'bala-vihar' && e.oid !== oid && e.status === 'active') {
      await d.ref.set(
        { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp(), cancelledReason: 'seed-test-accounts: single-BV fixture' },
        { merge: true },
      );
      console.log(`  [${key}] cancelled conflicting active BV enrollment ${e.oid}`);
    }
  }
}

interface LevelRow {
  levelId: string;
  levelName: string;
  location: string | null;
  pid: string;
}

async function loadEnabledLevels(db: Db): Promise<LevelRow[]> {
  const snap = await db.collection('levels').where('enabled', '==', true).get();
  return snap.docs.map((d) => {
    const l = d.data() as Partial<LevelRow>;
    return {
      levelId: l.levelId ?? d.id,
      levelName: l.levelName ?? '',
      location: l.location ?? null,
      pid: l.pid ?? '',
    };
  });
}

function pickLevels(levels: LevelRow[], pick: LevelPick, key: string): string[] {
  if (pick.type === 'all') return levels.map((l) => l.levelId);
  const hit = levels.find(
    (l) => l.location === pick.location && l.pid === pick.pid && l.levelName === pick.levelName,
  );
  if (!hit) {
    const available = levels
      .filter((l) => l.location === pick.location)
      .map((l) => `${l.levelName} (${l.pid})`)
      .join(', ');
    throw new Error(
      `[${key}] level "${pick.levelName}" not found for ${pick.location}/${pick.pid}. Available: ${available}`,
    );
  }
  return [hit.levelId];
}

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  console.log(`\n=== seed-test-accounts — project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    // No --allow-prod escape hatch on purpose: test accounts must never
    // exist in prod.
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat.');
    process.exit(1);
  }
  if (!PASSWORD) {
    console.error('Set TEST_ACCOUNTS_PASSWORD in apps/portal/.env.local (min 8 chars, letter+digit).');
    process.exit(1);
  }

  const db = portalFirestore();
  const levels = await loadEnabledLevels(db);
  console.log(`loaded ${levels.length} enabled levels\n`);

  const summary: { persona: string; email: string; roles: string; landing: string }[] = [];

  for (const p of PERSONAS) {
    console.log(`— ${p.key}`);
    if (p.kind === 'family') {
      const { fid, managerMid } = await ensureFamily(db, p);

      await ensureAuthPassword(p.email, PASSWORD);
      if (p.secondAdult) await ensureAuthPassword(p.secondAdult.email, PASSWORD);

      if (p.enrollOid) {
        await ensureEnrollmentWithPid(db, fid, p.enrollOid, managerMid, p.key);
      }

      let roles = 'family-manager';
      if (p.teacherLevels) {
        const levelIds = pickLevels(levels, p.teacherLevels, p.key);
        const { added, removed } = await assignTeacher({ ref: managerMid, levelIds, byUid: SEED_BY });
        console.log(`  [${p.key}] teacher on ${levelIds.length} level(s) (+${added.length}/−${removed.length})`);
        roles += ' + teacher';
      }
      summary.push({ persona: p.key, email: p.email, roles, landing: p.landing });
      if (p.secondAdult) {
        summary.push({ persona: 'member-brampton', email: p.secondAdult.email, roles: 'family-member', landing: '/family' });
      }
    } else {
      // Standalone sevak: auth-claim grant path (no family), then password.
      await grantStandaloneRole(p.email, p.role);
      await ensureAuthPassword(p.email, PASSWORD);
      console.log(`  [${p.key}] granted ${p.role} via auth-claim`);
      summary.push({ persona: p.key, email: p.email, roles: p.role, landing: p.landing });
    }
  }

  console.log('\n=== test accounts ready (password: TEST_ACCOUNTS_PASSWORD) ===\n');
  for (const s of summary) {
    console.log(`  ${s.persona.padEnd(20)} ${s.email.padEnd(48)} ${s.roles.padEnd(26)} → ${s.landing}`);
  }
  console.log('');
}

main().then(() => process.exit(failures > 0 ? 1 : 0)).catch((e) => { console.error(e); process.exit(1); });
