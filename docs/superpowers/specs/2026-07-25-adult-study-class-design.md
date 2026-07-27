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

## 2. RESOLVED: enforced as a persistent prompt, never as a block

**Decision (CMT Developer, 2026-07-25):**

> Enforced, but do **not** block Bala Vihar enrollment - BV enrollment is already complete once the donation is paid. **After** the BV donation, the family must choose one adult. If they don't, **keep prompting them like the profile-completion logic** until they select an adult. The rule does not apply to teachers: if both parents teach, they are not required to attend, because they are busy in Bala Vihar classes.

This is the best of both readings. Nothing gates a child's place in class - by the time the prompt appears, enrollment and payment are already done. But the requirement is real and persistent rather than a one-time ask a family can dismiss forever.

**Mechanically this is a fourth gate**, alongside the existing `ProfileCompletionGate` and `DisclaimerGate` in `app/family/layout.tsx`. That is a well-trodden pattern here - and one with specific, expensive failure modes this repo has already paid for (§5).

### 2.1 Gate condition

The gate fires when **all** of these hold:

1. The viewer is a **family manager** (matching how the family-address gate is manager-scoped, `layout.tsx:55`).
2. The family has an **active Bala Vihar enrollment**, selected by `programKey` via `selectBalaViharEnrollment` - never "the first active enrollment" (§5.2).
3. That Bala Vihar donation is **paid**.
4. The family has **no active Adult Study Class enrollment for the current term** carrying **at least one** adult in `enrolledMids`.
5. At least one adult in the family is **eligible to attend** (§4.4).

> Condition 4 is deliberately "an enrollment with at least one selected adult", not merely "an enrollment exists". An enrollment whose selected adult was later removed from the family (§4.5) leaves `enrolledMids` empty - that family still needs to choose someone, so the gate must fire again rather than treat the empty enrollment as satisfied.

### 2.2 Why "teachers are busy" reframes the exception cleanly

The stated reason is **availability** - a teacher is running a class while the adult class meets. That is a better rule than "if both parents are teachers", and it generalizes correctly:

