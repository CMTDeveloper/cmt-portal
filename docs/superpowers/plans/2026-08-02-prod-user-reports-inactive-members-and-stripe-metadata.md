# Production user reports (2026-08-02): inactive members, Child→Adult, Stripe metadata, SMS

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Unblock families who cannot finish `/complete-profile` because the portal
has no way to say "this person no longer participates", and correct the Stripe
metadata to the integration doc.

**Reported by:** real families on production, relayed by Vaibhav 2026-08-02.

**Architecture:** One new member field (`participation`) threaded through the ONE
helper that already decides who blocks whom, plus a `type` change on the member
PATCH route. No new packages, no new collections, no new indexes.

---

## Global constraints

- Production is LIVE on `chinmaya-setu-715b8` with 568 real families. The
  "UAT only" directive is in force: **no writes to prod** in Phases 1-3.
- `exactOptionalPropertyTypes` is on - never assign `undefined` to an optional.
- **Never add a required field (or `.min(1)`) to a read-validated doc schema** -
  2033 migrated member docs predate every new field. Enforce at write routes.
- Every new `/api/setu/*` path needs an explicit `canAccessRoute` rule.
- Any `/api/setu/**` request/response change needs a `MOBILE_API_CHANGELOG.md` entry.
- `develop` → E2E on preview → `main`. Never `--no-verify`.

---

## What was verified before writing this (evidence)

| Claim | Evidence |
|---|---|
| SMS is off in production | `NEXT_PUBLIC_FEATURE_SMS_OTP` is **absent** from the prod env list |
| Turning it on would NOT fix it | Live `debug-sns-config.ts`: `IN SANDBOX`, 1 verified number, `MonthlySpendLimit=1`, `Origination numbers: NONE` |
| No inactive concept exists | `MemberDocSchema` has `portalAccess` + `inviteStatus` only |
| ~~Child→Adult is impossible~~ | 🔴 **WRONG - retracted.** `patchMemberSchema` **already** has `type: z.enum(['Adult','Child']).optional()` (`write-member.ts:99`) and `/family/members/[mid]/edit` already exposes both. I read the schema from line 100 and reported the absence of something on line 99. Child→Adult **ships today**, with all the downstream consequences in "Pre-existing" below. |
| Children require grade+birth month | `REQUIRED_CHILD = ['schoolGrade','birthMonthYear']` |
| The gate has ONE chokepoint | ✅ confirmed by review: `profileGatePending()` and the form both route through `membersRequiringCompletion()`; the disclaimer/adult-class gates defer to it. **But see Task 1.0** - the chokepoint is fed by a mapper that would drop the new field. |
| ~~The legacy "graduated" signal was discarded~~ | 🔴 **WRONG - retracted.** `legacyLevel` **is** consumed: `backfill-bv-enrollments.ts:168` selects current children with exactly `c.legacyLevel != null`, and `normalize-legacy-grades.ts:70` reads it. My grep was scoped to `apps/portal/src` and never looked in `apps/portal/scripts`. The signal is live and already load-bearing - which is *good* news for Task 4.1: there is precedent for the exact rule. |
| Scale, measured in PROD (not the roster) | see the corrected table below |

### 🔴 Correction (2026-08-02): the roster-derived "129 blocked families" was WRONG

An earlier draft said 226 departed children / 129 hard-blocked families. Those came
from the **legacy roster snapshot**, i.e. the source data - not from what is
actually in production. Measured directly against prod `715b8`:

| | Roster (what I first counted) | **Production (what is true)** |
|---|---|---|
| child rows / child members | 1061 | **857** |
| departed (level NULL) | 226 | **21** |
| families released by deactivating them | "129" | **0** |

Why the gap: only 857 of 1061 roster children were migrated. The ~299 dormant
families were deliberately skipped at cutover and migrate **lazily on first
sign-in** - so most departed children are *not in prod yet*. They arrive, as
active children, the moment those families sign in.

**What actually blocks families today (prod, all 570 families):**

```
families failing the completion gate : 564 of 570
released by deactivating departed kids: 0
missing-field tally across blocking members:
  foodAllergies       2018      phone          306
  volunteeringSkills  1168      email          216
  birthMonthYear       850      gender         178
                                schoolGrade     40
```

So the gate is not mainly blocked by graduated children - it is blocked because
`foodAllergies`, `volunteeringSkills` and `birthMonthYear` **do not exist in the
legacy roster at all**, so every migrated family must supply them once. That is
the owner spec (2026-06-22) working as designed, not a defect.

