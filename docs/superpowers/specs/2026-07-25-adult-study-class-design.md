# Adult Study Class - Design

> **Status:** Draft for review - contains one BLOCKING policy question (§2)
> **Author:** CMT Developer (with AI agent)
> **Date:** 2026-07-25
> **Target:** Monday 2026-08-03
> **Sibling specs:** `2026-07-24-aug-3-launch-batch-design.md`, `2026-07-25-monthly-pledge-pad-design.md`

---

## 1. The requirement

From Vaibhav, 2026-07-25:

> All Bala Vihar families must have at least one parent enrolled in an adult class. "Adult Study Class" becomes a separate program with a suggested donation. Families already enrolled in Bala Vihar are **exempt from the $101 fee** - the fee applies only to families or adults registering **without** Bala Vihar enrollment. For families with multiple adults, provide a **selection tool** to identify which parent joins, triggering automatic enrollment at no extra cost. **Exception:** where both parents are teachers, neither joins. *"We need to finalize the logic for this specific scenario, though it will be the minority of cases."*

---

## 2. BLOCKING question: is "must" enforced or encouraged?

**"All Bala Vihar families must have at least one parent enrolled in an adult class"** has two readings that produce completely different features:

| Reading | What it means | Risk |
|---|---|---|
| **Encouraged** (assumed here) | Adult Study Class is offered and promoted; families are prompted; nothing blocks | Low. Purely additive. |
| **Enforced** | Bala Vihar enrollment is **blocked** until an adult is selected | **High.** Puts a new gate on the single most important flow, during cutover week, for ~867 families. |

**This spec is built to "encouraged."** Enforcement would add a hard gate to Bala Vihar enrollment - the flow that gates a child's place in class - and shipping that in the same week as a production cutover is not a risk worth taking. If enforcement is genuinely required, it should be a **post-launch** slice once the adult program has real enrollments.

> ⚠️ **Confirm with Vaibhav before implementation.** O1.

---

## 3. What already works, and what does not

Verified 2026-07-25 by reading the code. Cited so reviewers can check.

### 3.1 Good news

| Fact | Evidence |
|---|---|
| **`programKey` is a free slug, not an enum.** `'adult-study-class'` needs zero schema changes. | `offering.ts:5` - `z.string().regex(/^[a-z0-9-]+$/)`; comment at `:3-4` says it "replaces the frozen PROGRAM_KEYS enum so new programs need no schema change" |
| **Adult-only programs are already modelled.** | `program.ts:10-19` `memberType: 'child' \| 'adult' \| 'any'`; gate at `program.ts:74-87` (`:80` → `type === 'Adult'`) |
| **The enroll engine is not children-only.** | `enroll-family.ts:120-131` derives `enrolledMids` from `memberEligibleForProgram`, not a hardcoded child check |
| **A $0 enrollment reads "Enrolled" with no donation.** | `enrollment-confirmation.ts:34` - `enrolledVia: 'family-initiated'` self-confirms. Docstring `:17-18`: *"Amount is irrelevant (donations are suggestions, not fees)."* |
| **Programs are admin-creatable in the UI.** | `/admin/programs`, `programs-table.tsx`, `POST /api/admin/programs` |

### 3.2 The three blockers

**B1 - No field can express a per-family waived fee.**
`enrollment.ts:26` (verified directly):
```ts
suggestedAmountOverride: z.number().int().positive().nullable(),
```
`positive()` **excludes 0**. Free-ness today is an *offering-level, all-or-nothing* property (empty `pricingTiers` → `resolveSuggestedAmount` returns 0, `offering.ts:100-101`). There is no waiver, exemption, discount, or scholarship concept anywhere in the codebase.

**B2 - `enrolledMids` self-heals and will silently undo the parent selection.**
`sync-enrollment-members.ts:76-88` recomputes `enrolledMids` from `memberEligibleForProgram` alone on **every member add/edit/delete**. It knows nothing about a chosen parent. A family selects Father, later edits a child's grade, and the enrollment silently becomes both parents.

