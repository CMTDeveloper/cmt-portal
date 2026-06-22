# Profile-completion gate + member-field capture — Implementation Plan

> Execute task-by-task; separate review pass after. TDD. Spec:
> `docs/superpowers/specs/2026-06-22-profile-completion-gate-and-registration-fields-design.md`.

**Goal:** enforce the per-type required member matrix at every write + a hard post-sign-in
profile-completion gate (whole family), and finish registration step-2 to capture it all.

**Execution shape:** Task 1 **foundation** (shared rules helper, sequential) → Tasks 2–6 **parallel**
(disjoint file-sets, all import the helper) → Task 7 integrate/gate/review → Task 8 E2E + seeds.
`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` ON; required-ness at WRITE routes only
(never tighten the read-validated `MemberDocSchema`); role helpers not string equality.

---

## Task 1 — Foundation: the shared required-fields rules helper (sequential, FIRST)

**Files:** create `packages/shared-domain/src/setu/member-required-fields.ts` + export from the setu
index; tests.
- `REQUIRED_ALL = ['firstName','lastName','gender','type','foodAllergies']`,
  `REQUIRED_ADULT = ['email','phone','volunteeringSkills']`,
  `REQUIRED_CHILD = ['schoolGrade','birthMonthYear']`.
- `memberFieldComplete(member, field)`: gender complete iff `=== 'Male' || 'Female'` (PreferNotToSay →
  incomplete); foodAllergies complete iff a non-empty string OR the `NO_ALLERGIES` sentinel
  (define `export const NO_ALLERGIES = 'None'`); volunteeringSkills complete iff length ≥ 1; others
  complete iff non-null/non-empty.
- `whatsMissingForMember(member): string[]` using `effectiveType = member.type` + the matrix.
- `isMemberComplete(member): boolean`; `incompleteMembers(members): {mid, missing: string[]}[]`.
- Pure (no React/Next/DOM — shared-domain discipline). Type the member param to the relevant subset.
- **Tests (same commit):** an N=2 family (1 adult missing phone+gender, 1 child missing grade) →
  correct per-member missing lists; a complete adult + complete child → empty; PreferNotToSay → gender
  missing; foodAllergies `'None'` → complete.

---

## Task 2 — Write routes: per-type required validation (parallel; members POST + PATCH)

**Files:** `apps/portal/src/app/api/setu/members/route.ts`, `.../members/[mid]/route.ts`, their tests;
+ `apps/portal/docs/MOBILE_API_CHANGELOG.md` (stub finalized in Task 8).
- Narrow gender in `addMemberSchema` + `patchSchema` to `z.enum(['Male','Female'])`.
- Add per-type guards (reuse the `effectiveType = body.type ?? existing.type` pattern at
  `[mid]/route.ts:105`) using the Task-1 helper: missing foodAllergies (all) → `400 foodAllergies-required`;
  adult missing email/phone → `400 contact-required`; child missing schoolGrade → `400 grade-required`;
  child missing birthMonthYear → `400 birthmonth-required`; keep the existing `skills-required`.
- Derive + write `birthMonth` (1-12) from `birthMonthYear` on both routes (POST already accepts it;
  ensure PATCH/POST persist a derived value when birthMonthYear changes).
- PATCH enforces a rule only when the patch would leave the field missing for the effective type
  (don't 400 a partial patch that doesn't touch a still-satisfied field).
- **Do NOT** tighten `MemberDocSchema`. Tests: each 400 path + the happy path + the PreferNotToSay
  rejection at write.

---

## Task 3 — Registration: finish step 2 (parallel; register page + route + register-family)

**Files:** `apps/portal/src/app/register/family/page.tsx`, `apps/portal/src/app/api/setu/register/route.ts`,
`apps/portal/src/features/setu/registration/register-family.ts`, tests.
- Form: drop `PreferNotToSay` (no default — require a pick); add foodAllergies (all, with the "No known
  allergies" affordance); per-type — adult: require email/phone (manager's come from query params,
  reuse allowed) + `VolunteeringSkillsPicker` (≥1); child: schoolGrade + birth month/year. Extend the
  member-draft state + the manager block (manager is an Adult → needs skills + allergies). Client-side
  block submit until the matrix is satisfied.
