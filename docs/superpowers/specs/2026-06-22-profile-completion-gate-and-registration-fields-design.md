# Profile-completion gate + full member-field capture — Design

**Date:** 2026-06-22
**Status:** Approved (owner sign-off 2026-06-22), ready to plan + build.
Resolves GitHub **#15** (gender Male/Female) and **#16.1/#16.2** (split type/gender, adults need
email+phone). **Out of scope:** #16.3 postal address (not in the member-fields screenshot; ties to
the still-open issue #6 family-vs-per-member address) and #16.4 donation copy.

## Context

The owner's "Members" data-model screenshot defines a per-type required matrix. Two deliverables:
**(A)** a post-sign-in **profile-completion gate** (block the dashboard until the family's required
member info is complete), and **(B)** capturing all of it at **first-time registration** (finishing
the previously-parked register-new "step 2").

### Pivotal facts (code-backed)
- **Every field already exists** on `MemberDocSchema` (`packages/shared-domain/src/setu/schemas/member.ts`):
  `firstName, lastName, gender (enum Male|Female|PreferNotToSay), type (Adult|Child), foodAllergies
  (nullable string), email, phone, volunteeringSkills (array), schoolGrade (nullable string),
  birthMonthYear ('YYYY-MM' string), birthMonth (1-12, derived)`. Nothing structural to add.
- The fields are merely **optional at the write routes**. Required-ness is enforced **at the write
  routes + forms**, NOT the read-validated doc schema (the `.min()` trap — would break ~800 migrated
  docs). The exact pattern already ships for adult `volunteeringSkills`
  (`members/route.ts:75-77` → `400 skills-required`, using `effectiveType = body.type ?? existing.type`).
- **Gender** `PreferNotToSay` is used 3 ways: (i) a pickable option in capture forms (DROP it),
  (ii) a default/seed value (CHANGE to a no-selection placeholder), (iii) an internal sentinel
  written without asking on 3 paths — legacy migration, co-manager invite-accept, teacher visitor
  quick-add (KEEP as sentinel; the gate corrects later). The **read-doc enum keeps PreferNotToSay**.
- **The gate hook** is `apps/portal/src/app/family/layout.tsx` — the server shell over all `/family/*`
  that already calls `getCurrentFamily()`. Add a redirect to a new `/family/complete-profile` when
  incomplete. (Verify the redirect against cacheComponents streaming + the known local-dev `/family`
  hang by testing on deployed UAT.)
- **Registration step-2 is unfinished**: the form captures only name/type/gender/email/phone;
  `register-family.ts` hardcodes `volunteeringSkills:[]`/`foodAllergies:null` and never writes
  `birthMonth`.

## The required matrix

| Field | All | Adult-only required | Child-only required |
|---|---|---|---|
| firstName, lastName, **gender (Male\|Female)**, type, **foodAllergies** | ✅ required | | |
| email, phone, volunteeringSkills (≥1) | | ✅ required (optional for child) | |
| schoolGrade, **birthMonthYear** | | | ✅ required (optional for adult) |

Auto fields (mid, manager bool, joinedAt) unchanged.

## Owner decisions

