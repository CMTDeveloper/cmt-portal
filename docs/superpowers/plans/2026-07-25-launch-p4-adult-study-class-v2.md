# P4 v2 - Adult Study Class

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A family that has paid its Bala Vihar donation picks at least one non-teaching adult for the Adult Study Class at no cost; a family with no children pays a configurable `$101`. The ask lives on the donation success page, with a persistent gate as the fallback.

**Architecture:** `enrollFamily` gains explicit `enrolledMids`, `suggestedAmountOverride` and `membershipMode` parameters, and learns to **reconcile** an existing active enrollment rather than no-op on it. A pure `needsAdultClassSelection(family)` predicate implements the spec's conditions plus an "is there an offering at all" precondition. The ask renders on `/donate/success` first - a TOP-LEVEL route, moved out of the `/family` layout by Task 8 Step 4, because a gate cannot safely exempt a path from inside a layout (a server component has no pathname). `AdultClassGate` - flag-gated, ordered after the profile and disclaimer gates - redirects skippers to a top-level `/adult-class`.

**Tech Stack:** Next.js 16 App Router, Firebase Admin Firestore, Zod, Vitest, Playwright.

**Supersedes:** `2026-07-25-launch-p4-adult-study-class.md`, reviewed as REQUEST CHANGES (3 critical, 8 major, 7 minor). Review: `docs/superpowers/reviews/2026-07-25-review-p4.md`.

> **PROGRESS: Tasks 1, 2, 3, 4, 5 COMPLETE; Task 6 predicate done (loader outstanding) 2026-07-26** (`efc9b74`, `75e8423`, `40f78c4`, `6bf05ef`).
> Task 2's proof obligation held: the existing suite passes **UNMODIFIED** - only
> `enroll-family.ts` changed plus ONE NEW test file, and the kiosk's exact-object
> matcher (`auto-enroll-bala-vihar.test.ts:22`) is untouched and green. The plan's
> "four real callers" claim VERIFIED exactly, at exactly the cited lines.
> Beyond the plan: three extra reconcile tests that guard money - the pinned
> `suggestedAmountSnapshot` is never recomputed, only supplied fields are touched
> (else re-picking a parent silently re-bills a waived family), and a CANCELLED
> enrollment re-creates rather than gets patched. Also corrected two stale
> docstrings that asserted the old unconditional no-op
> (`auto-enroll-bala-vihar.ts`, `sync-enrollment-members.ts`).
>
> **PROGRESS: Task 1 COMPLETE 2026-07-26** (`efc9b74`, `75e8423`). Verified: the plan's
> cited pin `enrollment-integration.test.ts:704` (`-50 -> 400`) is real and exact.
> Two additions beyond the plan: (a) the neighbouring test's NAME said "positive
> number required" and would have become untrue, so it was corrected; (b) a
> regression test pins that a `0` override survives `effectiveSuggestedAmount`
> (`get-enrollments.ts:86`) - the schema relaxation is worthless if that read
> collapses `0` back to the offering rate. Mutation-checked (`??` -> `||` fails
> exactly that test). Audited all other reads of the field: `build-csv-rows.ts:66`
> and `report-dataset.ts:95` use `typeof === 'number'`, so the portal has NO
> truthiness trap - only the mobile mirror does, and the changelog flags it.
> One gotcha for later tasks: the override describe-block's 409 test uses a
> persistent `mockResolvedValue`, so its cancelled doc leaks into every test
> after it - seed your own state.

**Spec:** `docs/superpowers/specs/2026-07-25-adult-study-class-design.md`. **Depends on:** P1 v2's `can-access-route.ts` edits having landed (not merely its offerings grant) - three plans touch that file.

---

## Global Constraints

- **The fee rule, canonically (spec §4.2):** a family that has paid its Bala Vihar donation pays **nothing** for the Adult Study Class, for as many adults as it sends. A family with no children pays the configurable donation (default `$101`). **There is no middle case and no per-person component.** The exemption is evaluated once at enroll time and persisted as `suggestedAmountOverride: 0`; it is never recomputed on read.
- **"All adults" always means all NON-TEACHING adults.** A teacher-assigned adult is never offered - they are running a class at that hour. This one rule resolves scenario matrix rows 3, 4 and 7 without a special case.
- **The four gate rules the repo already paid for (spec §4.6):**
  - **R1** - the selection screen is a **top-level route** at `/adult-class`, outside `/family`. A gated screen nested inside the gated layout inherits the gate and loops under soft navigation. Never `redirect()` from a layout keyed on a header pathname.
  - **R2** - leave that screen with `window.location.assign('/family')`, **never `router.push`**. A soft push re-reads a stale `use cache` value, bounces to the same route, and React preserves component state - that is how `/complete-profile` once stranded users on "Saving…" forever.
  - **R3** - do not make a client decision from a read you just invalidated. `revalidateTag` is background and stale-tolerant. Trust the write.
  - **R4** - order the gates: `ProfileCompletionGate` → `DisclaimerGate` → `AdultClassGate`, deferring explicitly.
- **Term scoping (§4.6.1):** condition 4 is "no active enrollment **for the current term**", never "no enrollment ever". Checking history would silently exempt every returning family after year one.
- **Select Bala Vihar by `programKey`** via `selectBalaViharEnrollment`, never "the first active enrollment" - lint-guarded, and the cause of a real 2026-06-01 attendance loss.
- **All Firestore work targets `chinmaya-setu-uat`.** No em dashes. Commit author `CMT Developer <developer@chinmayatoronto.org>`. Never `--no-verify`.

### Deliberate deviations

1. **Spec §4.5 row 1 (adult class first, BV later) leaves `$601` expected and is accepted as-is** (spec open item O3, no retroactive refund). Task 11 records it rather than fixing it.
2. **Changing which parent attends is not built** (spec §4.5 row 4, "not in v1"). Task 3's reconcile path makes it a small follow-up rather than a re-enrolment.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/shared-domain/src/setu/schemas/enrollment.ts:26,53` | `positive()` → `nonnegative()` on the override | 1 |
| `apps/portal/src/features/setu/enrollment/enroll-family.ts:8-13,108-113,124-137,139-157` | explicit mids/override/mode **and reconcile-on-active** | 2, 3 |
| `apps/portal/src/features/setu/enrollment/sync-enrollment-members.ts:65` | prune respects `membershipMode`; doc type gains the field | 4 |
| `apps/portal/src/features/setu/adult-class/selectable-adults.ts` | non-teaching adults | 5 |
| `apps/portal/src/features/setu/adult-class/needs-selection.ts` | the gate predicate | 6 |
| `apps/portal/src/app/adult-class/page.tsx` + **`error.tsx`** | the selection screen | 7 |
| `apps/portal/src/middleware.ts:179-188` | `/adult-class` in `isSetuRoute` | 7 |
| `packages/shared-domain/src/auth/can-access-route.ts` | `/adult-class` + `/api/setu/adult-class` | 7 |
| `apps/portal/src/lib/flags.ts`, `turbo.json` | `flags.setuAdultClass`, default off | 8 |
| `apps/portal/src/app/family/layout.tsx` | `AdultClassGate`, ordered and deferring | 8 |
| `apps/portal/src/app/donate/success/page.tsx` **(moved out of `/family` by Task 8 Step 4)** | the ask, **first**, above the pledge | 9 |
| `apps/portal/src/app/api/setu/enrollments/route.ts:52-62` | BV waiver on the generic surface | 10 |
| `apps/portal/src/features/setu/roster/payment.ts:7-10` + callers | `expected === 0` classification | 11 |

---

## Task 1: Relax the override to `nonnegative()`

`suggestedAmountOverride: z.number().int().positive().nullable()` (`enrollment.ts:26`) cannot store `0`, so the exemption is unrepresentable.

- [x] **Step 1: Write the failing tests** - a doc with `suggestedAmountOverride: 0` parses; `-1` still rejects.
- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Relax `:26` to `nonnegative()`**
- [x] **Step 4: Relax `OverrideEnrollmentBodySchema` at `:53` too, and pin the contract change**

This widens the welcome-team `PATCH /api/welcome/enrollments/[eid]/override` contract (`route.ts:56`) to accept `0`. The existing suite pins `-50 → 400` (`enrollment-integration.test.ts:704`) and nothing pins `0`. Add a test for `0 → 200` and note the behaviour change in the commit - staff can now zero an override deliberately, which is a feature, but it is a contract change.

- [x] **Step 5: Add `membershipMode` to `EnrollmentDocSchema` too**

Spec §4.3b step 1 asks for it and no earlier draft did it. `EnrollmentDocSchema` (`enrollment.ts:13-35`) has no such field, and it is the type `get-enrollments.ts:15` casts raw docs to - the shape `GET /api/setu/enrollments` returns raw (`enrollments/route.ts:26`). Without it, Task 12's mobile-changelog entry documents a field the schema does not declare, and any future `.parse()` strips it silently.

```ts
membershipMode: z.enum(['auto', 'manual']).optional(),
```

**Bare `.optional()`, no `.default()`.** The repo has two recorded burns here: a `.default()` on a write schema erases the field for partial writers, and doc schemas validate on read so required-ness belongs at the write routes.

- [x] **Step 6: `MOBILE_API_CHANGELOG.md` entry.** This is a `@cmt/shared-domain` schema change consumed by `/api/setu/enrollments`, so CLAUDE.md requires one.
- [x] **Step 7: Run and commit**

---

## Task 2: Teach `enrollFamily` explicit mids, override and mode

**The whole plan rests on this and v1 had no task for it.** Today `EnrollFamilyParams` is `{ fid, oid, enrolledVia, enrolledByMid }` (`enroll-family.ts:8-13`) - no mids, no override, no mode. `enrolledMids` is derived from `memberEligibleForProgram` (`:124-131`), which for an `'adult'` program matches **every** adult including teacher-assigned ones and pending invitees. `suggestedAmountOverride: null` is hardcoded at `:153`. Nothing writes `membershipMode` anywhere.