**B3 - Payment is summed across programs.**
`roster/payment.ts:20-28` `deriveFamilyPayment` sums `effectiveSuggestedAmount` over **all** active enrollments against **all** completed donations. A non-zero Adult Study Class enrollment on a fully-paid Bala Vihar family would flip them to **`outstanding`** on the welcome roster.

---

## 4. Design

### 4.1 The program

Created through the existing admin UI - no seed script, no migration:

```
programs/adult-study-class = {
  programKey: 'adult-study-class',
  label: 'Adult Study Class',
  status: 'active',
  termType: 'term',
  eligibility:  { memberType: 'adult' },
  capabilities: { usesOfferings: true, usesDonation: true,
                  usesLevels: false, usesCalendar: false,
                  attendanceMode: 'none' },   // see O4
}
```

One offering per term/location with `pricingTiers: [{ amountCAD: 101, label: 'Full year' }]`.

> **First adult program in production.** `memberType: 'adult'` is supported and unit-tested but has **never run in production** - every real program to date is `'child'` (`migrate-to-programs.ts:51`). Expect to be the first to exercise that path; the eligibility gate deserves a deliberate test rather than an assumption.

### 4.2 The fee exemption - relax `positive()` to `nonnegative()`

Three options were considered:

| Option | Verdict |
|---|---|
| **(a) Relax `suggestedAmountOverride` to `nonnegative()`**, write `0` at enroll time for Bala Vihar families | **Chosen.** One schema character, composes with everything downstream |
| (b) New dedicated field (e.g. `feeWaived: boolean`) | More explicit, but every `expected`-computing site must learn about it |
| (c) Two parallel offerings, paid and free, routed at enroll time | Two offerings per term for one program; `getOpenOfferings` would surface both to families. Rejected |

**Why (a) is safe** - verified at `get-enrollments.ts:85-87`:
```ts
const effectiveSuggestedAmount =
  e.suggestedAmountOverride ??
  (offering ? resolveSuggestedAmount(offering, e.enrolledAt) : e.suggestedAmountSnapshot);
```
It uses `??` (nullish), **not** `||`. A `0` override therefore resolves to `0` rather than falling through - the exemption works with no change to the resolution logic. With `||` this design would silently fail; it is worth a regression test pinning that.

The arithmetic then works out on its own (B3 dissolves):

| Family | Expected | Behaviour |
|---|---|---|
| Bala Vihar + Adult class | `500 + 0 = 500` | Unchanged. Pays $500, reads **paid** ✅ |
| Adult class only | `101` | Pays $101, reads **paid** ✅ |
| BV, no adult class | `500` | Unchanged ✅ |

> **The exemption is evaluated once, at enroll time, and persisted.** It is not recomputed on read - so a family cannot lose their exemption later because of an unrelated change. §4.5 covers what happens if their Bala Vihar enrollment is subsequently cancelled.

### 4.3 Which parent joins - explicit selection that survives edits

**Placement (CMT Developer, 2026-07-25): ask on the donation success page, immediately after the family completes the Bala Vihar donation.**

That is the right moment for the same reason the pledge ask sits there - the family has just finished paying, their enrollment is complete, and the class is free to them. Asking earlier would add a step to a payment flow that already gates a child's place in class.

**The UI:** the family's adults are listed and they pick who attends. One adult → preselected, one tap to confirm. Selecting triggers enrollment at `$0` (§4.2).

> **The success page now carries two asks, and the order matters.** The adult-class selection comes **first** - it is quick, free, and part of completing enrollment. The monthly-pledge ask (`2026-07-25-monthly-pledge-pad-design.md` §5) comes **second and quieter** - it asks for more money and is entirely optional. Reversing them leads with a money ask straight after a $500 payment.
>
> A family who skips the selection must be able to return to it, via the same state-driven card treatment the pledge uses (that spec §5.1), surfaced on the family dashboard.

### 4.3a Adult-only families (no children)

An adult with no children in Bala Vihar enrolls in Adult Study Class directly and **pays the $101 through the existing Stripe checkout** - no new payment path.

This falls out of §4.2 with no extra code: they have no active Bala Vihar enrollment, so no exemption is written, `effectiveSuggestedAmount` resolves to the offering's tier ($101), and `enroll-cta.tsx:80-107` routes them to Stripe exactly as Bala Vihar does today.

