# P4 v2 - Adult Study Class

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A family that has paid its Bala Vihar donation picks at least one non-teaching adult for the Adult Study Class at no cost; a family with no children pays a configurable `$101`. The ask lives on the donation success page, with a persistent gate as the fallback.

**Architecture:** `enrollFamily` gains explicit `enrolledMids`, `suggestedAmountOverride` and `membershipMode` parameters, and learns to **reconcile** an existing active enrollment rather than no-op on it. A pure `needsAdultClassSelection(family)` predicate implements the spec's conditions plus an "is there an offering at all" precondition. The ask renders on `/family/donate/success` first; `AdultClassGate` - flag-gated, ordered after the profile and disclaimer gates, and exempting the success page - redirects skippers to a top-level `/adult-class`.

**Tech Stack:** Next.js 16 App Router, Firebase Admin Firestore, Zod, Vitest, Playwright.

**Supersedes:** `2026-07-25-launch-p4-adult-study-class.md`, reviewed as REQUEST CHANGES (3 critical, 8 major, 7 minor). Review: `docs/superpowers/reviews/2026-07-25-review-p4.md`.

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
| `apps/portal/src/app/family/donate/success/page.tsx` | the ask, **first**, above the pledge | 9 |
| `apps/portal/src/app/api/setu/enrollments/route.ts:52-62` | BV waiver on the generic surface | 10 |
| `apps/portal/src/features/setu/roster/payment.ts:7-10` + callers | `expected === 0` classification | 11 |

---

## Task 1: Relax the override to `nonnegative()`

`suggestedAmountOverride: z.number().int().positive().nullable()` (`enrollment.ts:26`) cannot store `0`, so the exemption is unrepresentable.

- [ ] **Step 1: Write the failing tests** - a doc with `suggestedAmountOverride: 0` parses; `-1` still rejects.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Relax `:26` to `nonnegative()`**
- [ ] **Step 4: Relax `OverrideEnrollmentBodySchema` at `:53` too, and pin the contract change**

This widens the welcome-team `PATCH /api/welcome/enrollments/[eid]/override` contract (`route.ts:56`) to accept `0`. The existing suite pins `-50 → 400` (`enrollment-integration.test.ts:704`) and nothing pins `0`. Add a test for `0 → 200` and note the behaviour change in the commit - staff can now zero an override deliberately, which is a feature, but it is a contract change.

- [ ] **Step 5: `MOBILE_API_CHANGELOG.md` entry.** This is a `@cmt/shared-domain` schema change consumed by `/api/setu/enrollments`, so CLAUDE.md requires one.
- [ ] **Step 6: Run and commit**

---

## Task 2: Teach `enrollFamily` explicit mids, override and mode

**The whole plan rests on this and v1 had no task for it.** Today `EnrollFamilyParams` is `{ fid, oid, enrolledVia, enrolledByMid }` (`enroll-family.ts:8-13`) - no mids, no override, no mode. `enrolledMids` is derived from `memberEligibleForProgram` (`:124-131`), which for an `'adult'` program matches **every** adult including teacher-assigned ones and pending invitees. `suggestedAmountOverride: null` is hardcoded at `:153`. Nothing writes `membershipMode` anywhere.

So without this task: all adults enrolled, `$101` billed to a Bala Vihar family, `membershipMode` absent (treated as `'auto'`), and the selection overwritten on the next member edit - the exact failure the design exists to prevent.

- [ ] **Step 1: Write the failing tests**

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

The last one is the proof obligation: `/api/setu/enrollments`, the rollover, and the backfill all call this today.

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Extend `EnrollFamilyParams`**

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

- [ ] **Step 4: Thread them into the `txn.set` at `:139-157`**

Use the supplied list when present, else the derived one. Apply the `no-eligible-members` guard (`:135-137`) to whichever list is used. Default `membershipMode` to `'auto'` so every existing doc and caller keeps today's semantics.

- [ ] **Step 5: Run - existing enroll tests must pass unmodified**, then commit

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

- [ ] **Step 1: Write the failing test**

```ts
it('a second enroll with different mids updates the existing active enrollment', async () => {
  await enrollFamily({ ...base, enrolledMids: ['F-02'], membershipMode: 'manual' });
  await enrollFamily({ ...base, enrolledMids: ['F-03'], membershipMode: 'manual' });
  const doc = await getEnrollment(eid);
  expect(doc.enrolledMids).toEqual(['F-03']);   // fails today: nothing is written
});
```

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Reconcile in place**

When the enrollment exists and is `active` **and** any of `enrolledMids` / `suggestedAmountOverride` / `membershipMode` was explicitly supplied, update those fields in the same transaction and return `{ created: false, reconciled: true, eid, suggestedAmountSnapshot }`. When none was supplied, keep today's exact no-op so no existing caller changes behaviour.

**Never recompute `suggestedAmountSnapshot` on reconcile** - it is pinned at first enrollment by design (`:106`) so later tier edits cannot move it.

- [ ] **Step 4: Run and commit**

---