⚠️ The 564 is an **upper bound**: this probe scoped to all non-pending members,
whereas `membersRequiringCompletion()` excludes *other* managers. The dominant
signal (foodAllergies on 2018 of 2033 members) is unaffected by that scoping.

**What this changes about the plan:** the inactive feature is still needed and
still correct - it is exactly what Sadeesh asked for, and issue #5 - but it is a
*friction* fix, not the thing standing between 129 families and the portal. The
higher-value half of it is **Task 4.1: stop lazy migration importing departed
children as active**, which prevents ~205 more arriving.

---

## Phase 1 - Unblock the families (issues #1, #3, #5)

Issues 1, 3 and 5 are one root cause: **a family cannot say a member no longer
participates**, so every migrated child ever on the roster since 2012 is an
active Child the gate demands a grade for.

### Task 1.1 - `participation` on the member doc

**Files:** `packages/shared-domain/src/setu/schemas/member.ts`,
`packages/shared-domain/src/setu/__tests__/schemas.test.ts`

- [ ] Add to `MemberDocSchema`, **optional, absent ⇒ active**:
```ts
  // Whether this person still takes part in family activities. Absent ⇒ active:
  // every one of the 2033 migrated docs predates this field, so it can never be
  // required on READ. Enforced at the write route instead.
  // NOT the same as portalAccess (can they sign in) or inviteStatus (have they
  // accepted) - a co-manager can be portalAccess:'active' and participation:
  // 'inactive' the year they stop attending.
  participation: z.enum(['active', 'inactive']).optional(),
  inactiveAt: z.date().nullable().optional(),
```
- [ ] Test: a doc with no `participation` parses and is treated as active.
- [ ] Run, commit.

### Task 1.0 - 🔴 FIRST: the projections, or every later task is inert

> Codex finding 19. `getFamilyByFid` does **not** parse member docs with the zod
> schema - it hand-maps field by field (`get-family-by-fid.ts:52-74`). A field
> added to `MemberDocSchema` and honoured in `membersRequiringCompletion()` would
> still arrive at the gate as `undefined`, and the whole of Phase 1 would silently
> do nothing. This is the same shape as the 2026-08-01 lesson: the schema is not
> the pipe.

- [ ] Add `participation`, `inactiveAt` and `graduatedAt` to the `getFamilyByFid`
      mapper.
- [ ] Then find **every other hand-written member projection** and decide for each:
      `get-child-profile.ts:131`, `dashboard/route.ts:70`,
      `load-dashboard.ts:87`, `get-family-for-welcome.ts:57`,
      `roster.ts:16` (the shared CSV row contract), `report-dataset.ts:54`.
- [ ] Write a test that fails if a mapper drops the field - e.g. round-trip a doc
      with `participation:'inactive'` through each projection.

### Task 1.2 - Exclude inactive members from the completion gate

**Files:** `packages/shared-domain/src/setu/member-required-fields.ts` + its tests

- [ ] In `membersRequiringCompletion()`, extend the existing filter:
```ts
  const active = members.filter(
    (m) => m.inviteStatus !== 'pending' && m.participation !== 'inactive',
  );
```
- [ ] Widen the generic `T` to carry `participation?: string | null | undefined`.
- [ ] Tests: an inactive child with NO grade does not block; an inactive member is
      still returned by `incompleteMembers()` (that helper is about data, not gating).
- [ ] **Mutation-check:** revert the filter, confirm the new test fails.

### Task 1.3 - Enumerate EVERY consumer, decide per surface

> Codex's 2026-08-01 lesson: *a shared helper does not find its own callers*.
> Task 1.2 fixes the gate. It does NOT fix anything that reads members directly.

The review did this enumeration. My proposed `rg` pattern would have **missed most
of it** (finding 1) because it omits direct `collection('members')` reads. The real
list, and the critical split:

**🔴 WRITE paths - these accept a client-supplied mid, so hiding a UI list is NOT
enough. Each must REJECT an inactive member server-side:**

- [ ] `enroll-family.ts:223` - derived enrollment includes every eligible type;
      supplied/manual mids are never rejected (finding 2)
- [ ] `sync-enrollment-members.ts:127` - reconciliation never prunes inactive
- [ ] `teacher/guests.ts:60` `markGuest` - accepts a mid, **auto-enrols the family
      and writes attendance** with no participation check (finding 3)
