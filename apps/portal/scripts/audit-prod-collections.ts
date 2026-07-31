/**
 * READ-ONLY pre-cutover audit of the prod project (chinmaya-setu-715b8),
 * required by the runbook §3 before the FIRST prod write.
 *
 * Three questions, all answered with `.limit(1).get()` reads and one
 * `listUsers(1)`. It never writes:
 *
 *   1. Do any PORTAL-owned collection names already exist in 715b8? They should
 *      not — the portal has never written there. Anything non-empty is a
 *      possible collision with the door app and means STOP.
 *   2. Do the DOOR-owned collections exist? This is the sanity check that we are
 *      actually pointed at prod and not at an empty project — an all-clear on
 *      question 1 is meaningless if we are reading the wrong database.
 *   3. Does this credential have Firestore WRITE and Firebase Auth ADMIN? The
 *      cutover needs both. §2 describes the MASTER service account as
 *      "read-only", so whether it can stand in for PORTAL_FIREBASE is a real
 *      question and not an assumption to make on launch day.
 *
 * Run from apps/portal:
 *   pnpm exec tsx --env-file=.env.local scripts/audit-prod-collections.ts
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMasterApp } from '@cmt/firebase-shared/admin/apps';

/** §3 "PORTAL-OWNED — safe to create/write". None of these should exist yet. */
const PORTAL_OWNED = [
  'families',
  'contactKeys',
  'offerings',
  'donationPeriods',
  'levels',
  'programs',
  'donations',
  'classCalendarEntries',
  'attendanceEvents',
  'attendance',
  'check_in_events',
  'checkIns',
  'guest_check_ins',
  'seva_opportunities',
  'seva_signups',
  'achievements',
  'setu_verification_codes',
  'otp_rate_limit',
  'weeklySchedules',
  'family_notifications',
  'counters',
  'app_config',
  'pledges',
  'audit_log',
  'prasadAssignments',
  'prasadConfig',
] as const;

/** §3 "DO NOT TOUCH — owned by the standalone check-in app". */
const DOOR_OWNED = ['family-check-ins', 'guest-families', 'verification_codes'] as const;

type Probe = { name: string; exists: boolean; error?: string };

async function probe(db: FirebaseFirestore.Firestore, name: string): Promise<Probe> {
  try {
    const snap = await db.collection(name).limit(1).get();
    return { name, exists: !snap.empty };
  } catch (err) {
    return { name, exists: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

async function main() {
  const project = process.env.MASTER_FIREBASE_PROJECT_ID ?? '(unset)';
  console.log('Pre-cutover collection audit (READ-ONLY) — runbook §3');
  console.log(`  project: ${project}`);
  if (project !== 'chinmaya-setu-715b8') {
    console.log('\n  ⚠️  This is NOT the prod project. The audit only means something against 715b8.');
  }
  console.log('');

  const db = getFirestore(getMasterApp());

  console.log('1. PORTAL-owned names — expect every one to be ABSENT:');
  const portal = await Promise.all(PORTAL_OWNED.map((c) => probe(db, c)));
  const collisions = portal.filter((p) => p.exists);
  const unreadable = portal.filter((p) => p.error);
  for (const p of portal) {
    if (p.error) console.log(`   ❓ ${p.name}: ${p.error}`);
    else if (p.exists) console.log(`   🔴 ${p.name}: HAS DOCUMENTS — investigate before writing`);
    else console.log(`   ✅ ${p.name}: absent`);
  }

  console.log('\n2. DOOR-owned names — expect these to be PRESENT (proves we are on prod):');
  const door = await Promise.all(DOOR_OWNED.map((c) => probe(db, c)));
  for (const p of door) {
    if (p.error) console.log(`   ❓ ${p.name}: ${p.error}`);
    else console.log(`   ${p.exists ? '✅' : '⚠️ '} ${p.name}: ${p.exists ? 'present' : 'EMPTY/absent'}`);
  }

  console.log('\n3. Credential capability — what this service account can actually do:');
  try {
    const users = await getAuth(getMasterApp()).listUsers(1);
    console.log(`   ✅ Firebase Auth ADMIN: yes (listUsers returned ${users.users.length})`);
  } catch (err) {
    console.log(`   🔴 Firebase Auth ADMIN: NO — ${err instanceof Error ? err.message : String(err)}`);
  }

  // Write capability is checked by asking Firestore to run an empty batch. An
  // empty commit is accepted by the service and creates no document, so this
  // answers "may I write?" without leaving anything behind.
  try {
    await db.batch().commit();
    console.log('   ✅ Firestore WRITE: accepted an (empty) commit');
  } catch (err) {
    console.log(`   🔴 Firestore WRITE: NO — ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log('');
  if (collisions.length > 0) {
    console.log(`🔴 STOP — ${collisions.length} portal-owned name(s) already hold data: ${collisions.map((c) => c.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (unreadable.length > 0) {
    console.log(`⚠️  ${unreadable.length} name(s) could not be read — the audit is INCOMPLETE, not clean.`);
    process.exitCode = 1;
    return;
  }
  const doorPresent = door.filter((d) => d.exists).length;
  if (doorPresent === 0) {
    console.log('⚠️  No door collection had data. Either this is not prod, or the credential cannot read them — do not treat section 1 as an all-clear.');
    process.exitCode = 1;
    return;
  }
  console.log('PASS — no collisions, and the door collections confirm this is prod.');
}

void main();
