# Legacy Family Enrollment Backfill (current school year) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize `apps/portal/scripts/backfill-bv-enrollments.ts` to enroll the ~142 legacy families that lack a **current-school-year** Bala Vihar enrollment (so their kids appear in each level's Previous students list), without disturbing the ~513 families the rollover already promoted.

**Architecture:** Extract three pure decision helpers into `src/features/setu/enrollment/legacy-backfill-helpers.ts` (unit-tested), then wire them into the existing ops script: resolve the BV offering ids from the **live** school year, **skip** any family that already has an active current-year enrollment (protects promoted families' advanced grades), and **cancel** a stale prior-year BV enrollment for families being enrolled. Extend the run report. Update the runbook. Verify by UAT dry-run + staged commit + deployed-UAT walkthrough.

**Tech Stack:** TypeScript, `tsx --env-file=.env.local`, Firebase Admin (Firestore + RTDB read-only), Vitest.

## Global Constraints

- **UAT writes only.** The script must refuse unless `PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'` (existing `--allow-prod` bypass, used only at prod cutover). Never touch prod `715b8` except read-only RTDB.
- **RTDB is read via the snapshot locally** (`RTDB_SNAPSHOT_DIR=.rtdb-snapshot`); never live-download from a dev/UAT run.
- **No em dash** anywhere (code, comments, docs). Use `-`.
- **No new `enrolledVia` value, no schema change, no new Firestore index, no `MOBILE_API_CHANGELOG` entry** (no `/api/setu/*` shape change).
- **`enrolledVia` stays `'welcome-team'`** for backfilled families (unconfirmed under issue-#23 -> Previous students).
- **exactOptionalPropertyTypes is on** - never assign `undefined` to an optional; omit the key.
- Commit author is the repo-local `CMT Developer <developer@chinmayatoronto.org>`; never add an agent co-author.
- Runbook currency: any UAT DB op requires updating `docs/runbooks/production-cutover-checklist.md` (§6/§10/§14) in the same change.

**Reference (existing script, do not re-derive):** `apps/portal/scripts/backfill-bv-enrollments.ts` currently hardcodes `BV_BRAMPTON_OID = 'bv-brampton-2025-26'` / `BV_SCARBOROUGH_OID = 'bv-scarborough-2025-26'`, has `oidForCenter(center)`, `processFamily(db, legacyFid, offerings, dryRun)`, and `main()`. `LegacyLocation = 'Brampton' | 'Mississauga' | 'Scarborough' | 'Markham'`. Non-cached school-year read: `getSchoolYearConfig(portalFirestore())` returns `{ currentYear: string }` (e.g. `"2026-27"`) from `@/features/setu/rollover/school-year-config`.

---

### Task 1: Pure backfill decision helpers

**Files:**
- Create: `apps/portal/src/features/setu/enrollment/legacy-backfill-helpers.ts`
- Test: `apps/portal/src/features/setu/enrollment/__tests__/legacy-backfill-helpers.test.ts`

**Interfaces:**
- Consumes: `LegacyLocation` from `@/features/setu/registration/legacy-parser`.
- Produces:
  - `bvOidForCenter(center: LegacyLocation, year: string): string`
  - `isBvOid(oid: string | null | undefined): boolean`
  - `hasActiveEnrollmentForOid(enrollments: EnrollmentLite[], oid: string): boolean`
  - `priorYearBvEidsToCancel(enrollments: EnrollmentLite[], currentOid: string): string[]`
  - `type EnrollmentLite = { oid?: string; eid?: string; status?: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/setu/enrollment/__tests__/legacy-backfill-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  bvOidForCenter,
  isBvOid,
  hasActiveEnrollmentForOid,
  priorYearBvEidsToCancel,
  type EnrollmentLite,
} from '../legacy-backfill-helpers';

describe('bvOidForCenter', () => {
  it('maps Scarborough to the Scarborough offering for the given year', () => {
    expect(bvOidForCenter('Scarborough', '2026-27')).toBe('bv-scarborough-2026-27');
  });
  it('maps Brampton (and every non-Scarborough center) to the Brampton offering', () => {
    expect(bvOidForCenter('Brampton', '2026-27')).toBe('bv-brampton-2026-27');
    expect(bvOidForCenter('Mississauga', '2026-27')).toBe('bv-brampton-2026-27');
    expect(bvOidForCenter('Markham', '2026-27')).toBe('bv-brampton-2026-27');
  });
});

describe('isBvOid', () => {
  it('is true only for bv- prefixed offering ids', () => {
    expect(isBvOid('bv-brampton-2026-27')).toBe(true);
    expect(isBvOid('tabla-brampton-2026-27')).toBe(false);
    expect(isBvOid(undefined)).toBe(false);
    expect(isBvOid(null)).toBe(false);
  });
});

describe('hasActiveEnrollmentForOid', () => {
  const rows: EnrollmentLite[] = [
    { oid: 'bv-brampton-2026-27', eid: 'F-bv-brampton-2026-27', status: 'active' },
    { oid: 'bv-brampton-2025-26', eid: 'F-bv-brampton-2025-26', status: 'cancelled' },
  ];
  it('is true when an active enrollment exists for the target oid', () => {
    expect(hasActiveEnrollmentForOid(rows, 'bv-brampton-2026-27')).toBe(true);
  });
  it('is false when the only match is cancelled', () => {
    expect(hasActiveEnrollmentForOid(rows, 'bv-brampton-2025-26')).toBe(false);
  });
  it('is false when no enrollment matches the oid', () => {
    expect(hasActiveEnrollmentForOid(rows, 'bv-scarborough-2026-27')).toBe(false);
  });
});

describe('priorYearBvEidsToCancel', () => {
  it('returns active BV enrollments whose oid differs from the current one', () => {
    const rows: EnrollmentLite[] = [
      { oid: 'bv-brampton-2025-26', eid: 'F-bv-brampton-2025-26', status: 'active' }, // cancel
      { oid: 'bv-brampton-2026-27', eid: 'F-bv-brampton-2026-27', status: 'active' }, // current -> keep
      { oid: 'bv-brampton-2024-25', eid: 'F-bv-brampton-2024-25', status: 'cancelled' }, // already cancelled -> skip
      { oid: 'tabla-brampton-2025-26', eid: 'F-tabla', status: 'active' }, // non-BV -> keep
    ];
    expect(priorYearBvEidsToCancel(rows, 'bv-brampton-2026-27')).toEqual(['F-bv-brampton-2025-26']);
  });
  it('returns empty when there are no stale prior-year BV enrollments', () => {
    expect(priorYearBvEidsToCancel([{ oid: 'bv-brampton-2026-27', eid: 'X', status: 'active' }], 'bv-brampton-2026-27')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/enrollment/__tests__/legacy-backfill-helpers.test.ts`
Expected: FAIL - cannot resolve `../legacy-backfill-helpers`.

- [ ] **Step 3: Write the implementation**

Create `apps/portal/src/features/setu/enrollment/legacy-backfill-helpers.ts`:

```ts
import type { LegacyLocation } from '@/features/setu/registration/legacy-parser';

/** A minimal view of an enrollment doc - only the fields the backfill decisions read. */
export type EnrollmentLite = { oid?: string; eid?: string; status?: string };

/** Bala Vihar offering id for a legacy center + school year. Scarborough maps to the
 *  Scarborough offering; every other center (Brampton / Mississauga / Markham) maps to
 *  Brampton - matching the legacy-parser mapLocation default. */
export function bvOidForCenter(center: LegacyLocation, year: string): string {
  return center === 'Scarborough' ? `bv-scarborough-${year}` : `bv-brampton-${year}`;
}

/** True for Bala Vihar offering ids (the `bv-` prefix), used to isolate BV enrollments
 *  from a family's other-program (Tabla, etc.) enrollments. */
export function isBvOid(oid: string | null | undefined): boolean {
  return typeof oid === 'string' && oid.startsWith('bv-');
}

/** Does the family already hold an ACTIVE enrollment for this exact offering? Drives the
 *  skip-guard that protects rollover-promoted families from a grade revert / overwrite. */
export function hasActiveEnrollmentForOid(enrollments: EnrollmentLite[], oid: string): boolean {
  return enrollments.some((e) => e.oid === oid && e.status === 'active');
}

/** Eids of the family's ACTIVE BV enrollments for a DIFFERENT (stale prior-year) offering,
 *  to cancel when we enroll them into the current year - keeps exactly one active BV
 *  enrollment per family. */
export function priorYearBvEidsToCancel(enrollments: EnrollmentLite[], currentOid: string): string[] {
  return enrollments
    .filter((e) => e.status === 'active' && isBvOid(e.oid) && e.oid !== currentOid && typeof e.eid === 'string')
    .map((e) => e.eid as string);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/enrollment/__tests__/legacy-backfill-helpers.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @cmt/portal typecheck
git add apps/portal/src/features/setu/enrollment/legacy-backfill-helpers.ts apps/portal/src/features/setu/enrollment/__tests__/legacy-backfill-helpers.test.ts
git commit -m "feat(enrollment): pure helpers for the current-year legacy backfill"
```

---

### Task 2: Generalize `backfill-bv-enrollments.ts` to the live year + skip-guard + prior-year cancel + report

**Files:**
- Modify: `apps/portal/scripts/backfill-bv-enrollments.ts`

**Interfaces:**
- Consumes: `bvOidForCenter`, `hasActiveEnrollmentForOid`, `priorYearBvEidsToCancel` from `@/features/setu/enrollment/legacy-backfill-helpers`; `getSchoolYearConfig` from `@/features/setu/rollover/school-year-config`.
- Produces: the same script, now year-agnostic, with new `FamilyOutcome.status` value `'skipped-already-enrolled'`, new outcome fields `priorYearCancelled: number` and `gradelessKids: { name: string; mid: string }[]`, and matching summary lines.

This task has no unit test (an ops script that reads the RTDB roster + UAT Firestore); it is verified by a **UAT dry-run** at the end of the task. The pure decisions it calls are already unit-tested in Task 1.

- [ ] **Step 1: Swap the hardcoded constants + imports**

Replace the two OID constants and the local `oidForCenter` with the shared helpers and the live-year import. At the top of the file, after the existing imports, add:

```ts
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import {
  bvOidForCenter,
  hasActiveEnrollmentForOid,
  priorYearBvEidsToCancel,
  type EnrollmentLite,
} from '@/features/setu/enrollment/legacy-backfill-helpers';
```

Delete these lines:

```ts
const BV_BRAMPTON_OID = 'bv-brampton-2025-26';
const BV_SCARBOROUGH_OID = 'bv-scarborough-2025-26';
```

Delete the local `oidForCenter` function (now `bvOidForCenter` from the helper, which takes a `year`).

- [ ] **Step 2: Extend `FamilyOutcome`**

Change the `FamilyOutcome` interface to add the new status and fields:

```ts
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
  gradeFixes?: number;
  priorYearCancelled?: number;
  gradelessKids?: { name: string; mid: string }[];
  error?: string;
}
```

- [ ] **Step 3: Thread `year` + `oid` through `processFamily` and add the skip-guard**

Change the `processFamily` signature to take the resolved `year`, and compute `oid` via `bvOidForCenter(center, year)`. Immediately after resolving `oid`/`eid`, read the family's enrollments once and apply the skip-guard **before** any grade re-assert. Replace the body from the `const oid = oidForCenter(center);` line through the members walk with:

```ts
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
  const gradeByLegacySid = new Map<string, string | null>();
  for (const child of currentChildren) {
    if (child.legacySid != null) gradeByLegacySid.set(child.legacySid, child.schoolGrade);
  }

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
```

Keep the existing "6. Walk Setu members -> enrolledMids" block that follows, but rename its comment number to 7 and, while building `enrolledMids`, collect gradeless current kids. Replace the members loop with:

```ts
  // 7. enrolledMids = current children's mids (via legacySid). Re-assert grade
  //    where stale, and record any current child with no parseable grade.
  const membersSnap = await db.collection('families').doc(fid).collection('members').get();
  const enrolledMids: string[] = [];
  const gradelessKids: { name: string; mid: string }[] = [];
  let gradeFixes = 0;
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

    const freshGrade = gradeByLegacySid.has(m.legacySid) ? (gradeByLegacySid.get(m.legacySid) ?? null) : (m.schoolGrade ?? null);
    if (freshGrade == null || freshGrade === '') {
      gradelessKids.push({ name: `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim(), mid: m.mid });
    }
    if (gradeByLegacySid.has(m.legacySid)) {
      const storedGrade = m.schoolGrade ?? null;
      if (freshGrade !== storedGrade) {
        gradeFixes++;
        if (!dryRun) await doc.ref.set({ schoolGrade: freshGrade }, { merge: true });
      }
    }
  }
