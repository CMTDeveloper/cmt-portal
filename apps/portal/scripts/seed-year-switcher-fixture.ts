/**
 * Phase 2 year-switcher fixture (UAT-only, idempotent, NON-DESTRUCTIVE).
 *
 * Gives the admin school-year switcher ≥3 selectable years so the Past / Live /
 * Preparing paths can be exercised end-to-end against deployed UAT. The
 * switcher's selectable set is `listKnownSchoolYears` = BV offering `termLabel`s
 * (plus the live year), so this seed ensures a **Past** (`2024-25`) and a
 * **Preparing** (`2026-27`) BV offering exist alongside the live `2025-26`.
 *
 * It also seeds the supporting docs the year-switcher E2E asserts on:
 *   - one BV level per seeded year (so `/admin/levels?year=…` has rows / a
 *     past-year read-only surface),
 *   - one `seva_opportunities` doc in the Past `sevaYear` (Phase 2 seva copy
 *     fixture / traceability),
 *   - one enabled `classCalendarEntries` doc dated in the Preparing-year window
 *     (`2026-09-06`, a Sunday) so the calendar live-year-exclusion assertion has
 *     something to exclude.
 *
 * IDEMPOTENT: every write uses `create()`-style "only if absent" — an existing
 * doc is reported and never overwritten (so a re-run can't clobber real data).
 *
 * NON-DESTRUCTIVE re: `app_config` — this seed does NOT flip the live year
 * (`app_config/school_year`) and never runs Activate. The live year stays
 * `2025-26`.
 *
 * Every seeded doc carries `_test: true` for traceability.
 *
 * UAT-ONLY: refuses to run unless PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'
 * (no --allow-prod escape hatch on purpose — this is a test fixture).
 *
 * Usage:
 *   pnpm --filter @cmt/portal seed:year-switcher-fixture            # seed
 *   pnpm --filter @cmt/portal seed:year-switcher-fixture --cleanup  # remove the fixture
 *
 * --cleanup deletes ONLY the docs this script seeds, and ONLY when the doc still
 * carries `_test: true` — a real doc that happens to share an id is left
 * untouched. Restores the clean pre-rollover state (live year never touched).
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getPortalApp } from '@cmt/firebase-shared/admin/apps';
import { BALA_VIHAR, calendarEntryId, levelSlug, toSafeSlug } from '@cmt/shared-domain';

const SYSTEM_UID = 'seed-year-switcher-fixture';
const LOCATION = 'Brampton';

interface YearFixture {
  year: string;
  oid: string;
  // Offering window (UTC). Same Sept→June span as the live offerings.
  startDate: Date;
  endDate: Date;
  // One BV level for the year.
  level: { levelName: string; levelKind: 'level'; gradeBand: string[]; ageLabel: string; curriculum: string; order: number };
}

const PAST: YearFixture = {
  year: '2024-25',
  oid: 'bv-brampton-2024-25',
  startDate: new Date(Date.UTC(2024, 8, 8)), // 2024-09-08
  endDate: new Date(Date.UTC(2025, 5, 15)), // 2025-06-15
  level: { levelName: 'Level 1', levelKind: 'level', gradeBand: ['1'], ageLabel: 'Grade 1', curriculum: 'Krishna Krishna', order: 2 },
};

const PREPARING: YearFixture = {
  year: '2026-27',
  oid: 'bv-brampton-2026-27',
  startDate: new Date(Date.UTC(2026, 8, 6)), // 2026-09-06
  endDate: new Date(Date.UTC(2027, 5, 13)), // 2027-06-13
  level: { levelName: 'Level 1', levelKind: 'level', gradeBand: ['1'], ageLabel: 'Grade 1', curriculum: 'Krishna Krishna', order: 2 },
};

// Pricing mirrors the live BV tiers (admins adjust in the period editor).
const PRICING = [
  { effectiveFrom: '2024-09-01', amountCAD: 500, label: 'Full year (from September)' },
];

type Db = FirebaseFirestore.Firestore;

interface Tally {
  created: string[];
  existing: string[];
}

/** Create a doc only if it's absent. Records created/existing; never overwrites. */
async function ensureDoc(
  db: Db,
  collection: string,
  id: string,
  data: Record<string, unknown>,
  tally: Tally,
): Promise<void> {
  const ref = db.collection(collection).doc(id);
  const snap = await ref.get();
  if (snap.exists) {
    tally.existing.push(`${collection}/${id}`);
    return;
  }
  await ref.set(data);
  tally.created.push(`${collection}/${id}`);
}