So without this task: all adults enrolled, `$101` billed to a Bala Vihar family, `membershipMode` absent (treated as `'auto'`), and the selection overwritten on the next member edit - the exact failure the design exists to prevent.

- [x] **Step 1: Write the failing tests**

```ts
it('enrolls exactly the supplied mids, not every eligible member', async () => { /* 3 adults, supply 1 */ });
it('persists suggestedAmountOverride: 0 when supplied', async () => { /* not null */ });
it('persists membershipMode: manual when supplied', async () => { /* ... */ });
it('applies the no-eligible-members guard to the SUPPLIED list', async () => {
  // enroll-family.ts:135-137 throws on an empty derived list; the same invariant
  // must hold for an explicitly supplied empty one.
  await expect(enrollFamily({ ...base, enrolledMids: [] })).rejects.toThrow('no-eligible-members');
});
it('is byte-identical for existing callers that supply none of the new params', async () => { /* ... */ });
```

**The last one is the proof obligation, and it must point at the right callers.** An earlier draft named "`/api/setu/enrollments`, the rollover, and the backfill". Two of those are wrong: `scripts/promote-families.ts` never references `enrollFamily` (the 2026-07-20 change made rollover grade-and-level only), and `scripts/backfill-bv-enrollments.ts:32` says explicitly that it *"Does NOT call enrollFamily/getProgram (they use Next 'use cache' and throw outside a render context)"*.

The four real callers, in traffic order:

| Caller | Why it matters |
|---|---|
| `features/setu/check-in/auto-enroll-bala-vihar.ts:24` | **the door kiosk**, every Sunday morning. Its docstring at `:13` reads *"Idempotent (enrollFamily no-ops an already-active enrollment)"* - the exact semantics Task 3 rewrites |
| `features/setu/enrollment/enroll-on-first-attendance.ts:20` | a teacher marking a guest child present, via `teacher/guests.ts:66` |
| `app/api/setu/enrollments/route.ts:56` | family self-serve |
| `app/api/welcome/enrollments/route.ts:34` | welcome-team staff enroll |

Plus `src/__tests__/e2e/enrollments.e2e.test.ts:203,211`, which runs against real UAT and is **not** in the pre-push hook.

Assert the kiosk and first-attendance paths explicitly - both are already mocked and testable. Note that `features/setu/check-in/__tests__/auto-enroll-bala-vihar.test.ts:22` pins the call with an **exact-object** matcher, so any caller that later gains a parameter fails there rather than where you are looking. `sync-enrollment-members.ts:22` also carries a comment asserting the no-op semantics; update it in Task 3.

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Extend `EnrollFamilyParams`**

```ts
export type EnrollFamilyParams = {
  fid: string;
  oid: string;
  enrolledVia: EnrollVia;
  enrolledByMid: string | null;
  /** Explicit member selection. Omit to keep today's derive-from-eligibility behaviour. */
  enrolledMids?: string[];
  /** Omit to keep today's hardcoded null. */
  suggestedAmountOverride?: number | null;
  /** 'manual' freezes enrolledMids against the auto-prune. Omit → 'auto'. */
  membershipMode?: 'auto' | 'manual';
};
```

- [x] **Step 4: Thread them into the `txn.set` at `:139-157`**

Use the supplied list when present, else the derived one. Apply the `no-eligible-members` guard (`:135-137`) to whichever list is used. Default `membershipMode` to `'auto'` so every existing doc and caller keeps today's semantics.

- [x] **Step 5: Run - existing enroll tests must pass unmodified**, then commit

---

## Task 3: Reconcile an existing active enrollment instead of no-op

**Without this the family is locked out of the portal permanently.** `eid` is deterministic (`${fid}-${oid}`, `enroll-family.ts:40`), and the already-active branch at `:108-113` returns `{ created: false }` **writing nothing**:

```ts
if (enrollmentSnap.exists) {
  const existing = enrollmentSnap.data() as { status: string; suggestedAmountSnapshot: number };
  if (existing.status === 'active') {
    return { created: false as const, eid, suggestedAmountSnapshot: existing.suggestedAmountSnapshot };
  }
}
```

The sequence: the selected parent leaves → Task 4's prune sets `enrolledMids: []` → the gate fires (spec §2.1 condition 4 is explicit that an empty list must re-fire) → the family picks someone → POST 200 → **nothing is written** → the gate fires again. The manager never reaches `/family` again. The same trap catches any future "change which parent attends".

- [x] **Step 1: Write the failing test**

```ts
it('a second enroll with different mids updates the existing active enrollment', async () => {
  await enrollFamily({ ...base, enrolledMids: ['F-02'], membershipMode: 'manual' });
  await enrollFamily({ ...base, enrolledMids: ['F-03'], membershipMode: 'manual' });
  const doc = await getEnrollment(eid);
  expect(doc.enrolledMids).toEqual(['F-03']);   // fails today: nothing is written
});
```

- [x] **Step 2: Run to verify it fails**
- [x] **Step 3: Reconcile in place**

When the enrollment exists and is `active` **and** any of `enrolledMids` / `suggestedAmountOverride` / `membershipMode` was explicitly supplied, update those fields in the same transaction and return `{ created: false, reconciled: true, eid, suggestedAmountSnapshot }`. When none was supplied, keep today's exact no-op so no existing caller changes behaviour.

**Never recompute `suggestedAmountSnapshot` on reconcile** - it is pinned at first enrollment by design (`:106`) so later tier edits cannot move it.

- [x] **Step 4: Run and commit**

---

## Independent audit findings (Codex, 2026-07-26, against `6bf05ef`)

An independent read-only audit of Tasks 2-3 produced 10 findings. **Fixed in
`c787ef0`:** the reconcile sat BELOW the enrollment-window gates and was
therefore unreachable exactly when needed (an admin closing registration
stranded any family whose `enrolledMids` the prune had emptied); no no-change
short-circuit; no `updatedAt`; and `suggestedAmountSnapshot` could return
`undefined` on an older doc. Every fixture in the suite used
`enabled:true/endDate:null`, so **none of that could ever have failed a test** -
there is now a `enabled:false` reachability test, and all six new tests fail
against the pre-fix code.

**Also corrected my own analysis:** I had listed the immutable-on-reconcile
fields as snapshot/enrolledAt/enrolledVia/enrolledByMid but treated `enrolledAt`
as merely ordering. It is not - `get-enrollments.ts:85-87` resolves the LIVE
price from `enrolledAt`, so preserving `suggestedAmountSnapshot` alone does NOT
preserve money owed.

### Second audit (Task 4 pre-implementation, 2026-07-26) - fixed in `b863bd0`

- **Manual-mode check ran BEFORE the program-active guard**, so a paused/removed
  program still mutated manual enrollments, breaking this function's own stated
  invariant. Real bug in `4d483bb`; the new test fails against it.
- **The SPEC was wrong, not the test.** 4.3b step 3 said a manual list also
  prunes the no-longer-eligible. `memberEligibleForProgram` is clock-dependent,
  so that would let a manual list empty ITSELF on a birthday. Spec corrected
  in place with the reasoning, so nobody "restores" the eligibility filter.
- **Order was unpinned.** `sameSet` is order-insensitive, so filtering `members`
  instead of `enrolledMids` would silently reorder with nothing flagging it.
  Implementation was already correct; a regression guard now exists.

### ⚠️ MUST-DO FOR TASK 7 - the feature is INERT until then

**Nothing sets `membershipMode: 'manual'` in production today.** Only
`enrollFamily` writes the field and no caller passes it, so every Task 4 test
can stay green while the prune honours a flag that is never set. **The test that
closes this is not in `sync-enrollment-members.test.ts`** - it is one that drives
the real `POST /api/setu/adult-class` route (Task 7 Step 6) and asserts the
persisted doc carries `membershipMode: 'manual'`. Same blind-spot shape as the
`enabled:true` fixtures that hid the reconcile-unreachable bug.

### Considered and NOT taken (with reasons)

- **Tighten `hasActiveEnrollment` (`teacher/guests.ts:23-26`) to require a
  non-empty `enrolledMids`.** The diagnosis is right - an active-but-empty
  enrollment is a zombie that first-attendance never repairs - but the proposed
  one-line fix does not achieve the repair: first-attendance would then call
  `enrollFamily`, which hits the already-active branch with nothing supplied and
  **no-ops**, so the empty list survives. A real repair needs the enroll path to
  re-derive. **Open item, not a half-fix.**
- **A `lastUpdateTime` Precondition on the prune's batch write** (to turn silent
  last-writer-wins into a loud `FAILED_PRECONDITION`). Declined for now: the
  prune writes MANY enrollments in ONE batch, so a single stale doc would fail
  the entire batch, and `syncEnrollments` (`write-member.ts:231-237`) swallows
  errors best-effort - turning a narrow race into a silent total sync failure.
  Doing it properly needs per-doc writes with individual error handling, which
  is more than Task 4 warrants this close to launch.

### Third audit (Task 6 pre-implementation, 2026-07-26) - `42ca6c8`

