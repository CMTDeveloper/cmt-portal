/**
 * Legacy Bala Vihar enrollment backfill (UAT, idempotent).
 *
 * Reads every legacy family from the prod RTDB roster (MASTER_FIREBASE
 * credentials, READ-ONLY) and, for each family with ≥1 CURRENTLY-REGISTERED
 * child, writes an ACTIVE Bala Vihar enrollment under that center's CURRENT
 * school-year offering into the Setu Firestore (PORTAL_FIREBASE credentials -
 * UAT by default). The legacy roster accumulates since 2012; only kids with a
 * non-null legacy `level` are currently registered (graduated/inactive kids
 * carry a NULL level and are excluded from enrolledMids).
 *
 * Per family:
 *   1. lazyMigrateLegacyFamily(legacyFid) - idempotent; ensures the Setu
 *      family + members + contactKeys exist; returns the Setu fid.
 *   2. Re-parse the legacy family → its non-parent children with the corrected
 *      schoolGrade (JK/SK fix from legacy-parser) + legacySid + legacyLevel.
 *   3. currentChildren = children with a non-null legacy `level`.
 *      - If none: the family has no current BV kids → if a prior run left an
 *        enrollment doc, set status:'cancelled' (merge); never create one.
 *   4. schoolGrade is NEVER written here. The legacy roster holds LAST year's
 *      grades, so re-asserting them onto a current-year enrollment would revert
 *      the correct (rollover/admin-advanced) Setu grade and drop the child off
 *      their level. Grades are owned by migration / rollover / admin; current
 *      children with a missing stored grade are only FLAGGED in the report.
 *   5. enrolledMids = the CURRENT children's Setu child mids (via legacySid).
 *   6. Upsert families/{fid}/enrollments/{fid}-{oid} with the full schema-valid
 *      doc INCLUDING `pid: oid` - the field deriveRoster queries on
 *      (collectionGroup('enrollments').where('pid','==',level.pid)). Without it
 *      the teacher roster stays EMPTY despite "successful" enrollments.
 *      set(...,{merge:true}) replaces enrolledMids with the current-only array.
 *
 * Does NOT call enrollFamily/getProgram (they use Next 'use cache' and throw
 * outside a render context). Writes the enrollment doc directly, mirroring
 * seed-e2e-family.ts ensureEnrollment() - but that helper OMITS `pid`; this
 * script ADDS it.
 *
 * Center → offering: the offering id is derived from the LIVE school year
 * (getSchoolYearConfig().currentYear): Scarborough → bv-scarborough-<year>;
 * everything else (Brampton / NULL / ALL / missing) → bv-brampton-<year>
 * (matches the legacy-parser mapLocation default). Families that already hold
 * an ACTIVE current-year enrollment are skipped untouched (protects
 * rollover-promoted grades); a stale prior-year BV enrollment is cancelled.
 *
 * Standing constraints:
 *   - UAT writes ONLY. Refuses unless PORTAL_FIREBASE_PROJECT_ID is
 *     chinmaya-setu-uat (pass --allow-prod to bypass - never used here).
 *   - The RTDB read of prod 715b8 is read-only by design. NEVER writes 715b8.
 *   - Idempotent: deterministic eid = `${fid}-${oid}`, set(..., { merge:true }).
 *
 * Usage:
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local \
 *     scripts/backfill-bv-enrollments.ts [--dry-run] [--limit N] [--fid X] [--allow-prod]
 *
 *   # dry-run a sample (writes nothing)
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local \
 *     scripts/backfill-bv-enrollments.ts --dry-run --limit 20
 *
 *   # full UAT run
 *   pnpm --filter @cmt/portal backfill:bv-enrollments
 */

import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { resolveSuggestedAmount, type OfferingDoc } from '@cmt/shared-domain';
import { listAllFamilies } from '@/features/check-in/shared/rtdb/family-lookup';
import { lazyMigrateLegacyFamily } from '@/features/setu/registration/lazy-migrate';
import {
  fetchLegacyFamilyForMigration,
  type LegacyLocation,
} from '@/features/setu/registration/legacy-parser';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import {
  bvOidForCenter,
  hasActiveEnrollmentForOid,
  priorYearBvEidsToCancel,
  type EnrollmentLite,
} from '@/features/setu/enrollment/legacy-backfill-helpers';

type Db = ReturnType<typeof portalFirestore>;

interface Args {
  dryRun: boolean;
  limit: number | null;
  fid: string | null;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, limit: null, fid: null, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--allow-prod') args.allowProd = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--fid') args.fid = argv[++i] ?? null;
  }
  return args;
}

