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

- [ ] **Step 5: Add `membershipMode` to `EnrollmentDocSchema` too**

Spec §4.3b step 1 asks for it and no earlier draft did it. `EnrollmentDocSchema` (`enrollment.ts:13-35`) has no such field, and it is the type `get-enrollments.ts:15` casts raw docs to - the shape `GET /api/setu/enrollments` returns raw (`enrollments/route.ts:26`). Without it, Task 12's mobile-changelog entry documents a field the schema does not declare, and any future `.parse()` strips it silently.

```ts
membershipMode: z.enum(['auto', 'manual']).optional(),
```

**Bare `.optional()`, no `.default()`.** The repo has two recorded burns here: a `.default()` on a write schema erases the field for partial writers, and doc schemas validate on read so required-ness belongs at the write routes.

- [ ] **Step 6: `MOBILE_API_CHANGELOG.md` entry.** This is a `@cmt/shared-domain` schema change consumed by `/api/setu/enrollments`, so CLAUDE.md requires one.
- [ ] **Step 7: Run and commit**

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

- [ ] **Step 5: Implement conditions 1, 2, 4, 5, and define "current term" concretely**

Spec §4.6.1 says condition 4 is "no active enrollment **for the current term**" and never says what identifies a term. `getOpenOfferingsForFamily` returns `OfferingDoc[]` and deliberately **merges two result sets** - located (`get-open-offerings.ts:96`) and location-less (`:90`), deduped at `:99-103` - so it can return more than one open adult-class offering the moment an admin creates a location-less one alongside a per-centre one.

With two open offerings and no definition, a family enrolled in offering A is still un-enrolled for offering B: the gate never clears and they are locked out of `/family` - the exact failure condition 0 exists to prevent.

**Definition: `openOfferings[0]` (earliest `startDate`, which is the returned sort order) is *the* current offering.** Condition 4 is "no active enrollment whose `oid === current.oid`", and **the `/adult-class` screen enrolls into that same `oid`**. Add a test with two open offerings.

Select Bala Vihar via `selectBalaViharEnrollment`, never "the first active enrollment".

- [ ] **Step 6: Give the predicate a real signature, and budget the reads**

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

- [ ] **Step 7: Run and commit**

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

- [ ] **Step 6: Build `POST /api/setu/adult-class` - the handler the Save button calls**

An earlier draft granted this path in `canAccessRoute` and wrote it into the mobile changelog **without any task creating it**. Executed literally that ships a selection screen whose Save does nothing, and Task 8 then redirects every paid Bala Vihar manager to it - a permanent lockout, the exact failure Task 3 exists to prevent.

The handler: manager-only in-handler check; `fid` from the **session**, never the body; body is `{ mids: string[] }` with `.strict()`; validates every mid is in `selectableAdults`; calls `enrollFamily` with `enrolledMids: mids`, `suggestedAmountOverride: bvPaid ? 0 : null`, `membershipMode: 'manual'`, and the current offering's `oid` from Step 5's definition.

- [ ] **Step 7: Add the `canAccessRoute` rules** for `/adult-class` and `/api/setu/adult-class` (any Setu family; the handler binds `fid` from the session). The `/api/setu/` catch-all is manager-only, so a member-reachable path needs its own clause.
- [ ] **Step 8: Run and commit**

---

## Task 8: `AdultClassGate`, flag-gated and ordered

- [ ] **Step 1: Add `flags.setuAdultClass`, default off**

In `lib/flags.ts` and `turbo.json`'s `env` array. **v1 added the gate unconditionally**, which violates discipline 5 and removes the kill switch three days before launch - on a gate that redirects. `DisclaimerGate` is the precedent: `layout.tsx:68` opens with `if (!flags.setuDisclaimers) return null;`.

- [ ] **Step 2: Write the failing tests** - fires for a gated family; returns `null` when the flag is off; returns `null` while either earlier gate would fire.
- [ ] **Step 3: Implement, deferring to the earlier gates explicitly**

