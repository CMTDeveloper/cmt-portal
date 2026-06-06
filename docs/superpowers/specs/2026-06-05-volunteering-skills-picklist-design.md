# Admin-managed Volunteering Skills picklist — design

**Date:** 2026-06-05
**Status:** Approved (CMT Developer / Vaibhav feedback)

## Goal

Replace the free-text "Volunteering skills" input on the member **Add** and
**Edit** screens with a **multi-select picklist** whose options are managed by
**admins**. Families pick from the list instead of typing free text.

## Decisions (locked)

- **Multi-select** — a member can hold several skills (the field is already a
  `string[]`).
- **Seed a default set** of options that admins can edit/remove afterward:
  `Teaching`, `AV / Tech`, `Kitchen / Prasad`, `Setup & Cleanup`,
  `Registration / Greeting`, `Decoration`, `Fundraising`, `Driving / Transport`.

## Data model

- `MemberDoc.volunteeringSkills: string[]` — **unchanged**. Already an array on
  the member; the member-write APIs already accept `z.array(z.string())`.
- **New config doc:** `app_config/volunteering_skills` in PORTAL_FIREBASE (UAT)
  → `{ options: string[]; updatedAt: Timestamp }`. A single doc, not a
  collection — it is just a list.

## Read path

`getVolunteeringSkillOptions()` (server) reads the config doc. If the doc is
missing it returns `DEFAULT_VOLUNTEERING_SKILLS` (no lazy write — the read path
needs no write permission; the first admin Save persists the doc). If the doc
exists it returns its `options` verbatim (admins may have removed the defaults).

## APIs (mirror the existing programs split)

- **`GET /api/setu/volunteering-skills`** → `{ options: string[] }`. Readable by
  **any signed-in Setu family** (the Add/Edit forms are client components and
  fetch it). Must be added to `canAccessRoute` as an explicit allow before the
  manager-only `/api/setu/*` catch-all.
- **`GET` + `PUT /api/admin/volunteering-skills`** → **admin-only**, gated the
  same way as `/api/admin/programs`. `GET` returns current options for the admin
  editor; `PUT { options }` validates (each trimmed, ≤ 60 chars, deduped
  case-insensitively, ≤ 50 options) and writes the config doc.

## Admin UI

- New page **`/admin/volunteering-skills`** (+ sidebar entry in `admin/layout.tsx`,
  mobile-nav entry, and an admin-dashboard tile).
- Editor (`features/admin/volunteering-skills/skills-editor.tsx`, client): renders
  the current options as removable chips, an "add option" input + button, and a
  **Save** button that `PUT`s the list. Toast on success / failure.

## Family UI

- New reusable client control
  `features/setu/members/volunteering-skills-picker.tsx`: fetches options from
  `GET /api/setu/volunteering-skills`, renders them as toggleable multi-select
  chips, and manages the selected `string[]`.
- **No silent data loss:** any value the member already has that is *not* in the
  current admin option list is still rendered as a selected chip, so saving keeps
  it.
- Wired into the **Adult** section of `members/new/page.tsx` and
  `members/[mid]/edit/page.tsx`. Parent state for the field becomes `string[]`
  (was a comma-joined string); submit sends the array directly (drop the
  `.split(',')`).

## Tests (ship in the same commits as the code)

- `getVolunteeringSkillOptions()` — returns defaults when the doc is missing;
  returns stored options when present.
- `GET /api/setu/volunteering-skills` — returns options for a signed-in family.
- `GET`/`PUT /api/admin/volunteering-skills` — admin passes; non-admin is denied;
  PUT trims/dedupes/validates.
- `VolunteeringSkillsPicker` — renders admin options; toggles selection; keeps a
  pre-existing value that is not in the option list.
- `canAccessRoute` — `/api/setu/volunteering-skills` GET is allowed for a
  family-member session.

## Out of scope (YAGNI)

- Reordering options (drag/sort) — admins add/remove only for now.
- Per-program skill lists; applying the picklist anywhere other than the member
  profile.
- Backfilling/normalizing existing free-text values already on members.
