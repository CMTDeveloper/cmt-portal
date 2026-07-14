# Mobile API contract changelog

The Chinmaya Setu **mobile app** (`chinmaya-setu-mobile`) mirrors this portal's
`/api/setu/*` request/response shapes **by hand** in `src/api/schemas/*.ts`
(+ the fetch calls in `src/api/*.ts`). It does **not** import `@cmt/shared-domain`.
So whenever a `/api/setu/**` route — or a `@cmt/shared-domain` schema it depends
on — changes its response/request shape, error codes, or required fields, the
mobile mirror must be updated to match or it silently drifts.

**This file is the contract handshake between the two repos.** The portal session
appends an entry here on every contract-affecting change; the mobile session's
`contract-sync` cron reads new entries (keyed by the portal commit SHA), updates
`src/api/schemas/*` + `src/api/*.ts`, runs its gate, and commits.

**Format:** newest first. Each entry cites the **portal commit SHA** so the mobile
cron can match it against `git log <watermark>..origin/main`. Keep entries small
and action-oriented: *what changed* + *what the mobile must do*.

**Mobile baseline:** the app was last built against portal commit **`e230061`**
(mobile API prerequisites — Bearer auth + the dashboard/donations endpoints).
Everything below is the backlog of contract changes since then.

---

## 2026-07-14 - `2c96f02` - `publicFid` is now null until a family's first enrollment (lazy minting)
The family `publicFid` (the user-facing 5001+ Family ID) is now **minted lazily at a family's FIRST enrollment**, not at family creation. So in every `/api/setu/*` response that returns it - notably **`GET /api/setu/dashboard`** (`family.publicFid`) and **`GET /api/setu/family`** (`family.publicFid`), plus `GET /api/setu/members/[mid]/profile` and the welcome-team `GET /api/setu/family/search` (`hits[].publicFid`) - `publicFid` is now **`null` for a signed-in family that has not yet enrolled**, and becomes the assigned number after their first enrollment (portal enroll / kiosk check-in / teacher-marked attendance). No request-shape, field-name, or error-code change; this is a behavioral change to WHEN the (already-nullable) field is populated.
- **Mobile action:** treat a `null` `publicFid` as "not yet enrolled" - show an "assigned when you enroll" nudge (or hide the Family ID) rather than a placeholder or the internal `fid`. The field was already typed nullable, so no schema change is required; just handle the null case in the UI. `publicMid` (member ids) is unaffected - still assigned at member creation.

## 2026-07-13 - `ef5ac68` - GET /api/setu/family/search hit gains additive `parentName`
Each `FamilySearchHit` in the `GET /api/setu/family/search` response now carries an
additional **`parentName: string`** field - the family's parents' display name (adult
members, manager first; e.g. `"Vaibhav & Noopur Rana"`, or the stored family name as a
fallback when a family has no adult member). Every existing field (`fid`, `publicFid`,
`legacyFid`, `name`, `location`, `memberCount`) is unchanged; `name` still holds the
stored (legacy) family name.
- **Mobile action: none required.** `/api/setu/family/search` is a **welcome-team-only
  admin endpoint** (not used by the family-facing mobile app). The change is purely
  additive. IF the mobile ever mirrors this endpoint, add an optional `parentName: string`
  to its hit schema. No request-shape or error-code change.