function toDate(v: unknown): Date {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(v as string);
}

/** A loaded offering doc reduced to just the fields the backfill needs. */
interface OfferingInfo {
  oid: string;
  programKey: string;
  programLabel: string;
  termLabel: string;
  location: OfferingDoc['location'];
  startDate: Date;
  pricingTiers: OfferingDoc['pricingTiers'];
}

async function loadOffering(db: Db, oid: string): Promise<OfferingInfo | null> {
  const snap = await db.collection('offerings').doc(oid).get();
  if (!snap.exists) return null;
  const od = snap.data() as Record<string, unknown>;
  return {
    oid,
    programKey: od['programKey'] as string,
    programLabel: od['programLabel'] as string,
    termLabel: od['termLabel'] as string,
    location: (od['location'] ?? null) as OfferingDoc['location'],
    startDate: toDate(od['startDate']),
    pricingTiers: (od['pricingTiers'] as OfferingDoc['pricingTiers']) ?? [],
  };
}

interface FamilyOutcome {
  status:
    | 'enrolled'
    | 'deactivated'
    | 'skipped-already-enrolled'
    | 'skipped-no-current-children'
    | 'skipped-no-children'
    | 'error'
    | 'dry-run';
  center?: LegacyLocation;
  oid?: string;
  childCount?: number;
  priorYearCancelled?: number;
  gradelessKids?: { name: string; mid: string }[];
  error?: string;
}