```

- [ ] **Step 4: Add the prior-year cancel + carry the new fields into the enrollment write and returns**

After resolving `managerMid` and `suggestedAmountSnapshot`, compute the prior-year cancels. Keep the existing `enrolledVia: 'welcome-team'` write unchanged. Replace the dry-run return and the enrollment-write block with:

```ts
  const priorEids = priorYearBvEidsToCancel(enrollments, oid);

  if (dryRun) {
    return { status: 'dry-run', center, oid, childCount: enrolledMids.length, gradeFixes, priorYearCancelled: priorEids.length, gradelessKids };
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

  return { status: 'enrolled', center, oid, childCount: enrolledMids.length, gradeFixes, priorYearCancelled: priorEids.length, gradelessKids };
}
```

- [ ] **Step 5: Resolve the live year in `main()` + load the current-year offerings + extend the report**

In `main()`, after the UAT-guard block and before loading offerings, resolve the year and the two oids; pass `year` into `processFamily`; add the new counters + gradeless roll-up + summary lines. Replace the offerings-load loop and the per-family/summary sections:

```ts
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
```

Add to the `counts` object: `skippedAlreadyEnrolled: 0` and `priorYearCancelled: 0`, and add `const gradelessAll: { name: string; mid: string; legacyFid: string }[] = [];` before the loop. In the loop, change the `processFamily` call to pass `year`:

```ts
      const outcome = await processFamily(db, legacyFid, offerings, year, args.dryRun);
      counts.gradeFixes += outcome.gradeFixes ?? 0;
      counts.priorYearCancelled += outcome.priorYearCancelled ?? 0;
      for (const g of outcome.gradelessKids ?? []) gradelessAll.push({ ...g, legacyFid });