- [ ] `check-in/setu/check-in/route.ts:63` + `mark-door-attendance.ts:67` - the
      POST takes client mids; door attendance skips Adults but not inactive
      Children (finding 4)
- [ ] `seva/signups/route.ts:21` - validates only the mid *prefix*, so seva credit
      can be written against an inactive or even nonexistent member (finding 7)
- [ ] `adult-class/selectable-adults.ts:26` - inactive adults stay enrollable
      (finding 6)

**READ paths - hide:**

- [ ] enroll page child list; `prasad/load-engine-input.ts:70` (confirmed as the
      sole source for youngest-child/birth-month - finding 11); `teacher/grade-eligible.ts:103`
      and `teacher/welcome-read.ts:42` (registered-not-enrolled + unassigned queues);
      `rollover/plan-family-promotion.ts:39` (finding 10 - today it can advance or
      graduate someone who left)

**READ paths - show, but labelled (history is the point):**

- [ ] `/family/members`, `/family/members/[mid]`, welcome detail
      (`get-family-for-welcome.ts:57`), roster CSV (`roster.ts:16`),
      `report-dataset.ts:54` - none of these currently carry a status field at all
      (finding 9), so the "Inactive" label cannot be rendered until Task 1.0 lands
- [ ] mobile projections (`dashboard/route.ts:70`, `get-child-profile.ts:131`) -
      mobile cannot label what it is not sent, and its family counts currently
      count inactive people as active children/adults (finding 8)

**Correctly NOT filtered (verified, finding 12) - do not "fix" these:**
enrollment + attendance reports, `bv-unpaid.ts`, `select-bv-enrollment.ts`. They
read enrollment snapshots, attendance events and family-level pledge state, which
*should* preserve history and financial obligation regardless of participation.

**⚠️ Out of reach entirely:** the legacy check-in teacher roster is RTDB-only
(`classlist.ts:94`) and cannot see Setu participation; its Setu bridge maps by
`legacySid` and can auto-enrol and mark an inactive child (finding 5). Decide
explicitly whether to filter at the bridge or accept it until kiosk cutover.

- [ ] One test per surface with an N=2 fixture (one active, one inactive).

### Task 1.4 - PATCH accepts `participation` and `type`

**Files:** `apps/portal/src/features/setu/members/write-member.ts`,
`apps/portal/src/app/api/setu/members/route.ts` + tests

- [ ] Add `participation: z.enum(['active','inactive']).optional()` and
      `type: z.enum(['Adult','Child']).optional()` to the `.strict()` PATCH schema.
- [ ] Stamp `inactiveAt` server-side on the active→inactive transition; clear it
      (to `null`, never `undefined`) on reactivate.
- [ ] Guards, each with its own error code and its own test:
  - `self-deactivate` - a manager may not deactivate themselves (they would be
    locked out of the family they administer).
  - `last-manager` - reuse the existing last-manager guard.
  - `enrolled-cannot-deactivate` - refuse (409) while the member holds an
    enrollment with `status:'active'` in the current school year. **Fail closed:**
    a deactivated-but-enrolled child would vanish from the parent's view while
    still sitting on a teacher's roster and in attendance. Tell the family to
    cancel the enrollment first.
  - `manager-must-be-adult` - refuse Adult→Child while `manager === true`.
- [ ] Reactivation is always allowed (this is a disable, not a delete).
- [ ] Changing Child→Adult makes `REQUIRED_ADULT` apply; that is intended - the
      completion form will then ask for email/phone/skills.

### Task 1.5 - The UI

**Files:** `complete-profile-form.tsx`, `/family/members/[mid]`, `/family/members`

- [ ] On `/complete-profile`, each **Child** row offers two actions (owner's
      wording, 2026-08-02 - there is no third "still enrolling" option; a child who
      has finished BV is either an adult or no longer participating):
  - **"Now an adult"** → `type: 'Adult'`
  - **"No longer participating"** → `participation: 'inactive'`