async function processFamily(
  db: Db,
  legacyFid: string,
  offerings: Map<string, OfferingInfo>,
  year: string,
  dryRun: boolean,
): Promise<FamilyOutcome> {
  // 1. Ensure the Setu family + members exist (idempotent), get the Setu fid.
  const migrate = await lazyMigrateLegacyFamily(legacyFid);
  const fid = migrate.fid;

  // 2. Re-parse the legacy family -> its non-parent children + center.
  const legacy = await fetchLegacyFamilyForMigration(legacyFid);
  if (!legacy) return { status: 'error', error: 'legacy family vanished mid-run' };
  const center = legacy.location;
  if (legacy.children.length === 0) return { status: 'skipped-no-children', center };

  // 3. Current kids = non-null legacy level (graduated/inactive carry NULL).
  const currentChildren = legacy.children.filter((c) => c.legacyLevel != null);
  const currentLegacySids = new Set(currentChildren.map((c) => c.legacySid).filter((s): s is string => s != null));

  // 4. Current-year offering for this center.
  const oid = bvOidForCenter(center, year);
  const offering = offerings.get(oid);
  if (!offering) return { status: 'error', center, oid, error: `offering ${oid} not loaded` };
  const eid = `${fid}-${oid}`;

  // 5. SKIP-GUARD: if the family already has an active enrollment for this
  //    current-year offering, leave it completely alone. The rollover ADVANCED
  //    promoted kids' grades (grade 1 -> 2, ...), which the legacy roster does not
  //    know - re-asserting here would revert them. Read enrollments once; reuse
  //    for the prior-year cancel below.
  const enrollSnap = await db.collection('families').doc(fid).collection('enrollments').get();
  const enrollments: EnrollmentLite[] = enrollSnap.docs.map((d) => {
    const e = d.data() as { oid?: string; eid?: string; status?: string };
    return { oid: e.oid, eid: e.eid ?? d.id, status: e.status };
  });
  if (hasActiveEnrollmentForOid(enrollments, oid)) {
    return { status: 'skipped-already-enrolled', center, oid };
  }

  // 6. No current BV kids -> deactivate a stale enrollment for THIS oid if present.
  if (currentChildren.length === 0) {
    const enrollRef = db.collection('families').doc(fid).collection('enrollments').doc(eid);
    const existing = await enrollRef.get();
    if (existing.exists) {
      if (!dryRun) await enrollRef.set({ status: 'cancelled' }, { merge: true });
      return { status: 'deactivated', center, oid };
    }
    return { status: 'skipped-no-current-children', center, oid };
  }

  // 7. enrolledMids = current children's mids (via legacySid). We deliberately do
  //    NOT touch schoolGrade here: the legacy roster holds LAST year's grades, so
  //    re-asserting them onto a CURRENT-year enrollment would revert the correct
  //    (rollover/admin-advanced) Setu grade and drop the child off their level
  //    (e.g. reverting a Grade 2 kid to Grade 1 removes them from Level 2). Grades
  //    are owned by migration / rollover / admin. We only FLAG current children
  //    whose STORED grade is missing - they will not match any level until it is set.
  const membersSnap = await db.collection('families').doc(fid).collection('members').get();
  const enrolledMids: string[] = [];
  const gradelessKids: { name: string; mid: string }[] = [];
  for (const doc of membersSnap.docs) {
    const m = doc.data() as {
      mid?: string;
      type?: 'Adult' | 'Child';
      firstName?: string;
      lastName?: string;
      schoolGrade?: string | null;
      legacySid?: string | null;
    };
    if (!m.mid || m.type !== 'Child') continue;
    if (m.legacySid == null || !currentLegacySids.has(m.legacySid)) continue;
    enrolledMids.push(m.mid);
    const storedGrade = m.schoolGrade ?? null;
    if (storedGrade == null || storedGrade === '') {
      gradelessKids.push({ name: `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim(), mid: m.mid });
    }
  }

  // Resolve the manager mid (every migrated family has a manager).
  const familySnap = await db.collection('families').doc(fid).get();
  const familyData = familySnap.data() as { managers?: string[] } | undefined;
  const managerMid = familyData?.managers?.[0] ?? `${fid}-01`;

  const suggestedAmountSnapshot = resolveSuggestedAmount(offering, offering.startDate);

  const priorEids = priorYearBvEidsToCancel(enrollments, oid);

  if (dryRun) {
    return { status: 'dry-run', center, oid, childCount: enrolledMids.length, priorYearCancelled: priorEids.length, gradelessKids };
  }

  // 8. Upsert the enrollment doc - CRUCIALLY carrying pid: oid.
  await db.collection('families').doc(fid).collection('enrollments').doc(eid).set(
    {
      eid, fid, oid,
      pid: oid, // required - deriveRoster queries where('pid','==',level.pid)
      programKey: offering.programKey,
      programLabel: offering.programLabel,
      termLabel: offering.termLabel,
      location: offering.location,
      enrolledMids,
      enrolledAt: FieldValue.serverTimestamp(),
      enrolledVia: 'welcome-team',
      enrolledByMid: managerMid,
      suggestedAmountSnapshot,
      suggestedAmountOverride: null,
      status: 'active',
      cancelledAt: null,
      cancelledReason: null,
    },
    { merge: true },
  );

  // 9. Cancel stale prior-year BV enrollments so exactly one active BV enrollment remains.
  for (const staleEid of priorEids) {
    await db.collection('families').doc(fid).collection('enrollments').doc(staleEid).set(
      { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp(), cancelledReason: `superseded-by-${oid}` },
      { merge: true },
    );
  }

  return { status: 'enrolled', center, oid, childCount: enrolledMids.length, priorYearCancelled: priorEids.length, gradelessKids };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const portalProject = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  const masterProject = process.env['MASTER_FIREBASE_PROJECT_ID'];
  if (!portalProject || !masterProject) {
    console.error('REFUSED: PORTAL_FIREBASE_PROJECT_ID and MASTER_FIREBASE_PROJECT_ID must be set in .env.local');
    process.exit(1);
  }
  if (portalProject !== 'chinmaya-setu-uat' && !args.allowProd) {
    console.error(
      `REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${portalProject}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`,
    );
    process.exit(1);
  }

  console.log('\nLegacy Bala Vihar enrollment backfill');
  console.log(`  Read from:  ${masterProject} (RTDB roster, read-only)`);
  console.log(`  Write to:   ${portalProject} (Firestore${args.dryRun ? ', DRY-RUN - no writes' : ''})`);
  if (args.limit !== null) console.log(`  Limit:      first ${args.limit} families`);
  if (args.fid !== null) console.log(`  Filter:     legacyFid=${args.fid} only`);
  console.log('');

  const db = portalFirestore();

  const { currentYear: year } = await getSchoolYearConfig(db);
  const bramptonOid = bvOidForCenter('Brampton', year);
  const scarboroughOid = bvOidForCenter('Scarborough', year);
  console.log(`  School year: ${year}  (offerings ${bramptonOid} / ${scarboroughOid})\n`);

  const offerings = new Map<string, OfferingInfo>();
  for (const oid of [bramptonOid, scarboroughOid]) {
    const off = await loadOffering(db, oid);
    if (!off) {
      console.error(`REFUSED: offering ${oid} not found in ${portalProject}. Seed offerings first.`);
      process.exit(1);
    }
    offerings.set(oid, off);
    console.log(`  loaded offering ${oid} (programKey=${off.programKey}, location=${off.location ?? 'null'})`);
  }
  console.log('');

  console.log('Reading legacy roster…');
  let families = await listAllFamilies();
  console.log(`  → ${families.length} legacy families found`);

  if (args.fid !== null) {
    families = families.filter((f) => String(f.fid) === args.fid);
    console.log(`  → ${families.length} matched --fid=${args.fid}`);
  }
  if (args.limit !== null) {
    families = families.slice(0, args.limit);
    console.log(`  → ${families.length} after --limit=${args.limit}`);
  }
  console.log('');

  const counts = {
    processed: 0,
    enrolled: 0,
    wouldEnroll: 0,
    deactivated: 0,
    skippedAlreadyEnrolled: 0,
    skippedNoCurrentChildren: 0,
    skippedNoChildren: 0,
    errors: 0,
    priorYearCancelled: 0,
  };
  const perCenter = new Map<string, number>(); // oid → enrolled count
  const gradelessAll: { name: string; mid: string; legacyFid: string }[] = [];

  for (let i = 0; i < families.length; i++) {
    const fam = families[i];
    if (!fam) continue;
    const legacyFid = String(fam.fid);
    const pos = `[${String(i + 1).padStart(4)}/${families.length}]`;
    counts.processed++;

    try {
      const outcome = await processFamily(db, legacyFid, offerings, year, args.dryRun);
      counts.priorYearCancelled += outcome.priorYearCancelled ?? 0;
      for (const g of outcome.gradelessKids ?? []) gradelessAll.push({ ...g, legacyFid });

      if (outcome.status === 'skipped-no-children') {
        counts.skippedNoChildren++;
        console.log(`${pos} ${legacyFid.padEnd(8)} ↺ skipped (no children)`);
      } else if (outcome.status === 'skipped-already-enrolled') {
        counts.skippedAlreadyEnrolled++;
        console.log(`${pos} ${legacyFid.padEnd(8)} = skipped (already enrolled ${outcome.oid})`);
      } else if (outcome.status === 'skipped-no-current-children') {
        counts.skippedNoCurrentChildren++;
        console.log(`${pos} ${legacyFid.padEnd(8)} ↺ skipped (no current kids)`);
      } else if (outcome.status === 'deactivated') {
        counts.deactivated++;
        console.log(`${pos} ${legacyFid.padEnd(8)} ⊘ deactivated (no current kids; cancelled stale enrollment)`);
      } else if (outcome.status === 'error') {
        counts.errors++;
        console.error(`${pos} ${legacyFid.padEnd(8)} ✗ ERROR: ${outcome.error}`);
      } else {
        // enrolled or dry-run
        if (outcome.oid) perCenter.set(outcome.oid, (perCenter.get(outcome.oid) ?? 0) + 1);
        if (outcome.status === 'enrolled') counts.enrolled++;
        else counts.wouldEnroll++;
        const verb = outcome.status === 'dry-run' ? 'would enroll' : '✓ enrolled';
        console.log(
          `${pos} ${legacyFid.padEnd(8)} ${verb}  center=${outcome.center} → ${outcome.oid}  (${outcome.childCount} children)`,
        );
      }
    } catch (err) {
      counts.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${pos} ${legacyFid.padEnd(8)} ✗ ERROR: ${msg}`);
    }
  }

  console.log('\nSummary:');
  console.log(`  Processed:           ${counts.processed}`);
  if (args.dryRun) {
    console.log(`  Would enroll:        ${counts.wouldEnroll}`);
  } else {
    console.log(`  Enrolled:            ${counts.enrolled}`);
  }
  console.log(`  Deactivated (stale): ${counts.deactivated}${args.dryRun ? ' (dry-run - not written)' : ''}`);
  console.log(`  Skipped (already enr):${counts.skippedAlreadyEnrolled}`);
  console.log(`  Skipped (no current):${counts.skippedNoCurrentChildren}`);
  console.log(`  Skipped (no kids):   ${counts.skippedNoChildren}`);
  console.log(`  Prior-year cancelled: ${counts.priorYearCancelled}${args.dryRun ? ' (dry-run - not written)' : ''}`);
  console.log(`  Errors:              ${counts.errors}`);
  console.log('  Per offering:');
  for (const [oid, n] of perCenter) {
    console.log(`    ${oid}: ${n}`);
  }
  if (gradelessAll.length > 0) {
    console.log(`\n  Enrolled-but-gradeless children (${gradelessAll.length}) - set a grade so they appear on a level:`);
    for (const g of gradelessAll) console.log(`    ${g.name.padEnd(28)} mid=${g.mid} legacyFid=${g.legacyFid}`);
  }

  process.exit(counts.errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