**FIXED: the `>=` amount threshold in this plan's Task 6 Step 4 was WRONG.** It
contradicts an explicit owner decision (2026-07-02, issue #23) already
implemented at `enrollment-confirmation.ts:38`: *"any completed donation tied to
its eid ... Amount is irrelevant (donations are suggestions, not fees)."* The
threshold silently exempted every PARTIAL donor from the policy this feature
enforces, and no fixture would have caught it. It also made the gate a function
of later pricing edits, since `effectiveSuggestedAmount` is recomputed LIVE
(`get-enrollments.ts:85-87`). **Both bugs die with the threshold.**
**⚠️ Task 10 Step 3 uses the same `bvPaid` - it must use the threshold-free rule.**

**CONFIRMED, with a stronger argument than the plan's:** condition 0 is not only
a config risk. The `endDate` filter is evaluated PER REQUEST against `new Date()`
(`get-open-offerings.ts`), so without condition 0 this fires **at midnight on the
term's end date with no deploy and no config change** - a scheduled outage.

**STILL OPEN - for the loader (Task 6 Step 6) and Task 7:**

| Finding | Where it belongs |
|---|---|
| **The current-offering resolver owes a DELIBERATE tie-break.** Equal `startDate`s resolve to the LOCATED offering only because the dedupe Map is filled located-first - an accident of insertion order nothing states or tests. And **"earliest" is wrong when an online location-less class starts before the family's own centre's**: `[0]` is then the online one and the family is gated on, and enrolled into, the wrong offering. Resolve as *"earliest startDate, the family's location wins a tie"* and test the **equal-startDate** located-vs-location-less pair - two different dates pass under any ordering. | **Loader** (noted in `needs-selection.ts`'s `currentOffering` doc) |
| **Condition 5's set RESOLUTION is untested.** `selectableAdults` takes `teacherAssignedMids` as input, so if the loader resolves it over children, or the wrong mids, every predicate test still passes. | **Loader**, its own test |
| **A family with `location: null` takes the single-query branch** and skips the merge entirely. Zero coverage today. | **Loader** test |
| **9 uncached Firestore ops per `/family/*` render**, not 7. Only `getLegacyPaymentStatus` is cached. On `/family` itself the gate and `load-dashboard` issue literal duplicate `getEnrollments`/`getDonations` queries. **The biggest lever is NOT the signature split** - it is adding `'use cache'` + `cacheTag(\`family-${fid}\`)` to `getEnrollments`/`getDonations`, whose invalidation is ALREADY wired (the mutation routes call `revalidateTag`). `getCurrentFamily` is React-`cache()`d, so re-calling it in the gate is free. | **Its own task** - do not fold into Task 6 |
| `getLegacyPaymentStatus` **fails SOFT to `'unknown'`**, so an RTDB blip silently un-pays every legacy family and the gate stops firing. | accepted; note in Task 12 |

**Task 8's closing test, restated:** all 28 predicate tests can be green while the
gate is **never mounted**. Task 8 must assert `layout.tsx` renders
`AdultClassGate` AFTER `DisclaimerGate`, and Task 12 must walk it in deployed UAT.

### STILL OPEN - carry into the tasks below

| # | Finding | Where it belongs |
|---|---|---|
| ~~1~~ **CLOSED `4d483bb`** | ~~**`membershipMode` has ZERO readers.**~~ `syncActiveEnrollmentMemberships` (`sync-enrollment-members.ts:64-93`) recomputes `enrolledMids` without ever reading it, so the schema/param docs currently promise a guarantee the code does not provide. Family picks parent A → anyone edits any member → both parents re-enrolled, including one teaching that hour. | **Task 4 - next, and it closes findings 5 and 6 too** |
| 3 | **Supplied `enrolledMids` is never validated** (`enroll-family.ts` skips the members read when mids are supplied). No cross-family leak (consumers path-scope by fid), but phantom or ineligible people reach rosters and CSVs. | **Task 7 Step 6 - MUST ship with the route that supplies mids, not after** |
| 4 | **A reconcile retroactively rewrites the year.** `enrolledMids` is read everywhere as current membership, never history: `teacher/roster.ts:82` drops the previously-named person and their recorded attendance; `report-dataset.ts:221` can silently flip a family confirmed→registered; `load-dashboard.ts:108-111` flips the family's own "Enrolled" pill with no user action. | **Accepted limit - record in Task 12's runbook entry** |
| ~~5~~ **RESOLVED as intended `4d483bb`** - the asymmetry is deliberate and now documented in the prune's docstring: enrollFamily never WRITES an empty list, the prune may LEAVE one, because stale mids on a teacher roster are worse than an empty enrollment, and empty is the signal the gate keys on. Original text: **The prune writes `enrolledMids: []` onto ACTIVE enrollments** (`sync-enrollment-members.ts:90-91`), which `enrollFamily` refuses to write at both `:163` and `:208`. Two writers, contradictory invariants on one field. `teacher/guests.ts:23-26` then reports `hasActiveEnrollment` true (status-only) so first-attendance never repairs it. | **Task 4** |
| ~~6~~ **CLOSED for manual `4d483bb`** (the prune no longer has authority over a manual list, so the race has nothing to win; auto keeps the pre-existing narrow race) | **The prune races the reconcile and wins.** The prune reads outside any txn and commits a `db.batch()` (no version precondition); the reconcile holds no lock a member edit conflicts with. Both "succeed", the prune's value stands. | **Task 4** (a `manual` skip removes the batch's authority entirely) |
| 8 | **Cancelled → re-create uses a bare `txn.set` (no merge)**, wiping `levelSnapshots` - written only by the rollover (`promote-families.ts:313-322`) and the sole source for `get-child-journey.ts:73-88`. Re-enrolling into the same oid destroys that child's prior-year level history. Also strips `_test`. **Pre-existing, NOT introduced here**, but my Task 3 test now pins the re-create path as correct, so fix or annotate. | **Separate issue - raise before launch, do not silently inherit** |
| 9b | Map Firestore `NOT_FOUND` (a deleted doc between read and update) to **409**, not the current unhandled 500. `txn.update` is the right primitive - it carries an exists-precondition, where `set(merge)` would silently resurrect a fragment that every `collectionGroup('enrollments')` sweep then picks up. | **Task 7, with the routes** |

---

## Task 4: `membershipMode` survives the member-edit prune

- [x] **Step 1: Write the failing tests**

```ts
it('does NOT prune a manual enrollment when an unrelated member is edited', async () => { /* ... */ });
it('still prunes an auto enrollment', async () => { /* today's behaviour, unchanged */ });
it('prunes a removed member even from a manual enrollment', async () => {
  // A departed member must leave enrolledMids regardless of mode - that is what
  // makes the gate re-fire per spec 2.1 condition 4.
});
```

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement**

`sync-enrollment-members.ts:65` types the doc as `{ eid?; programKey?; enrolledMids? }` - **add `membershipMode?`**. When `membershipMode === 'manual'`, the prune keeps the stored list intact except for members who no longer exist in the family.

**"Currently-eligible" here means `memberEligibleForProgram`, not `selectableAdults`.** If an implementer reads it as the latter, a chosen adult who later becomes teacher-assigned is pruned → `enrolledMids: []` → the gate re-fires → and without Task 3 that is the permanent loop.

Note the asymmetric invariant deliberately: `enroll-family.ts:135-137` refuses to **create** an empty enrollment, but the prune may legitimately **leave** one. Comment it, or a later reader will "fix" the inconsistency.

- [x] **Step 4: Run and commit**

---

## Task 5: Selectable adults are the non-teaching ones

- [x] **Step 1: Write the failing tests** - one per scenario-matrix row, including **row 5** (single non-teaching parent → exactly one selectable, preselected), which v1 had no test for despite spec §6.6 asking for one per row.
- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement `selectableAdults(members, teacherAssignedMids)`** - adults, excluding teacher-assigned, excluding `inviteStatus: 'pending'` invitees.
- [x] **Step 4: Run and commit**

---

## Task 6: `needsAdultClassSelection` - the gate predicate

**Two things v1 left undefined, both of which decide whether families get stuck.**

- [x] **Step 1: Write the failing tests - all seven matrix rows plus the two preconditions**

Rows 3, 4 and 7 all resolve through the empty selectable set. **Row 7 must be asserted twice over** (no BV enrollment **and** no selectable adults), independently - spec §2.3 says so explicitly, because a later change to one could silently start prompting a childless teacher couple.

- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Implement condition 0 - is there an offering at all**

Spec §2.1's five conditions never check that a current adult-study-class offering is **reachable**. Resolve it first via `getOpenOfferingsForFamily('adult-study-class', family.location)` and return `false` when there is none.

Without this: the day the launch offering expires, or someone toggles `enabled` off, or a location is missed, **every paid Bala Vihar manager at that location is redirected to `/adult-class`, cannot enroll, and cannot reach `/family` at all.** There is no escape hatch in the design without it.

- [x] **Step 4: Define condition 3 - "the BV donation is paid"**

v1 named this and never defined it, and the two obvious helpers are both wrong:

- `isEnrollmentConfirmed` (`enrollment-confirmation.ts:34`) returns `true` for any `enrolledVia === 'family-initiated'` **regardless of payment**, so it would gate families who clicked Enroll and never paid - contradicting spec §2 ("**After** the BV donation").
- A bare donations sum misses legacy-paid families and teacher-managed offerings, whose families never pay in-portal and would be gated **forever**.

The predicate is a three-way disjunction. **Two of the three helpers an earlier draft named do not exist**, and the nearest real one is wrong in a way that would fire the gate on families who never paid Bala Vihar:

- **There is no `sumCompletedDonationsForEid`.** The real export is `sumCompletedDonations(fid)` (`roster/donations-sum.ts:5`), which sums **every** completed donation for the family with **no eid filter** - so a Tabla or general donation would count toward the Bala Vihar amount. The only eid-scoped sums in the repo are inline; copy `dashboard-model.ts:115-119`.
- **`legacyPaid` is not a free variable, and unconditional use is wrong in both directions.** Both real derivations gate it on the offering actually being legacy-sourced (`family-engagement.ts:59-65`, `dashboard-model.ts:122-124`). Ungated, a family whose **2025-26** legacy row reads `paid` is treated as having paid the **2026-27** donation, contradicting spec §2 ("**After** the BV donation").

```ts
const donations = await getDonations(fid);
const bvPaidByDonation = donations
  .filter((d) => d.status === 'completed' && d.eid === bv.eid)
  .reduce((sum, d) => sum + d.amountCAD, 0) >= (bv.effectiveSuggestedAmount ?? 0);

const source = bv.offering ? paymentSourceOf(bv.offering) : 'portal';
const legacyPaid = source === 'legacy'
  ? (await getLegacyPaymentStatus(family.legacyFid)) === 'paid'
  : false;

const bvPaid = bvPaidByDonation || legacyPaid || source === 'teacher-managed';
```

Note `getLegacyPaymentStatus` reads the **entire prod RTDB roster** (`legacy-payment.ts:26-38`). It is `use cache`-backed, but it is a real cost on a gate that runs on every `/family/*` render - see Step 6.

- [x] **Step 5: Implement conditions 1, 2, 4, 5, and define "current term" concretely**

Spec §4.6.1 says condition 4 is "no active enrollment **for the current term**" and never says what identifies a term. `getOpenOfferingsForFamily` returns `OfferingDoc[]` and deliberately **merges two result sets** - located (`get-open-offerings.ts:96`) and location-less (`:90`), deduped at `:99-103` - so it can return more than one open adult-class offering the moment an admin creates a location-less one alongside a per-centre one.

With two open offerings and no definition, a family enrolled in offering A is still un-enrolled for offering B: the gate never clears and they are locked out of `/family` - the exact failure condition 0 exists to prevent.

**Definition: `openOfferings[0]` (earliest `startDate`, which is the returned sort order) is *the* current offering.** Condition 4 is "no active enrollment whose `oid === current.oid`", and **the `/adult-class` screen enrolls into that same `oid`**. Add a test with two open offerings.

Select Bala Vihar via `selectBalaViharEnrollment`, never "the first active enrollment".

- [x] **Step 6: Give the predicate a real signature, and budget the reads**

This plan's own architecture line calls it "a **pure** `needsAdultClassSelection(family)` predicate", and Task 8 criticises `DisclaimerGate` for "an extra Firestore read on every `/family/*` render". As specified it is neither pure nor cheap - per render of every `/family/*` page it needs:

| Input | Cost |
|---|---|
| condition 0's offering | up to 2 queries (`get-open-offerings.ts:90,96`) |
| enrollments | 1 query + 1 `.get()` per distinct oid, **not cached** (`get-enrollments.ts:54,66-68`) |
| donations | 1 query |
| `legacyPaid` | whole-roster RTDB read, cached |
| teacher flags | **1 `teacherAssignments` doc read per adult** (`assignments.ts:22-33`) |

Roughly 7+ Firestore ops added to every family page load, against the ~1 the plan objects to. And `getCurrentFamily()` returns only `{ family, members, currentMid, isManager }` (`get-current-family.ts:8-13`), so the stated signature cannot carry any of it.

Split it: a genuinely pure `needsAdultClassSelection({ family, members, enrollments, donations, currentOffering, teacherAssignedMids })`, and one `loadAdultClassGateData(fid)` that does the I/O. State the render-cost budget in Task 8 and measure it in Task 12.

- [x] **Step 7: Run and commit**

---

### Task 6 as SHIPPED (`42ca6c8` predicate, `2b087ae` loader, `e2e6238` resolver)

**Step 5's "current term" definition was WRONG and is superseded.** The plan said
*"`openOfferings[0]` (earliest `startDate`) is THE current offering"*. That array
MERGES the family's own centre's offerings with the location-less (online) ones,
so `[0]` resolves an exact tie by the dedupe Map's insertion order and, worse,
hands a located family to an online class whenever that one starts first - the
family would be gated on, and enrolled into, a class that is not their centre's.

The shipped rule is **`resolveCurrentOffering`: the family's own centre wins
OUTRIGHT; `startDate` only orders within a group; `oid` breaks an exact tie.**
Location is a hard attendance constraint, start date a soft heuristic, and the
two failure directions are not symmetric - preferring the centre can at worst
pick that centre's later term (benign, visible), preferring the earliest picks a
different class entirely. It lives in `enrollment/get-open-offerings.ts`, beside
the query it interprets, NOT in `adult-class/`, because two other callers had the
same `[0]` bug (`family/enroll/[programKey]/page.tsx:162`, which has no picker,
and `check-in/auto-enroll-bala-vihar.ts:28` at the door) and a second resolver
that disagreed with the gate's would ask a family to choose and then default them
elsewhere. **Task 7 MUST use `resolveCurrentOffering`, never `[0]`.**

**Step 6's signature was impossible as written.** `loadAdultClassGateData(fid)`
cannot work: `isManager` comes from the session claims and is not derivable from
a fid. Shipped as `loadAdultClassGateData({ family, members, isManager })`,
matching `loadFamilyDashboard(family, members)`.

**It returns `null` on any read failure**, logged - this gate REDIRECTS on every
`/family/*` render, so a transient Firestore error must cost an un-asked question
rather than a 500 across the portal. `null` therefore means "do not gate" for
both reasons. **Task 7's route must do its OWN in-handler manager check first**
(it must anyway, per the three-gate rule), so by the time it calls the loader a
`null` means no-offering / nobody-selectable / read-failure → refuse, don't 500.

**Read budget as shipped**, cheapest exits first: non-manager → 0 reads; nobody
selectable → 0 reads; no open offering → 2 queries and stop. Only a manager with
an eligible adult and an open offering pays the full fan-out. Two corrections to
the audit's estimate: `getEnrollments` is **unbounded**, not constant (1 doc read
per distinct `oid` across the family's whole history, no year/status filter), and
`getLegacyPaymentStatus` is skipped entirely unless the BV offering is
legacy-sourced (`isLegacyBvPeriod`, the same predicate `load-dashboard.ts:98`
uses) and is `use cache`-backed even then.

`ADULT_STUDY_CLASS` is now a shared-domain constant, because the resolver, Task
7's route and Task 10's fee rule must agree and a typo in any one is invisible -
the query just returns nothing and the family is never asked.

All six risky lines were mutation-tested; each mutation fails the suite.

### Fourth audit (Task 6 loader, Codex 2026-07-26) - carry forward

| Finding | Where it belongs |
|---|---|
| **The `[0]` divergence in the enroll page and the kiosk.** CONFIRMED at `enroll/[programKey]/page.tsx:162` (no picker - it commits silently) and `auto-enroll-bala-vihar.ts:28`. Codex called it a permanent loop; verified it is not (the `/adult-class` screen enrolls into the resolved oid, so the gate does clear) but it does double-enroll and mis-default. **FIXED in `e2e6238`** - both adopted the shared resolver. | closed |
| **Caching `getEnrollments`/`getDonations` is NOT the same risk as caching a display read.** This loader's output drives a REDIRECT. If the tag is not invalidated precisely on Stripe-webhook completion and on enroll/member-edit writes, a family who just paid gets re-gated until it fires - a visible, confusing bounce, far worse than a stale dashboard number. **Both are uncached TODAY, which is the only reason the post-save render is correct**: after Save, `AdultClassGate` re-queries fresh, sees the new `enrolledMids`, and condition 4 clears. Add `'use cache'` without exact invalidation and that becomes a redirect loop straight back to `/adult-class`. Also note the loader has **no already-answered fast path** - condition 4 is evaluated at the END of the fan-out, so a family who has ALREADY chosen still pays 6-10 uncached round trips on every `/family/*` render, permanently, once the flag is on. | **the caching task's acceptance criteria** |
| **`resolveCurrentOffering`'s fallback branch trusted its input.** `pool = located.length > 0 ? located : offerings` fell back to the WHOLE array, not the location-less subset. `getOpenOfferingsForFamily` upholds that invariant, but the function is exported for reuse and `getOpenOfferings({programKey})` returns every centre's - hand that in for a family whose own centre runs nothing and it resolves to **another centre's in-person class**, worse than the "earliest" bug it exists to fix. Invisible to mutation testing: no fixture contained a third real location, so the distinction was not constructible. **FIXED `61778c3`** - both branches now name the location they accept, plus two Scarborough fixtures. | closed |
| **Task 7's screen must NOT reuse the loader's `null` as its own truth.** The gate fails open on a read error (correct - never 500 the portal). If `/adult-class` also treated `null` as "nothing to select" and redirected back to `/family`, an INTERMITTENT read failure would ping-pong the two routes - the `ERR_TOO_MANY_REDIRECTS` shape already seen in this codebase. The screen needs its own error state. | **Task 7 Step 3** |
| No `await connection()` needed in the loader - but only because its caller resolves `getCurrentFamily()` (which calls `cookies()`, Next's own dynamic bailout) first. That is a property of the CALLER's order, not of the loader. | **Task 8** - state it in the gate |
| `getOpenOfferings:60` branches on `!== undefined`, not `!= null`, so a leaked `undefined` location would drop the location filter and return EVERY centre's offerings. The loader coerces `family.location ?? null` at its boundary (`get-family-by-fid.ts:31` maps location with no fallback, so `undefined` is reachable despite the type). | closed - covered by a test |

---

## Task 7: The `/adult-class` route

- [x] **Step 1: Write the failing tests**
- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Build `app/adult-class/page.tsx`**

Top-level, outside `/family` (**R1**). Multi-select, minimum one, preselected when there is exactly one. Copy must explain **why** - one parent needs to be present during Bala Vihar classes - per spec §4.3; a family reading "you must pick an adult" with no reason reads it as bureaucracy. Exact wording is spec open item O7.

Server component needs `await connection()` (repo pattern, e.g. `app/family/page.tsx:280`) or the Vercel build prerender check fails, and a `CspRoot` / `className="csp"` wrapper or it renders unstyled.

Save, then leave with `window.location.assign('/family')` (**R2**). Do not re-read to decide whether the gate is satisfied (**R3**).

- [x] **Step 4: Add `app/adult-class/error.tsx`**

CLAUDE.md discipline 3: every top-level route segment has its own. Both `/complete-profile` and `/acknowledgements` do.

- [x] **Step 5: Add `/adult-class` to middleware's `isSetuRoute`**

`middleware.ts:179-188` lists `/complete-profile` and `/acknowledgements` - the two routes this one is modelled on - and `/adult-class` is not there. Without it, an expired-session manager hitting `/adult-class` is bounced to the **legacy `/login`**, not `/sign-in`. Add a middleware test.

- [x] **Step 6: Build `POST /api/setu/adult-class` - the handler the Save button calls**

An earlier draft granted this path in `canAccessRoute` and wrote it into the mobile changelog **without any task creating it**. Executed literally that ships a selection screen whose Save does nothing, and Task 8 then redirects every paid Bala Vihar manager to it - a permanent lockout, the exact failure Task 3 exists to prevent.

The handler: manager-only in-handler check; `fid` from the **session**, never the body; body is `{ mids: string[] }` with `.strict()`; validates every mid is in `selectableAdults`; calls `enrollFamily` with `enrolledMids: mids`, `suggestedAmountOverride: bvPaid ? 0 : null`, `membershipMode: 'manual'`, and the current offering's `oid` from Step 5's definition.

- [x] **Step 7: Add the `canAccessRoute` rules** for `/adult-class` and `/api/setu/adult-class` (any Setu family; the handler binds `fid` from the session). The `/api/setu/` catch-all is manager-only, so a member-reachable path needs its own clause.
- [x] **Step 8: Run and commit**

---

### Task 7 as SHIPPED (`6fb832c` prerequisites, `cdb72b6` route + screen, `bea3d65` changelog)

**⚠️ Task 8 Step 1 is ALREADY DONE.** `flags.setuAdultClass` + the `turbo.json`
entry shipped here, because the flag has to gate the SCREEN too, not just the
gate - a route reachable in prod before the feature is announced lets a family
enroll into an offering nobody has told them about. Task 8 starts at Step 2.

**Two prerequisites the plan did not anticipate, both in `6fb832c`:**

1. **`loadAdultClassGateData` now THROWS on a read failure**, and
   `loadAdultClassGateDataFailSoft` is the gate's variant. They must stay
   distinguishable. The gate redirects here; if this screen ALSO collapsed a read
   failure to "nothing to select, go back to `/family`", an INTERMITTENT failure
   would bounce the two routes off each other - `ERR_TOO_MANY_REDIRECTS`, already
   an open issue in this codebase. The throw reaches `error.tsx` instead, so the
   family gets a retry. **Task 8's gate MUST use the FailSoft variant**; the
   screen and the route must not.
2. **`isBalaViharPaid` is extracted and exported** from `needs-selection.ts`.
   Three sites must agree: the gate's condition 3, this route's waiver, and
   **Task 10 Step 3**. A third hand-written copy is how the `>=` threshold bug
   got in. **Task 10 must import it, not re-derive it.**

**The screen is deliberately NOT gated on `needsAdultClassSelection`.** It is
both the gate's destination and the only way to CHANGE a selection later, so
redirecting away once the gate is satisfied would make the choice irreversible -
and would add a second route redirecting on the same predicate the gate uses,
which is the surface the ping-pong lives on. It renders whenever a manager has an
offering and a selectable adult, pre-filled with the current choice.

**Authorization, all three layers, each mutation-verified:**

| Layer | Rule |
|---|---|
| `canAccessRoute` `/adult-class` | **any Setu family** (like `/complete-profile`, `/acknowledgements`). Denying a member HERE would 302 them at the middleware, which is the `ERR_TOO_MANY_REDIRECTS` shape; the page sends them to `/family` instead. |
| `canAccessRoute` `/api/setu/adult-class` | **manager-only, NARROWER than the `/api/setu/` catch-all**, which also grants welcome-team and admin - roles with no `fid`, so the handler could only ever 400 for them. |
| in-handler | `isSetuManager` + `fid` from the session, never the body. |

**Closes plan finding 3 (`enrolledMids` is never validated).** `enroll-family.ts:223-224`
takes a supplied list VERBATIM and skips the member read, so this route is the
ONLY place a mid is checked. It validates against `selectableAdults` -
**all-or-nothing (422)**, never a partial enroll that silently drops someone -
which covers a child, a pending invitee, a teaching parent and another family's
mid in one rule. The body schema adds two things the plan did not ask for:
`.strict()` (so a body carrying `fid` is a 400 rather than something we must
remember not to read) and **duplicate rejection** (`enrolledMids` is written
verbatim, so `['a','a']` lists one person twice on the teacher roster).

**Finding 9b (NOT_FOUND → 409) did not apply.** `enrollFamily` never surfaces a
raw Firestore `NOT_FOUND`: the reconcile path uses `txn.update` only after
`enrollmentSnap.exists`, and a missing family/offering already throws the typed
`family-not-found` / `offering-not-found`, both mapped to 404 here.

**A closed offering does not strand anyone**, as Task 3 intended: the reconcile
sits above the enrollment-window gates, so an already-enrolled family can still
change their choice after registration closes. Only a FIRST enrollment can hit
`offering-disabled` (422), which is the admin-closed-it-mid-flow race.

---

### Fifth audit (Task 7, Codex 2026-07-26) - what it found AFTER the code shipped

Most of its recommendations were already implemented independently (the loader
split, the `isBalaViharPaid` extraction, duplicate rejection, both `canAccessRoute`
clauses, the middleware entry, no `public-routes` entry, no new indexes,
`connection()` + `CspRoot`). Four findings were new; each verified before acting.

| Finding | Verdict |
|---|---|
| **"Task 3 fixed the closed-offering stranding" is only HALF true.** The reconcile-above-the-window-gates fix covers RE-selecting on an already-active enrollment. A family's very FIRST Save takes the CREATE path (`enroll-family.ts:195-203`), which is still gated - so an admin closing registration between the gate redirect and the Save click gives a first-time family a 422 with no reconcile fallback. | **CONFIRMED, already handled.** The form maps `offering-disabled`/`offering-expired`/`program-not-available`/`no-adult-class-offering` to "Registration has closed. Please contact the centre." Codex suggested "try again shortly"; that is wrong copy for a deliberate admin toggle. |
| **The teacher-assignment TOCTOU.** `isTeacherAssigned` is a point-in-time read and `enrollFamily`'s transaction has no concept of a teacher, so an adult assigned to teach between validation and commit still lands in `enrolledMids`. | **ACCEPTED**, now commented in the route. No money, no access; worst case a teacher is listed as attending the class they run, which a human notices at once. |
| **Firestore auto-retry makes finding 8 worse than a 500.** The Admin SDK retries the whole transaction callback, so a doc deleted mid-window makes the RETRY see `exists === false` and fall through to the bare `txn.set`, silently recreating the doc rather than surfacing NOT_FOUND. | **CONFIRMED but NARROWER than stated for this route.** `levelSnapshots` is written ONLY by the annual rollover (`promote-families.ts:319`) and read only for CHILD level history, so an adult-class enrollment has none to lose; the exposure here is `_test`, i.e. UAT sweep hygiene. Verified no in-app path hard-deletes an enrollment - `DELETE /api/setu/enrollments/[eid]` only flips `status` to `cancelled`. Finding 8 stays a pre-existing separate issue, NOT worsened by this route. |
| **Task 12 Step 4 asks for "three" mobile-changelog entries, but `efc9b74` already covers Tasks 1 AND 2 in one.** | **CORRECT.** Two entries total, and both now exist: `efc9b74` + `cdb72b6`. **Task 12 Step 4 is already satisfied.** |

**Sixth pass, against the SHIPPED code.** Confirmed the ping-pong fix converges
(a genuine state change makes BOTH sides read the same new reality and agree, so
there is no bounce), that a cross-family mid is structurally impossible rather
than accidentally rejected (`getFamilyByFid` is scoped to the session fid by
construction, and every member-mutating route revalidates its `family-${fid}`
tag), that the Save button cannot stick (`saving` resets on every path except the
success path, which unmounts via a full navigation), and that the flag is a
literal `process.env` read so page and route cannot disagree. Two real gaps, both
now closed:

| Gap | Fix |
|---|---|
| **Nothing bound Task 8 to the FailSoft variant.** Both functions returned the identical `Promise<AdultClassGateInput \| null>`, so a copy-paste of the wrong name compiles clean, type-checks green, and silently reopens the ping-pong. And the plain name `loadAdultClassGateData` was the obvious one to reach for - the WRONG one for a gate. | **Renamed to `loadAdultClassGateDataOrThrow`.** Neither variant is now the innocuous default, so the choice is deliberate at every call site. A comment would not have survived a copy-paste; a name that does not exist cannot be pasted. |
| **No test made the loader throw**, so the route's deliberate absence of a try/catch around it was documented but unverified. | Added; mutation-checked (adding a `.catch(() => null)` fails it). |

**Accepted and left alone:** `data.currentOffering!.oid` is re-resolved fresh at
save time rather than pinned from what the page rendered, so an admin publishing
an earlier-dated offering at the family's centre inside a multi-second window
could enroll them in a term they never saw. The alternative - trusting a
client-supplied oid - is a tamperable field, which is strictly worse.

Also corrected a framing of mine that reached the plan: the `/api/setu/` catch-all
is `manager || welcome-team || admin`, not manager-only. The explicit clause is
still right - it denies the two staff roles, which carry no `fid`.

---

## Task 8: `AdultClassGate`, flag-gated and ordered

- [x] **Step 1: Add `flags.setuAdultClass`, default off**

In `lib/flags.ts` and `turbo.json`'s `env` array. **v1 added the gate unconditionally**, which violates discipline 5 and removes the kill switch three days before launch - on a gate that redirects. `DisclaimerGate` is the precedent: `layout.tsx:68` opens with `if (!flags.setuDisclaimers) return null;`.

- [x] **Step 2: Write the failing tests** - fires for a gated family; returns `null` when the flag is off; returns `null` while either earlier gate would fire.
- [x] **Step 3: Implement, deferring to the earlier gates explicitly**

v1 said "guarding on both earlier gates exactly as `DisclaimerGate` guards on profile completeness (`layout.tsx:76`)". That is not the same shape. `:76` is a pure in-memory check (`incompleteMembers` + `isFamilyAddressComplete`). A **fourth** gate must additionally defer to the **disclaimer** gate, which needs `getDisclaimerStateForFamily(portalFirestore(), data.family)` (`:78`) - an extra Firestore read on every `/family/*` render - and must respect the `flags.setuDisclaimers` short-circuit: when disclaimers are OFF, `DisclaimerGate` never fires and the deferral must not block.

Extract a shared `earlierGatesPending(data)` that both gates call, rather than copying `:76`.

**And say which scope it takes, because the two differ today and unifying them is a live behaviour change.** `:76` uses `incompleteMembers(data.members)` (all members); `ProfileCompletionGate` uses `membersRequiringCompletion(...)` (`:52`), which filters `inviteStatus !== 'pending'` (`member-required-fields.ts:155`).

So a family with a **pending co-manager invite** whose invitee record is incomplete currently sees *neither* gate: `ProfileCompletionGate` does not redirect (narrow scope), and `DisclaimerGate` returns null (wide scope). They never accept disclaimers.

**Unify on the narrow scope** - it is the correct one - and record that this also closes an existing hole where a pending co-manager suppressed the disclaimer gate. Those families will start being redirected to `/acknowledgements` for the first time. Add a test for it. Do not let it land as an unexplained side effect nine days before launch.

- [x] **Step 4: Do NOT exempt a path from inside the layout. Move the success page out instead.**

An earlier draft of this step said "exempt `/family/donate/success`". **That is the pattern this repo has already had an outage from, and it contradicts R1 in this plan's own Global Constraints.** The gates are server components rendered from `app/family/layout.tsx`; a component has no pathname, so the only way to give it one is a header - and `layout.tsx:23-32` records what happened last time:

> "When the completion screen was nested at /family/complete-profile it inherited THIS gate, which then had to exempt itself via the current request pathname - and under a soft client-side navigation that header is stale (it read '/family' while the layout re-rendered for the completion route), so the gate redirected to itself forever: a blank page with flickering chrome."

There is also no such header to read: `middleware.ts:106-135` sets `x-portal-{role,uid,family-id,fid,mid,extra-roles,email,phone}` and nothing else. No `x-pathname`, no `x-invoke-path` anywhere in the repo.

**Instead, move `/family/donate/success` to a top-level `/donate/success`, outside the gated layout** - the same reason `/complete-profile`, `/acknowledgements` and `/adult-class` are top-level. It already renders its own full-screen `CspRoot` (`donate/success/page.tsx:30`) and uses none of the layout chrome, so the move is nearly free.

This is what makes the owner's requirement work: **the gate stays persistent, and the Bala Vihar donation flow is never blocked by it.** P5's pledge card moves with the page; update P5 v2 Task 9's path reference in the same commit.

**Files:** move `app/family/donate/success/` → `app/donate/success/`; add `app/donate/success/error.tsx`; add the `canAccessRoute` clause and the `isSetuRoute` entry for `/donate`; update every link to it (`grep -rn "donate/success"`).
- [x] **Step 5: Run and commit**

---

### Task 8 as SHIPPED (`2ed04dc` gate, `47663d1` the move)

**The plan said "extract a shared `earlierGatesPending(data)`". It needed to be
TWO functions, not one.** `profileGatePending(data)` is the pure in-memory
condition list that all THREE gates call; `earlierGatesPending(data)` composes it
with the disclaimer read and the `setuDisclaimers` short-circuit, and only the
third gate needs that. One function could not serve both, because
`DisclaimerGate` must not defer to itself.

**The disclaimer read is now React `cache()`d on the family object**
(`getDisclaimerStateCached`). `getCurrentFamily` already memoizes that object, so
both gates get the same identity and therefore ONE Firestore read - adding a
third gate costs zero extra reads rather than doubling the disclaimer read on
every `/family/*` render. `acceptance.ts` itself is untouched (it takes a `db`
param, so caching it there would key on the db handle).

**The scope unification landed and is tested.** `DisclaimerGate` now uses
`membersRequiringCompletion` (pending invitees excluded) instead of
`incompleteMembers` over all members. Confirmed in code first: the filter is at
`member-required-fields.ts:155`. **Families with a pending co-manager invite whose
invitee row is incomplete will start being redirected to `/acknowledgements` for
the first time** - they previously saw neither gate and never accepted at all.

**Step 4's move cost three code references**, all `successUrl`-related. The page
was already self-contained (its own `CspRoot`, no layout chrome). **It needed a
mobile changelog entry** the plan did not anticipate: the Stripe redirect target
changed, and a mobile client matching on `/family/donate/success` to detect
payment completion would strand the user. Recorded at `47663d1`.

**Why Step 4 could not be deferred, quantified.** Independent audit worked out the
race precisely: `DonateSuccessPage` marks the donation completed with ONE
Firestore write, while `AdultClassGate` on the SAME render spends 6-10 round
trips. The gate's chain is strictly slower, so by the time its fresh
`getDonations()` resolves the donation is already `completed`, `bvPaid` flips
true, and a family with a selectable adult is redirected to `/adult-class`
**without ever seeing "Thank you for your donation"**. The asymmetry makes that
the LIKELY outcome, not an edge case. Shipping Task 8 Steps 1-3 without Step 4 -
even just to smoke-test the flag in UAT - would have eaten the receipt page the
gate was supposed to leave alone. Both shipped in one push; the intermediate
state never reached `origin` (the first push attempt failed the build).

**The plan's "the move is nearly free" was WRONG, and the pre-push build caught
it.** It reasoned from the page rendering its own `CspRoot` and using no layout
chrome - but the `/family` layout also wrapped children in a `<Suspense>`
boundary, and the ROOT layout does not. Under `cacheComponents` that fails the
Vercel prerender outright: *"Route /donate/success: Uncached data was accessed
outside of `<Suspense>`."* Moving a page out of a layout means taking over
everything that layout provided, not just the visible chrome. The default export
is now a synchronous shell, the same shape as `/acknowledgements` and
`/adult-class`. **Any future route move must check this first.**

**P5 v3 already references `/donate/success`** (its Task 5), so no cross-plan
edit was needed - v2's reference was the stale one and v2 is superseded.

Five mutations verified on the gate (swap the loader variant, un-mount it, drop
the deferral, revert the member scope, ignore the disclaimers flag) and two on
the move (each authorization entry). All fail the suite.

**⚠️ Task 9 Step 3 must now target `app/donate/success/page.tsx`**, not
`app/family/donate/success/page.tsx`.

---

## Task 9: The ask on the donation success page, with a skip path

**v1 implemented a hard redirect gate only, and spec §4.3 asks for something else.** The consequences are concrete: `app/family/donate/success/page.tsx` is **inside** the `/family` layout, so once the BV donation reads paid, v1's gate redirects away from it - and P5's monthly-pledge card, which is added to that exact file, **would never render for a gated family**. Spec §4.3's own "the order matters, adult-class first, pledge second" becomes unimplementable.

- [x] **Step 1: Write the failing tests**
- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Render the ask on `/donate/success`, above the pledge ask** (top-level since Task 8 Step 4 - the old `/family/donate/success` no longer exists)

Adult-class selection **first** - quick, free, part of completing enrollment. The pledge ask **second and quieter**. Reversing them leads with a money ask straight after a $500 payment.

- [x] **Step 4: "Skip" means "not now", and the gate is what brings them back. No dashboard card.**

An earlier draft asked for both a skip path *and* a dashboard card *and* a persistent gate. **Those cannot coexist.** Nothing but an active enrollment carrying an adult clears spec §2.1 condition 4, and skipping writes nothing - so the moment a skipper navigates to `/family`, the gate fires and redirects them to `/adult-class`. The dashboard card could never render, and Skip would return the user to the same screen.

The owner's requirement was "keep popping them like profile completion logic", so **the gate is the persistence mechanism**:

- On `/donate/success`, Skip simply continues to `/family`.
- The next `/family` visit hits the gate and lands them on `/adult-class`, where they complete it.
- **No `adultClassPromptDismissedAt`, no sixth condition, no dashboard card.** Do not build a dismissal - it would defeat the requirement.

If the product actually wants a real dismissal, that is a different feature: it needs persistence (the repo's precedent is `volunteeringSkillsNudgeDismissedAt`, `member.ts:30`) and a sixth condition in `needsAdultClassSelection`. Decide before building, not after.

- [x] **Step 5: Run and commit**

---

### Task 9 as SHIPPED (`11da5ec`)

**DEVIATION, deliberate: there is no "Skip for now" control.** Step 4's own text
establishes that skipping writes nothing and `AdultClassGate` is the persistence
mechanism - so a skipper reaching `/family` trips the gate and lands on
`/adult-class` regardless. A button labelled "Skip" that demonstrably cannot skip
is worse than the honest **"Back to family"** link already on the page, which
performs the identical action and satisfies Step 4's stated intent ("there is a
way to not do it now; the gate brings them back"). Tested from both directions:
there IS a way out that writes nothing, and there is NO control claiming to skip.

**The ask is the REAL form, inline** (`AdultClassForm` reused), not a link to
`/adult-class` - a family finishes in place. It is gated on the SAME
`needsAdultClassSelection` predicate the gate uses, so the two surfaces cannot
disagree about who owes a selection.

**Ordering against `markDonationStatus` is load-bearing.** The ask loads AFTER
the completion write, because condition 3 asks whether the Bala Vihar donation is
paid and that write is what makes it so. Reversing the two lines means the family
who JUST paid is the one family never asked. This is the same read/write race
that was DANGEROUS in Task 8, working in our favour here.

**FAIL-SOFT here, THROWING on `/adult-class`** - the split earning its keep in
both directions. A receipt page must never lose the family's confirmation that
their ~$500 arrived over an optional ask; on `/adult-class` the whole page is the
ask, so swallowing a failure there would be a blank screen. Both are tested by
mocking BOTH variants and asserting which one is called.

**A `{/* P5 MONTHLY PLEDGE CARD GOES HERE */}` marker sits between the ask and the
"Back to family" link**, naming the required order and why. P5 v3 Task 5 Step 4
lands there.

**Two gaps closed after audit (`81f5fec`):**

- **The DOM ordering was enforced by a COMMENT only.** The ask-above-pledge order
  is the entire point of Task 9, and nothing asserted it - P5's implementer could
  paste the card above the ask, or nest it inside the `ask &&` block where it
  renders for nobody, with the whole suite green. Same trap that made the loader
  variants get distinct names instead of a shared name plus a comment. **Now
  test-locked before P5 touches the file**: thank-you < ask < way-out, plus a test
  proving the pledge slot survives when the ask does not render (i.e. it is a
  sibling, not inside the conditional).
- **`markDonationStatus` was uncaught, which made this task's own comment untrue.**
  It claims a transient error costs the ask and never the receipt - but an
  uncaught WRITE failure took down both. The function is documented best-effort
  and explicitly not authoritative, and Stripe already has the money, so a failed
  status write is recoverable where a receipt the family never sees is not.
  Pre-existing (inherited with the page in `47663d1`), fixed here because Task 9's
  stated invariant depends on it.

**A stale SPEC line, deliberately not implemented:** spec §4.3 asks for a
dashboard card. The plan's Task 9 Step 4 already overrides it in writing ("card +
gate + skip cannot coexist... no dashboard card"), so the plan wins over the
spec here - not a dropped requirement.

The page had **no test file at all** before this (it moved in `47663d1` and none
came with it); it has **thirteen** now. Four mutations verified: ignoring the predicate,
using the throwing loader, dropping the flag gate, and removing the way out.

---

## Task 10: Close the `$101` door on Bala Vihar families

`app/api/setu/enrollments/route.ts:52-62` calls the **same** `enrollFamily` with `enrolledVia: 'family-initiated'`, which before Task 2 always wrote `suggestedAmountOverride: null`. So a Bala Vihar family enrolling in the adult class through the ordinary `/family/enroll/adult-study-class` surface is billed **$101** and has **all** adults auto-enrolled - and the gate then never fires, because condition 4 is satisfied by a non-empty `enrolledMids`.

Two doors to one program, and the more discoverable one bills the family the spec says pays nothing. Spec §4.5 row 1 covers "adult class *first*, BV later"; this is the different and more likely case.

- [x] **Step 1: Write the failing test** - `BV-paid family POSTs /api/setu/enrollments for adult-study-class → override 0`.
- [ ] **Step 2: Run to verify it fails**
- [x] **Step 3: Close BOTH halves of the door, not just the fee**

The waiver alone leaves the other half open. `enroll-family.ts:124-131` still derives `enrolledMids` from `memberEligibleForProgram`, which for `memberType: 'adult'` matches **every** Adult - including teacher-assigned adults (violating spec §4.4 and matrix rows 2-4) and `inviteStatus: 'pending'` invitees. `membershipMode` stays `'auto'`, so the next member edit re-adds everyone. And because `enrolledMids` is non-empty, **condition 4 is satisfied and the gate never fires** - the family never sees the selection screen at all.

So the generic route must pass all three:

```ts
enrolledMids: selectableAdults(members, teacherAssignedMids).map((m) => m.mid),
suggestedAmountOverride: bvPaid ? 0 : null,
membershipMode: 'manual',
```

Assert that a teacher-assigned adult is **not** in `enrolledMids` after a generic-surface enroll.

- [x] **Step 3b: Apply the waiver on CREATE only**

Task 3's reconcile fires whenever `suggestedAmountOverride` is explicitly supplied. Combined with this step that silently implements the retroactive exemption Deviation 1 says is **not** being implemented: a childless family enrolls in adult class at `$101` and pays; later they add a child, enroll in Bala Vihar, and pay; they re-POST the adult-class oid; `bvPaid` is now true, the route supplies `0`, the reconcile fires, and **the $101 they already paid is rewritten to an expected of `0`.**

Gate it: apply the waiver only when `created === true`, or only when the stored override is `null`. Test: "an adult-class enrollment that already carries a non-null override is not rewritten by a later BV-paid re-POST."

- [x] **Step 3c: Decide the BV-enrolled-but-unpaid case**

`bvPaid` is evaluated once at enroll time and never recomputed. A family that enrolls in Bala Vihar, then enrolls in adult class **before** paying, gets `override: null` → `$101`. Paying afterwards never waives it (by design), and the gate never fires because condition 4 is satisfied. They sit at `$601` expected with no in-product recourse.

Either block the generic adult-class enroll while Bala Vihar is unpaid, or write `override: 0` on any Bala Vihar **enrollment** rather than payment and accept the wider waiver. Either is defensible; silence is not.

- [x] **Step 4: Run and commit**

---

### Task 10 as SHIPPED (`378df10`, `ab47661`)

**STEP 3c DECIDED - and NOT the option I set out to implement.** The plan offered
blocking the generic enroll while Bala Vihar is unpaid. **Rejected**, because
`isBalaViharPaid` carries a documented FALSE NEGATIVE: a legacy-paid family whose
offering doc is missing reads as unpaid (`needs-selection.ts`, "KNOWN LIMIT,
accepted"). Inside the gate that costs an un-asked question - benign, and
explicitly the safe direction. Turned into a block it would **refuse a family who
genuinely paid**. So:

> **The waiver tracks Bala Vihar MEMBERSHIP; the gate's prompt tracks Bala Vihar
> PAYMENT.** They answer different questions - "should we BILL them?" versus
> "should we PROMPT them yet?" - and charging for a class included with Bala
> Vihar is wrong whether or not the payment has landed.

Worst case is now a benign false positive: a family enrolls in BV, never pays,
gets the adult class free, and still visibly owes the BV donation on the staff
roster. That beats a harmful false negative.

**THE FEE WAIVER ALONE DID NOT CLOSE THE DOOR** - found by tracing the caller,
not by any test. `enroll-cta.tsx:85-88` reads the POST response's
`suggestedAmount` and, when it is `>= 1`, sends the family **straight to Stripe**.
The route was returning `result.suggestedAmountSnapshot`, the amount pinned at
enrollment time, so a waived family got an override of 0 on the record and a
**$101 checkout anyway**. The route now reports `overrideInForce`. The Task 10
tests could not see this: they asserted what `enrollFamily` was called WITH, never
what the caller was told back.

**`resolveTeacherAssignedMids` extracted** from the gate loader so both doors
share one definition of who teaches; two hand-rolled copies would enroll
different people.

**Accepted limit:** a family enrolling through the generic door does not get to
CHOOSE which adult attends - `selectableAdults` is auto-derived - and because
that leaves `enrolledMids` non-empty, condition 4 is satisfied and the gate never
offers them the choice either. Better than today (every adult, including
teachers, at $101), and the bespoke door is the one families are steered to.

**Step 3b was implemented WRONG first, and its test asserted the wrong behaviour**
(corrected `9d6163e`). The guard was "omit the override when the stored one is
non-null" - but a stored `null` is AMBIGUOUS. This function always supplies one
value or the other, so on a create it WRITES `null` for a family with no Bala
Vihar, which is exactly how they get billed the full amount. A later re-POST then
read that null as "never priced" and applied the waiver, rewriting an amount the
family had already PAID down to 0 - the precise scenario Step 3b exists to
prevent. **Create-only means "no active enrollment for this oid yet", not "no
override stored".** Worth noting the failure mode: the test was written to match
the implementation rather than the requirement, so it locked the bug in.

**The new 422 needed client copy.** `enroll-cta.tsx`'s error switch had no case
for `no-selectable-adults`, so a family where every adult teaches got
"Enrollment failed - please try again" - wrong twice over, since the condition is
deterministic and retrying cannot help.

**Known, accepted, and NOT fixed here:** `enroll-cta.tsx:68` shows "Add a child to
your family before enrolling in Bala Vihar" for `no-eligible-members` regardless
of program - pre-existing and now reachable via other programs. And the enroll
page's pre-click price still shows the raw amount, since it cannot preview the
waiver without duplicating the computation server-side; it self-corrects the
instant they click, now that the response reports the effective amount.

Six mutations verified, plus one on the response amount and one on the create-only gate.

---

### Task 11 as SHIPPED (`8ac2256`) - the owner rejected the recommendation

**The recommended rule (`expected === 0 && activeCount > 0` ⇒ `'paid'`) was NOT
adopted.** CMT Developer's decision: **`paid` means money actually arrived**, so a
family who never owed anything must not be labelled paid however much they
donated. A fourth state `'not-applicable'` (chip **"N/A"**) was added for "no fee
applies", and `'unknown'` keeps the cases where a zero total is not knowledge.

**Four corrections to this task's own analysis, all verified in code:**

1. **"Four callers" is two live surfaces.** `deriveFamilyPayment` (`payment.ts`)
   and `deriveFamilyRosterSignals` (`family-engagement.ts`) have **no production
   caller** - only their own tests. `list-families.ts`, the module they were
   written for, no longer exists. The live consumers are `buildRosterCsvRows` →
   `GET /api/welcome/reports/[kind]` and `buildRosterReportDataset` →
   `GET /api/welcome/roster/report` → `/welcome/roster`. **Both orphans are still
   wired to the shared classifier rather than deleted; deletion is a separate
   call.**
2. **"Starts appearing in the default view" was wrong** - and moot under the
   chosen design. The default is `payment='paid'` **and** `engagement='enrolled'`
   (`roster-browser.tsx:250-251`), where enrolled means `bvEngagement ===
   'confirmed'`. A free non-BV family is `not-enrolled` and was never going to
   appear. With N/A rather than Paid, **the default view is unchanged**.
3. **Teacher-managed does not imply `$0`.** `paymentSource` is orthogonal to
   `pricingTiers` (`offering.ts:28`). A teacher-managed offering with a $300 tier
   has `expected = 300` and reads **outstanding forever**, because portal
   donations never arrive for it. Left unchanged, and now pinned by a test so
   this task cannot be read as having moved it. **Worth its own decision later.**
4. **A THIRD source of `expected === 0` that this task never listed, and the only
   one observed in real data: the offering doc is missing.** All 7 UAT families
   reading as `$0` got there via `oid`s (`e2e-att-period`, `e2e-prev-period`)
   pointing at deleted offering docs, so `expected` fell back to a snapshot of 0.
   That is "nobody ever wrote a price", not "free" - and shipping the recommended
   rule would have labelled exactly those families **Paid**.

**Measured blast radius (UAT, read-only):** 898 families, 45 active enrollments,
10 offerings. 854 have no active enrollment (unchanged), 37 unchanged, **7 flip -
all E2E fixtures, all via the missing-offering path. Zero real families move.**

**The design.** `paymentFromAmounts` is **deleted**, not widened: taking a
pre-summed total is precisely what made the two kinds of zero indistinguishable
at the point of classification, and each caller carried its own copy of the
override → offering → snapshot fallback. `classifyRosterPayment` takes the raw
pieces; `chargeFromEnrollment` and `classifyBulkPayment` are the only two
adapters. `chargeAmount` returns **`null`**, not 0, for "no override, no offering,
snapshot 0" - a *positive* snapshot is still honoured as real recorded knowledge.
One unpriceable enrollment poisons the whole family's verdict.

Seven mutations verified (empty-active guard, null-amount guard, `> 0` vs `>= 0`,
teacher-managed guard, isFinite/negative guard, `snapshot > 0` vs `>= 0`,
`override !== null` vs truthy). Fixtures that carried only the precomputed
`effectiveSuggestedAmount` were made realistic; `build-csv-rows.test.ts` also
stopped mocking `resolveSuggestedAmount` through a barrel the classifier does not
cross, and prices its fake offerings for real instead.

**No mobile changelog entry owed** - `/api/welcome/*` is not `/api/setu/*`, and
`RosterPayment` reaches no setu route.

---

## Task 11: A `$0` expected total must not read `unknown`

Spec §6 item 5, which v1 claimed as covered and had no task for.

`paymentFromAmounts` (`roster/payment.ts:7-10`) returns `'unknown'` when `expected <= 0`:

```ts
if (activeCount === 0 || expected <= 0) return 'unknown';
```

Traced against the fee rule:
- **BV(500) + ASC(0) → expected 500 → `paid`.** The case the spec asserts is safe. ✅
- **BV cancelled after the waiver** (spec §4.5 row 2 keeps `override: 0`) → the only active enrollment is ASC at 0 → **`'unknown'`, not `paid`** - on `/welcome/roster` via `deriveFamilyPayment`, in `deriveFamilyRosterSignals` (`family-engagement.ts:46,50`), and in the CSV (`build-csv-rows.ts:113-118`). Same for a teacher-managed or empty-`pricingTiers` offering.

This is not a truthiness bug - the `?? 0` and `typeof === 'number'` reads all preserve a literal `0` correctly. It is the `expected <= 0` classifier.

- [x] **Step 1: Write the failing tests** with a **2-enrollment** fixture (N=2 rule), covering BV+ASC, ASC-only-after-BV-cancelled, and ASC-only-never-BV.
- [x] **Step 2: Run to verify they fail**
- [x] **Step 3: Decide and implement, across all FOUR callers**

Recommended: `expected === 0 && activeCount > 0` classifies as `paid` - the family owes nothing and has paid nothing, which is settled, not unknown.

The classifier is shared, so changing it changes every consumer. There are **four**, not three:

1. `roster/payment.ts:25` (`deriveFamilyPayment`)
2. `roster/family-engagement.ts:50` (`deriveFamilyRosterSignals`)
3. `roster/build-csv-rows.ts:118` (`buildRosterCsvRows`)
4. **`roster/report-dataset.ts:183`** (`buildRosterReportDataset`), consumed by `api/welcome/roster/report/route.ts:27`

**And this is a visible product change, not only a correction.** `roster-browser.tsx:250` defaults the payment filter to `'paid'`. Every family whose only active enrollments have empty `pricingTiers` - free and teacher-managed offerings, where `resolveSuggestedAmount` returns 0 (`offering.ts:101`) - starts appearing in the **default** `/welcome/roster` view labelled **Paid**. Today they are filtered out as `unknown`. Confirm that is wanted before shipping it.

- [x] **Step 4: Run and commit**

---

## Task 12: Verify against deployed UAT

- [ ] **Step 1: Seed fixtures** for matrix rows 1, 2, 3, 5, 6 and 7.
- [ ] **Step 2: The E2E steps spec §6 requires and v1 omitted**
  - **§6.1** - assert `101` for a **non-BV** family. v1 walked only the BV family.
  - **§6.3** - after selecting, **edit an unrelated member and re-assert `enrolledMids`**. Spec calls this "the failure that unit tests and a single-pass walkthrough both miss"; only Task 4's mocked test covers it otherwise, which is exactly the layer §6.3 says is insufficient.
  - Walk the success-page ask, the skip, the dashboard card, and the gate fallback.
  - Re-select after the chosen parent is removed, and assert the second write lands (Task 3's loop).
- [ ] **Step 3: Run against deployed UAT**

```bash
PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu adult-class
```

- [ ] **Step 4: `MOBILE_API_CHANGELOG.md`** - three entries, not one. Task 1 (override accepts `0`), Task 2 (`membershipMode` now appears in `GET /api/setu/enrollments`, which returns raw `getEnrollments` output at `enrollments/route.ts:26`), and the new `/api/setu/adult-class` route.
- [ ] **Step 5: Update the cutover runbook** - `flags.setuAdultClass`, the offering and its `$101` amount per location, and a dated §14 entry.
- [ ] **Step 6: Commit**

---

## Self-review

**Spec coverage.** §2.1 conditions → Task 6 (plus condition 0). §2.3 all seven rows → Tasks 5 and 6, row 7 asserted twice over, row 5 now tested. §4.2 fee rule → Tasks 1, 2, 10. §4.3 placement, multi-select, skip, dashboard card → Task 9. §4.3b configurable amount → Task 7 (admin + coordinator per P1). §4.4 exception → Task 5. §4.5 lifecycle → Tasks 3, 4, 11, with rows 1 and 4 recorded as deviations. §4.6 R1-R4 → Global Constraints + Tasks 7, 8. §4.6.1 term scoping → Task 6 Step 5. §5 the confirmed bug → Task 1. §6.1-6.7 → Task 12, including the three items v1 claimed and did not deliver.

**Type consistency.** `EnrollFamilyParams`'s three new optional fields (Task 2) are consumed in Tasks 3, 9 and 10. `selectableAdults` (Task 5) feeds `needsAdultClassSelection` (Task 6) and the Task 7 screen. `bvPaid` (Task 6 Step 4) is reused by Task 10.

**Every review finding addressed:** C1 → Task 2. C2 → Task 3. C3 → Task 6 Step 3 (offering precondition) + Task 8 Step 1 (flag). M1 → Task 10. M2 → Task 11. M3 → Task 7 Step 5. M4 → Task 7 Step 4. M5 → Task 6 Step 4. M6 → Task 8 Step 3. M7 → Task 9 + Task 8 Step 4. M8 → Task 12 Step 2. m1 → Task 1 Step 4. m2 → Task 12 Step 4. m3 → Task 7 Step 3. m4 → Task 4 Step 3. m5 → Task 4 Step 3. m6 → Task 5 Step 1. m7 → the dependency note in the header.

## Review history

Reviewed once after the first draft (`docs/superpowers/reviews/2026-07-25-review-p4v2.md`): 2 critical, 15 major, 8 minor. What changed most:

1. **The success-page exemption was the exact pattern this repo had an outage from - and this plan's own R1 forbids it.** Gates are server components with no pathname; the only way to give them one is a header that does not exist (`middleware.ts:106-135` sets eight `x-portal-*` headers and nothing else), and `layout.tsx:23-32` records the last time a gate exempted itself by pathname: "under a soft client-side navigation that header is stale ... so the gate redirected to itself forever." Resolved by **moving the success page to a top-level `/donate/success`** instead - which is also what keeps the donation flow unblocked.
2. **Skip, the dashboard card, and a persistent gate could not all be true.** Nothing but an active enrollment clears condition 4, so a skipper is redirected on their next `/family` visit and the card can never render. The gate *is* the persistence; the card and any dismissal state are gone.
3. **The "proof obligation" pointed at two callers that do not exist** (the rollover and the backfill both explicitly avoid `enrollFamily`) and away from the **door kiosk**, which runs every Sunday morning and whose docstring depends on precisely the no-op semantics Task 3 rewrites.
4. **Three helpers in the `bvPaid` definition were invented.** `sumCompletedDonationsForEid` does not exist and the nearest real helper is program-blind, which would have fired the gate on families who never paid Bala Vihar and waived their `$101`.
5. **No task built `POST /api/setu/adult-class`** - the plan granted it in `canAccessRoute` and documented it for mobile. Executed literally, Save does nothing and the gate then locks every paid manager on a screen they cannot complete.

Also corrected: the waiver applied on reconcile as well as create (silently implementing the retroactive exemption Deviation 1 disclaims); the generic route left `enrolledMids` and `membershipMode` untouched, so the gate never fired at all; `membershipMode` was never added to `EnrollmentDocSchema`; `paymentFromAmounts` has four callers, not three, and the change makes free-program families appear as **Paid** in the default roster view; "current term" had no definition and breaks with two open offerings; and `earlierGatesPending` had to pick a scope, which closes an existing hole where a pending co-manager suppressed the disclaimer gate.

**Known risk.** Twelve tasks, four of which (2, 3, 6, 10) change `enrollFamily` or its inputs - the single function behind the door kiosk, first-attendance enrollment, family self-serve and staff enroll. Task 2's "byte-identical for existing callers" test is the load-bearing guard, and `auto-enroll-bala-vihar.test.ts:22` pins the call with an exact-object matcher, so a new parameter fails there rather than where you are looking. If either needs editing, stop.