> **Selectable adults = adults who are NOT teacher-assigned.**
> - Both adults teach → selectable set is empty → **the gate never fires.** (Vaibhav's stated case, handled without a special case.)
> - One teaches, one does not → the non-teacher is selectable and must be chosen. Correct: the teacher is unavailable, the other parent is not.
> - Single adult who teaches → empty set → gate does not fire. Handles the single-parent edge that a literal "both parents" rule could not.
> - Grandparent or other non-teaching adult → selectable, like any other adult.

This dissolves three of the four policy edges that were open in §4.4, using one rule derived from the reason Vaibhav gave rather than from the letter of it.

### 2.3 The complete scenario matrix

Confirmed with CMT Developer 2026-07-25. **"All adults" always means all *non-teaching* adults** - a teacher-assigned adult is never *selectable*, because they are running a class at that hour.

> **REVISED 2026-07-27 (CMT Developer), presentation only.** A teaching adult is now **shown on the screen, greyed out, with a "Teaching this hour" label and a disabled checkbox** - not omitted. The original rule hid them entirely, and a real two-adult family (one a teacher) reported seeing a single name and reading it as their family record being wrong. **The selection rule is unchanged**: a teaching adult still cannot be picked, the write route still rejects their mid with `mid-not-selectable`, and an all-teaching household still yields an empty selectable set so the gate never fires. `selectableAdults()` remains the sole authority on who may be chosen; `teachingAdults()` is a display-only companion, and the two PARTITION the family's eligible adults - disjoint and covering, so nobody appears twice and nobody silently vanishes.

| # | Family | Children in BV | Adults | Gate fires? | Adult-class cost |
|---|---|---|---|---|---|
| 1 | Typical BV family | Yes | 2, neither teaches | **Yes** - select 1 or both | **$0** |
| 2 | BV family, one parent teaches | Yes | 1 teacher, 1 not | **Yes** - only the non-teacher is selectable; the teacher is shown greyed + labelled (rev. 2026-07-27) | **$0** |
| 3 | BV family, both parents teach | Yes | 2 teachers | **No** - selectable set empty | n/a |
| 4 | Single parent, teaches | Yes | 1 teacher | **No** - selectable set empty | n/a |
| 5 | Single parent, does not teach | Yes | 1 non-teacher | **Yes** - preselected, one tap | **$0** |
| 6 | Adults only, wants the class | No | any non-teacher | **No** - no BV enrollment. May enroll voluntarily | **$101** (configurable) |
| 7 | **Adults only, both teachers** | **No** | **2 teachers** | **No** | n/a |

**Row 7 is the case CMT Developer raised explicitly**, and it is worth noting that it fails the gate **twice over**:
- **Condition 2** - they have no active Bala Vihar enrollment, so the gate never reaches the adult check.
- **Condition 5** - even if they did, every adult is teacher-assigned, so the selectable set is empty.

Both must be tested independently. If only one is asserted, a later change to the other could silently start prompting a teacher couple with no children to enroll in a class they are teaching through - the exact outcome this row exists to prevent.

> Rows 3, 4 and 7 all resolve through the same mechanism (empty selectable set), which is why §2.2's rule is preferable to a literal "if both parents are teachers" check - that phrasing would have handled row 3 and quietly missed rows 4 and 7.

**Availability vs. obligation.** None of this removes the Adult Study Class from the programs a family *can* enroll in. Rows 3, 4 and 7 simply are never *required* to. A teacher who genuinely wants to attend can still enroll through the normal program surface.

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

### The fee rule, stated canonically (confirmed 2026-07-25)

> **A family that has paid its Bala Vihar donation pays nothing for the Adult Study Class - for as many adults as they choose to send.**
> **A family with no children, attending only the Adult Study Class, pays the configurable donation (default `$101`).**

There is no middle case and no per-person component. The fee is a property of the *family's* situation, not a headcount.

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

**The UI: multi-select, minimum one** (CMT Developer, 2026-07-25).

The family's adults are listed. **At least one must be selected, but the family may select as many as they like - including every adult - all at no cost.** One adult → preselected, one tap to confirm.

Because the exemption lives on the **enrollment** (`suggestedAmountOverride: 0`), not per member, the cost is `$0` regardless of how many adults are in `enrolledMids`. Selecting three adults costs exactly what selecting one costs. **No per-person arithmetic exists or should be added.**

**Screen copy must explain the why** (Vaibhav to supply exact wording, O7). The substance: *one parent needs to be present during Bala Vihar classes.* That single sentence is what makes the requirement feel reasonable rather than arbitrary - a family reading "you must pick an adult" with no explanation will read it as bureaucracy, and it is the difference between a gate people complete and a gate people resent.

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
3. `sync-enrollment-members.ts` **skips recomputation** for `'manual'` enrollments. It still prunes members who no longer **exist** - it just never *adds*.

   > **CORRECTED 2026-07-26 (was: "no longer exist *or are no longer eligible*").** Pruning a manual list by eligibility is wrong, because `memberEligibleForProgram` is **clock-dependent** (age bounds): an eligibility-filtered manual list could empty **itself** on a birthday, with no user action, re-firing the gate and asking the family to re-choose for no reason. Existence is the only safe filter. A member who merely became ineligible staying enrolled is the far milder failure, and it is visible and fixable. Implemented and tested this way in `4d483bb`; the code carries the same note.

> Without step 3 this feature appears to work, passes tests, and then quietly breaks the first time a family edits any member. Exactly the class of bug the repo's N=2 rule exists to catch - so the E2E must edit an unrelated member and re-assert the selection (§6.3).

### 4.4 The both-parents-teachers exception

**Rule:** if every adult in the family is an assigned teacher, no adult is auto-enrolled.

**Detection** - the only correct predicate:
```ts
isTeacherAssigned(mid)   // teacher/assignments.ts:30-33
```
It reads `teacherAssignments/{ref}.levelIds` and requires **non-empty** `levelIds`.

> **Do not use the `teachers` collection.** Per `teacher.ts:3-5`, a sevak who is also a parent has **no `teachers/` doc** - the capability attaches to their member `mid` via `teacherAssignments`. Since every "parent who teaches" is exactly that case, a `teachers/`-based lookup would find nobody and the rule would never fire.

**The rule (§2.2): selectable adults are adults who are NOT teacher-assigned.** An empty selectable set means the gate never fires. Expressed once, this handles the both-teachers case, the single-teaching-parent case, and the one-teaches-one-doesn't case without branching on any of them.

```ts
const adults = members.filter(m => m.type === 'Adult');
const teacherFlags = await Promise.all(adults.map(m => isTeacherAssigned(m.mid)));
const selectable = adults.filter((_, i) => !teacherFlags[i]);
// selectable.length === 0  →  gate does not fire
```

**Two edges that remain, and how they are handled:**

1. **"Parent" is not modelled.** Only `type === 'Adult'` is durable. `FamilyDocSchema.managers` means *account manager*, not parent, and `FAMILY_RELATION_OPTIONS` (`family.ts:4-6`) is **not stored on the member doc**. So a live-in grandparent is selectable. **Accepted** - the requirement is that *an adult from the family* attends, and a grandparent attending satisfies that intent.
2. **Pending co-manager invites.** `member.ts:39` `inviteStatus: 'pending'` - an adult who has not yet accepted their invite. **Excluded from selectable**, since they may never join the family, and an unaccepted invitee cannot meaningfully agree to attend a class.

**One accepted imprecision:** a teacher between assignments has empty `levelIds` and so reads as a non-teacher (`assignments.ts:30-33`), making them selectable. This resolves itself the moment they are assigned to a level, and erring toward "asked unnecessarily" is far cheaper than erring toward "silently exempted".

### 4.5 Lifecycle edge cases

| Situation | Behaviour |
|---|---|
| Family enrols in Adult class **first**, Bala Vihar later | Adult class keeps `override: null` ($101 already expected). BV adds $500. Total $601. **No retroactive refund** - flag if wrong (O3) |
| Family exempt via BV, then **cancels** BV | Override stays `0` - they keep the free class for the term. Recommended: the exemption was earned at enroll time and is not clawed back mid-term |
| Selected parent is **removed** from the family | `sync-enrollment-members.ts` prunes them; enrollment survives with an empty `enrolledMids`. Should surface as a prompt to reselect (O5) |
| Family wants to **change** which parent attends | Not in v1. Re-enrolment or staff edit. Adding a change flow is a small follow-up |

---

## 4.6 Implementing the gate - four rules this repo already paid for

Gates in this codebase have failed in specific, expensive ways. Each rule below exists because something broke.

**R1 - The selection screen MUST be a top-level route, outside `/family`.**
Put it at `/adult-class`, a sibling of `/complete-profile` and `/acknowledgements`. Those two are top-level for exactly this reason, recorded in `layout.tsx:25-32`: a gated screen nested *inside* the gated layout inherits the gate, which then needs an exemption, which then loops under soft navigation. **Never `redirect()` from a layout keyed on a header pathname.** Redirect to a route the gate does not cover.

**R2 - Leave the screen with a HARD navigation, never `router.push`.**
Use `window.location.assign('/family')` after the selection saves. A soft push back into a `redirect()` gate re-reads a stale `use cache` value, bounces to the same route, and React *preserves component state* - which is how `/complete-profile` once stranded users on "Saving…" forever. A full load re-runs the gate server-side against fresh data.

**R3 - Do not make a client decision from a read you just invalidated.**
After enrolling the adult, trust the write. `revalidateTag` is background and stale-tolerant, so re-reading to decide "is the gate satisfied now?" can return the pre-write answer and bounce the family straight back.

**R4 - Order the gates, and defer explicitly.**
`ProfileCompletionGate` → `DisclaimerGate` → **`AdultClassGate`**. The new gate must return early while either earlier gate would fire, exactly as `DisclaimerGate` already guards on profile completeness (`layout.tsx:76`). Otherwise Suspense resolution order decides which screen a family lands on, and an incomplete profile could be asked to pick an adult first.

### 4.6.1 Term scoping

Condition 4 in §2.1 is **"no active enrollment for the current term"**, not "no enrollment ever". Adult Study Class offerings are per-term, so a family who selected an adult last year must be asked again this year. Checking for any historical enrollment would silently exempt every returning family after the first year.

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
4. **N=2, both directions**: a family with **two adults** and two children.
   - Select **one** adult → assert the other is not in `enrolledMids`.
   - Select **both** → assert both are enrolled **and the cost is still `$0`**. This is the test that catches anyone who "helpfully" adds per-person pricing.
   A one-adult fixture passes trivially and proves nothing.
5. **Roster payment isn't corrupted** (B3): a fully-paid BV family that adds an exempt Adult class enrollment must still read **paid**, not `outstanding`.
6. **Teacher rule - one test per row of the §2.3 matrix.** Rows 3, 4 and 7 must each assert the gate does **not** fire; rows 1, 2 and 5 must assert it **does**, with only non-teaching adults offered.
   - **Row 7 needs two separate assertions**, since it fails the gate twice over: once because the family has no Bala Vihar enrollment, and once because every adult is teacher-assigned. Test each in isolation - a fixture that happens to satisfy both proves neither, and a later change to one condition would silently start prompting a teacher couple to enroll in a class they are teaching.
   - Row 2 must assert the teacher adult is **shown, labelled "Teaching this hour", and genuinely unpickable** (a `disabled` checkbox, not merely grey styling) - and that exactly one adult remains selectable. *Revised 2026-07-27; this previously required the teacher be absent from the screen.* Count selectable adults with `input[type=checkbox]:not([disabled])`, or the greyed row silently inflates every count.
7. **Index audit**: this spec adds no new query shape. `enrollments (programKey, status)` already exists. Confirm before shipping.

---

## 7. Open items

| # | Item | Owner |
|---|---|---|
| ~~O1~~ | RESOLVED 2026-07-25 - **enforced as a persistent post-donation prompt, never a block** (§2). Implemented as a fourth gate after profile-completion and disclaimers. | done |
| ~~O2~~ | RESOLVED 2026-07-25 - **selectable adults are non-teacher-assigned adults; an empty set means the gate never fires** (§2.2, §4.4). Derived from Vaibhav's stated reason (teachers are busy in BV classes), which handles the both-teachers, single-teacher, and mixed cases with one rule. | done |
| **O7** | Gate copy for `/adult-class` - must carry the note that **one parent needs to be present during Bala Vihar classes** (§4.3), plus the "select as many adults as you like, at no cost" framing. Vaibhav's wording. | Vaibhav |
| ~~O8~~ | RESOLVED 2026-07-25 - **"all adults" means all non-teaching adults.** A teacher-assigned adult is never offered in the selection. Confirmed alongside scenario row 7 (§2.3): a childless family whose adults are all teachers is never shown the mandatory enrollment. | done |
| **O3** | Adult-class-first then Bala Vihar: retroactive exemption or not (§4.5)? | CMT Developer |
| **O4** | Does Adult Study Class need attendance tracking (`attendanceMode`) and levels? Assumed **no** for v1 - it is a donation + enrollment record only. | Vaibhav |
| **O5** | UX when the selected parent is removed from the family (§4.5). | CMT Developer |
| **O6** | Confirm $101 and whether it varies by location or term. | Vaibhav |
