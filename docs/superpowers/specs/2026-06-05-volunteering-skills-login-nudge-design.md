# Post-login "set your volunteering skills" nudge — design

**Date:** 2026-06-05
**Status:** Approved (CMT Developer / Vaibhav feedback)
**Builds on:** `2026-06-05-volunteering-skills-picklist-design.md` (the picker + admin list).

## Goal

When a family logs in, prompt the signed-in **adult** member to set their
volunteering skills — inline on the dashboard — if they have none on file yet.

## Decisions (locked)

- **Trigger:** show **only when the signed-in adult member has no skills yet**
  (`volunteeringSkills.length === 0`) and hasn't dismissed it. Stops once they
  add any or dismiss. (Mirrors the existing ContactsNudge philosophy.)
- **Set method:** **inline** — render the `VolunteeringSkillsPicker` right in the
  dashboard nudge card; Save without leaving the page.

## Pattern

Mirror the existing **ContactsNudge** (B3): a one-time, dismissible dashboard
card gated by a per-member timestamp + a pure `shouldShow…` helper.

### Data model
- `MemberDocSchema`: add `volunteeringSkillsNudgeDismissedAt: z.date().nullable().optional()`
  (mirrors `contactsNudgeDismissedAt`).
- `get-family-by-fid.ts`: map `d.volunteeringSkillsNudgeDismissedAt?.toDate?.() ?? null`.

### Gate (`apps/portal/src/app/family/_helpers/should-show-volunteering-nudge.ts`)
`shouldShowVolunteeringSkillsNudge(member)` → true iff member exists AND
`type === 'Adult'` AND `volunteeringSkills.length === 0` AND
`volunteeringSkillsNudgeDismissedAt == null`. Accepts `Date | null | undefined`
on the timestamp for `exactOptionalPropertyTypes` composition.

### Save (reuse — no new endpoint)
Inline Save = `PATCH /api/setu/members/{mid}` with `{ volunteeringSkills }`. The
members PATCH already supports partial `merge:true` updates and allows a
family-member self-edit on their own mid (canAccessRoute). Save is disabled
until ≥1 skill is selected, so saving always clears the gate (`length > 0`).

### Dismiss (`POST /api/setu/volunteering-skills/dismiss-nudge`)
Mirror the contacts dismiss route: `getCurrentFamily()` → set
`volunteeringSkillsNudgeDismissedAt = serverTimestamp()` on the caller's own
member doc → `revalidateTag(\`family-${fid}\`)`. Already covered by the
`isSetuFamily` canAccessRoute rule for `/api/setu/volunteering-skills/*` — **no
canAccessRoute change**.

### Client wrapper (`features/setu/members/volunteering-skills-client.ts`)
`saveVolunteeringSkills(mid, skills)` (PATCH) + `dismissVolunteeringSkillsNudge()`
(POST). Component tests mock THESE, not fetch (route handlers are server-only).

### Nudge component (`features/family/components/volunteering-skills-nudge.tsx`)
Client. Props `{ mid }`. Holds `skills: string[]` (starts `[]`), renders the
card + `VolunteeringSkillsPicker` + **Save** (saves then hides) + **Not now**
(dismiss then hides). Save disabled while `skills` is empty.

### Dashboard wiring (`app/family/page.tsx`)
Compute `showVolunteeringNudge = shouldShowVolunteeringSkillsNudge(currentMember)`
alongside `showContactsNudge`. Render priority — **at most one nudge**:
`{!needsProfile && !showContactsNudge && showVolunteeringNudge && currentMid && <VolunteeringSkillsNudge mid={currentMid} />}`
in both the mobile and desktop blocks (after the existing profile/contacts nudges).

## Tests (ship with the code)
- gate helper: Adult+empty+undismissed → true; has-skills / dismissed / Child /
  undefined → false.
- dismiss route: 404 when flag off, 401 no session, sets the timestamp on the
  current member, mocks `next/cache`.
- nudge component: renders; Save calls `saveVolunteeringSkills(mid, skills)` then
  hides; "Not now" calls dismiss then hides; Save disabled when empty.
- get-family-by-fid + member schema: map/parse the new field (extend existing).

## Out of scope (YAGNI)
- Prompting managers to fill OTHER adults' skills (self-scoped only).
- Recurring reminders for members who already have skills (one-time only).
- Showing the nudge when the admin option list is empty is left as-is (rare; the
  picker shows its own empty-state and Save stays disabled).