1. **Gate: HARD block, WHOLE family.** Redirect to `/family/complete-profile` before the dashboard.
   A **manager** must complete the whole family (children included — they don't sign in); a plain
   **family-member** completes their own record (they can only self-edit per `canAccessRoute`).
2. **Applies to EVERYONE NOW** — all families, including the ~800 already-migrated ones, hit the gate
   on next sign-in until complete. (No phased flag.)
3. **Adults: email AND phone required**, but an adult may **reuse the manager's/primary's contact** —
   accepted as satisfying the requirement; same-family contact reuse must NOT trip the duplicate
   rejection, while the cross-FAMILY contactKey theft check stays.
4. **`PreferNotToSay` kept as the internal sentinel** on the 3 non-asking paths only.
5. **foodAllergies** gets an explicit **"No known allergies"** choice (so "required" doesn't force junk).
6. **birthMonthYear** canonical (`'YYYY-MM'`) + derive `birthMonth` (1-12) on every write.

## Design

### A. Single source of truth — `@cmt/shared-domain`
New pure module (e.g. `setu/member-required-fields.ts`): `requiredFieldsForType(type)`,
`memberFieldMissing(member, field)`, `whatsMissingForMember(member) → string[]`,
`isMemberComplete(member)`, `incompleteMembers(members) → {mid, missing[]}[]`. Rules: all →
firstName, lastName, gender ∈ {Male,Female} (PreferNotToSay counts as MISSING), type, foodAllergies
(null/empty = missing; the "No known allergies" sentinel = present); adults → email, phone,
volunteeringSkills.length≥1; children → schoolGrade, birthMonthYear. Consumed by the forms (client
markers), all write routes, the register route, AND the gate — one rule set. Tests with a 2-member
(N=2) fixture.

### B. Write routes — per-type required validation
`members/route.ts` (POST) + `members/[mid]/route.ts` (PATCH): narrow gender to `['Male','Female']`;
add `superRefine`/guards using the shared helper + the `effectiveType` rule — `400` with a clear
error code when a required field is missing (`foodAllergies-required`, `contact-required` for adult
email/phone, `grade-required`, `birthmonth-required`; reuse `skills-required`). Derive `birthMonth`
from `birthMonthYear` on write. **MemberDocSchema read enum unchanged.** Mobile changelog entry.

### C. Registration — finish step 2 (B)
`register/family/page.tsx`: capture foodAllergies (all, with "None"), gender Male|Female required (no
default), and per-type — adult: email/phone (manager's already from query params; reuse allowed) +
volunteeringSkills (`VolunteeringSkillsPicker`); child: schoolGrade + birthMonth/year. `register/route.ts`:
widen the schema (add birthMonth, volunteeringSkills; tighten gender) + the same per-type 400 guards
before `registerFamily`. `register-family.ts`: persist the new fields + derive birthMonth + converge
with the canonical `/api/setu/members` write (stop hardcoding `[]`/null). Mobile changelog entry.

### D. The gate (A) + completion screen
`family/layout.tsx`: after `getCurrentFamily()`, compute incompleteness (manager → whole family;
member → own record). If incomplete and the path isn't the completion route, `redirect('/family/complete-profile')`.
New `app/family/complete-profile/page.tsx` (+ `error.tsx`): renders **only the missing fields per
member**, PATCHes `/api/setu/members/{mid}`, returns to `/family` when complete. Replace the soft
`family/page.tsx:127` nudge. Desktop + mobile. Verify the layout-redirect against cacheComponents on
deployed UAT.

### E. Member add/edit forms
`members/new/page.tsx` + `[mid]/edit/page.tsx`: drop `PreferNotToSay`; move foodAllergies OUT of the
Child-only block (required for all + "None"); add per-type required markers + client validation
(adult email/phone/skills; child grade/birth); unify the birth-month input (the two forms diverge
today — converge on the month-dropdown that also yields birthMonth). Keep `PreferNotToSay` only at
the 3 sentinel-minting sites (lazy-migrate, invite-accept, teacher quick-add).

### F. Seeds & fixtures (the ripple)
`seed-test-accounts.ts`, `seed-e2e-family.ts`, `seed-join-request-family.ts`, and the e2e fixtures all
write `gender:'PreferNotToSay'` + null allergies → they'd fail the new gate and break the existing E2E
suite. Update them to **gate-complete** members (Male/Female gender, foodAllergies, adult skills,
child grade+birthMonthYear) so the personas pass the gate.

### G. Mobile contract
`/register` + `/api/setu/members` POST/PATCH change required fields + error codes + tighten the gender
enum + verify-code/dashboard unaffected. Append a dated SHA-keyed `MOBILE_API_CHANGELOG.md` entry.

## Testing
- Unit: the shared rules helper (N=2 family); the write-route per-type 400s; the registration per-type
  guards; the gate incompleteness predicate.
- **Playwright E2E** vs deployed UAT: a freshly-seeded incomplete family → sign in → redirected to
  `/family/complete-profile` → fill missing fields → land on the dashboard; a complete family → straight
  to the dashboard; registration captures the full set. Seeds updated so existing specs still pass.

## Rollout
Everyone hard-gated (no flag). Solo-dev main-only, UAT-only. Mobile changelog. Update the cutover
runbook (the new required-field contract + the gate). No new Firestore index (pure reads).