Two things to verify rather than assume, since **no adult-only family exists in production today**:
- **Registration with zero children** must complete - the flow is built around families with kids.
- The enroll surface must **show** an adult program to a childless family. `enroll-family.ts:135-137` throws `no-eligible-members` when nothing matches; for an adult program the adults *are* the eligible members, so it should pass - but its error copy is Bala-Vihar-specific (*"Add a child to your family before enrolling in Bala Vihar"*, `enroll-cta.tsx:68-69`) and would read as nonsense if it ever surfaced here.

### 4.3b The fee amount is admin-configurable

The $101 lives where every other program's amount lives - the offering's `pricingTiers` (`offering.ts:58`), edited through the existing offerings panel on `/admin/programs/[key]`. **No new configuration surface is needed**, and the amount can vary by term or location without a deploy.

**Editable by admin and coordinator** (CMT Developer, 2026-07-25). That requires one addition to the Coordinator grants in the launch-batch spec §3.1: **`/api/admin/offerings` and `/api/admin/offerings/[oid]`**. The page grant alone is not enough - the amount is written through the offerings API, so a coordinator would see the panel and hit a 403 on save.

> Changing the amount later affects **unpaid** families immediately: `get-enrollments.ts:85-87` recomputes `effectiveSuggestedAmount` live from the current offering rather than the enroll-time snapshot. Families who already paid are unaffected. Existing intended behaviour, but worth knowing before someone edits a price mid-term.

**The persistence problem is the real work.** Because of B2, a selection written into `enrolledMids` would be silently overwritten on the next member edit. Fix:

1. Add `membershipMode: 'auto' | 'manual'` to the enrollment schema (optional, defaults `'auto'`, so every existing enrollment is unaffected).
2. Adult Study Class enrollments are written `'manual'` with `enrolledMids` = the selected adults.
3. `sync-enrollment-members.ts:76-88` **skips recomputation** for `'manual'` enrollments. It still prunes members who no longer exist or are no longer eligible - it just never *adds*.

> Without step 3 this feature appears to work, passes tests, and then quietly breaks the first time a family edits any member. Exactly the class of bug the repo's N=2 rule exists to catch - so the E2E must edit an unrelated member and re-assert the selection (§6.3).

### 4.4 The both-parents-teachers exception

**Rule:** if every adult in the family is an assigned teacher, no adult is auto-enrolled.

**Detection** - the only correct predicate:
```ts
isTeacherAssigned(mid)   // teacher/assignments.ts:30-33
```
It reads `teacherAssignments/{ref}.levelIds` and requires **non-empty** `levelIds`.

> **Do not use the `teachers` collection.** Per `teacher.ts:3-5`, a sevak who is also a parent has **no `teachers/` doc** - the capability attaches to their member `mid` via `teacherAssignments`. Since every "parent who teaches" is exactly that case, a `teachers/`-based lookup would find nobody and the rule would never fire.

**Four policy edges the code cannot decide** (this is the part Vaibhav flagged as unfinalized - O2):

1. **"Parent" is not modelled.** Only `type === 'Adult'` is durable. `FamilyDocSchema.managers` means *account manager*, not parent, and `FAMILY_RELATION_OPTIONS` (`family.ts:4-6`) is **not stored on the member doc**. A live-in grandparent counts as an adult today.
2. **Single-adult families.** One adult who teaches - does "both parents are teachers" apply? Literally no; in spirit yes.
3. **Pending co-manager invites.** `member.ts:39` `inviteStatus: 'pending'` - an adult who has not yet accepted. Counted or not?
4. **A teacher with zero levels reads as a non-teacher** (`assignments.ts:30-33`). Someone between assignments would be treated as a regular parent.

**Recommended v1** (smallest defensible rule): *if every `type === 'Adult'` member with a non-pending invite is teacher-assigned, skip auto-enrollment - but still let the family enrol manually if they want to.* Advisory, not a hard block. It is a minority case by Vaibhav's own account, and an advisory rule that is occasionally wrong costs far less than a hard rule that wrongly excludes a family.