v1 said "guarding on both earlier gates exactly as `DisclaimerGate` guards on profile completeness (`layout.tsx:76`)". That is not the same shape. `:76` is a pure in-memory check (`incompleteMembers` + `isFamilyAddressComplete`). A **fourth** gate must additionally defer to the **disclaimer** gate, which needs `getDisclaimerStateForFamily(portalFirestore(), data.family)` (`:78`) - an extra Firestore read on every `/family/*` render - and must respect the `flags.setuDisclaimers` short-circuit: when disclaimers are OFF, `DisclaimerGate` never fires and the deferral must not block.

Extract a shared `earlierGatesPending(data)` that both gates call, rather than copying `:76`.

**And say which scope it takes, because the two differ today and unifying them is a live behaviour change.** `:76` uses `incompleteMembers(data.members)` (all members); `ProfileCompletionGate` uses `membersRequiringCompletion(...)` (`:52`), which filters `inviteStatus !== 'pending'` (`member-required-fields.ts:155`).

So a family with a **pending co-manager invite** whose invitee record is incomplete currently sees *neither* gate: `ProfileCompletionGate` does not redirect (narrow scope), and `DisclaimerGate` returns null (wide scope). They never accept disclaimers.

**Unify on the narrow scope** - it is the correct one - and record that this also closes an existing hole where a pending co-manager suppressed the disclaimer gate. Those families will start being redirected to `/acknowledgements` for the first time. Add a test for it. Do not let it land as an unexplained side effect nine days before launch.

- [ ] **Step 4: Do NOT exempt a path from inside the layout. Move the success page out instead.**

An earlier draft of this step said "exempt `/family/donate/success`". **That is the pattern this repo has already had an outage from, and it contradicts R1 in this plan's own Global Constraints.** The gates are server components rendered from `app/family/layout.tsx`; a component has no pathname, so the only way to give it one is a header - and `layout.tsx:23-32` records what happened last time:

> "When the completion screen was nested at /family/complete-profile it inherited THIS gate, which then had to exempt itself via the current request pathname - and under a soft client-side navigation that header is stale (it read '/family' while the layout re-rendered for the completion route), so the gate redirected to itself forever: a blank page with flickering chrome."

There is also no such header to read: `middleware.ts:106-135` sets `x-portal-{role,uid,family-id,fid,mid,extra-roles,email,phone}` and nothing else. No `x-pathname`, no `x-invoke-path` anywhere in the repo.

**Instead, move `/family/donate/success` to a top-level `/donate/success`, outside the gated layout** - the same reason `/complete-profile`, `/acknowledgements` and `/adult-class` are top-level. It already renders its own full-screen `CspRoot` (`donate/success/page.tsx:30`) and uses none of the layout chrome, so the move is nearly free.

This is what makes the owner's requirement work: **the gate stays persistent, and the Bala Vihar donation flow is never blocked by it.** P5's pledge card moves with the page; update P5 v2 Task 9's path reference in the same commit.

**Files:** move `app/family/donate/success/` → `app/donate/success/`; add `app/donate/success/error.tsx`; add the `canAccessRoute` clause and the `isSetuRoute` entry for `/donate`; update every link to it (`grep -rn "donate/success"`).
- [ ] **Step 5: Run and commit**

---

## Task 9: The ask on the donation success page, with a skip path

**v1 implemented a hard redirect gate only, and spec §4.3 asks for something else.** The consequences are concrete: `app/family/donate/success/page.tsx` is **inside** the `/family` layout, so once the BV donation reads paid, v1's gate redirects away from it - and P5's monthly-pledge card, which is added to that exact file, **would never render for a gated family**. Spec §4.3's own "the order matters, adult-class first, pledge second" becomes unimplementable.

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Render the ask on `/family/donate/success`, above the pledge ask**

Adult-class selection **first** - quick, free, part of completing enrollment. The pledge ask **second and quieter**. Reversing them leads with a money ask straight after a $500 payment.