- [ ] Each **Adult** row offers "No longer participating" (Sadeesh's spouse case).
- [ ] `/family/members` shows an "Inactive" badge and a **Reactivate** action.
- [ ] Copy must not say "removed" or "deleted" anywhere - the record is kept.
- [ ] a11y: these are destructive-ish actions; use a real `<button>`, confirm
      inline (**never** `window.confirm` - it blocks the automation harness).

### Task 1.6 - Record `graduatedAt` going forward

**Files:** `apps/portal/src/features/setu/rollover/promote-families.ts`

- [ ] When the rollover graduates a child, stamp `graduatedAt` on the member.
      Today the rollover *counts* graduates (`acc.graduated++`) and writes nothing,
      which is why a grade-12 graduate is indistinguishable from a current grade-12
      student and why this prompt cannot be auto-targeted.
- [ ] Do **not** auto-deactivate on graduation - a graduate may become an adult
      member. The prompt asks; the system does not guess.

---

## Phase 2 - Stripe metadata (issue #4)

Source of truth: **`Stripe Integration Doc.docx`** (owner-supplied 2026-08-02).

| | Doc | We send today (verified in code) |
|---|---|---|
| `/checkout-link` | `campaign: "BalaViharDonation"`, `source: "setu"` | `campaign: 'setu'`, `category: 'enrollment'`, `fid`, `familyId` - no `source` |
| `/pad/setup-link` | `campaign: "BalaViharPledge"`, `source: "setu"` | `fid`, `familyId`, `pid` - **no campaign, no source** |

⚠️ `category` is `'enrollment' | 'general'` (`DONATION_TYPES`, `schemas/donation.ts:3`),
NOT `'bala-vihar'`. The slice-3c spec says `'bala-vihar'` and is stale; the code is
the truth.

`campaign` currently carries the value that belongs in `source`, and the pledge
path sends no campaign at all - so monthly PAD gifts are invisible to any
reporting keyed on campaign.

### Task 2.1 - One helper, both paths

**Files:** new `packages/shared-domain/src/setu/payment-metadata.ts`,
`donations/checkout/route.ts`, `pledges/start-pledge.ts`

- [ ] `buildPaymentMetadata({ kind: 'donation'|'pledge', donationType?, fid, publicFid, pid? })`
      returning `campaign` + `source: 'setu'` + the existing `fid` / `familyId`
      (and `pid` for pledges).
- [ ] `campaign`: `BalaViharDonation` | `BalaViharPledge` per the doc — **but it
      must be program-aware, not a constant.** 🔴 Codex finding 28: the checkout
      deliberately derives program identity from the enrollment's offering, with
      the comment *"the ACTUAL program (Bala Vihar, Tabla, …), not a hardcode"*
      (`checkout/route.ts:151`). Labelling every enrollment donation
      `BalaViharDonation` would misfile every **Tabla** gift. The helper takes
      `programKey` and derives the campaign from it; only `bala-vihar` yields
      `BalaViharDonation`. Confirm the naming for other programs with the owner
      (`TablaDonation`?) - a wrong campaign string is silent.
- [ ] **RESOLVED 2026-08-02 (owner):** there are no general donations in the app,
      so no `GeneralDonation` campaign is needed. Confirmed in code: `/family/donate`
      **redirects to `/family`** whenever `mode === 'general'` (`donate/page.tsx:82`,
      CMT decision 2026-06-04), and no client anywhere POSTs `type: 'general'`.
- [ ] ⚠️ **But the branch is dead, not gone.** `DONATION_TYPES` still contains
      `'general'`, the checkout body still accepts `z.literal('general')`, and
      `checkoutLineItemName('general')` is still reachable at `route.ts:201`. So an
      authenticated manager hand-POSTing `type:'general'` would still mint a real
      Stripe checkout - now with a campaign nobody defined.
      **Decide with the owner before coding:** either (a) map it to
      `GeneralDonation` defensively, or (b) refuse `type:'general'` at the route
      since the UI already redirects.
      ⚠️ (b) is a **breaking API change** - the mobile app hand-mirrors these
      shapes. Check `chinmaya-setu-mobile` for a general-donation screen first and
      add a `MOBILE_API_CHANGELOG.md` entry either way.
- [ ] Keep `fid` + `familyId` (added 2026-07-31 at Vaibhav's request) - metadata is
      `[k: string]: string`, extra keys are allowed, and removing data someone may
      already be reporting on is the riskier move.
- [ ] Decide on `category`: not in the doc, currently sent. Keep (harmless, useful)
      and note it as a deliberate superset.
- [ ] Assert on the **provider payload**, not on a mocked call - the 2026-08-01
      review caught exactly this: a route-level assertion proved a value reached a
      mock, not Stripe.
- [ ] `MOBILE_API_CHANGELOG.md` entry (metadata is observable to the mobile app's
      donation flows).

### Task 2.2 - `client_reference_id` - investigate, do not blindly match

- [ ] The doc's samples use `"FID-477"`. We send `did` / `pid`, which is what
      `finalize`/reconciliation looks the record up by. **Changing it to the FID
      would break reconciliation and is NOT part of this fix.** Confirm with the
      payment service owner whether they key on it; record the answer here.

---

## Phase 3 - SMS one-time codes (issue #2, Melissa)

**This is not a code change and not a flag flip.** Verified live 2026-08-02:

```
Sandbox status : ⚠️  IN SANDBOX      (delivers ONLY to verified numbers)
Verified       : +14379712609        (one number)
MonthlySpendLimit = 1                ($1)
Origination numbers: NONE registered.
```

Setting `NEXT_PUBLIC_FEATURE_SMS_OTP=true` today would make the UI offer SMS and
AWS would accept, bill, and silently drop every code - **worse** than the current
honest refusal, which is why the flag is off and `sns.ts` refuses non-`+1`.

- [ ] AWS console/support, in order: (1) request production SMS access (exit the
      sandbox); (2) register an origination number that can deliver to Canadian
      carriers (toll-free registration is not instant - allow days to weeks);
      (3) raise `MonthlySpendLimit` above $1.
- [ ] Only then set `NEXT_PUBLIC_FEATURE_SMS_OTP=true` on Production and redeploy.
- [ ] Verify by **sending a real code to a real unverified phone** and having a
      human read it - `MessageId` returned is not delivery
      ([[feedback_aws_sns_region_origination]]).
- [ ] Until then: no code change. Melissa's experience (email works, SMS not
      offered) is the intended interim behaviour.

---

## Phase 4 - Stop importing departed children (the "during migration" half of issue #1)

This is the higher-value half, and it is **preventive**: ~205 departed children are
still sitting in the ~299 dormant families that migrate lazily on first sign-in.
Without this they each arrive as an active child demanding a grade.

The legacy roster already knows: `level === NULL` ⇒ graduated/left. The parser
reads it into `legacyLevel` (`legacy-parser.ts:262`) and **nothing has ever
consumed it** - it is parsed and dropped.

### Task 4.1 - lazy migration marks departed children inactive at import

**Files:** `features/setu/registration/lazy-migrate.ts` + tests

- [ ] When creating a child member, set `participation: 'inactive'` +
      `inactiveAt` + `inactiveSource: 'legacy-migration'` iff `legacyLevel === null`.
- [ ] Persist `legacyLevel` on the member doc so the decision is auditable and a
      future fix does not have to re-derive it from a snapshot.
- [ ] Test with an N=2 family: one child with a level, one without. The one
      WITHOUT must not block the gate; the one WITH must still be required.
- [ ] ⚠️ This is a **behaviour change to the migration path that every dormant
      family will hit exactly once**, and it is not reversible per-family without
      the UI. Deploy behind the same review as Phase 1.

### Task 4.2 - OPTIONAL, needs explicit owner approval: backfill the 21 already in prod

Only **21** departed children are in prod today, and **0** families are blocked
solely by them - so this is cleanup, not a rescue. Phase 1 gives those families a
UI to do it themselves.

- [ ] `scripts/backfill-inactive-legacy-children.ts`: join `members.legacySid` →
      roster row, and where `level` is NULL set the same three fields as 4.1.
- [ ] Feasibility is proven: **856 of 857** prod child members carry a
      `legacySid`, and **856/856 matched** a roster row (0 unmatched).
- [ ] `--dry-run` + `--csv-out` first; refuse prod without `--allow-prod`;
      per-member reversible from the UI.
- [ ] Risk: a child who IS returning this year gets marked inactive and the family
      must flip them back.

### Interaction with the 2026-07-31 grade advance - checked, no conflict

- Different fields: the advance wrote `schoolGrade` + `gradeSchoolYear`; this
  writes `participation` + `inactiveAt`. No collision.
- The join key is `legacySid`, which the advance never touched.
- The advance's idempotency guard is `gradeSchoolYear`; this never writes it, so
  re-running the advance stays a no-op.
- It **did** advance 5 already-departed children (they were stamped
  `gradeSchoolYear: '2026-27'`) - harmless, but it means "has a 2026-27 grade" is
  NOT a signal of active enrollment. Do not use it as one.
- [ ] Small follow-up: have the advance skip `participation:'inactive'` members so
      it stops promoting people who left.

---

---

## 🔴 Pre-existing: Child→Adult already ships, and it is already broken

Child→Adult is **not** a new capability (retraction above) - it is live at
`/family/members/[mid]/edit` today. Which means these are **bugs in production
right now**, not risks my plan introduces. They need their own decision, separate
from the five reports:

- **`sync-enrollment-members.ts:30`** - every type change triggers reconciliation,
  which drops the converted child from `enrolledMids` and therefore from the
  teacher roster, with no guard (finding 21).
- **🔴 `sync-enrollment-members.ts:41` + `pledges/start/route.ts:64`** -
  reconciliation deliberately leaves an active enrollment with **empty**
  `enrolledMids`, and pledge authorisation only checks that an active Bala Vihar
  enrollment exists. So converting the only child can leave a family able to
  authorise a **recurring bank mandate with no child enrolled** - the exact class
  of bug task #58 was written to close (finding 23).
- `enrollment-report.ts:83` - program totals use pruned `enrolledMids` while level
  totals keep counting stale `levelSnapshots` keys, so the report disagrees with
  itself after any conversion (finding 24).
- `members/[mid]/page.tsx:61,140` - attendance and the Bala Vihar journey render
  only while `type === 'Child'`, so conversion **hides the child's own history**
  from the family (finding 25).
- `schoolGrade` / birth data are not cleared on conversion and still render
  (finding 26). (Not a child-list leak - kiosk/prasad/attendance all gate on
  current `type`, finding 27.)

**Recommendation:** file these as their own task and fix the pledge one (#23)
first - it is the only one that can move money.

Also from the review, to fold into Phase 1's guards:

- [ ] `last-manager-guard.ts:8` counts the manager *array*, so two co-managers can
      deactivate each other in sequence and leave the family with no participating
      manager (finding 13). The guard must count *participating* managers.
- [ ] The manager-must-be-adult guard is too narrow: it must also refuse setting
      `manager:true` on an existing Child, which the shared mutation permits today
      (finding 14).
- [ ] Drop the "self-deactivation causes lockout" rationale - it is false.
      `build-session-claims.ts:39` derives access from `portalAccess`/`manager`
      and ignores participation, so an inactive manager still gets in (finding 16).
      Keep the guard if desired, but justify it as intent, not lockout.
- [ ] The active-enrollment guard needs care: stale children may *already* be
      auto-enrolled, and the "cancel first" recovery cancels **every sibling** and
      loses `levelSnapshots` on re-enrolment (finding 15).
- [ ] Perform the enrollment / other-manager reads **inside** the existing
      transaction in `write-member.ts:478`, or the guards are not atomic
      (finding 18).
- [ ] Add `graduatedAt` to Task 1.1's schema change - Task 1.6 writes it but 1.1
      never declared it, so it would be silently dropped by every reader
      (finding 33).
- [ ] The plan named the wrong route: `api/setu/members/route.ts` is POST-only.
      PATCH lives at `members/[mid]/route.ts:16` **and** at the staff route
      `welcome/families/[fid]/members/[mid]/route.ts:26` - both delegate to the
      shared mutation and both need guard coverage (finding 35).
- [ ] Mobile changelog: **Phase 1 needs it** (member response shape, new PATCH
      fields, new error codes). **Phase 2 does not** - provider-only metadata
      changes neither the request nor the `{url,did}` response (finding 37).
- [ ] Corrected rationale for keeping `did`/`pid` as `client_reference_id`: the
      claim that reconciliation depends on it was **false**. Reconciliation uses
      the return-flow `pid`, Firestore doc ids and stored session ids
      (`finalize-pledge.ts:29`, `reconcile-pledges.ts:76`). Keeping them is still
      right - just not for the reason given (finding 30).

Confirmed safe, no action (do not "fix"): optional schema evolution cannot cause a
strict-read rejection (`MemberDocSchema` is non-strict, finding 31); no new
Firestore index is needed because every consumer fetches whole subcollections or
exact doc refs and can filter in memory (finding 32); donation/pledge history is
preserved because those docs snapshot `fid`/`donorMid`/`startedByMid` (finding 17).

---

## Verification (all phases)

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] Mutation-check every new guard: revert it, confirm exactly the intended test fails.
- [ ] Deployed-UAT E2E for the unblock, with a realistic fixture: a family with
      **two** children, one graduated, plus a non-participating spouse - i.e. the
      shape that actually blocked Sadeesh.
- [ ] Walk `/complete-profile` in a browser as that family and confirm the gate
      releases. Tests are not a walkthrough.
- [ ] Codex review of the whole change set before merge.
