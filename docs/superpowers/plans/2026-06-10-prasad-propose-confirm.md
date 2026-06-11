# Prasad Propose→Confirm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish writes prasad *proposals*; families confirm the suggested Sunday (or pick any open one); admins assign whoever never confirms.

**Architecture:** The pure engine (`proposePrasadAssignments`) and all cap/placement logic are untouched. A `'proposed'` status is added ahead of `'assigned'` in the doc lifecycle; every seat-counting read learns to count both; a new confirm transaction, two admin assign endpoints, status-aware reminder copy, and a publish-time proposal notification complete the loop. No new Firestore indexes, no `canAccessRoute` changes (the `/api/setu/prasad/` prefix rule already makes new POSTs manager-only).

**Tech Stack:** Next.js 16 route handlers, Firestore Admin SDK transactions/batches, Zod schemas in `@cmt/shared-domain`, Vitest with the existing seeds-based fake-firestore harnesses, Playwright vs deployed UAT.

**Spec:** `docs/superpowers/specs/2026-06-10-prasad-propose-confirm-design.md`

**Standing constraints (read first):**
- All DB work targets UAT (`chinmaya-setu-uat`) only. Never touch prod `715b8`.
- `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are ON.
- Zod schemas must gain every new field in the SAME commit as writers (silent-strip trap).
- Tests ship in the same commit as the branching logic they cover.
- Never `--no-verify`; push after each authorized commit is fine but at minimum push at the end (pre-push gate = typecheck/lint/test/build).
- E2E mutation specs must tolerate re-runs (UAT is shared state; seeds restore fixtures).
- The existing E2E fixture `prasadAssignments/bv-brampton-2025-26-CMT-FSWEDU2X` stays `status:'assigned'` — the shipped locked-move specs depend on it.

---

## File map

| File | Change |
|---|---|
| `packages/shared-domain/src/setu/prasad.ts` | `'proposed'` status; `confirmedAt/confirmedBy/proposalNotifiedAt`; confirm + assign-remaining bodies; `assign` on admin-reassign body |
| `apps/portal/src/features/setu/prasad/load-engine-input.ts` | proposed docs count as `existing` |
| `apps/portal/src/features/setu/prasad/family-assignment.ts` | view + options + move count/return proposed; new `confirmAssignment` |
| `apps/portal/src/features/setu/prasad/publish-assignments.ts` | publish writes `proposed` + null lifecycle fields |
| `apps/portal/src/features/setu/prasad/proposal-notify.ts` | **new** — notify un-notified proposals (env-gated, stamp-after-send) |
| `apps/portal/src/features/setu/prasad/reminder-service.ts` | status-aware copy (assigned reminder vs proposed confirm-nudge) |
| `apps/portal/src/app/api/setu/prasad/confirm/route.ts` | **new** POST (manager-only via existing prefix rule) |
| `apps/portal/src/app/api/admin/prasad/assignment/route.ts` | `assign:true` flips proposed→assigned |
| `apps/portal/src/app/api/admin/prasad/assign-remaining/route.ts` | **new** POST bulk assign |
| `apps/portal/src/app/api/admin/prasad/publish/route.ts` | calls `notifyUnnotifiedProposals` after publish |
| `apps/portal/src/features/setu/prasad/prasad-client.ts` | `confirmPrasad`, `assignRemainingPrasad`, `assign` on reassign body |
| `apps/portal/src/features/setu/prasad/family-prasad-card.tsx` | proposed state: Confirm CTA + choose-a-Sunday sheet mode |
| `apps/portal/src/features/setu/prasad/admin-prasad-screen.tsx` | status chips, per-row Assign, bulk assign, confirmed/proposed counts, CTA copy |
| `apps/portal/src/features/setu/prasad/upcoming.ts` + `apps/portal/src/app/welcome/prasad/page.tsx` | include proposed with chips + counts |
| `apps/portal/scripts/seed-test-accounts.ts` | proposed fixture on the Scarborough test family |
| `apps/portal/e2e/setu/prasad-propose.spec.ts` | **new** persona E2E |
| `docs/runbooks/production-cutover-checklist.md`, `CLAUDE.md` | §14 entry + ops ritual + status block |

---

### Task 1: Schema — status, lifecycle fields, request bodies

**Files:**
- Modify: `packages/shared-domain/src/setu/prasad.ts`
- Test: `apps/portal/src/features/setu/prasad/__tests__/prasad-schemas.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside the existing top-level `describe` in `prasad-schemas.test.ts`; reuse the file's existing valid-doc fixture builder if one exists, else inline a full doc):

```ts
import {
  PrasadAssignmentDocSchema,
  PrasadConfirmBodySchema,
  PrasadAssignRemainingBodySchema,
  PrasadAdminReassignBodySchema,
  PRASAD_STATUSES,
} from '@cmt/shared-domain';

describe('propose→confirm lifecycle', () => {
  const baseDoc = {
    paid: 'bv-brampton-2025-26-CMT-AB12CD34',
    pid: 'bv-brampton-2025-26',
    fid: 'CMT-AB12CD34',
    familyName: 'Patel Family',
    location: 'Brampton',
    date: '2026-03-22',
    youngestMid: 'CMT-AB12CD34-03',
    youngestName: 'Anu Patel',
    birthMonth: 3,
    reason: 'birthday-month' as const,
    source: 'auto' as const,
    status: 'proposed' as const,
    assignedAt: new Date(),
    movedFrom: null,
    movedAt: null,
    movedBy: null,
    remindedAt: { weekBefore: null, twoDayBefore: null },
    confirmedAt: null,
    confirmedBy: null,
    proposalNotifiedAt: null,
  };

  it('accepts proposed status and the lifecycle fields', () => {
    expect(PRASAD_STATUSES).toContain('proposed');
    const parsed = PrasadAssignmentDocSchema.parse(baseDoc);
    expect(parsed.status).toBe('proposed');
    expect(parsed.confirmedBy).toBeNull();
  });

  it('round-trips confirmedBy family|admin (no silent strip)', () => {
    const parsed = PrasadAssignmentDocSchema.parse({
      ...baseDoc, status: 'assigned', confirmedAt: new Date(), confirmedBy: 'admin',
      proposalNotifiedAt: new Date(),
    });
    expect(parsed.confirmedBy).toBe('admin');
    expect(parsed.proposalNotifiedAt).toBeInstanceOf(Date);
  });

  it('rejects unknown confirmedBy', () => {
    expect(() => PrasadAssignmentDocSchema.parse({ ...baseDoc, confirmedBy: 'sevak' })).toThrow();
  });

  it('confirm body: empty {} and {date} both valid; bad date rejected', () => {
    expect(PrasadConfirmBodySchema.parse({})).toEqual({});
    expect(PrasadConfirmBodySchema.parse({ date: '2026-04-05' }).date).toBe('2026-04-05');
    expect(() => PrasadConfirmBodySchema.parse({ date: 'nope' })).toThrow();
  });

  it('assign-remaining body requires pid', () => {
    expect(PrasadAssignRemainingBodySchema.parse({ pid: 'bv-brampton-2025-26' }).pid).toBe('bv-brampton-2025-26');
    expect(() => PrasadAssignRemainingBodySchema.parse({})).toThrow();
  });

  it('admin reassign body accepts assign:true', () => {
    const p = PrasadAdminReassignBodySchema.parse({ paid: 'x-y', assign: true });
    expect(p.assign).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/prasad-schemas.test.ts`
Expected: FAIL — `'proposed'` not in enum, unknown export `PrasadConfirmBodySchema`, unrecognized keys stripped.

- [ ] **Step 3: Implement** in `packages/shared-domain/src/setu/prasad.ts`:

Change the statuses line:
```ts
export const PRASAD_STATUSES = ['proposed', 'assigned', 'cancelled'] as const;
```