## Task 4: `membershipMode` survives the member-edit prune

- [ ] **Step 1: Write the failing tests**

```ts
it('does NOT prune a manual enrollment when an unrelated member is edited', async () => { /* ... */ });
it('still prunes an auto enrollment', async () => { /* today's behaviour, unchanged */ });
it('prunes a removed member even from a manual enrollment', async () => {
  // A departed member must leave enrolledMids regardless of mode - that is what
  // makes the gate re-fire per spec 2.1 condition 4.
});
```

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**

`sync-enrollment-members.ts:65` types the doc as `{ eid?; programKey?; enrolledMids? }` - **add `membershipMode?`**. When `membershipMode === 'manual'`, the prune keeps the stored list intact except for members who no longer exist in the family.

**"Currently-eligible" here means `memberEligibleForProgram`, not `selectableAdults`.** If an implementer reads it as the latter, a chosen adult who later becomes teacher-assigned is pruned → `enrolledMids: []` → the gate re-fires → and without Task 3 that is the permanent loop.

Note the asymmetric invariant deliberately: `enroll-family.ts:135-137` refuses to **create** an empty enrollment, but the prune may legitimately **leave** one. Comment it, or a later reader will "fix" the inconsistency.

- [ ] **Step 4: Run and commit**

---

## Task 5: Selectable adults are the non-teaching ones

- [ ] **Step 1: Write the failing tests** - one per scenario-matrix row, including **row 5** (single non-teaching parent → exactly one selectable, preselected), which v1 had no test for despite spec §6.6 asking for one per row.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement `selectableAdults(members, teacherAssignedMids)`** - adults, excluding teacher-assigned, excluding `inviteStatus: 'pending'` invitees.
- [ ] **Step 4: Run and commit**

---

## Task 6: `needsAdultClassSelection` - the gate predicate

**Two things v1 left undefined, both of which decide whether families get stuck.**

- [ ] **Step 1: Write the failing tests - all seven matrix rows plus the two preconditions**

Rows 3, 4 and 7 all resolve through the empty selectable set. **Row 7 must be asserted twice over** (no BV enrollment **and** no selectable adults), independently - spec §2.3 says so explicitly, because a later change to one could silently start prompting a childless teacher couple.

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement condition 0 - is there an offering at all**

Spec §2.1's five conditions never check that a current adult-study-class offering is **reachable**. Resolve it first via `getOpenOfferingsForFamily('adult-study-class', family.location)` and return `false` when there is none.

Without this: the day the launch offering expires, or someone toggles `enabled` off, or a location is missed, **every paid Bala Vihar manager at that location is redirected to `/adult-class`, cannot enroll, and cannot reach `/family` at all.** There is no escape hatch in the design without it.

- [ ] **Step 4: Define condition 3 - "the BV donation is paid"**

v1 named this and never defined it, and the two obvious helpers are both wrong:

- `isEnrollmentConfirmed` (`enrollment-confirmation.ts:34`) returns `true` for any `enrolledVia === 'family-initiated'` **regardless of payment**, so it would gate families who clicked Enroll and never paid - contradicting spec §2 ("**After** the BV donation").
- A bare donations sum misses legacy-paid families and teacher-managed offerings, whose families never pay in-portal and would be gated **forever**.

The predicate is a three-way disjunction. One test per branch:

```ts
const bvPaid =
  sumCompletedDonationsForEid(donations, bv.eid) >= (bv.effectiveSuggestedAmount ?? 0)
  || legacyPaid
  || paymentSourceOf(bvOffering) === 'teacher-managed';
```

- [ ] **Step 5: Implement conditions 1, 2, 4, 5** per spec §2.1, selecting Bala Vihar via `selectBalaViharEnrollment` and scoping condition 4 to the **current term**.
- [ ] **Step 6: Run and commit**

---

## Task 7: The `/adult-class` route

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Build `app/adult-class/page.tsx`**

Top-level, outside `/family` (**R1**). Multi-select, minimum one, preselected when there is exactly one. Copy must explain **why** - one parent needs to be present during Bala Vihar classes - per spec §4.3; a family reading "you must pick an adult" with no reason reads it as bureaucracy. Exact wording is spec open item O7.

Server component needs `await connection()` (repo pattern, e.g. `app/family/page.tsx:280`) or the Vercel build prerender check fails, and a `CspRoot` / `className="csp"` wrapper or it renders unstyled.

Save, then leave with `window.location.assign('/family')` (**R2**). Do not re-read to decide whether the gate is satisfied (**R3**).

- [ ] **Step 4: Add `app/adult-class/error.tsx`**

CLAUDE.md discipline 3: every top-level route segment has its own. Both `/complete-profile` and `/acknowledgements` do.

- [ ] **Step 5: Add `/adult-class` to middleware's `isSetuRoute`**

`middleware.ts:179-188` lists `/complete-profile` and `/acknowledgements` - the two routes this one is modelled on - and `/adult-class` is not there. Without it, an expired-session manager hitting `/adult-class` is bounced to the **legacy `/login`**, not `/sign-in`. Add a middleware test.