## 2026-07-12 - `6d994a8` - NEW POST /api/setu/teacher/attendance/confirm-previous + teacher roster splits Enrolled vs Previous
The teacher attendance roster is now split. The main **Enrolled students** list shows only enrollments that are engagement-confirmed (the existing issue #23 `isEnrollmentConfirmed` rule: family-initiated / first-attendance enrolledVia, OR attended >=1 class this year, OR a completed donation for the eid, OR legacy-paid). Rollover carry-forwards that have not re-engaged (`enrolledVia:'promotion'`/`'welcome-team'`, no engagement) are moved OFF the main roster into a secondary **Previous students** list. The attendance stats and the unmarked->absent save-sweep now cover ONLY the confirmed roster - a previous student is never auto-marked Absent.
- **NEW `POST /api/setu/teacher/attendance/confirm-previous`** (teacher-gated, under the already-gated `/api/setu/teacher/*` prefix). Body `{ levelId: string, mid: string, date: 'YYYY-MM-DD' }`. Marks ONE previous student present, which confirms that family's already-active enrollment (no new enrollment doc). Success -> `{ ok: true, fid }`. Errors: 403 `teacher-required` (non-teacher), 403 `not-your-class` / 404 `not-found` (level access), 400 `bad-request` (body), 400 `not-a-previous-student` (mid is not an unconfirmed carry-forward on this level), 404 `level-not-found`.
- **`POST /api/setu/teacher/attendance` (save) is unchanged in shape** but a mark for a mid that is NOT on the confirmed roster is now returned in `skipped` (previous students are excluded from the main save). No request/response field changed.
- **Mobile action:** IF/when the mobile app builds a teacher attendance screen, mirror the split - render the confirmed roster as the main list, expose a "Previous students (N)" secondary list, and call `POST .../confirm-previous` to move one present (their whole family + siblings surface in the Enrolled list on the next roster load). If the mobile currently renders the full active-enrollment roster for teachers, it will now under-count "enrolled" for carry-forward families until they re-engage - which matches the family dashboard's Registered-vs-Enrolled badge. No change needed to the family-facing endpoints.

## 2026-07-12 - `2753f40` - POST /api/setu/register `location` is now a dynamic centre string (was a 4-value enum)
- **POST `/api/setu/register`**: `location` changed from a fixed enum (`'Brampton' | 'Mississauga' | 'Scarborough' | 'Markham'`) to **any string that is a member of the admin-managed centre list** (see `GET /api/setu/locations`). Sending a value NOT in that list now returns **400 `{ error: 'invalid-location' }`** (a new error code on this route; a non-string / empty `location` still returns 400 `bad-request`). Every other request/response shape and error code is unchanged.
- **Mobile action:** stop hardcoding the four centres in the registration screen. Fetch the centre list from `GET /api/setu/locations` and send one of its returned `options` as `location`. Handle the new 400 `invalid-location` (e.g. if the picker is stale) by re-fetching the list.

## 2026-07-12 - `2f84cf7` - NEW public GET /api/setu/locations (centre list)
New **public** (pre-auth) read-only endpoint.
- **GET `/api/setu/locations`** -> `200 { options: string[] }` - the admin-managed centre list (e.g. `['Brampton', 'Scarborough']`), defaulting to `['Brampton', 'Scarborough']` until an admin saves a custom list. No auth required (org-wide, non-sensitive config); also readable by any signed-in setu family. No request body.
  - **Mobile:** fetch the centre list from this endpoint in the registration flow (and any location picker) **instead of hardcoding the four centres**. Add a `locations` fetch + a `{ options: string[] }` response type in `src/api/*`; render the returned list. No request-shape change; additive endpoint.

## 2026-07-11 - `7c2a396` - enrolledVia gains 'kiosk'
`EnrollmentDoc.enrolledVia` (schemas/enrollment.ts) now includes `'kiosk'` for door/kiosk-driven auto-enrollments. Mobile: widen the enrolledVia union to accept `'kiosk'` on any enrollment read; no request-shape change.

## 2026-07-10 - `b1561cb` - Family home address (GET/PATCH /api/setu/family, POST /api/setu/register)
New REQUIRED family-level home address.
- **GET `/api/setu/family`** -> `family` gains **`familyAddress: { street: string; unit: string; city: string; province: string; postalCode: string } | null`** (null = not yet on file). `province` is a 2-letter Canadian province code (e.g. `ON`); `postalCode` is a Canadian code (`A1A 1A1`). Additive.
- **PATCH `/api/setu/family`** (manager-only) now ALSO accepts **`familyAddress`** and is a partial update: send either or both of `familyEmergencyContact` and `familyAddress`; keys absent from the body are left untouched. Empty body -> 400; invalid postal code -> 400.
- **POST `/api/setu/register`** now **REQUIRES** a top-level **`familyAddress: { street, unit?, city, province, postalCode }`** (street/city/province non-empty, valid CA postal). Registering without it -> 400 `bad-request`.
- **Mobile action:** add a required home-address section to the registration screen and send `familyAddress` in the register POST; read/display `family.familyAddress` and let managers edit it via `PATCH /api/setu/family`. ALSO: existing families are now redirected to the profile-completion screen until a manager provides the address (see below), so surface an "add your home address" prompt for managers when `family.familyAddress` is null.

## 2026-07-10 - `62588ae` - Emergency contact moved to the family level (GET/PATCH /api/setu/family)
Emergency contact is now a single OPTIONAL **family-level** record instead of per-member.
- **GET `/api/setu/family`** -> `family` gains **`familyEmergencyContact: { relation: string; phone: string; email: string } | null`** (null = none on file). Additive; every other field unchanged.
- **NEW `PATCH /api/setu/family`** (manager-only): body `{ familyEmergencyContact: { relation, phone, email } | null }` (null clears it). `relation` + `phone` are required, `email` optional (defaults `''`). Returns `{ ok: true }`. Errors: non-manager -> 403 `not-manager`, invalid body -> 400 `bad-request`, no session -> 401 `no-session`.
- **Deprecated:** per-member `members[].emergencyContacts` is no longer collected by the add/edit member forms; the tuple slots are now both nullable and default to `[null, null]`. The field stays on the member schema for backward compat, but treat `family.familyEmergencyContact` as the source of truth and stop writing per-member emergency contacts.
- **Mobile action:** read/display `family.familyEmergencyContact`; give managers an editor that PATCHes `/api/setu/family`; remove the per-member emergency-contact fields from the member add/edit screens.

## 2026-07-10 - `1279eb4` - POST /api/setu/enrollments rejects an ineligible (childless) family with 400 `no-eligible-members`
`POST /api/setu/enrollments` now returns **400 `{ error: 'no-eligible-members' }`** when the family has zero members eligible for the program (e.g. an adult-only family enrolling in child-only Bala Vihar). Previously it silently created an enrollment with `enrolledMids: []`. This is a NEW error code on an existing route; the success shapes (201/200 `{ eid, suggestedAmount, donateUrl }`) and every other error code are unchanged. **Mobile action:** handle the new 400 `no-eligible-members` on the enroll call and surface an "add a child to your family before enrolling" message (do not treat it as a generic failure); optionally gate the enroll CTA client-side when the family has no eligible members.

## 2026-07-08 — `02b8eeb` — Member add/edit/delete now reconciles active-enrollment membership
`POST /api/setu/members`, `PATCH /api/setu/members/[mid]`, and `DELETE /api/setu/members/[mid]` now, after the write, reconcile every ACTIVE enrollment's `enrolledMids` to the family's currently-eligible members. A child added AFTER the family enrolled is automatically swept into the active enrollment (previously it was silently omitted from the dashboard/roster — the N=2 bug); a deleted/ineligible member is dropped. **No request/response SHAPE change** — same bodies (`{ mid }` / `{ ok: true }`), same error codes, no new fields. **Mobile action:** after ANY member add/edit/delete, REFETCH enrollments / the dashboard (`GET /api/setu/dashboard` or `GET /api/setu/family`) — a member mutation can now change the family's `enrolledMids` (and thus the enrolled-children list) as a side effect, so a locally-cached enrollment/dashboard is stale until refetched.

## 2026-07-03 — `de017f6` — Attendance is Present/Absent only (Late retired)
`POST /api/setu/teacher/attendance` (`marks`) and `POST /api/setu/teacher/guests` (`status`) now accept only `present` | `absent`. Sending `late` → 400 `bad-request`. Reads are unchanged (historical `late` events still returned). **Mobile:** drop `late` from the attendance marker UI and never send it; render any historical `late` in read views as needed.

## `f960ee5` · 2026-07-03 — Disclaimers (Slice 2)

**New — `GET /api/setu/disclaimers`** → `{ version:number, schoolYear:string, sections:{id,title,body}[], accepted:boolean }`. The signed-in family's disclaimer state. Any family role.

**New — `POST /api/setu/disclaimers/accept`** (no body) → `{ ok:true, version:number }`. Records acceptance of the CURRENT version + school year. **Manager-only** (a family-member gets 401/`unauthorized`). Server-authoritative version.

**Changed — `GET /api/setu/dashboard`** gains additive top-level **`disclaimersPending: boolean`** — true when this (manager) family must accept before using the portal; false for a family-member, when the feature flag is off, or on a read error.

**Mobile action:** on launch, a manager session should check `disclaimersPending` (or `GET /api/setu/disclaimers`); if pending, show the accept screen (render `sections`, one required checkbox each) and `POST …/accept` before proceeding. Acceptance is per-family (manager); a stale version or new `schoolYear` re-prompts. Flag `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS` gates the web gate — until it's on in an environment, `disclaimersPending` is always false there.

## `4195d05` · 2026-07-03 · dashboard gains per-child BV rows, family counts, action-item seam; `bvState` semantics widen (Slice 1)
- **GET `/api/setu/dashboard`** — additive fields (the dashboard now drives a 3-block layout: Family · Action items · Bala Vihar):
  - `family.counts: { children: number; adults: number }` — the family's child/adult split (derived from `members[].type`), for the Family block header.
  - `balaVihar.children: Array<{ mid: string; firstName: string; levelName: string | null; teacherNames: string[]; attendance: { present: number; total: number } }>` — **one row per BV-enrolled child**: their level name (null if unassigned), assigned teacher name(s) (empty array if none/unresolved), and Sunday attendance ratio (present+late over total in-window). Empty array when there's no active BV enrollment. Already plain-serializable — no Date/Map.
  - `actionItems: Array<{ kind: 'donation'; title: string; ctaLabel: string }>` — the forward-compatible action seam. **ALWAYS EMPTY (`[]`) in Slice 1** — the Bala Vihar donation is surfaced via the existing `balaVihar` donation fields (`suggestedAmount`/`givenForPeriod`/`donationComplete`/`donationPct`/`donationHeading`), **NOT** as an action item (owner decision 2026-07-03). Slice 2 will populate it (a disclaimers item). Present now so the mobile schema/UI is forward-compatible; the client builds its own navigation from `kind`.
  - **`balaVihar.bvState` semantics WIDEN** (Slice 1 Part A): `'enrolled'` now ALSO covers a `family-initiated` enrollment (family clicked Enroll, even a $0 intent) and a `first-attendance` enrollment (teacher auto-enrolled on first check-in), in addition to the prior engaged/donated/legacy-paid triggers. **Values are unchanged** (`'enrolled' | 'registered' | 'none'`) — only MORE families now read `'enrolled'`. `'registered'` now occurs only for `promotion`/`welcome-team` carry-forwards with zero engagement. `isEnrolled` is unchanged (still doc-exists).
  - **All additive** — no existing field changed (`upcoming`/`seva`/`prasad`/`otherPrograms`/`members`/`balaVihar.*`/`isEnrolled` all stay). No request-shape change.
  - **Mobile:** add `family.counts`, `balaVihar.children` (with the exact per-child shape above), and `actionItems` to the dashboard schema in `src/api/schemas/*`. Render the 3-block layout (Family · Action items · Bala Vihar); list each `balaVihar.children` row with level + teacher(s) + attendance ratio. **Drive the donation CTA from the existing `balaVihar` donation fields, NOT from `actionItems`** (`actionItems` is empty in Slice 1). Drive the BV pill from `bvState` (green Enrolled / amber Registered / grey Not enrolled) — no code change needed for the widened semantics, but the amber "Registered" state now appears for fewer families.

## `2e87f19` · 2026-07-02 · dashboard `balaVihar` gains three-state `bvState` (issue #23)
- **GET `/api/setu/dashboard`** — `balaVihar` gains an additive **`bvState: 'enrolled' | 'registered' | 'none'`**. `'enrolled'` = the family has ENGAGED this year (attended ≥1 BV class in the enrollment's window OR any completed donation for that enrollment, OR legacy-roster paid for legacy offerings). `'registered'` = an active BV enrollment exists (self-enroll, promotion, or backfill) but no engagement yet. `'none'` = no active BV enrollment. **`isEnrolled` is UNCHANGED** (still "active BV enrollment doc exists") — do not re-derive it from `bvState`.
  - **Mobile:** add `bvState` to the dashboard schema; drive the BV pill from it (green "Enrolled" / amber "Registered" / grey "Not enrolled"). For `'registered'`, show the nudge copy "Attend your first class or complete your donation to confirm enrollment." + a donate CTA. No request-shape change; no other field changed.

## `773f15c` · 2026-06-25 · dashboard / family / member-detail gain public ids (FID 4-digit, MID 5-digit)
- **Family responses** (`GET /api/setu/dashboard` → `family`, `GET /api/setu/family` → `family`) gain an additive **`publicFid: string | null`** (4-digit, e.g. `'1042'`) — the family's canonical user-facing Family ID; `null` until the FID/MID renumber migration assigns one. The existing `fid` (`CMT-…`) is **unchanged** and remains the join key.
- **Member responses** (`GET /api/setu/dashboard` → each `members[]`, `GET /api/setu/members/[mid]/profile` → `profile`) gain an additive **`publicMid: string | null`** (5-digit, e.g. `'50001'`). The existing `mid` (`${fid}-NN`) is **unchanged** and remains the join key / route param.
- **Additive only** — no existing field changed; both raw `fid`/`mid` AND the new `publicFid`/`publicMid` are returned (the route does NOT collapse to a single `displayFid`, so the mobile client mirrors the web's own `publicX ?? legacyX` fallback).
  - **Mobile:** add the optional nullable `publicFid` to the family schema and `publicMid` to the member schema in `src/api/schemas/*`. **Display intent:** show **FID at the family level** (`dashboard.family` / `family` GET) and **MID on the member-detail screen** (`members/[mid]/profile`); fall back to `fid` / `mid` when the public id is `null`. **NEVER** use `publicFid` / `publicMid` as join keys or route params — keep using `fid` / `mid`. No request-shape change. (The earlier `921bb37` entry already covers `GET /api/setu/family/search` `hits[].publicFid` — this entry is the dashboard / family / member-detail one and does not change search.)

## `921bb37` · 2026-06-24 · family search hit gains `publicFid`
- **GET `/api/setu/family/search`** (welcome-team) — each object in the `hits` array gains an additive **`publicFid: string | null`** field: the family's canonical 4-digit user-facing Family ID (`null` until assigned during the FID/MID renumber migration; the internal `fid` remains the join key and is unchanged). **Additive** — no existing field changed; `fid`, `legacyFid`, `name`, `location`, `memberCount` are all unchanged. Part of issue #4 (surface the 4-digit FID at family level, 5-digit MID on member detail).
  - **Mobile:** add the nullable `publicFid` to the `FamilySearchHit` schema/type in `src/api/schemas/*`. If/when the app renders a family identifier, prefer `publicFid ?? fid` (a `displayFid` equivalent) so it shows the 4-digit id when present and falls back to the legacy `fid` during migration. No request-shape change. (Member-level `publicMid` is shown only on the member detail screen on web — not added to any list/search response here.)

## `93f5e12` · 2026-06-24 · dashboard exposes the live `schoolYear`
- **GET `/api/setu/dashboard`** — the 200 JSON gains a top-level **`schoolYear: string`** (e.g. `'2025-26'`). This is the **LIVE / operational** school year families and teachers are currently in (the mobile counterpart of the web school-year badge). It is **distinct from `balaVihar.termLabel`**, which is the *family's enrollment period* — `balaVihar.termLabel` is unchanged. **Additive** — no existing field changed.
  - **Mobile:** add `schoolYear` to the dashboard response schema/type in `src/api/schemas/*`, and render the live-year label on the home screen (the mobile counterpart of the web school-year badge). No request-shape change.

## `bd38f92` · 2026-06-24 · seva opportunity status gains `draft`
- **`SevaOpportunityStatus`** (`@cmt/shared-domain`) gains an additive **`'draft'`** value — now `['open','closed','draft']`. A `'draft'` opp is an admin-only, unscheduled rollover copy (a "decide the date later" placeholder) that families must NEVER see. **Additive only**; existing `'open'`/`'closed'` values and all existing docs are unchanged.
- **GET `/api/setu/seva/opportunities`** (family view) — **continues to EXCLUDE drafts**: the family browse list is built from `status:'open'` only, so a `'draft'` opp is never returned. **No response-shape change** — the status enum simply has a new member that the family endpoint won't emit.
  - **Mobile:** add `'draft'` to the seva opportunity status enum/type in the seva schema (so a doc/read carrying `status:'draft'` still validates); ensure the seva list/browse UI filters to `status:'open'` (drafts are admin-only and never appear in the family feed). No request-shape change. The new admin copy endpoint (`POST /api/admin/school-year/copy-seva`) is web/admin-only — no mobile mirror.

## `79cf98c` · 2026-06-24 · calendar scoped to the live school year
- **GET `/api/setu/calendar`** — the returned `entries` are now filtered to the **live school year's window** (Aug 1 → Jul 31 of the operational year). Both prior-year and next-year **preparing** Sundays (cloned for the upcoming year as `enabled:true` before an admin Activates it) are now **excluded**. **Response shape is UNCHANGED** — same `{ location, programKey, entries, weekly }`, same entry fields; only the *set* of `entries` is narrower (live-year-only).
  - **Mobile:** no schema change. The calendar / upcoming list will no longer include other-school-year dates, so update any fixtures/expectations to the live-year set (a test asserting a future-year or prior-year date in `entries` will now fail). `GET /api/setu/dashboard`'s `upcoming` is filtered the same way (also no shape change).

## `357b460` · 2026-06-22 · join-request review — distinct `wrong-family` error
- **GET `/api/setu/join-request/[token]`** — when a signed-in manager opens a request that belongs to a **different family**, the route now returns **`404 { error: 'wrong-family' }`** instead of the old `404 { error: 'not-found' }`. The status stays **404** (deliberately not 401/403 — the review page is public and treats 401/403 as "go sign in", which would loop an already-signed-in user); the target family's name is **not** included. A genuinely missing/handled token still returns `404 { error: 'not-found' }`.
  - **Mobile:** if/when the app builds the join-request review screen, map `wrong-family` to a distinct "you're signed in as a different family — switch accounts" state (vs. the not-found/invalid-link copy). No change to `approve`/`decline` or to the request/response shape otherwise.

## `096463e` · 2026-06-22 · teacher-managed payment source — checkout 422
- **`teacher-managed`** added to the offering `paymentSource` enum (`@cmt/shared-domain` `PAYMENT_SOURCES` is now `['portal','legacy','teacher-managed']`) — an offering whose donation is collected by the teacher OFF-portal. **Additive**; existing values unchanged.
- **POST `/api/setu/donations/checkout`** — when the target enrollment's offering is `paymentSource: 'teacher-managed'`, the route now returns **`422 { error: 'payment-source-teacher-managed' }`** BEFORE any Stripe checkout-session is created (no in-portal donation is possible for these offerings).
  - **Mobile:** add `'teacher-managed'` to the paymentSource enum in the offering/enrollment schemas; in the donate flow, hide the in-portal Give/checkout action for a teacher-managed enrollment and handle the `payment-source-teacher-managed` 422 (surface "payment is collected by your teacher", not a generic error). `GET /api/setu/dashboard` + family reads are unchanged in shape. (The admin offering-overlap `409 offering-date-overlap` change is on `/api/admin/*` — web-only, no mobile mirror.)

## `120c885` · 2026-06-22 · profile-completion gate + required member-field matrix
A per-type "required member info" matrix is now enforced at every member write. The mobile add/edit-member + registration forms must capture + validate the same fields and handle the new 400 codes, or members it creates will be incomplete.
- **Matrix:** ALL members → `gender` (now **`Male|Female` only** on write — `PreferNotToSay` is rejected by the write enums), `foodAllergies` (non-empty; offer a "No known allergies" choice that sends the sentinel **`'None'`**). ADULTS → `email` + `phone` + `volunteeringSkills` (≥ 1). CHILDREN → `schoolGrade` + `birthMonthYear` (`'YYYY-MM'`). `birthMonth` (1-12) is now **derived server-side** from `birthMonthYear` — the client need not send it (it's still honoured when `birthMonthYear` is absent).
- **POST `/api/setu/members`** + **PATCH `/api/setu/members/[mid]`** — new `400 { error }` codes: **`foodAllergies-required`**, **`contact-required`** (an adult missing email or phone), **`grade-required`**, **`birthmonth-required`** (plus the existing `skills-required`). The write-side `gender` enum is now `['Male','Female']`. PATCH enforces a rule **only when the patch touches that field (or changes `type`)**, so a partial patch of a still-incomplete legacy member is not blocked. Same-**family** contact reuse now **shares** the existing contactKey (no overwrite); cross-family reuse still returns `409 { error: 'contact-already-registered', field }`.
  - **Mobile:** in add/edit-member, require gender (Male/Female) + foodAllergies (with a "No known allergies" → `'None'` affordance) for everyone; email+phone+≥1 skill for adults; schoolGrade + a month/year picker (→ `'YYYY-MM'`) for children. Block submit until satisfied; map the new 400 codes to friendly copy. Remove any `PreferNotToSay` option from capture forms.
- **POST `/api/setu/register`** — the body's `manager` object now accepts **and requires** `foodAllergies` + `volunteeringSkills` (≥ 1); `additionalMembers[]` now accepts `foodAllergies`, `volunteeringSkills`, `schoolGrade`, `birthMonthYear`, `email`, `phone`, with `gender` `Male|Female`. Same per-type 400 codes as above, with the response adding **`member: 'manager' | <index>`** to point at the offender. An adult **may reuse the manager's email/phone** (same-family reuse is accepted, not a `duplicate-contact`).
  - **Mobile:** the registration flow must capture the manager's foodAllergies + skills and each added member's per-type required fields, and handle the per-type 400s (`member` tells you which row).
- **Post-sign-in gate (web only):** the portal now hard-redirects an incomplete family to `/family/complete-profile` before the dashboard. The mobile app has no such route, but its home should prompt completion when `GET /api/setu/family` / `GET /api/setu/dashboard` shows members missing the matrix fields. **No response-shape change** to those read endpoints.

## `0225cca` · 2026-06-22 · family-lookup classification + join-request flow
- **POST `/api/setu/family-lookup`** — the found response will gain **`matchAction: 'sign-in' | 'request-to-join'`** alongside the existing `{ found, matchedType, matchedValue }`. `'sign-in'` = the matched contact is a manager or active member (sign in as today); `'request-to-join'` = a roster-origin non-manager member whose access is gated until a manager approves.
  - **Mobile:** add `matchAction` to the family-lookup response schema in `src/api/schemas/auth.ts`; on `'request-to-join'` show a "send a request to your manager" CTA instead of the sign-in CTA.
- **POST `/api/setu/auth/verify-code`** — for a `portalAccess: 'pending'` member the response will carry a **`pendingApproval: true`** signal (+ `fid`, `matchedMid`) and grant **no** family-member claims; the user must wait for manager approval. Managers and active/absent members are unchanged.
  - **Mobile:** handle `pendingApproval` in the verify-code response — surface "access pending your manager's approval" and offer to (re)send the join request rather than landing in the family home.
- **New `POST /api/setu/join-request/send`** (open + IP rate-limited), **`GET /api/setu/join-request/[token]`** (manager-only), **`POST /api/setu/join-request/approve`** and **`POST /api/setu/join-request/decline`** (manager-only) — the member→manager join-request flow. `send` writes a pending request and notifies managers; `approve` promotes the matched member to co-manager.
  - **Mobile:** add the four endpoints + their request/response schemas (mirror the invite flow shapes) once they ship.

## `1d469cf` · 2026-06-21 · #12 invite existing-member guard
- **POST `/api/setu/invite/send`** — now returns **`409 { error: 'already-member' }`** when the invited email already belongs to a family member (primary email or `altEmails`). Previously only `201` / `family-not-found`.
  - **Mobile:** handle the 409 `already-member` case in the invite flow ("already a member of your family"). `src/api/auth.ts:148` already documents it — just verify it's wired in the UI. No response-schema change.

## `73ebdb9` · 2026-06-21 · #10 adult volunteering-skills required
- **POST `/api/setu/members`** and **PATCH `/api/setu/members/[mid]`** — for `type === 'Adult'`, `volunteeringSkills` must contain **≥ 1** item, else **`400 { error: 'skills-required' }`**. Children are never required. PATCH enforces only when `volunteeringSkills` is present in the body.
  - **Mobile:** in the add/edit-member flow require an adult to pick at least one skill before submit, and handle the `skills-required` 400. (The skill *options* list also changed to 11 new values, served by the volunteering-skills options endpoint — no shape change.)

## `a75613d` · 2026-06-21 · #3 dashboard attendance removed
- **GET `/api/setu/dashboard`** — the **`attendance`** sub-object is **removed** from the response. Family-level attendance is no longer a dashboard concept; per-child attendance remains only on the child profile (`/api/setu/members/[mid]/profile`, unchanged).
  - **Mobile:** remove `attendance` (the `attendanceSchema` usage) from `src/api/schemas/dashboard.ts` and any home-screen UI that reads it. ⚠️ Already drifting — `src/api/schemas/dashboard.ts:~55` still declares it.

## `6abbcb9` · 2026-06-21 · security: OTP-gate registration
- **POST `/api/setu/auth/send-code`** — accepts optional **`purpose: 'signin' | 'register'`**. For a brand-new email the client MUST send `purpose:'register'` to receive a code (the sign-in path returns a silent `200` with no code for unknown contacts).
- **POST `/api/setu/auth/verify-code`** — on the no-family (email) path the response now includes a **`registrationGrant`** token.
- **POST `/api/setu/register`** — request body now **requires `registrationGrant`** (the token from verify-code). Missing → `400`; invalid/expired → **`403 { error: 'registration-unverified' }`**.
  - **Mobile:** registration flow must be: send-code `{ purpose: 'register' }` → verify-code returns `registrationGrant` → pass it in the `/register` body. Update `src/api/auth.ts` (register call + verify-code handling) and `src/api/schemas/auth.ts`.

## `1c7f2f1` · 2026-06-21 · security: family-lookup PII trim
- **POST `/api/setu/family-lookup`** — the `match` field is trimmed to **`{ found: true, matchedType: 'email' | 'phone', matchedValue: string } | null`** (no family/member PII). Response is still `{ match }`.
  - **Mobile:** update the family-lookup response schema in `src/api/schemas/auth.ts` to the trimmed `match` shape (it already treats `match: null` as "no family").