async function seedOffering(db: Db, fx: YearFixture, now: Timestamp, tally: Tally): Promise<void> {
  await ensureDoc(db, 'offerings', fx.oid, {
    oid: fx.oid,
    programKey: BALA_VIHAR,
    programLabel: 'Bala Vihar',
    location: LOCATION,
    termLabel: fx.year,
    termType: 'term',
    startDate: Timestamp.fromDate(fx.startDate),
    endDate: Timestamp.fromDate(fx.endDate),
    pricingTiers: PRICING,
    paymentSource: 'portal',
    enabled: true,
    _test: true,
    createdAt: now,
    createdBy: SYSTEM_UID,
    updatedAt: now,
    updatedBy: SYSTEM_UID,
  }, tally);

  // donationPeriods mirror — the admin levels page reads the period dropdown
  // from donationPeriods (where enabled), so seed it too for symmetry.
  await ensureDoc(db, 'donationPeriods', fx.oid, {
    pid: fx.oid,
    programKey: BALA_VIHAR,
    programLabel: 'Bala Vihar',
    location: LOCATION,
    periodLabel: fx.year,
    startDate: Timestamp.fromDate(fx.startDate),
    endDate: Timestamp.fromDate(fx.endDate),
    pricingTiers: PRICING,
    paymentSource: 'portal',
    enabled: true,
    _test: true,
    createdAt: now,
    createdBy: SYSTEM_UID,
    updatedAt: now,
    updatedBy: SYSTEM_UID,
  }, tally);
}

async function seedLevel(db: Db, fx: YearFixture, now: Timestamp, tally: Tally): Promise<void> {
  const levelId = `${toSafeSlug(LOCATION)}-${levelSlug(fx.level.levelName)}-${fx.oid}`;
  await ensureDoc(db, 'levels', levelId, {
    levelId,
    programKey: BALA_VIHAR,
    location: LOCATION,
    levelName: fx.level.levelName,
    levelKind: fx.level.levelKind,
    order: fx.level.order,
    gradeBand: fx.level.gradeBand,
    ageLabel: fx.level.ageLabel,
    curriculum: fx.level.curriculum,
    pid: fx.oid,
    periodLabel: fx.year,
    teacherRefs: [],
    enabled: true,
    _test: true,
    createdAt: now,
    createdBy: SYSTEM_UID,
    updatedAt: now,
    updatedBy: SYSTEM_UID,
  }, tally);
}

/** Every (collection, id) this fixture writes — the single source of truth for
 *  both the seed tally and the cleanup. */
function seededDocRefs(): Array<{ collection: string; id: string }> {
  const refs: Array<{ collection: string; id: string }> = [];
  for (const fx of [PAST, PREPARING]) {
    refs.push({ collection: 'offerings', id: fx.oid });
    refs.push({ collection: 'donationPeriods', id: fx.oid });
    refs.push({ collection: 'levels', id: `${toSafeSlug(LOCATION)}-${levelSlug(fx.level.levelName)}-${fx.oid}` });
  }
  refs.push({ collection: 'seva_opportunities', id: `seva-year-switcher-${PAST.year}` });
  refs.push({ collection: 'classCalendarEntries', id: calendarEntryId(BALA_VIHAR, LOCATION, '2026-09-06') });
  return refs;
}