- [ ] **Step 4: "Skip" means "not now", and the gate is what brings them back. No dashboard card.**

An earlier draft asked for both a skip path *and* a dashboard card *and* a persistent gate. **Those cannot coexist.** Nothing but an active enrollment carrying an adult clears spec §2.1 condition 4, and skipping writes nothing - so the moment a skipper navigates to `/family`, the gate fires and redirects them to `/adult-class`. The dashboard card could never render, and Skip would return the user to the same screen.

The owner's requirement was "keep popping them like profile completion logic", so **the gate is the persistence mechanism**:

- On `/donate/success`, Skip simply continues to `/family`.
- The next `/family` visit hits the gate and lands them on `/adult-class`, where they complete it.
- **No `adultClassPromptDismissedAt`, no sixth condition, no dashboard card.** Do not build a dismissal - it would defeat the requirement.

If the product actually wants a real dismissal, that is a different feature: it needs persistence (the repo's precedent is `volunteeringSkillsNudgeDismissedAt`, `member.ts:30`) and a sixth condition in `needsAdultClassSelection`. Decide before building, not after.

- [ ] **Step 5: Run and commit**

---

## Task 10: Close the `$101` door on Bala Vihar families

`app/api/setu/enrollments/route.ts:52-62` calls the **same** `enrollFamily` with `enrolledVia: 'family-initiated'`, which before Task 2 always wrote `suggestedAmountOverride: null`. So a Bala Vihar family enrolling in the adult class through the ordinary `/family/enroll/adult-study-class` surface is billed **$101** and has **all** adults auto-enrolled - and the gate then never fires, because condition 4 is satisfied by a non-empty `enrolledMids`.

Two doors to one program, and the more discoverable one bills the family the spec says pays nothing. Spec §4.5 row 1 covers "adult class *first*, BV later"; this is the different and more likely case.

- [ ] **Step 1: Write the failing test** - `BV-paid family POSTs /api/setu/enrollments for adult-study-class → override 0`.
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Close BOTH halves of the door, not just the fee**

The waiver alone leaves the other half open. `enroll-family.ts:124-131` still derives `enrolledMids` from `memberEligibleForProgram`, which for `memberType: 'adult'` matches **every** Adult - including teacher-assigned adults (violating spec §4.4 and matrix rows 2-4) and `inviteStatus: 'pending'` invitees. `membershipMode` stays `'auto'`, so the next member edit re-adds everyone. And because `enrolledMids` is non-empty, **condition 4 is satisfied and the gate never fires** - the family never sees the selection screen at all.

So the generic route must pass all three:

```ts
enrolledMids: selectableAdults(members, teacherAssignedMids).map((m) => m.mid),
suggestedAmountOverride: bvPaid ? 0 : null,
membershipMode: 'manual',
```

Assert that a teacher-assigned adult is **not** in `enrolledMids` after a generic-surface enroll.

- [ ] **Step 3b: Apply the waiver on CREATE only**

Task 3's reconcile fires whenever `suggestedAmountOverride` is explicitly supplied. Combined with this step that silently implements the retroactive exemption Deviation 1 says is **not** being implemented: a childless family enrolls in adult class at `$101` and pays; later they add a child, enroll in Bala Vihar, and pay; they re-POST the adult-class oid; `bvPaid` is now true, the route supplies `0`, the reconcile fires, and **the $101 they already paid is rewritten to an expected of `0`.**

Gate it: apply the waiver only when `created === true`, or only when the stored override is `null`. Test: "an adult-class enrollment that already carries a non-null override is not rewritten by a later BV-paid re-POST."

- [ ] **Step 3c: Decide the BV-enrolled-but-unpaid case**

`bvPaid` is evaluated once at enroll time and never recomputed. A family that enrolls in Bala Vihar, then enrolls in adult class **before** paying, gets `override: null` → `$101`. Paying afterwards never waives it (by design), and the gate never fires because condition 4 is satisfied. They sit at `$601` expected with no in-product recourse.

Either block the generic adult-class enroll while Bala Vihar is unpaid, or write `override: 0` on any Bala Vihar **enrollment** rather than payment and accept the wider waiver. Either is defensible; silence is not.

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
- [ ] **Step 3: Decide and implement, across all FOUR callers**

Recommended: `expected === 0 && activeCount > 0` classifies as `paid` - the family owes nothing and has paid nothing, which is settled, not unknown.

The classifier is shared, so changing it changes every consumer. There are **four**, not three:

1. `roster/payment.ts:25` (`deriveFamilyPayment`)
2. `roster/family-engagement.ts:50` (`deriveFamilyRosterSignals`)
3. `roster/build-csv-rows.ts:118` (`buildRosterCsvRows`)
4. **`roster/report-dataset.ts:183`** (`buildRosterReportDataset`), consumed by `api/welcome/roster/report/route.ts:27`

**And this is a visible product change, not only a correction.** `roster-browser.tsx:250` defaults the payment filter to `'paid'`. Every family whose only active enrollments have empty `pricingTiers` - free and teacher-managed offerings, where `resolveSuggestedAmount` returns 0 (`offering.ts:101`) - starts appearing in the **default** `/welcome/roster` view labelled **Paid**. Today they are filtered out as `unknown`. Confirm that is wanted before shipping it.

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

## Review history

Reviewed once after the first draft (`docs/superpowers/reviews/2026-07-25-review-p4v2.md`): 2 critical, 15 major, 8 minor. What changed most:

1. **The success-page exemption was the exact pattern this repo had an outage from - and this plan's own R1 forbids it.** Gates are server components with no pathname; the only way to give them one is a header that does not exist (`middleware.ts:106-135` sets eight `x-portal-*` headers and nothing else), and `layout.tsx:23-32` records the last time a gate exempted itself by pathname: "under a soft client-side navigation that header is stale ... so the gate redirected to itself forever." Resolved by **moving the success page to a top-level `/donate/success`** instead - which is also what keeps the donation flow unblocked.
2. **Skip, the dashboard card, and a persistent gate could not all be true.** Nothing but an active enrollment clears condition 4, so a skipper is redirected on their next `/family` visit and the card can never render. The gate *is* the persistence; the card and any dismissal state are gone.
3. **The "proof obligation" pointed at two callers that do not exist** (the rollover and the backfill both explicitly avoid `enrollFamily`) and away from the **door kiosk**, which runs every Sunday morning and whose docstring depends on precisely the no-op semantics Task 3 rewrites.
4. **Three helpers in the `bvPaid` definition were invented.** `sumCompletedDonationsForEid` does not exist and the nearest real helper is program-blind, which would have fired the gate on families who never paid Bala Vihar and waived their `$101`.
5. **No task built `POST /api/setu/adult-class`** - the plan granted it in `canAccessRoute` and documented it for mobile. Executed literally, Save does nothing and the gate then locks every paid manager on a screen they cannot complete.

Also corrected: the waiver applied on reconcile as well as create (silently implementing the retroactive exemption Deviation 1 disclaims); the generic route left `enrolledMids` and `membershipMode` untouched, so the gate never fired at all; `membershipMode` was never added to `EnrollmentDocSchema`; `paymentFromAmounts` has four callers, not three, and the change makes free-program families appear as **Paid** in the default roster view; "current term" had no definition and breaks with two open offerings; and `earlierGatesPending` had to pick a scope, which closes an existing hole where a pending co-manager suppressed the disclaimer gate.

**Known risk.** Twelve tasks, four of which (2, 3, 6, 10) change `enrollFamily` or its inputs - the single function behind the door kiosk, first-attendance enrollment, family self-serve and staff enroll. Task 2's "byte-identical for existing callers" test is the load-bearing guard, and `auto-enroll-bala-vihar.test.ts:22` pins the call with an exact-object matcher, so a new parameter fails there rather than where you are looking. If either needs editing, stop.