```

Add a branch for the new status alongside the existing ones:

```ts
      } else if (outcome.status === 'skipped-already-enrolled') {
        counts.skippedAlreadyEnrolled++;
        console.log(`${pos} ${legacyFid.padEnd(8)} = skipped (already enrolled ${outcome.oid})`);
```

Extend the summary block with:

```ts
  console.log(`  Skipped (already enr):${counts.skippedAlreadyEnrolled}`);
  console.log(`  Prior-year cancelled: ${counts.priorYearCancelled}${args.dryRun ? ' (dry-run - not written)' : ''}`);
  if (gradelessAll.length > 0) {
    console.log(`\n  Enrolled-but-gradeless children (${gradelessAll.length}) - set a grade so they appear on a level:`);
    for (const g of gradelessAll) console.log(`    ${g.name.padEnd(28)} mid=${g.mid} legacyFid=${g.legacyFid}`);
  }
```

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint`
Expected: both exit 0. (`exactOptionalPropertyTypes` - if a `FamilyOutcome` return omits an optional field, that is correct; never pass `undefined`.)

- [ ] **Step 7: UAT dry-run smoke test (read-only, writes nothing)**

Run:
```bash
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/backfill-bv-enrollments.ts --dry-run --limit 40
```
Expected: prints `School year: 2026-27`, loads both offerings, and for 40 families shows a mix of `would enroll` / `skipped (already enrolled ...)` / `skipped (no current kids)`. No errors. Confirms the year resolution, skip-guard, and report all execute.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/scripts/backfill-bv-enrollments.ts
git commit -m "feat(enrollment): backfill-bv-enrollments targets the live year + skips already-enrolled families"
```

---

### Task 3: Runbook updates (§6, §10, §14)

**Files:**
- Modify: `docs/runbooks/production-cutover-checklist.md`

**Interfaces:** None (docs only).

- [ ] **Step 1: §6 (prod data-migration sequence)**

Add a step: after the target school year is activated and the BV offerings are seeded for that year (and before kiosk cutover), run `pnpm --filter @cmt/portal backfill:bv-enrollments --allow-prod` to enroll currently-registered legacy families that lack a current-year BV enrollment. Note it is idempotent and skips already-enrolled families.

- [ ] **Step 2: §10 (CLI script reference)**

Update the `backfill:bv-enrollments` entry: it now targets the **live** school year (`getSchoolYearConfig().currentYear`), no longer hardcoded 2025-26; it **skips** families with an active current-year enrollment (protects rollover-promoted grades) and cancels stale prior-year BV enrollments; it prints an enrolled-but-gradeless report.

- [ ] **Step 3: §14 (dated change-log entry)**

Add a `**2026-07-13**` entry: generalized `backfill-bv-enrollments.ts` to the live school year + already-enrolled skip-guard + prior-year cancel + gradeless report; ran on UAT to enroll the ~142 legacy families (incl. `legacyFid 477` / Harshita) missing a 2026-27 BV enrollment so their kids surface in Previous students; **prod-cutover TODO:** re-run with `--allow-prod` after the prod year is activated + BV offerings seeded. No schema/index change.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/production-cutover-checklist.md
git commit -m "docs(runbook): current-year legacy enrollment backfill (§6/§10/§14)"
```

---

### Task 4: UAT run + verification (operator-run, not a subagent)

**Files:** None (operational; writes UAT Firestore).

This task is run by the controller/operator after Tasks 1-3 are merged, because it writes ~142 real UAT families. Do not delegate the commit run to a subagent.

- [ ] **Step 1: Full dry-run (writes nothing)**

```bash
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/backfill-bv-enrollments.ts --dry-run
```
Expected: ~142 `would enroll` (Brampton-heavy), ~513 `skipped (already enrolled)`, remainder `skipped (no current kids)`. Review the enrolled-but-gradeless list.

- [ ] **Step 2: Staged commit - Harshita's family first**

```bash
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/backfill-bv-enrollments.ts --fid 477
```
Expected: 1 enrolled, center Brampton -> `bv-brampton-2026-27`, 1+ children.

- [ ] **Step 3: Full commit**

```bash
pnpm --filter @cmt/portal backfill:bv-enrollments
```
Expected: ~142 enrolled, ~513 skipped-already-enrolled, 0 errors.

- [ ] **Step 4: Idempotency re-run**

Re-run Step 3. Expected: 0 enrolled, ~all skipped-already-enrolled (proves the guard + idempotency).

- [ ] **Step 5: Read-only re-audit**

Re-run the families-with-children-but-no-active-enrollment count against UAT (throwaway tsx script reading each family's members + `enrollments.where('status','==','active')`). Expected: legacy no-enrollment count drops to ~0 (excluding genuinely-graduated / gradeless families).

- [ ] **Step 6: Deployed-UAT walkthrough**

On `cmt-setu.vercel.app` as a teacher of Brampton Level 2: confirm **Harshita Rana** now appears under **Previous students**; mark her present; confirm she + siblings move to **Enrolled** and a present attendance event is recorded. Spot-check 2-3 already-promoted (grade-advanced) families - grades unchanged (skip-guard held).

---

## Self-Review

**Spec coverage:**
- Change 1 (live year) -> Task 2 Steps 1, 5. ✓
- Change 2 (skip-guard) -> Task 1 (`hasActiveEnrollmentForOid`) + Task 2 Step 3. ✓
- Change 3 (prior-year cancel) -> Task 1 (`priorYearBvEidsToCancel`) + Task 2 Step 4. ✓
- RTDB snapshot read -> Global Constraints (existing `readRtdb` behavior, unchanged). ✓
- Extended report (skipped-already-enrolled, prior-year-cancelled, gradeless) -> Task 2 Steps 2, 5. ✓
- enrolledVia stays welcome-team -> Task 2 Step 4 + Global Constraints. ✓
- Runbook §6/§10/§14 -> Task 3. ✓
- Verification (dry-run, staged commit, idempotency, re-audit, walkthrough) -> Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `bvOidForCenter(center, year)`, `hasActiveEnrollmentForOid(rows, oid)`, `priorYearBvEidsToCancel(rows, oid)`, `EnrollmentLite`, and `FamilyOutcome`'s new fields are named identically in Task 1 and Task 2. `processFamily(db, legacyFid, offerings, year, dryRun)` matches its call site in Task 2 Step 5. ✓