- Route: widen `additionalMemberSchema` + the manager object (add birthMonth, volunteeringSkills,
  foodAllergies; gender `['Male','Female']`); add the same per-type 400 guards (Task-1 helper) BEFORE
  `registerFamily`; **same-as-manager contact reuse must pass** (don't reject an adult who shares the
  manager's email/phone within the family).
- `register-family.ts`: persist foodAllergies/volunteeringSkills/schoolGrade/birthMonthYear + derive
  birthMonth; stop hardcoding `[]`/null; converge with the `/api/setu/members` doc write.
- Mobile changelog entry. Tests: a complete adult+child registration; per-type rejections; same-as-
  manager contact accepted.

---

## Task 4 — The gate + completion screen (parallel; family layout + new route)

**Files:** `apps/portal/src/app/family/layout.tsx`, new `apps/portal/src/app/family/complete-profile/page.tsx`
(+ `error.tsx`), `apps/portal/src/app/family/page.tsx` (remove the soft `needsProfile` nudge), tests.
- Layout: after `getCurrentFamily()`, compute incompleteness via the Task-1 helper — **manager →
  whole family** (`incompleteMembers(members)`); **plain member → own record only** (`isMemberComplete(currentMember)`).
  If incomplete AND the current path ≠ `/family/complete-profile`, `redirect('/family/complete-profile')`.
  Read the path via `headers()` (or a route-segment exemption) to avoid an infinite loop. Verify the
  redirect-in-layout works with cacheComponents (test on deployed UAT; the layout already awaits
  `getCurrentFamily`).
- `complete-profile/page.tsx`: server-load the family, render **only the missing fields per member**
  (reuse the member-fields UI from Task 5 where possible via a shared client component), PATCH
  `/api/setu/members/{mid}` per member, redirect to `/family` when `incompleteMembers` is empty.
  Desktop + mobile. `canAccessRoute` already covers `/family/*`.
- Tests: layout redirects an incomplete family + exempts the completion route + lets a complete family
  through; the completion form patches + clears.

---

## Task 5 — Member add/edit forms + gender sentinel sites (parallel)

**Files:** `apps/portal/src/app/family/members/new/page.tsx`, `.../[mid]/edit/page.tsx`; the gender
sentinel sites `features/setu/registration/lazy-migrate.ts`, `app/api/setu/invite/accept/route.ts`,
`features/setu/teacher/pending-family.ts` (KEEP PreferNotToSay — verify, no change needed unless they
offer it to a human); read-only display fallback in `members/[mid]/page.tsx`; tests.
- Drop `PreferNotToSay` from both capture forms' selects/pills + their Gender type aliases.
- Move foodAllergies OUT of the Child-only block → required for ALL (with the "No known allergies"
  affordance); add per-type required markers + client validation (adult email/phone/skills; child
  grade/birth); unify the birth-month input across add/edit (month dropdown → also yields birthMonth).
- Read-only detail: keep mapping a legacy `PreferNotToSay` to a display label (don't crash on it).
- Desktop + mobile branches. Tests: gender has only 2 options; foodAllergies shown for adults; per-type
  required blocks submit.

---

## Task 6 — Seeds & fixtures so existing E2E passes the gate (parallel)

**Files:** `apps/portal/scripts/seed-test-accounts.ts`, `scripts/seed-e2e-family.ts`,
`scripts/seed-join-request-family.ts`, `src/__tests__/e2e/helpers/fixtures.ts`.
- Replace `gender:'PreferNotToSay'` → `'Male'`/`'Female'`; add `foodAllergies` (a value or the "None"
  sentinel), adult `volunteeringSkills` (≥1), child `schoolGrade` + `birthMonthYear`, so every seeded
  persona/fixture is **gate-complete** and the existing specs aren't redirected to the completion screen.
- Idempotent (same as today). No behavior change beyond completeness.

---

## Task 7 — Integration (controller): gate + full suite + review + commit

- Run `pnpm typecheck` + the FULL `pnpm test` (incl. the separate integration dirs). Fix cross-task
  seams (the shared helper's exact signature; the gender enum narrowing across routes; the gate's
  layout-await). Dispatch a `code-reviewer` (opus) on the diff — focus: the gate can't infinite-loop
  or lock out a legitimately-complete family; required-ness only at write (read-doc untouched);
  same-as-manager contact reuse; cacheComponents/layout-redirect. Commit in logical chunks; push (gate).

---

## Task 8 — E2E + UAT walkthrough + finalize

- Playwright spec `e2e/setu/registration/profile-completion.spec.ts`: seed an INCOMPLETE family →
  sign in → assert redirect to `/family/complete-profile` → fill the missing fields → land on `/family`;
  a complete family → straight to the dashboard; the registration form captures the full set. Run vs
  deployed UAT; mock-free walkthrough of the layout redirect (catches the cacheComponents/dev-hang
  class of bug). Update the seeds (Task 6) so all existing specs stay green.
- Finalize the MOBILE_API_CHANGELOG SHAs; update the cutover runbook (new required-field contract + gate).

## Self-review checklist
- read-validated `MemberDocSchema` NOT tightened (gender keeps PreferNotToSay; nothing gains `.min`). ✓
- one rule set (shared helper) drives forms + write routes + register + gate. ✓
- gate: manager→whole family, member→own; completion route exempt (no loop). ✓
- adult same-as-manager contact reuse passes; cross-family theft check intact. ✓
- seeds/fixtures gate-complete so existing E2E passes. ✓
- mobile changelog entry; no new Firestore index. ✓