/** Delete the seeded docs — but ONLY those still flagged `_test: true`. A real
 *  doc sharing an id (e.g. a manual rollover later created `bv-brampton-2026-27`)
 *  is NEVER deleted. */
async function cleanup(db: Db): Promise<void> {
  const deleted: string[] = [];
  const skipped: string[] = [];
  for (const { collection, id } of seededDocRefs()) {
    const ref = db.collection(collection).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      skipped.push(`${collection}/${id} (absent)`);
      continue;
    }
    if ((snap.data() as { _test?: unknown })._test !== true) {
      skipped.push(`${collection}/${id} (NOT _test — left untouched)`);
      continue;
    }
    await ref.delete();
    deleted.push(`${collection}/${id}`);
  }
  console.log(`Deleted (${deleted.length}):`);
  for (const id of deleted) console.log(`  - ${id}`);
  console.log(`\nSkipped (${skipped.length}):`);
  for (const id of skipped) console.log(`  · ${id}`);
  console.log('\nDone. Clean pre-rollover state restored (app_config/school_year was never touched).');
}

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  const isCleanup = process.argv.includes('--cleanup');
  console.log(`\n=== seed-year-switcher-fixture${isCleanup ? ' --cleanup' : ''} — project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    // No --allow-prod escape hatch on purpose: this is a test fixture and must
    // never exist in prod.
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat.');
    process.exit(1);
  }

  const db = getFirestore(getPortalApp());

  if (isCleanup) {
    await cleanup(db);
    process.exit(0);
  }

  const now = Timestamp.now();
  const tally: Tally = { created: [], existing: [] };

  // ── Past + Preparing offerings (+ donationPeriods mirror) + one level each ──
  for (const fx of [PAST, PREPARING]) {
    await seedOffering(db, fx, now, tally);
    await seedLevel(db, fx, now, tally);
  }

  // ── Past-year seva opportunity (sevaYear:'2024-25') ───────────────────────
  const sevaId = `seva-year-switcher-${PAST.year}`;
  await ensureDoc(db, 'seva_opportunities', sevaId, {
    oppId: sevaId,
    title: 'Year-switcher fixture seva (2024-25)',
    description: '',
    date: Timestamp.fromDate(new Date(Date.UTC(2024, 9, 6))), // 2024-10-06
    location: LOCATION,
    defaultHours: 4,
    capacity: null,
    sevaYear: PAST.year,
    status: 'open',
    _test: true,
    createdAt: now,
    createdBy: SYSTEM_UID,
    updatedAt: now,
    updatedBy: SYSTEM_UID,
  }, tally);

  // ── Preparing-year calendar entry (2026-09-06, a Sunday) ──────────────────
  // Enabled + dated in the 2026-27 window so GET /api/setu/calendar (live-year
  // scoped) MUST exclude it — that exclusion is the E2E assertion.
  const prepDate = '2026-09-06';
  const calId = calendarEntryId(BALA_VIHAR, LOCATION, prepDate);
  await ensureDoc(db, 'classCalendarEntries', calId, {
    entryId: calId,
    programKey: BALA_VIHAR,
    location: LOCATION,
    date: prepDate,
    kind: 'class',
    classType: 'first',
    noClassReason: null,
    specialEvents: 'Year-switcher fixture — preparing year (must NOT appear in live calendar)',
    enabled: true,
    prasadNeeded: true,
    _test: true,
    createdAt: now,
    createdBy: SYSTEM_UID,
    updatedAt: now,
    updatedBy: SYSTEM_UID,
  }, tally);

  console.log(`Created (${tally.created.length}):`);
  for (const id of tally.created) console.log(`  + ${id}`);
  console.log(`\nAlready present (${tally.existing.length}):`);
  for (const id of tally.existing) console.log(`  = ${id}`);
  console.log(
    `\nDone. Live year is unchanged (app_config/school_year NOT touched). ` +
      `Selectable years now include ${PAST.year}, 2025-26 (live), ${PREPARING.year}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