Add to `PrasadAssignmentDocSchema` (after the `remindedAt` field):
```ts
  // Propose→confirm lifecycle (2026-06-10 revision): publish writes 'proposed';
  // a family confirm or an admin assign flips to 'assigned'. Docs written before
  // the revision have status 'assigned' and these fields absent → default null.
  confirmedAt: z.date().nullable().default(null),
  confirmedBy: z.enum(['family', 'admin']).nullable().default(null),
  proposalNotifiedAt: z.date().nullable().default(null),
```

Add after `PrasadMoveBodySchema`:
```ts
/** Family confirm: no date → confirm the proposed Sunday in place; with date →
 *  confirm at that open Sunday instead (cap-checked). */
export const PrasadConfirmBodySchema = z.object({ date: YMD.optional() });
export type PrasadConfirmBody = z.infer<typeof PrasadConfirmBodySchema>;

/** Admin bulk: flip every remaining 'proposed' row for the pid to 'assigned'. */
export const PrasadAssignRemainingBodySchema = z.object({ pid: z.string().min(1) });
export type PrasadAssignRemainingBody = z.infer<typeof PrasadAssignRemainingBodySchema>;
```

Extend `PrasadAdminReassignBodySchema`:
```ts
export const PrasadAdminReassignBodySchema = z.object({
  paid: z.string().min(1),
  date: YMD.optional(),           // present → reassign to this date
  cancel: z.boolean().optional(), // true → status:'cancelled' (family left)
  assign: z.boolean().optional(), // true → proposed→assigned (confirmedBy:'admin')
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/prasad-schemas.test.ts && pnpm --filter @cmt/portal typecheck`
Expected: PASS / clean. (Typecheck confirms no downstream type break from the enum widening.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/setu/prasad.ts apps/portal/src/features/setu/prasad/__tests__/prasad-schemas.test.ts
git commit -m "feat(prasad): proposed status + confirm lifecycle fields/bodies in shared schema"
```

---

### Task 2: Seat-counting + family view treat `proposed` as live

**Files:**
- Modify: `apps/portal/src/features/setu/prasad/load-engine-input.ts:55`
- Modify: `apps/portal/src/features/setu/prasad/family-assignment.ts`
- Test: `apps/portal/src/features/setu/prasad/__tests__/family-assignment.test.ts` (extend the existing seeds harness — `AssignmentSeed.status` already exists)

- [ ] **Step 1: Write the failing tests** (append to the file; `ymdPlus(n)` and `makeDb(seeds, updateOps)` are already in the harness):

```ts
describe('proposed-status handling', () => {
  it('getFamilyAssignment returns a proposed doc (status surfaced)', async () => {
    const seeds: Seeds = {
      calendar: [],
      config: [{ pid: 'bv-brampton-2025-26', capPerSunday: 10 }],
      assignments: [{
        paid: 'bv-brampton-2025-26-F1', fid: 'F1', pid: 'bv-brampton-2025-26',
        date: ymdPlus(30), status: 'proposed', reason: 'birthday-month', youngestName: 'Anu', birthMonth: 6,
      }],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);
    const view = await getFamilyAssignment('F1');
    expect(view?.status).toBe('proposed');
  });

  it('getMoveOptions counts proposed rows against the cap', async () => {
    const target = ymdPlus(30);
    const seeds: Seeds = {
      calendar: [
        { entryId: 'c1', location: 'Brampton', programKey: 'bala-vihar', date: target, kind: 'class' },
        { entryId: 'c2', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(37), kind: 'class' },
      ],
      config: [{ pid: 'bv-brampton-2025-26', capPerSunday: 1 }],
      assignments: [
        { paid: 'bv-brampton-2025-26-F1', fid: 'F1', pid: 'bv-brampton-2025-26', date: ymdPlus(37), status: 'assigned' },
        // A PROPOSED family already holds the only seat on `target`.
        { paid: 'bv-brampton-2025-26-F2', fid: 'F2', pid: 'bv-brampton-2025-26', date: target, status: 'proposed' },
      ],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);
    const opts = await getMoveOptions('F1');
    expect(opts!.options.find((o) => o.date === target)).toBeUndefined(); // full
  });

  it('a PROPOSED family sees near-term Sundays (no 7-day lock) but never past ones', async () => {
    const near = ymdPlus(3); // inside MOVE_LOCK_DAYS — visible only to proposed
    const seeds: Seeds = {
      calendar: [
        { entryId: 'c1', location: 'Brampton', programKey: 'bala-vihar', date: near, kind: 'class' },
        { entryId: 'c2', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(-7), kind: 'class' },
      ],
      config: [{ pid: 'bv-brampton-2025-26', capPerSunday: 10 }],
      assignments: [{
        paid: 'bv-brampton-2025-26-F1', fid: 'F1', pid: 'bv-brampton-2025-26',
        date: ymdPlus(30), status: 'proposed',
      }],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);
    const opts = await getMoveOptions('F1');
    expect(opts!.options.map((o) => o.date)).toEqual([near]);
  });

  it('moveAssignment counts proposed rows in the txn cap check', async () => {
    const target = ymdPlus(30);
    const updateOps: UpdateOp[] = [];
    const seeds: Seeds = {
      calendar: [
        { entryId: 'c1', location: 'Brampton', programKey: 'bala-vihar', date: target, kind: 'class' },
        { entryId: 'c2', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(44), kind: 'class' },
      ],
      config: [{ pid: 'bv-brampton-2025-26', capPerSunday: 1 }],
      assignments: [
        { paid: 'bv-brampton-2025-26-F1', fid: 'F1', pid: 'bv-brampton-2025-26', date: ymdPlus(44), status: 'assigned' },
        { paid: 'bv-brampton-2025-26-F2', fid: 'F2', pid: 'bv-brampton-2025-26', date: target, status: 'proposed' },
      ],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, updateOps, { capInTxn: 1 }) as never);
    // The options list already excludes the full Sunday → invalid-target is the
    // observable result of proposed-aware counting at BOTH layers.
    expect(await moveAssignment('F1', target, 'M1')).toBe('invalid-target');
    expect(updateOps).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/family-assignment.test.ts`
Expected: FAIL — proposed doc skipped by `getFamilyAssignment`; proposed seat not counted; near-term Sunday filtered by the lock.

- [ ] **Step 3: Implement** in `family-assignment.ts`:

`getFamilyAssignment` — replace the status guard (line 20):
```ts
    if (a.status !== 'assigned' && a.status !== 'proposed') continue;
```

`getMoveOptions` — replace the seat-count filter (line 50) and the lock filter (line 55):
```ts
    if (a.status === 'assigned' || a.status === 'proposed') countByDate.set(a.date, (countByDate.get(a.date) ?? 0) + 1);
```
```ts
    // Confirmed families keep the 7-day move lock; a proposed family may pick
    // ANY future Sunday (confirming late beats not confirming at all).
    .filter((e) => daysUntil(e.date, todayYmd) > (current.status === 'proposed' ? 0 : MOVE_LOCK_DAYS) && e.date !== current.date)
```

`moveAssignment` — replace the txn count (line 80):
```ts
    const activeCount = targetSnap.docs.filter((d) => {
      const s = (d.data() as { status: string }).status;
      return s === 'assigned' || s === 'proposed';
    }).length;
```

In `load-engine-input.ts` — replace line 55 so proposed families are not re-proposed and keep their seat:
```ts
    if (a.status === 'assigned' || a.status === 'proposed') existingByFid.set(a.fid, { date: a.date });
```

- [ ] **Step 4: Run the full prasad unit set**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad`
Expected: PASS (existing tests unaffected — they seed only `assigned`/`cancelled`).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/prasad/load-engine-input.ts apps/portal/src/features/setu/prasad/family-assignment.ts apps/portal/src/features/setu/prasad/__tests__/family-assignment.test.ts
git commit -m "feat(prasad): proposed rows hold seats and surface to the family view"
```

---

### Task 3: `confirmAssignment` transaction

**Files:**
- Modify: `apps/portal/src/features/setu/prasad/family-assignment.ts` (append)
- Test: `apps/portal/src/features/setu/prasad/__tests__/family-assignment.test.ts`

- [ ] **Step 1: Write the failing tests** (append; note `makeDb` records `updateOps` for `tx.update`):

```ts
describe('confirmAssignment', () => {
  const PID = 'bv-brampton-2025-26';
  function proposedSeeds(extra: AssignmentSeed[] = []): Seeds {
    return {
      calendar: [
        { entryId: 'c1', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(30), kind: 'class' },
        { entryId: 'c2', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(37), kind: 'class' },
      ],
      config: [{ pid: PID, capPerSunday: 2 }],
      assignments: [
        { paid: `${PID}-F1`, fid: 'F1', pid: PID, date: ymdPlus(30), status: 'proposed' },
        ...extra,
      ],
    };
  }

  it('confirms in place (no date): status flip, confirmedBy family', async () => {
    const updateOps: UpdateOp[] = [];
    mockFirestore.mockReturnValue(makeDb(proposedSeeds(), updateOps) as never);
    expect(await confirmAssignment('F1', undefined, 'M1')).toBe('confirmed');
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0]!.data).toMatchObject({ status: 'assigned', confirmedBy: 'family' });
    expect(updateOps[0]!.data.date).toBeUndefined(); // in-place keeps the date
  });

  it('confirms at another open Sunday: date moves + flip in one update', async () => {
    const updateOps: UpdateOp[] = [];
    mockFirestore.mockReturnValue(makeDb(proposedSeeds(), updateOps) as never);
    expect(await confirmAssignment('F1', ymdPlus(37), 'M1')).toBe('confirmed');
    expect(updateOps[0]!.data).toMatchObject({
      status: 'assigned', confirmedBy: 'family', date: ymdPlus(37), source: 'family-move',
    });
  });

  it('rejects a full target Sunday', async () => {
    const updateOps: UpdateOp[] = [];
    const seeds = proposedSeeds([
      { paid: `${PID}-F2`, fid: 'F2', pid: PID, date: ymdPlus(37), status: 'assigned' },
      { paid: `${PID}-F3`, fid: 'F3', pid: PID, date: ymdPlus(37), status: 'proposed' },
    ]); // cap 2, both seats taken
    mockFirestore.mockReturnValue(makeDb(seeds, updateOps) as never);
    // options already hides the full Sunday → surfaces as invalid-target
    expect(await confirmAssignment('F1', ymdPlus(37), 'M1')).toBe('invalid-target');
    expect(updateOps).toHaveLength(0);
  });

  it('already-confirmed when the doc is assigned', async () => {
    const seeds: Seeds = { ...proposedSeeds() };
    seeds.assignments[0]!.status = 'assigned';
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);
    expect(await confirmAssignment('F1', undefined, 'M1')).toBe('already-confirmed');
  });

  it('not-found without any doc', async () => {
    mockFirestore.mockReturnValue(makeDb({ calendar: [], config: [], assignments: [] }, []) as never);
    expect(await confirmAssignment('F9', undefined, 'M1')).toBe('not-found');
  });
});
```

Add `confirmAssignment` to the import at the top of the test file.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/family-assignment.test.ts`
Expected: FAIL — `confirmAssignment` not exported.

- [ ] **Step 3: Implement** (append to `family-assignment.ts`):

```ts
export type ConfirmResult = 'confirmed' | 'not-found' | 'already-confirmed' | 'invalid-target' | 'target-full';

/**
 * Family confirm: no targetDate → flip the proposed doc to assigned in place
 * (the seat is already counted — no cap check). With targetDate → validate it
 * against the live options list, then re-count the target inside the txn
 * (mirrors moveAssignment) and move+flip in one update. confirmedBy:'family'.
 */
export async function confirmAssignment(
  fid: string,
  targetDate: string | undefined,
  actorMid: string,
): Promise<ConfirmResult> {
  const current = await getFamilyAssignment(fid);
  if (!current) return 'not-found';
  if (current.status !== 'proposed') return 'already-confirmed';

  const db = portalFirestore();
  const ref = db.collection('prasadAssignments').doc(current.paid);

  if (targetDate === undefined || targetDate === current.date) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return 'not-found' as const;
      if ((snap.data() as { status?: string }).status !== 'proposed') return 'already-confirmed' as const;
      tx.update(ref, {
        status: 'assigned',
        confirmedAt: FieldValue.serverTimestamp(),
        confirmedBy: 'family',
      });
      return 'confirmed' as const;
    });
  }

  const opts = await getMoveOptions(fid);
  if (!opts || !opts.options.some((o) => o.date === targetDate)) return 'invalid-target';
  const cfgSnap = await db.collection('prasadConfig').doc(current.pid).get();
  const cap = (cfgSnap.data()?.capPerSunday as number | undefined) ?? FALLBACK_CAP;

  return db.runTransaction(async (tx) => {
    const targetSnap = await tx.get(
      db.collection('prasadAssignments').where('pid', '==', current.pid).where('date', '==', targetDate),
    );
    const liveCount = targetSnap.docs.filter((d) => {
      const s = (d.data() as { status: string }).status;
      return s === 'assigned' || s === 'proposed';
    }).length;
    if (liveCount >= cap) return 'target-full' as const;
    const meSnap = await tx.get(ref);
    if (!meSnap.exists) return 'not-found' as const;
    if ((meSnap.data() as { status?: string }).status !== 'proposed') return 'already-confirmed' as const;
    tx.update(ref, {
      date: targetDate,
      status: 'assigned',
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: 'family',
      movedFrom: current.date,
      movedAt: FieldValue.serverTimestamp(),
      movedBy: actorMid,
      source: 'family-move',
    });
    return 'confirmed' as const;
  });
}
```

(Note: if the harness's `makeDb` txn only supports `tx.get(query)` and not `tx.get(docRef)`, extend the fake's transaction object with a doc-ref branch that resolves via the same `assignmentDocRef(...).get()` — keep the extension inside the test file's `makeDb`.)

- [ ] **Step 4: Run**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/family-assignment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/prasad/family-assignment.ts apps/portal/src/features/setu/prasad/__tests__/family-assignment.test.ts
git commit -m "feat(prasad): confirmAssignment transaction (in-place + choose-a-Sunday)"
```

---

### Task 4: Publish writes `proposed`

**Files:**
- Modify: `apps/portal/src/features/setu/prasad/publish-assignments.ts:35-38`
- Test: `apps/portal/src/features/setu/prasad/__tests__/publish-assignments.test.ts`

- [ ] **Step 1: Write the failing test** (extend the existing publish test that asserts the written doc shape — locate the assertion on `status: 'assigned'` and change/extend):

```ts
it('publish writes NEW rows as proposed with null lifecycle fields', async () => {
  // reuse the file's existing seeds/mocks for a publish run
  // after running publishAssignments(...):
  const written = batchSetCalls.find((c) => c.data.fid === 'F-NEW');
  expect(written!.data).toMatchObject({
    status: 'proposed',
    confirmedAt: null,
    confirmedBy: null,
    proposalNotifiedAt: null,
  });
});
```

(Adapt the capture variable name to the file's existing batch mock — it records `batch.set` calls.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/publish-assignments.test.ts`
Expected: FAIL — written status is `'assigned'`, lifecycle keys absent. Any existing test asserting `status: 'assigned'` in the written doc must be updated to `'proposed'` in this same step.

- [ ] **Step 3: Implement** — in `publishAssignments`, replace the written-doc literal (lines 35-38):

```ts
        source: 'auto', status: 'proposed',
        assignedAt: FieldValue.serverTimestamp(),
        movedFrom: null, movedAt: null, movedBy: null,
        remindedAt: { weekBefore: null, twoDayBefore: null },
        confirmedAt: null, confirmedBy: null, proposalNotifiedAt: null,
```

Also update the function doc comment: `/** Publish = preview + write each NEW row as a PROPOSAL + the config doc. ... */`

- [ ] **Step 4: Run**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/publish-assignments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/prasad/publish-assignments.ts apps/portal/src/features/setu/prasad/__tests__/publish-assignments.test.ts
git commit -m "feat(prasad): publish writes proposals, not assignments"
```

---

### Task 5: Proposal notifications (`proposal-notify.ts`)

**Files:**
- Create: `apps/portal/src/features/setu/prasad/proposal-notify.ts`
- Test: `apps/portal/src/features/setu/prasad/__tests__/proposal-notify.test.ts`

- [ ] **Step 1: Write the failing test** (mirror `reminder-service.test.ts`'s mocks — `resolveSender` returns typed `vi.fn` senders; fake firestore seeds proposed docs + manager members):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmail = vi.fn<(args: { to: string; subject: string; text: string }) => Promise<void>>().mockResolvedValue();
const sendSMS = vi.fn<(args: { phone: string; message: string }) => Promise<void>>().mockResolvedValue();
vi.mock('@/lib/aws/resolve-sender', () => ({ resolveSender: () => ({ sendEmail, sendSMS }) }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { notifyUnnotifiedProposals } from '../proposal-notify';

// Fake db: prasadAssignments where(pid==…).where(status=='proposed') → seeds;
// families/{fid}/members where(manager==true) → managers; doc.ref.set captured.
// (Copy the harness skeleton from reminder-service.test.ts and adapt.)

describe('notifyUnnotifiedProposals', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.PRASAD_REMINDER_CRON_ENABLED = 'true'; });

  it('sends once per un-notified proposed family and stamps proposalNotifiedAt', async () => {
    // seeds: F1 proposed/un-notified, F2 proposed/already notified, F3 assigned
    const result = await notifyUnnotifiedProposals('bv-brampton-2025-26');
    expect(result).toMatchObject({ sent: 1, skipped: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].text).toContain('confirm');
    // stamp captured on F1's doc ref:
    expect(setOps[0]!.data).toMatchObject({ proposalNotifiedAt: '__ts__' });
  });

  it('per-family failures do not abort the batch and count as failed', async () => {
    sendEmail.mockRejectedValueOnce(new Error('ses down'));
    const result = await notifyUnnotifiedProposals('bv-brampton-2025-26'); // F1 fails, F4 succeeds
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
  });

  it('returns disabled when the kill switch is off, sending nothing', async () => {
    process.env.PRASAD_REMINDER_CRON_ENABLED = 'false';
    const result = await notifyUnnotifiedProposals('bv-brampton-2025-26');
    expect(result.disabled).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/proposal-notify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `proposal-notify.ts`:

```ts
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { resolveSender } from '@/lib/aws/resolve-sender';

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export interface ProposalNotifyResult { disabled?: boolean; checked: number; sent: number; skipped: number; failed: number }

/**
 * One-time "your suggested prasad Sunday — please confirm" email+SMS to every
 * PROPOSED family that hasn't been notified yet. Self-healing by design: keyed
 * off the docs (status=='proposed' && proposalNotifiedAt==null), NOT the publish
 * response rows, so a crash between publish and notify is repaired by the next
 * publish click. Stamp-after-send + per-family try/catch — same semantics as
 * sendDuePrasadReminders. Gated by PRASAD_REMINDER_CRON_ENABLED (the master
 * prasad-send switch) + the UAT allowlists inside resolveSender.
 */
export async function notifyUnnotifiedProposals(pid: string): Promise<ProposalNotifyResult> {
  if (process.env.PRASAD_REMINDER_CRON_ENABLED !== 'true') {
    return { disabled: true, checked: 0, sent: 0, skipped: 0, failed: 0 };
  }
  const db = portalFirestore();
  const sender = resolveSender();
  const base = process.env.NEXT_PUBLIC_PORTAL_BASE_URL ?? 'https://cmt-setu.vercel.app';

  // Two equality filters — served by merged single-field indexes, no composite.
  const snap = await db.collection('prasadAssignments')
    .where('pid', '==', pid).where('status', '==', 'proposed').get();

  let sent = 0, skipped = 0, failed = 0;
  for (const doc of snap.docs) {
    const a = doc.data() as { fid: string; date: string; proposalNotifiedAt?: unknown };
    if (a.proposalNotifiedAt != null) { skipped++; continue; }
    try {
      const managersSnap = await db.collection('families').doc(a.fid)
        .collection('members').where('manager', '==', true).get();
      const when = formatDate(a.date);
      for (const m of managersSnap.docs) {
        const mem = m.data() as { email?: string | null; phone?: string | null; firstName?: string };
        const msg = `Namaste ${mem.firstName ?? ''}! Your family's suggested Bala Vihar prasad Sunday is ${when}. Please confirm it or pick another date: ${base}/family/prasad — Chinmaya Mission Toronto`;
        if (mem.email) await sender.sendEmail({ to: mem.email, subject: `Prasad Sunday — please confirm (${when})`, text: msg });
        if (mem.phone) await sender.sendSMS({ phone: mem.phone, message: msg });
      }
      await doc.ref.set({ proposalNotifiedAt: FieldValue.serverTimestamp() }, { merge: true });
      sent++;
    } catch (err) {
      console.error(`[prasad-proposal] family ${a.fid} failed:`, err);
      failed++;
    }
  }
  return { checked: snap.size, sent, skipped, failed };
}
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/proposal-notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/prasad/proposal-notify.ts apps/portal/src/features/setu/prasad/__tests__/proposal-notify.test.ts
git commit -m "feat(prasad): one-time proposal notification (env-gated, stamp-after-send)"
```

---

### Task 6: Status-aware reminder cron

**Files:**
- Modify: `apps/portal/src/features/setu/prasad/reminder-service.ts`
- Test: `apps/portal/src/features/setu/prasad/__tests__/reminder-service.test.ts`

- [ ] **Step 1: Write the failing tests** (the harness already seeds assignments + managers; add):

```ts
it('sends a confirm-nudge (not a reminder) to a proposed family at the 7-day mark', async () => {
  // seed one PROPOSED doc dated today+7 with empty remindedAt
  const result = await sendDuePrasadReminders(now);
  expect(result.sent).toBe(1);
  const text = sendEmail.mock.calls[0]![0].text;
  expect(text).toContain('not confirmed');
  expect(text).toContain('/family/prasad');
});

it('still sends the plain reminder to an assigned family in the same run', async () => {
  // seed one PROPOSED + one ASSIGNED doc both dated today+2
  const result = await sendDuePrasadReminders(now);
  expect(result.sent).toBe(2);
  const texts = sendEmail.mock.calls.map((c) => c[0].text);
  expect(texts.some((t) => t.includes('Please bring prasad'))).toBe(true);
  expect(texts.some((t) => t.includes('not confirmed'))).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/reminder-service.test.ts`
Expected: FAIL — the query only matches `status=='assigned'`; proposed docs invisible.

- [ ] **Step 3: Implement** — in `sendDuePrasadReminders`, replace the single query + message build:

```ts
  // One query per status — `in` can't combine with the date `in` filter, and
  // each (status==, date in […]) pair is served by the existing (status,date)
  // composite. Proposed families get a confirm-nudge instead of a reminder.
  const targets = Object.keys(KIND_BY_DAYS).map((d) => addDays(today, Number(d)));
  const [assignedSnap, proposedSnap] = await Promise.all([
    db.collection('prasadAssignments').where('status', '==', 'assigned').where('date', 'in', targets).get(),
    db.collection('prasadAssignments').where('status', '==', 'proposed').where('date', 'in', targets).get(),
  ]);
  const docs = [
    ...assignedSnap.docs.map((d) => ({ doc: d, proposed: false })),
    ...proposedSnap.docs.map((d) => ({ doc: d, proposed: true })),
  ];
```

…and inside the loop (`for (const { doc, proposed } of docs)`) build the copy per status (everything else — stamps, deep-merge comment, try/catch — unchanged):

```ts
      const base = process.env.NEXT_PUBLIC_PORTAL_BASE_URL ?? 'https://cmt-setu.vercel.app';
      const msg = proposed
        ? `Namaste ${mem.firstName ?? ''}! Your family's suggested Bala Vihar prasad Sunday (${when}) is ${lead} and is not confirmed yet. Please confirm or pick another date: ${base}/family/prasad — Chinmaya Mission Toronto`
        : `Namaste ${mem.firstName ?? ''}! Your family's Bala Vihar prasad day ${lead} — ${when}. Please bring prasad for the assembly. — Chinmaya Mission Toronto`;
      const subject = proposed ? `Prasad Sunday — please confirm (${when})` : `Prasad reminder — ${when}`;
```

Update `checked` to `assignedSnap.size + proposedSnap.size`.

- [ ] **Step 4: Run**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/reminder-service.test.ts`
Expected: PASS (existing assigned-only tests still pass — the second query returns empty for them).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/prasad/reminder-service.ts apps/portal/src/features/setu/prasad/__tests__/reminder-service.test.ts
git commit -m "feat(prasad): 7d/2d cron nudges unconfirmed proposals with confirm copy"
```

---

### Task 7: Routes — confirm, admin assign, assign-remaining, publish notify

**Files:**
- Create: `apps/portal/src/app/api/setu/prasad/confirm/route.ts`
- Modify: `apps/portal/src/app/api/admin/prasad/assignment/route.ts`
- Create: `apps/portal/src/app/api/admin/prasad/assign-remaining/route.ts`
- Modify: `apps/portal/src/app/api/admin/prasad/publish/route.ts`
- Tests: `apps/portal/src/app/api/setu/prasad/__tests__/routes.test.ts`, `apps/portal/src/app/api/admin/prasad/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing tests.** Follow each routes-test file's existing mock pattern (they mock the feature module + `readSessionFromHeaders` + flags). Add:

To the **setu** routes test:
```ts
describe('POST /api/setu/prasad/confirm', () => {
  it('400 on malformed date', async () => {
    const res = await CONFIRM_POST(req('POST', { date: 'nope' }));
    expect(res.status).toBe(400);
  });
  it('maps confirmed→200, not-found→404, already-confirmed/invalid-target/target-full→409', async () => {
    for (const [result, status] of [
      ['confirmed', 200], ['not-found', 404],
      ['already-confirmed', 409], ['invalid-target', 409], ['target-full', 409],
    ] as const) {
      mockConfirmAssignment.mockResolvedValueOnce(result);
      const res = await CONFIRM_POST(req('POST', {}));
      expect(res.status).toBe(status);
    }
  });
});
```

To the **admin** routes test:
```ts
describe('PATCH assignment with assign:true', () => {
  it('flips a proposed row to assigned with confirmedBy admin', async () => {
    const res = await ASSIGNMENT_PATCH(adminReq({ paid: 'p-f', assign: true }));
    expect(res.status).toBe(200);
    expect(capturedUpdate).toMatchObject({ status: 'assigned', confirmedBy: 'admin' });
  });
  it('409 when the row is not proposed', async () => {
    // seed the doc snapshot as status:'assigned'
    const res = await ASSIGNMENT_PATCH(adminReq({ paid: 'p-f', assign: true }));
    expect(res.status).toBe(409);
  });
});

describe('POST /api/admin/prasad/assign-remaining', () => {
  it('400 unknown pid; 403 non-admin; 200 with assigned count', async () => { /* same gate-stack pattern as preview/publish tests */ });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cmt/portal exec vitest run "src/app/api/setu/prasad/__tests__" "src/app/api/admin/prasad/__tests__"`
Expected: FAIL — missing route modules / unhandled body keys.

- [ ] **Step 3: Implement.**

`apps/portal/src/app/api/setu/prasad/confirm/route.ts` (new — mirrors `move/route.ts`; manager-only via the existing `/api/setu/prasad/` prefix rule in `canAccessRoute`, no gate change):
```ts
import { NextResponse } from 'next/server';
import { PrasadConfirmBodySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { confirmAssignment } from '@/features/setu/prasad/family-assignment';

/**
 * POST /api/setu/prasad/confirm — family confirms their PROPOSED Sunday, either
 * in place (no body date) or at another open Sunday. Manager-only at the
 * middleware gate; the transaction re-validates status + target capacity.
 */
export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session?.fid) return NextResponse.json({ error: 'no-session' }, { status: 401 });

  const parsed = PrasadConfirmBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });
  }

  const result = await confirmAssignment(session.fid, parsed.data.date, session.mid ?? 'manager');
  if (result === 'confirmed') return NextResponse.json({ ok: true }, { status: 200 });
  if (result === 'not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ error: result }, { status: 409 });
}
```

`assignment/route.ts` — insert the assign branch BEFORE the date-only branch (cancel stays first):
```ts
  if (parsed.data.assign === true) {
    const data = snap.data() as { status?: string; date?: string } | undefined;
    if (data?.status !== 'proposed') {
      return NextResponse.json({ error: 'not-proposed' }, { status: 409 });
    }
    const actor = session.mid ?? session.uid ?? 'admin';
    await ref.update({
      status: 'assigned',
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: 'admin',
      ...(parsed.data.date !== undefined
        ? { date: parsed.data.date, movedFrom: data?.date ?? null, movedAt: FieldValue.serverTimestamp(), movedBy: actor, source: 'admin' }
        : {}),
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }
```

`assign-remaining/route.ts` (new — same gate stack as publish):
```ts
import { NextResponse } from 'next/server';
import { isAdmin, PrasadAssignRemainingBodySchema } from '@cmt/shared-domain';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { CURRENT_PRASAD_PIDS } from '@/features/setu/prasad/constants';

/** POST /api/admin/prasad/assign-remaining — flip every still-PROPOSED row for
 *  the pid to assigned (confirmedBy:'admin'). The "assign the stragglers"
 *  bulk action before the season starts. Admin-only. */
export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = PrasadAssignRemainingBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });
  if (!CURRENT_PRASAD_PIDS.some((p) => p.pid === parsed.data.pid)) {
    return NextResponse.json({ error: 'unknown-pid' }, { status: 400 });
  }

  const db = portalFirestore();
  const snap = await db.collection('prasadAssignments')
    .where('pid', '==', parsed.data.pid).where('status', '==', 'proposed').get();

  const limit = 400;
  for (let i = 0; i < snap.docs.length; i += limit) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + limit)) {
      batch.update(doc.ref, {
        status: 'assigned',
        confirmedAt: FieldValue.serverTimestamp(),
        confirmedBy: 'admin',
      });
    }
    await batch.commit();
  }
  return NextResponse.json({ ok: true, assigned: snap.size }, { status: 200 });
}
```

`publish/route.ts` — after `publishAssignments(...)`:
```ts
  const result = await publishAssignments(period.pid, period.location, parsed.data.cap, actor);
  // Fire the one-time proposal notifications for anything still un-notified
  // (self-healing — includes rows from a previous publish whose notify crashed).
  const notify = await notifyUnnotifiedProposals(period.pid);
  return NextResponse.json({ ...result, notify }, { status: 200 });
```
(import `notifyUnnotifiedProposals` from `@/features/setu/prasad/proposal-notify`.)

- [ ] **Step 4: Run all route tests**

Run: `pnpm --filter @cmt/portal exec vitest run "src/app/api/setu/prasad" "src/app/api/admin/prasad" "src/app/api/cron/__tests__/send-prasad-reminders.test.ts"`
Expected: PASS (publish route tests may need the new `notifyUnnotifiedProposals` mocked — add `vi.mock('@/features/setu/prasad/proposal-notify', () => ({ notifyUnnotifiedProposals: vi.fn().mockResolvedValue({ checked: 0, sent: 0, skipped: 0, failed: 0 }) }))`).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/app/api/setu/prasad apps/portal/src/app/api/admin/prasad
git commit -m "feat(prasad): confirm + admin assign + bulk assign-remaining routes; publish notifies"
```

---

### Task 8: Client wrappers

**Files:**
- Modify: `apps/portal/src/features/setu/prasad/prasad-client.ts`
- Test: `apps/portal/src/features/setu/prasad/__tests__/prasad-client.test.ts`

- [ ] **Step 1: Failing tests** (follow the file's fetch-mock pattern):

```ts
it('confirmPrasad posts {} for in-place and {date} for choose; throws the API code', async () => { /* mirror movePrasad tests */ });
it('assignRemainingPrasad posts the pid and returns the assigned count', async () => { /* … */ });
it('adminReassignPrasad passes assign:true through', async () => { /* body assertion */ });
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/prasad-client.test.ts`

- [ ] **Step 3: Implement** (append; extend the reassign body type):

```ts
export async function confirmPrasad(date?: string): Promise<void> {
  const res = await fetch('/api/setu/prasad/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(date ? { date } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `confirm failed: ${res.status}`);
  }
}

export async function assignRemainingPrasad(pid: string): Promise<number> {
  const res = await fetch('/api/admin/prasad/assign-remaining', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid }),
  });
  if (!res.ok) throw new Error(`assign-remaining failed: ${res.status}`);
  return ((await res.json()) as { assigned: number }).assigned;
}
```
…and change `adminReassignPrasad`'s parameter type to `{ paid: string; date?: string; cancel?: boolean; assign?: boolean }`.

- [ ] **Step 4: Run** — same command, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/prasad/prasad-client.ts apps/portal/src/features/setu/prasad/__tests__/prasad-client.test.ts
git commit -m "feat(prasad): confirm/assign-remaining client wrappers"
```

---

### Task 9: Family card — proposed state

**Files:**
- Modify: `apps/portal/src/features/setu/prasad/family-prasad-card.tsx`
- Test: `apps/portal/src/features/setu/prasad/__tests__/family-prasad-card.test.tsx`

- [ ] **Step 1: Failing tests** (follow the file's render pattern; the card receives `assignment` directly):

```ts
const PROPOSED: FamilyPrasadView = {
  paid: 'bv-brampton-2025-26-F1', pid: 'bv-brampton-2025-26', date: '2026-03-22',
  youngestName: 'Anu', birthMonth: 3, reason: 'birthday-month', status: 'proposed', movable: true,
};

it('proposed: shows the suggested heading + Confirm and Pick buttons, no locked note', () => {
  render(<FamilyPrasadCard assignment={PROPOSED} />);
  expect(screen.getByText(/suggested prasad sunday/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /confirm this date/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /pick a different sunday/i })).toBeInTheDocument();
  expect(screen.queryByText(/date locked/i)).not.toBeInTheDocument();
});

it('confirm CTA calls confirmPrasad() and refreshes', async () => {
  render(<FamilyPrasadCard assignment={PROPOSED} />);
  await userEvent.click(screen.getByRole('button', { name: /confirm this date/i }));
  expect(mockConfirmPrasad).toHaveBeenCalledWith(undefined);
});

it('assigned: unchanged — Your prasad Sunday + move button when movable', () => {
  render(<FamilyPrasadCard assignment={{ ...PROPOSED, status: 'assigned' }} />);
  expect(screen.getByText(/your prasad sunday/i)).toBeInTheDocument();
});
```
(Mock `./prasad-client` exporting `confirmPrasad`/`movePrasad`/`fetchMoveOptions` like the existing tests mock the move pair.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/family-prasad-card.test.tsx`

- [ ] **Step 3: Implement.** In `family-prasad-card.tsx`:

1. Import `confirmPrasad` alongside the existing client fns.
2. Add state + handler inside `FamilyPrasadCard` (after `sheetOpen`):
```tsx
  const [confirming, setConfirming] = useState(false);
  const isProposed = assignment?.status === 'proposed';

  async function confirmInPlace() {
    if (confirming) return;
    setConfirming(true);
    try {
      await confirmPrasad(undefined);
      toast.success('Prasad Sunday confirmed — thank you!');
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      toast.error(code === 'already-confirmed' ? 'Already confirmed.' : 'Could not confirm. Please try again.');
      setConfirming(false);
    }
  }
```
3. Heading (line 97): `{isProposed ? 'Suggested prasad Sunday' : 'Your prasad Sunday'}`.
4. Why-line for proposed: in `whyLine`, no change (same reasons apply).
5. Replace the movable/locked block (lines 147-169) with a three-way branch:
```tsx
        {isProposed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              onClick={confirmInPlace}
              disabled={confirming}
              className="btn btn--p btn--block"
              style={{ minHeight: 44, fontSize: 13, opacity: confirming ? 0.6 : 1 }}
              data-testid="prasad-confirm"
            >
              {confirming ? 'Confirming…' : 'Confirm this date'}
            </button>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              disabled={confirming}
              className="btn btn--s btn--block"
              style={{ minHeight: 44, fontSize: 13 }}
            >
              Pick a different Sunday
            </button>
          </div>
        ) : assignment.movable ? (
          /* existing Move button unchanged */
        ) : (
          /* existing locked note unchanged */
        )}
```
6. Sheet: pass a mode prop — `<MovePrasadSheet mode={isProposed ? 'choose' : 'move'} …/>`. In `MovePrasadSheet`:
   - props gain `mode: 'move' | 'choose'`;
   - title: `mode === 'choose' ? 'Pick your prasad Sunday' : 'Move your prasad Sunday'`;
   - intro copy for choose: `You're suggested for <strong>{currentDate}</strong>. Pick any Sunday with room — picking one confirms it.`;
   - `confirmMove` calls `mode === 'choose' ? confirmPrasad(picked) : movePrasad(picked)` and the success toast becomes `mode === 'choose' ? 'Prasad Sunday confirmed — thank you!' : 'Prasad day moved'`;
   - CTA label: `mode === 'choose' ? 'Confirm this Sunday' : 'Confirm move'`;
   - error mapping gains `'already-confirmed'` → `toast.error('Already confirmed — refresh to see your date.')`.

- [ ] **Step 4: Run** — card tests + full prasad set: `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/prasad/family-prasad-card.tsx apps/portal/src/features/setu/prasad/__tests__/family-prasad-card.test.tsx
git commit -m "feat(prasad): family card proposed state — confirm in place or pick a Sunday"
```

---

### Task 10: Admin screen — chips, Assign, bulk, counts, CTA copy

**Files:**
- Modify: `apps/portal/src/features/setu/prasad/admin-prasad-screen.tsx`
- Test: `apps/portal/src/features/setu/prasad/__tests__/admin-prasad-screen.test.tsx`

- [ ] **Step 1: Failing tests** (follow the file's existing fetch-mock + render pattern for `AssignmentsManager`/screen):

```ts
it('renders a Proposed chip + Assign button on proposed rows, none on confirmed', async () => {
  mockFetchAssignments.mockResolvedValue([
    rowFixture({ paid: 'p-1', status: 'proposed', familyName: 'Patel' }),
    rowFixture({ paid: 'p-2', status: 'assigned', familyName: 'Rao' }),
  ]);
  // render manager, expand first disclosure
  expect(await screen.findByText('Proposed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /assign patel/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /assign rao/i })).not.toBeInTheDocument();
});

it('bulk button shows the unconfirmed count and calls assignRemainingPrasad', async () => {
  window.confirm = vi.fn().mockReturnValue(true);
  // 2 proposed + 1 assigned → "Assign all unconfirmed (2)"
  await userEvent.click(screen.getByRole('button', { name: /assign all unconfirmed \(2\)/i }));
  expect(mockAssignRemaining).toHaveBeenCalledWith('bv-brampton-2025-26');
});

it('publish CTA reads "Publish proposals"', () => { /* render PreviewBody path, assert text */ });
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/admin-prasad-screen.test.tsx`

- [ ] **Step 3: Implement** in `admin-prasad-screen.tsx`:

1. Import `assignRemainingPrasad` from `./prasad-client`.
2. Module-scope status chip (next to `SOURCE_BADGE`, ~line 58):
```tsx
const STATUS_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  proposed: { label: 'Proposed', bg: 'var(--setu-warn-soft)', fg: 'var(--warn, #a06410)' },
  assigned: { label: 'Confirmed', bg: 'var(--info-soft)', fg: 'var(--info-deep)' },
};

function StatusChip({ status }: { status: string }) {
  const meta = STATUS_CHIP[status];
  if (!meta) return null;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: meta.bg, color: meta.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {meta.label}
    </span>
  );
}
```
3. `AssignmentRow`: add an `assigning` state + handler and render the chip + button. Insert `<StatusChip status={assignment.status} />` next to the family name (inside the name `<span>` row, after the name); add the Assign button as the FIRST control in the right-hand controls span, rendered only when `assignment.status === 'proposed'`:
```tsx
  const [assigning, setAssigning] = useState(false);
  // include `assigning` in the existing `busy` computation:
  const busy = saving || cancelling || assigning;

  async function assignNow() {
    if (busy) return;
    setAssigning(true);
    try {
      await adminReassignPrasad({ paid: assignment.paid, assign: true });
      toast.success(`${assignment.familyName} assigned to ${prettySunday(assignment.date)}`);
      onMutated();
    } catch {
      toast.error('Could not assign. Please try again.');
      setAssigning(false);
    }
  }
```
```tsx
        {assignment.status === 'proposed' && (
          <button
            type="button"
            onClick={assignNow}
            disabled={busy}
            aria-label={`Assign ${assignment.familyName}`}
            data-testid="prasad-assign"
            className="prasad-save"
            style={{ minHeight: 44, padding: '0 14px', fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--info-deep)', background: 'var(--info-soft)', border: '1px solid var(--info-deep)', borderRadius: 999, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1, whiteSpace: 'nowrap' }}
          >
            {assigning ? 'Assigning…' : 'Assign'}
          </button>
        )}
```
4. `AssignmentsManager`: above the date groups, a summary line + bulk button (uses the `pid` prop it already has):
```tsx
  const proposedCount = active.filter((a) => a.status === 'proposed').length;
  const confirmedCount = active.filter((a) => a.status === 'assigned').length;
  const [bulkAssigning, setBulkAssigning] = useState(false);

  async function bulkAssign() {
    if (bulkAssigning || proposedCount === 0) return;
    if (!window.confirm(`Assign all ${proposedCount} unconfirmed families to their proposed Sundays?`)) return;
    setBulkAssigning(true);
    try {
      const n = await assignRemainingPrasad(pid);
      toast.success(`${n} famil${n === 1 ? 'y' : 'ies'} assigned`);
      load();
    } catch {
      toast.error('Bulk assign failed. Please try again.');
    } finally {
      setBulkAssigning(false);
    }
  }
```
```tsx
      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }} data-testid="prasad-status-counts">
          {confirmedCount} confirmed · {proposedCount} proposed
        </span>
        {proposedCount > 0 && (
          <button type="button" onClick={bulkAssign} disabled={bulkAssigning} className="btn btn--s" data-testid="prasad-assign-remaining" style={{ minHeight: 44, fontSize: 12.5, opacity: bulkAssigning ? 0.6 : 1 }}>
            {bulkAssigning ? 'Assigning…' : `Assign all unconfirmed (${proposedCount})`}
          </button>
        )}
      </div>
```
5. Publish CTA (line 988): `'Publish schedule'` → `'Publish proposals'`; the publishing spinner label stays. Also update the heading at line ~783 from `Published assignments` to `Published proposals & assignments`.

- [ ] **Step 4: Run** — `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/prasad/admin-prasad-screen.tsx apps/portal/src/features/setu/prasad/__tests__/admin-prasad-screen.test.tsx
git commit -m "feat(prasad): admin manage view — status chips, per-row + bulk assign, counts"
```

---

### Task 11: Welcome day-of list shows proposed

**Files:**
- Modify: `apps/portal/src/features/setu/prasad/upcoming.ts`
- Modify: `apps/portal/src/app/welcome/prasad/page.tsx`
- Test: `apps/portal/src/features/setu/prasad/__tests__/upcoming.test.ts`

- [ ] **Step 1: Failing test** (extend the harness):

```ts
it('includes proposed families with their status, confirmed sorted first', async () => {
  // seed one assigned + one proposed family on the same future Sunday
  const { locations } = await getUpcomingPrasad();
  const families = locations[0]!.sundays[0]!.families;
  expect(families.map((f) => f.status)).toEqual(['assigned', 'proposed']);
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad/__tests__/upcoming.test.ts`

- [ ] **Step 3: Implement.** In `upcoming.ts`:
- `PrasadFamily` gains `status: 'proposed' | 'assigned';`
- the status filter becomes `(a.status === 'assigned' || a.status === 'proposed')` and carries `status` through the row objects (`rows.push({ fid, familyName, status: a.status })` — adjust the intermediate `grouped` type accordingly);
- when building each Sunday's `families`, sort confirmed first: `rows.sort((x, y) => (x.status === y.status ? 0 : x.status === 'assigned' ? -1 : 1))`;
- update the doc comment ("keep status==assigned" → "keep assigned + proposed").

In `page.tsx` `SundayCard`: change the count pill and add a per-family chip:
```tsx
        <span style={{ flex: '0 0 auto', fontSize: 11, padding: '2px 9px', borderRadius: 99, fontWeight: 600, background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>
          {sunday.families.filter((f) => f.status === 'assigned').length} confirmed · {sunday.families.filter((f) => f.status === 'proposed').length} proposed
        </span>
```
```tsx
            <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              {family.familyName}
              {family.status === 'proposed' && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'var(--setu-warn-soft)', color: 'var(--warn, #a06410)', textTransform: 'uppercase' }}>
                  not confirmed
                </span>
              )}
            </div>
```

- [ ] **Step 4: Run** — `pnpm --filter @cmt/portal exec vitest run src/features/setu/prasad && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/prasad/upcoming.ts apps/portal/src/app/welcome/prasad/page.tsx apps/portal/src/features/setu/prasad/__tests__/upcoming.test.ts
git commit -m "feat(prasad): welcome day-of list shows proposed families with chips + counts"
```

---

### Task 12: Seed fixture + Playwright E2E

**Files:**
- Modify: `apps/portal/scripts/seed-test-accounts.ts` (new section after the persona loop or inside the parent-scarborough branch)
- Create: `apps/portal/e2e/setu/prasad-propose.spec.ts`

- [ ] **Step 1: Add the seed fixture.** In `seed-test-accounts.ts`, inside the family-persona branch, after `ensureEnrollmentWithPid`, add for `parent-scarborough` only:

```ts
      // Proposed-prasad fixture (propose→confirm E2E): always restored to
      // 'proposed' on re-seed so the confirm spec is repeatable. Future-dated
      // (today+60) so it never reads as past.
      if (p.key === 'parent-scarborough') {
        const pid = 'bv-scarborough-2025-26';
        const date = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
        const paid = `${pid}-${fid}`;
        await db.collection('prasadAssignments').doc(paid).set({
          paid, pid, fid,
          familyName: p.familyName, location: p.location,
          date,
          youngestMid: null, youngestName: 'Test Child Three', birthMonth: 11,
          reason: 'birthday-month', source: 'auto', status: 'proposed',
          assignedAt: FieldValue.serverTimestamp(),
          movedFrom: null, movedAt: null, movedBy: null,
          remindedAt: { weekBefore: null, twoDayBefore: null },
          confirmedAt: null, confirmedBy: null, proposalNotifiedAt: null,
          _test: true,
        }, { merge: false });
        await db.collection('prasadConfig').doc(pid).set(
          { pid, capPerSunday: 10, publishedAt: FieldValue.serverTimestamp(), publishedBy: 'seed-test-accounts', _test: true },
          { merge: true },
        );
        console.log(`  [${p.key}] proposed prasad fixture ${paid} (date=${date})`);
      }
```
Note `merge: false` (plain set) — re-seed must RESET a confirmed doc back to proposed.

- [ ] **Step 2: Run the seed against UAT**

Run: `pnpm --filter @cmt/portal seed:test-accounts`
Expected: exit 0; log line shows the proposed fixture written.

- [ ] **Step 3: Write the E2E spec** `apps/portal/e2e/setu/prasad-propose.spec.ts` (persona request-context pattern from `test-accounts.spec.ts`):

```ts
import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { TEST_ACCOUNT_EMAILS, TEST_ACCOUNTS_PASSWORD, hasTestAccounts } from '../_helpers';

// Propose→confirm flow vs deployed UAT. The seeded Scarborough test family
// carries a PROPOSED assignment (re-seed resets it), so:
//  - the proposed card state is deterministic right after a seed run;
//  - the in-place confirm test tolerates an already-confirmed rerun (the only
//    state drift possible between seeds).
test.describe('prasad propose→confirm', () => {
  test.skip(!hasTestAccounts, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');

  let ctx: APIRequestContext;
  test.beforeAll(async ({ baseURL }) => {
    ctx = await request.newContext({ baseURL: baseURL! });
    const res = await ctx.post('/api/setu/auth/password-sign-in', {
      data: { email: TEST_ACCOUNT_EMAILS.parentScarborough, password: TEST_ACCOUNTS_PASSWORD },
    });
    expect(res.ok()).toBeTruthy();
  });
  test.afterAll(async () => { await ctx.dispose(); });

  test('family GET surfaces the proposed status', async () => {
    const res = await ctx.get('/api/setu/prasad');
    expect(res.status()).toBe(200);
    const { assignment } = (await res.json()) as { assignment: { status: string; date: string } | null };
    expect(assignment).not.toBeNull();
    expect(['proposed', 'assigned']).toContain(assignment!.status); // assigned only if a prior run confirmed
  });

  test('confirm validates: malformed 400, bogus target 409', async () => {
    const bad = await ctx.post('/api/setu/prasad/confirm', { data: { date: 'nope' } });
    expect(bad.status()).toBe(400);
    const bogus = await ctx.post('/api/setu/prasad/confirm', { data: { date: '2099-01-03' } });
    expect(bogus.status()).toBe(409); // invalid-target or already-confirmed — both 409
  });

  test('in-place confirm round-trips (or reports already-confirmed on rerun)', async () => {
    const res = await ctx.post('/api/setu/prasad/confirm', { data: {} });
    if (res.status() === 200) {
      const after = await ctx.get('/api/setu/prasad');
      const { assignment } = (await after.json()) as { assignment: { status: string } };
      expect(assignment.status).toBe('assigned');
    } else {
      expect(res.status()).toBe(409);
      expect(((await res.json()) as { error?: string }).error).toBe('already-confirmed');
    }
  });

  test('admin assign-remaining rejects an unknown pid', async ({ page }) => {
    // `page.request` carries the storageState admin session (seeded E2E user).
    const res = await page.request.post('/api/admin/prasad/assign-remaining', { data: { pid: 'nope' } });
    expect(res.status()).toBe(400);
  });

  test('admin list rows carry status', async ({ page }) => {
    const res = await page.request.get('/api/admin/prasad?pid=bv-scarborough-2025-26');
    expect(res.status()).toBe(200);
    const { assignments } = (await res.json()) as { assignments: Array<{ status: string }> };
    expect(assignments.length).toBeGreaterThan(0);
    for (const a of assignments) expect(['proposed', 'assigned', 'cancelled']).toContain(a.status);
  });
});
```

- [ ] **Step 4: Typecheck + unit suite** — `pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal test`
Expected: clean. (The Playwright run happens AFTER deploy — see Final verification.)

- [ ] **Step 5: Commit**

```bash
git add apps/portal/scripts/seed-test-accounts.ts apps/portal/e2e/setu/prasad-propose.spec.ts
git commit -m "test(prasad): proposed seed fixture + propose→confirm E2E"
```

---

### Task 13: Docs

**Files:**
- Modify: `docs/runbooks/production-cutover-checklist.md` (§14 new dated entry + amend the prasad operational sequence)
- Modify: `CLAUDE.md` (Prasad status block)

- [ ] **Step 1: Runbook §14 entry** (top of the change log):

```markdown
- **2026-06-10** — **Prasad propose→confirm revision** (spec `docs/superpowers/specs/2026-06-10-prasad-propose-confirm-design.md`; admin-team feedback). Publish now writes `status:'proposed'`; families confirm in place or pick any open Sunday (`POST /api/setu/prasad/confirm`, manager-only via the existing prefix rule); admin assigns stragglers per-row (`assign:true` on the PATCH) or in bulk (`POST /api/admin/prasad/assign-remaining`). New doc fields `confirmedAt`/`confirmedBy('family'|'admin')`/`proposalNotifiedAt`; statuses now `proposed|assigned|cancelled` ('assigned' still = committed, so pre-revision docs need **no migration**). Publish fires a one-time confirm-request email+SMS per family and the daily cron nudges unconfirmed proposals at 7d/2d — both gated by `PRASAD_REMINDER_CRON_ENABLED` + allowlists. **No new indexes** (cron reuses `(status,date)`; bulk assign is equality-only). Seed: proposed fixture on the Scarborough test family (`seed:test-accounts`, plain-set so re-seed resets a confirmed doc). **Operational ritual change:** publish proposals → families confirm over ~2 weeks → admin clicks "Assign all unconfirmed (N)" before the season starts. **Prod TODO:** unchanged from the prasad-module entry.
```
Also amend the original prasad entry's prod-TODO sequence: "admin publishes each location from `/admin/prasad`" → "admin publishes **proposals** per location from `/admin/prasad`, then bulk-assigns unconfirmed families before the first prasad Sunday".

- [ ] **Step 2: CLAUDE.md** — in the Prasad-module status paragraph, after "rollover-pattern preview→publish at `/admin/prasad`", insert: "Revised 2026-06-10 to **propose→confirm**: publish writes proposals, families confirm (or pick another open Sunday) at `/family/prasad`, admin assigns stragglers per-row or in bulk; reminders are status-aware."

- [ ] **Step 3: Commit + push**

```bash
git add docs/runbooks/production-cutover-checklist.md CLAUDE.md
git commit -m "docs(prasad): propose→confirm runbook entry + CLAUDE.md status"
git push
```

---

## Final verification (after the push deploys to UAT)

1. `pnpm --filter @cmt/portal seed:test-accounts` (restores the proposed fixture).
2. `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm test:e2e` — full suite. Baseline before this plan: 48 passed / 12 skipped; this plan adds 5 (prasad-propose.spec.ts) → expect **53 passed / 12 skipped / 0 failed**. The shipped `prasad.spec.ts` must stay green untouched (its fixture remains `assigned`).
3. Browser walkthrough (mock-free, per CLAUDE.md pre-ship rules): sign in as `setu-test-parent-scarborough@…` → `/family/prasad` shows **Suggested prasad Sunday** with both CTAs → "Pick a different Sunday" lists open Sundays → Confirm → card flips to **Your prasad Sunday**. Then as admin: `/admin/prasad` → Scarborough tab → manage list shows the Confirmed chip, counts line, and (after re-seeding) the Assign + bulk-assign controls.
4. Note in the summary which steps were browser-verified vs API-verified.