- [ ] **Step 6: Add the `canAccessRoute` rules** for `/adult-class` and `/api/setu/adult-class` (any Setu family; the handler binds `fid` from the session). Remember the `/api/setu/` catch-all is manager-only, so a member-reachable path needs its own clause.
- [ ] **Step 7: Run and commit**

---

## Task 8: `AdultClassGate`, flag-gated and ordered

- [ ] **Step 1: Add `flags.setuAdultClass`, default off**

In `lib/flags.ts` and `turbo.json`'s `env` array. **v1 added the gate unconditionally**, which violates discipline 5 and removes the kill switch three days before launch - on a gate that redirects. `DisclaimerGate` is the precedent: `layout.tsx:68` opens with `if (!flags.setuDisclaimers) return null;`.

- [ ] **Step 2: Write the failing tests** - fires for a gated family; returns `null` when the flag is off; returns `null` while either earlier gate would fire.
- [ ] **Step 3: Implement, deferring to the earlier gates explicitly**

v1 said "guarding on both earlier gates exactly as `DisclaimerGate` guards on profile completeness (`layout.tsx:76`)". That is not the same shape. `:76` is a pure in-memory check (`incompleteMembers` + `isFamilyAddressComplete`). A **fourth** gate must additionally defer to the **disclaimer** gate, which needs `getDisclaimerStateForFamily(portalFirestore(), data.family)` (`:78`) - an extra Firestore read on every `/family/*` render - and must respect the `flags.setuDisclaimers` short-circuit: when disclaimers are OFF, `DisclaimerGate` never fires and the deferral must not block.

Extract a shared `earlierGatesPending(data)` that both gates call, rather than copying `:76`. Copying it also inherits a mismatch: `:76` uses `incompleteMembers(data.members)` (all members) while `ProfileCompletionGate` uses the narrower `membersRequiringCompletion(...)` (`:52`).

- [ ] **Step 4: Exempt `/family/donate/success`** - see Task 9. Without this the gate redirects away from the page carrying the ask.
- [ ] **Step 5: Run and commit**

---

## Task 9: The ask on the donation success page, with a skip path

**v1 implemented a hard redirect gate only, and spec §4.3 asks for something else.** The consequences are concrete: `app/family/donate/success/page.tsx` is **inside** the `/family` layout, so once the BV donation reads paid, v1's gate redirects away from it - and P5's monthly-pledge card, which is added to that exact file, **would never render for a gated family**. Spec §4.3's own "the order matters, adult-class first, pledge second" becomes unimplementable.

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Render the ask on `/family/donate/success`, above the pledge ask**

Adult-class selection **first** - quick, free, part of completing enrollment. The pledge ask **second and quieter**. Reversing them leads with a money ask straight after a $500 payment.

- [ ] **Step 4: Add the skip path and the dashboard card**

A family who skips must be able to return, "via the same state-driven card treatment the pledge uses, surfaced on the family dashboard" (spec §4.3). The persistent `AdultClassGate` remains the fallback for families who skip and then navigate elsewhere.

- [ ] **Step 5: Run and commit**

---

## Task 10: Close the `$101` door on Bala Vihar families

`app/api/setu/enrollments/route.ts:52-62` calls the **same** `enrollFamily` with `enrolledVia: 'family-initiated'`, which before Task 2 always wrote `suggestedAmountOverride: null`. So a Bala Vihar family enrolling in the adult class through the ordinary `/family/enroll/adult-study-class` surface is billed **$101** and has **all** adults auto-enrolled - and the gate then never fires, because condition 4 is satisfied by a non-empty `enrolledMids`.

Two doors to one program, and the more discoverable one bills the family the spec says pays nothing. Spec §4.5 row 1 covers "adult class *first*, BV later"; this is the different and more likely case.

- [ ] **Step 1: Write the failing test** - `BV-paid family POSTs /api/setu/enrollments for adult-study-class → override 0`.
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Apply the waiver in the generic route** when `programKey === 'adult-study-class'` and the family qualifies, reusing Task 6's `bvPaid` predicate. (Alternative: hide the program from the generic enroll surface. The waiver is better - it keeps one rule in one place.)
- [ ] **Step 4: Run and commit**

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

- [ ] **Step 1: Write the failing tests** with a **2-enrollment** fixture (N=2 rule), covering BV+ASC, ASC-only-after-BV-cancelled, and ASC-only-never-BV.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Decide and implement.** Recommended: `expected === 0 && activeCount > 0 && paid >= 0` classifies as `paid` - the family owes nothing and has paid nothing, which is settled, not unknown. Apply consistently across `deriveFamilyPayment`, `deriveFamilyRosterSignals` and `buildRosterCsvRows`.
- [ ] **Step 4: Run and commit**

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

**Known risk.** Twelve tasks, three of which (2, 3, 10) change `enrollFamily` - the single function behind every enrollment path in the portal, including the rollover and the backfill. Task 2's "byte-identical for existing callers" test is the load-bearing guard; if it needs editing, stop.