### 4.5 Lifecycle edge cases

| Situation | Behaviour |
|---|---|
| Family enrols in Adult class **first**, Bala Vihar later | Adult class keeps `override: null` ($101 already expected). BV adds $500. Total $601. **No retroactive refund** - flag if wrong (O3) |
| Family exempt via BV, then **cancels** BV | Override stays `0` - they keep the free class for the term. Recommended: the exemption was earned at enroll time and is not clawed back mid-term |
| Selected parent is **removed** from the family | `sync-enrollment-members.ts` prunes them; enrollment survives with an empty `enrolledMids`. Should surface as a prompt to reselect (O5) |
| Family wants to **change** which parent attends | Not in v1. Re-enrolment or staff edit. Adding a change flow is a small follow-up |

---

## 5. A confirmed bug found while tracing this (fix in this batch)

`roster-confirmation.ts:77` derives the family id as:
```ts
const fid = d.ref.parent.parent?.id;
if (!fid || !needsReadFids.has(fid)) continue;   // :78
```
But `donations` is a **top-level** collection - `create-donation.ts:28` writes `db.collection('donations').doc()`. For a top-level document, `ref.parent` is the `donations` collection and **`ref.parent.parent` is `null`**. So `fid` is always `undefined` and `:78` skips **every donation**.

**Effect:** on the teacher attendance roster, the completed-donation confirmation signal **never fires**. A `promotion` or `welcome-team` family that paid but has not yet attended shows **"Registered"** to their teacher while showing **"Enrolled"** on both the family dashboard and the welcome roster - the same family, three screens, two answers.

**Fix:** use the defensive pattern the other three readers already use (`enrollment-report.ts:178`, `report-dataset.ts:111`, `build-csv-rows.ts:78`):
```ts
const fid = typeof data.fid === 'string' ? data.fid : d.ref.parent.parent?.id;
```

Unrelated to the Adult Study Class, cheap, and it removes a visible inconsistency on a screen teachers use every Sunday. Worth taking now.

---

## 6. Verification

1. **Deployed-UAT E2E**: create the program, enrol a Bala-Vihar family (assert `effectiveSuggestedAmount === 0`) and a non-BV family (assert `101`).
2. **The `??` regression test**: pin that a `0` override resolves to `0` and does not fall through. If anyone ever "tidies" `??` into `||`, this must fail loudly.
3. **The B2 test - the one most likely to be skipped**: enrol with a manual selection, then **edit an unrelated member**, then re-assert `enrolledMids` is unchanged. This is the failure that unit tests and a single-pass walkthrough both miss.
4. **N=2**: a family with **two adults** and two children. Select one adult; assert the other is not enrolled. A one-adult fixture passes trivially and proves nothing.
5. **Roster payment isn't corrupted** (B3): a fully-paid BV family that adds an exempt Adult class enrollment must still read **paid**, not `outstanding`.
6. **Teacher rule**: a family whose adults are all teacher-assigned is not auto-enrolled; a family with one teacher and one non-teacher **is**.
7. **Index audit**: this spec adds no new query shape. `enrollments (programKey, status)` already exists. Confirm before shipping.

---

## 7. Open items

| # | Item | Owner |
|---|---|---|
| **O1** | **BLOCKING - is "must have a parent enrolled" enforced or encouraged (§2)?** This spec assumes encouraged. Enforcement puts a new gate on Bala Vihar enrollment during cutover week. | Vaibhav / CMT Developer |
| **O2** | Finalize the both-parents-teachers rule (§4.4) - the four policy edges: grandparents, single-adult families, pending invites, zero-level teachers. Vaibhav flagged this as unfinished. | Vaibhav |
| **O3** | Adult-class-first then Bala Vihar: retroactive exemption or not (§4.5)? | CMT Developer |
| **O4** | Does Adult Study Class need attendance tracking (`attendanceMode`) and levels? Assumed **no** for v1 - it is a donation + enrollment record only. | Vaibhav |
| **O5** | UX when the selected parent is removed from the family (§4.5). | CMT Developer |
| **O6** | Confirm $101 and whether it varies by location or term. | Vaibhav |
