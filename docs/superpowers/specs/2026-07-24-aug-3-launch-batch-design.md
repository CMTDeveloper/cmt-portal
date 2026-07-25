# Aug 3 2026 Launch Batch - Design

> **Status:** Draft for review
> **Author:** CMT Developer (with AI agent)
> **Date:** 2026-07-24
> **Target:** Monday 2026-08-03 - **full production cutover** + 7 meeting requirements
> **Baseline:** `main` @ `b1395e0`

---

## 0. Scope decisions (locked with CMT Developer, 2026-07-24)

| Decision | Answer |
|---|---|
| What "launch" means | **Full production cutover.** Real families, prod Firebase `chinmaya-setu-715b8`, real domain. |
| W&R Team role | **Not a new role.** It is the existing `welcome-team`. **Keep the name `welcome-team`** everywhere - internal identifiers *and* UI copy. Add edit powers + a Visitors page to it. |
| Coordinator role | **New role.** Scope is literally **Roster + Programs**. Nothing else - no levels, no calendar, no school-year, no locations. |
| W&R edit power | **Full family edit** (everything a family manager can do, on any family) **+ audit log**. |
| "Canadian numbers" at login | **`+1` / NANP** (Canada + US). No area-code allowlist. |
| Requirement 6 (turn off old portal) | **Owned by CMT Developer.** Out of scope for this spec, but sequenced against in §9. |
| If it doesn't fit in 5 days | Plan the full batch; CMT Developer adds capacity. |

### Honest sizing (revised 2026-07-24 after measuring the real constraints)

An earlier draft of this spec said "12-16 engineering days". **That was wrong** - it was human-developer sizing applied to AI-authored code. Corrected:

| Constraint | Reality |
|---|---|
| **Writing the code** | ~2-3 days. Mechanical against a fully mapped codebase: Coordinator's 14 touchpoints, the cross-family endpoints, the teacher table from a supplied sample, roster reset, phone gate. |
| **Verification wall-clock** | Does **not** compress. Every push runs `typecheck && lint && test && build` on a Turborepo/Next monorepo, then a Vercel deploy, then Playwright against deployed UAT. The setu suite **cannot be run all at once** (OTP limiter cascade), so specs run serially. Deploy-bound calendar time. |
| **External prerequisites** | Do not compress at all. Measured below in §1.8 - the result is better than feared. |
| **Human launch decisions** | Two of them (§1.9) are worth more to a successful launch than any single feature. |

**Conclusion: Aug 3 is achievable.** The binding constraints are verification cycles and the two launch decisions in §1.9, not engineering throughput.

### 1.8 Measured external state (2026-07-24, read-only diagnostics)

**AWS SES - production-ready.** `ca-central-1`, sending enabled, `Max24HourSend` 50,000, 14/s, **out of the sandbox**. Verified identities include the domain `chinmayatoronto.org` and the FROM address `bvregistration@chinmayatoronto.org`.

**AWS SNS - NOT production-ready.** `ca-central-1`, **still IN SANDBOX**, `MonthlySpendLimit = $1`, **no origination numbers registered**, single sandbox-verified destination `+14379712609`.

> Exiting the SNS sandbox, raising the spend limit, and registering a Canadian origination number are AWS support/carrier-review processes measured in **business days to weeks**. They cannot be completed by Aug 3 and no amount of engineering speed changes that.

**Why this is survivable.** Measured against the legacy RTDB snapshot (`.rtdb-snapshot/roster.json`, captured 2026-06-10): **2,543 roster rows / 867 distinct families. 767 have both email and phone, 100 have email only, and ZERO are phone-only or contactless. 100% of families are reachable by email.**

So SMS being unavailable **locks nobody out**. Email OTP - the channel that is production-ready - covers the entire roster. This is the single most important fact in this spec.

### 1.9 The two decisions that outrank the features

**D-A: Is the roster populated at launch?** Under the lazy-migration path (runbook §6 steps 2-5 skipped), a legacy family enters Setu only on first engagement, so **the welcome roster starts nearly empty**. Roster is precisely what requirement 1 (welcome-team) and requirement 2 (Coordinator) grant access to. Shipping both roles onto an empty roster makes them look broken on day one. Either bulk-migrate (runbook §6 step 2, ~864 families, ~15 min) or accept an empty launch roster - deliberately, not by omission.

**D-B: Do teacher rosters start empty?** Runbook §6 step 8 **contradicts itself**: the step says the BV enrollment backfill is "**Recommended for launch**", and the 2026-07-20 note directly below says "**do NOT run this backfill**" because it recreates the "500 registrations" the rollover change deliberately removed. Unresolved, teacher rosters - including "Previous students" - start **EMPTY** on launch Sunday. This must be settled by a human before Aug 3, and the runbook must be corrected either way.

---

## 1. Current-state facts this design depends on

All verified by reading the code on 2026-07-24. Cited so reviewers can check.

### 1.1 Role system - three layers, six tripwires

Three type layers must be widened for any genuinely new role:

1. `ROLES` - `packages/shared-domain/src/auth/role.ts:1`
   `['admin','teacher','family','family-manager','family-member','welcome-team','kiosk']`
2. `GRANTABLE_ROLES` - `packages/shared-domain/src/setu/schemas/sevak.ts:6` → `['admin','welcome-team']`
3. `Capability` - `apps/portal/src/lib/auth/role-claims.ts:16` → `'admin'|'welcome-team'|'kiosk'`

Authorization is one pure function, `canAccessRoute` (`packages/shared-domain/src/auth/can-access-route.ts`, 316 lines, default-deny at `:315`), called from exactly one place: `apps/portal/src/middleware.ts:101`. Everything else is defensive re-checks via the `isX()` helpers.

**Compile-time tripwires** (build fails until updated - these are guardrails, not obstacles):
- `roles-reference.ts:21` - `Record<Role, RoleReference>` with `_exhaustive` assert at `:105`
- `role-badges.tsx:9` - `Record<GrantableRole, {...}>`
- `roles-reference.test.ts:6-12` - asserts `Object.keys(ROLE_REFERENCE)` equals `ROLES`

**Silent-failure traps** (no error; the role simply does not work):
- `member-roles.ts:40-41` - hardcoded `r === 'admin' || r === 'welcome-team'` filter drops unknown roles read from Firestore
- `manage-roles.ts:406` - `ROLE_ORDER`; a role missing here vanishes from every `/admin/users` row
- `build-session-claims.ts:125-131` - `preservedExtras()`; a role missing here is **lost at sign-in** for anyone who also has a family

### 1.2 Cross-family editing does not exist

- `apps/portal/src/app/api/setu/members/route.ts:118-127` - `POST` requires `role === 'family-manager'` and writes into the caller's own `x-portal-fid`
- `apps/portal/src/app/api/setu/members/[mid]/route.ts:95` - same `fid` binding on `PATCH`/`DELETE`
- `/welcome/family/[fid]` is **purely read-only**, no edit affordance
- Sole exception: `MemberGradeEditor` at `welcome/family/[fid]/members/[mid]/page.tsx:73-80` posts to `/api/admin/school-year/set-grade`, which is **admin-only**

> **Existing bug (fix in this batch):** welcome-team users are shown `MemberGradeEditor` and get a **403** when they use it. This is exactly the "edit child grade" capability requirement 1 asks for.

### 1.3 `/api/admin/welcome-team*` has no in-handler role check

It is protected **only** by the `/api/admin/*` prefix rule at `can-access-route.ts:75`. **Widening that prefix for any new role would hand that role the power to grant welcome-team.** Non-negotiable consequence: the Coordinator role gets explicit per-route clauses placed *above* `:75`, and the prefix rule itself is never loosened.

Precedent for this pattern already exists at `can-access-route.ts:51-73` (teacher-assignments, calendar, teachers/search, levels/*/teachers each opened individually above the catch-all).

### 1.4 Teacher attendance data shape

- Page: `apps/portal/src/app/teacher/levels/[levelId]/attendance/page.tsx` (date defaults to `mostRecentSunday()`)
- Rows: `attendance-marker.tsx:505-580` - avatar initials, conditional red safety dot, "First Last", conditional "Gr N", toggle circle
- **Rows are `<button>` elements**, so a nested "View profile" link is invalid HTML and needs the row restructured
- Data: `level-attendance-view.ts:7-17` via `roster.ts:180-197`
- **Neither parent contact nor payment status is in that shape.** Both need new reads. Patterns exist at `student-detail.ts:62-66` (contact) and `roster/payment.ts:21` (payment)
- Child profile **already exists** at `/teacher/students/[mid]`, authorized by `canTeacherSeeStudent` (`student-detail.ts:41-52`), currently linked only from `visitors-panel.tsx:487`

### 1.5 Guest check-in - mostly shipped, one defect

Shipped in `b1395e0`: per-child name + grade, required email/phone, and teacher-side surfacing.

- Form: `features/check-in/kiosk/guest-check-in-form.tsx`
- Writer: `features/check-in/shared/firestore/guest-check-ins.ts:32-44`
- Reader: `readPortalGuestChildren` - `features/setu/attendance/check-in-attendance.ts:168-201` (single-field `date` equality; no composite index needed)
- Merge: `getLevelVisitorsView` - `features/setu/teacher/visitors.ts:53-97` (merges legacy `guest-families` + portal `guest_check_ins`, matches to level by grade)
- Legacy `guest-families` is **Firestore, not RTDB** (`check-in-source.ts:18-25`)
- Teacher page: `app/teacher/levels/[levelId]/visitors/page.tsx`, behind `NEXT_PUBLIC_FEATURE_SETU_TEACHER` (`middleware.ts:70-81`)

> **Defect D1 - guest date-key mismatch.** The writer stamps `date: torontoYMD()` (actual calendar day); the teacher visitors page defaults to `mostRecentSunday()` (`visitors/page.tsx:26`). Meanwhile `mark-door-attendance.ts:61-64` deliberately normalizes to `mostRecentSunday(now)`. Attendance normalizes to Sunday; guest check-in does not. They coincide on Sundays, which is why it works today - **any guest checked in on a non-Sunday is invisible to teachers.**

> **Gap:** there is **no `/welcome/visitors`**. Visitors is teacher-only today.

> **Gap:** no UI→UI guest→teacher E2E. Only `e2e/legacy/b1-kiosk.spec.ts:22`, which never submits the form.

### 1.6 Roster filters

- Page: `app/welcome/roster/page.tsx`; only URL param is `?year=` (via `school-year-scope-bar.tsx:95-105`)
- Filters: React `useState` at `features/setu/roster/roster-browser.tsx:246-251`
- **Non-null defaults:** `payment='paid'`, `engagement='enrolled'`
- API: `GET /api/welcome/roster/report`

### 1.7 Phone identity chain

```
user-typed phone
  → normalizeContactForKey            (contact-key.ts:26-37)
      → sha256('phone:'+canonical)  = contactKeys/{docId}   (hash-contact-key.ts:4-8)
      → sha256(canonical)           = Firebase Auth UID     (build-session-claims.ts:86)
      → claims.phone = canonical                            (build-session-claims.ts:52)
```

- `69132b1` made non-`+1` numbers preserve their country code, with the NANP branch kept **byte-identical** so no existing key drifts (test at `schemas.test.ts:264`)
- A **second, different** normalizer exists: `normalizeContact` (digits-only, `check-in/shared/contact/normalize.ts:1-4`) is the OTP-store and rate-limit key
- `POST /api/setu/auth/send-code` has **no country check** at any layer; the SMS branch is at `route.ts:160-169`
- `sns.ts:1-38` has no country filter
- Today an international user gets `200 {success:true}` (`route.ts:173`), no SMS, no error - they sit on the OTP screen forever

---

## 2. Requirement 1 - welcome-team gains full family edit + audit log

### 2.1 Approach

**Chosen: extract shared write logic, add staff-scoped routes.**

The member-write logic in `/api/setu/members` is non-trivial - Zod validation, `nextMemberMid` allocation, `contactKey` conflict checks, and a Firestore transaction. It has already caused one data-loss incident (the mid-collision fixed in `9ee2de8`). Duplicating it for staff would be reckless.

Rejected alternatives:
- *Add an `fid` override to `/api/setu/members`* - muddies the auth model; one missed check silently lets a family manager edit another family.
- *Point staff UI at the family routes with a spoofed header* - the `fid` comes from the session cookie via middleware; spoofing is not possible and should not be made possible.

### 2.2 Work

1. **Extract** the member create/update/delete core into `features/setu/members/write-member.ts`, taking `fid` as an explicit parameter. Refactor `/api/setu/members` and `/api/setu/members/[mid]` to delegate. Externally byte-for-byte unchanged; existing tests must stay green (precedent: `mint-password-session.ts` refactor, runbook `:332`).
2. **New staff routes**, welcome-team + admin only:
   - `POST   /api/welcome/families/[fid]/members`
   - `PATCH  /api/welcome/families/[fid]/members/[mid]`
   - `DELETE /api/welcome/families/[fid]/members/[mid]`
   - `PATCH  /api/welcome/families/[fid]` (family-level fields: address, emergency contact, location)
3. **`canAccessRoute` clauses** for each, placed above the generic `/api/welcome/` handling.
4. **Audit log.** New Firestore collection `audit_log`, one doc per write:
   `{ actorUid, actorRole, action, fid, mid|null, before, after, at }`
   Written inside the same transaction as the mutation so an audit gap is impossible.
5. **UI.** Add edit affordances to `/welcome/family/[fid]` and `/welcome/family/[fid]/members/[mid]`, reusing the existing family edit components where possible.
6. **Fix the `MemberGradeEditor` 403** - repoint it at the new staff member-PATCH route instead of the admin-only `set-grade` endpoint.
7. **Last-manager guard** must hold on the staff paths too (existing rule: every demotion path checks it).

### 2.3 Risks

- **Privilege boundary.** These are the first endpoints where the acting user's `fid` and the target `fid` differ. Every handler must derive the target `fid` from the **route param** and the authority from the **session**, never mix them.
- **Read roles through the helpers, never the raw header.** `middleware.ts:118` sets `x-portal-role` to the **primary** role only; extras go into a separate comma-separated `x-portal-extra-roles` header (`middleware.ts:123-129`). A welcome-team member who is also a parent has `role='family-member'`, `extraRoles=['welcome-team']` - so a bare `x-portal-role` string comparison **403s real staff**, who are usually also parents.
  The correct readers already exist and the newer `/api/welcome/*` routes already use them: `readSessionFromHeaders` (`lib/auth/headers.ts:53`) and `getServerSession` (`lib/auth/server-session.ts:13`), combined with `isWelcomeTeam()` / `isAdmin()`.
  The **old** pattern is what to avoid - `/api/setu/members/route.ts:118` does `role !== 'family-manager'` on the raw header. The extraction in §2.2 step 1 should carry the new routes onto the helper-based pattern rather than propagate the header comparison.
  > This is the single most likely launch-day bug in this requirement, and it fails *closed* (staff locked out), so it will surface immediately in testing rather than silently.
- `audit_log` must be added to the runbook's portal-owned collection list (§3 of the cutover checklist).

---

## 3. Requirement 2 - Coordinator role

### 3.1 Scope (literal, per decision)

- **Roster:** `/welcome/roster` + `GET /api/welcome/roster/report`
- **Programs:** `/admin/programs`, `/admin/programs/[key]`, `/api/admin/programs`, `/api/admin/programs/[key]`

Nothing else. Explicitly **not** granted: levels, calendar, school-year, locations, users/roles, reports, family search, family edit.

### 3.2 Work - every touchpoint

| Layer | File | Change |
|---|---|---|
| Role union | `packages/shared-domain/src/auth/role.ts:1` | add `'coordinator'` |
| Role helper | `role.ts` | add `isCoordinator()`; admin inherits |
| Grantable | `packages/shared-domain/src/setu/schemas/sevak.ts:6` | add `'coordinator'` |
| Capability | `apps/portal/src/lib/auth/role-claims.ts:16` | add `'coordinator'` |
| Claims preservation | `build-session-claims.ts:125-131` | add to `preservedExtras()` - **omission = silent loss at sign-in** |
| Firestore role read | `member-roles.ts:40-41` | widen the hardcoded filter - **omission = silent drop** |
| Admin users ordering | `manage-roles.ts:406` | add to `ROLE_ORDER` - **omission = invisible in `/admin/users`** |
| Docs (build-breaking) | `roles-reference.ts:21` | add entry; `_exhaustive` at `:105` enforces it |
| Badge (build-breaking) | `role-badges.tsx:9` | add entry |
| Test (build-breaking) | `roles-reference.test.ts:6-12` | updates with `ROLES` |
| Route gate | `can-access-route.ts` | **explicit clauses above `:50` and `:75`** (see below) |
| Sidebar | `desktop-sidebar.tsx:13` | widen `role` union + link filtering |
| Mobile nav | mobile nav components | add coordinator links |
| Seeds | `scripts/seed-test-accounts.ts` | add a coordinator persona |

### 3.3 The route rules - exact placement

```ts
// BEFORE the admin-only page catch-all at :50
if (pathname === '/admin/programs' || pathname.startsWith('/admin/programs/')) {
  return isAdmin(claims) || isCoordinator(claims);
}

// BEFORE the admin-only API catch-all at :75 - and NEVER by loosening that prefix
if (pathname === '/api/admin/programs' || pathname.startsWith('/api/admin/programs/')) {
  return isAdmin(claims) || isCoordinator(claims);
}

// BEFORE the generic /welcome/* rule at :113
if (pathname === '/welcome/roster' || pathname.startsWith('/welcome/roster/')) {
  return isWelcomeTeam(claims) || isCoordinator(claims);
}
if (pathname === '/api/welcome/roster' || pathname.startsWith('/api/welcome/roster/')) {
  return isWelcomeTeam(claims) || isCoordinator(claims);
}
```

`/welcome` root redirects to `/welcome/roster`; a Coordinator hitting `/welcome` must land on the roster and not be denied, so the redirect target needs the same allowance.

### 3.4 Tests

A dedicated `can-access-route` test asserting the **negative** cases: a coordinator is denied `/admin`, `/admin/users`, `/api/admin/welcome-team`, `/api/admin/levels`, `/welcome/reports`, `/api/setu/family/search`. Negative authorization tests are the point here, not the positive ones.

---

## 4. Requirement 3 - Teacher attendance list revamp

Specified from the supplied sample (desktop + mobile).

### 4.1 Desktop layout

- **Header:** `← My classes` · `Level 2` · `Grades 2 & 3` · buttons `Visitors (n)` / `Previous students (n)` · close
- **Date navigator:** `‹` · `📅 Sunday, July 12, 2026 ▾` · `›`
- **Stat cards (4):** ENROLLED · PRESENT · UNMARKED · ABSENT, each with an icon
- **Info banner:** "Tap a student to mark Present. Anyone left unmarked will automatically be recorded Absent."
- **Controls row:** search box · filter chips (All / Present / Unmarked / Absent, each with a count) · `Mark all present`
- **Table - `Enrolled students (n)`:**

| Column | Content |
|---|---|
| Student | avatar initials + "First Last" |
| Grade / Level | two lines: `Grade 2` / `Level 2` |
| Primary Parent | parent name |
| Contact | phone (icon) + email (icon), stacked |
| Donation Status | chip: `Donation Complete` (green) / `Donation Pending` (amber) |
| - | `View profile` button |
| Attendance | `Present` chip + filled radio, or `Unmarked` + empty radio |

- **Detail drawer (right):** selected student name + `Grade 2 · Level 2`
  - **Attendance** - `Present for Sunday, July 12, 2026` + `Mark Unmark`
  - **Registration** - Enrollment Status chip, Donation Status chip
  - **Primary Parent** - name, phone, email
  - **Actions** - `View full profile ↗`, `View registration ↗`
  - **Note** - "Need to update information? You can request updates from the parent through the student profile."
- **Footer bar:** `n Present · Tap to mark` | `n Unmarked · Will be marked absent` | `✓ Auto-saves`

### 4.2 Mobile layout

Header, date nav, `Visitors` / `Previous students` chips, 2×2 stat grid, info banner, search, filter chips, then **cards**: avatar, name, `Grade 2 · Level 2`, donation chip, `View` button, radio toggle. Footer summary retained.

### 4.3 Allergies / medical / safety

Requested but **not present in the sample**. Design decision:
- **Row:** keep the existing red safety dot, add an accessible label (it is currently a bare visual).
- **Detail drawer:** a `Safety & medical` block rendering the notes as readable text.

This keeps the dense table dense while making the information actually reachable. Flagging explicitly because it deviates from the sample.

### 4.4 Data

Parent contact and payment status are **not** in `level-attendance-view.ts:7-17`. Both must be added.

**Mandatory:** bulk `collectionGroup` reads joined in memory - **never** a per-family fan-out. Per-family loops time out at this roster size (~45s @ 769 families, documented). Reuse the patterns at `student-detail.ts:62-66` and `roster/payment.ts:21`.

**Index audit required.** Any new `.where().orderBy()` or multi-`where` needs an entry in `firestore.indexes.json`, deployed to **UAT only** (`--project chinmaya-setu-uat`, never `--force`, never prod). Fake-firestore is index-blind.

### 4.5 Structural note

Rows are `<button>` elements today. A nested `View profile` link is invalid HTML and breaks keyboard navigation. **Restructure the row**: the row is a plain container; the toggle is a button; `View profile` is a link. Preserves tap-to-mark while making both controls reachable.

### 4.6 Privacy note (raised, not blocking)

This puts **every family's donation status and parent contact details in front of every teacher**. That is what was asked for and it is a reasonable operational call for a volunteer-run program - recorded here so it is a decision rather than an accident.

---

## 5. Requirement 4 - Guest / visitor check-in

Capture (per-child name + grade, required contact) and teacher surfacing shipped in `b1395e0`. Remaining:

1. **Fix defect D1** (§1.5) - normalize the guest `date` key to the same Sunday basis the teacher views use, or make the visitors query span the week. Preference: **write both** `date` (calendar day, preserved for admin reports) **and** `sessionDate` (`mostRecentSunday`), and query on `sessionDate`. Non-destructive to existing docs and to the admin reports that read `date`.
2. **New `/welcome/visitors`** - the welcome-team-visible visitors surface. Reuses `getLevelVisitorsView` across levels rather than the per-level teacher view.
3. **The missing E2E** - a real UI→UI Playwright spec: submit the guest form, then assert the child appears in the teacher's visitors panel. This is the specific gap called out at `e2e/legacy/b1-kiosk.spec.ts:22`.

---

## 6. Requirement 5 - Roster Reset button

Smallest item. `roster-browser.tsx` - a `Reset filters` control that restores the documented defaults:

- `payment` → `'paid'`
- `engagement` → `'enrolled'`
- search, location, program → cleared

**Assumption (stated, easily changed):** Reset does **not** touch `?year=`. The school year is a *scope* selected in a separate bar (`school-year-scope-bar.tsx:95-105`) and lives in the URL, not a filter chip. Resetting it would silently move the user to a different year's data.

The button should be hidden or disabled when filters are already at their defaults, so it never reads as a live control that does nothing.

---

## 7. Requirement 6 - old portal shutdown

**Owned by CMT Developer.** Not specified here.

Two facts to carry into that work:
- Retiring the standalone door app is `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=true`, which the runbook (`:202`) says to flip **last, after parallel-run is proven**.
- The portal currently **reads** the standalone app's `family-check-ins` for attendance (`features/setu/attendance/check-in-attendance.ts`). Turning that app off makes portal-native teacher attendance mandatory, i.e. `NEXT_PUBLIC_FEATURE_SETU_TEACHER=true` - which requirement 3 already assumes.

---

## 8. Requirement 7 - `+1`/NANP-only SMS at login

### 8.0 Launch posture: SMS is undeliverable, so sign-in is email-only

Per the measured state in §1.8, **SNS is in the sandbox with no origination number** - SMS OTP cannot reach any real family on Aug 3. A `+1` gate alone would therefore still leave every phone user on a screen waiting for a code that never arrives, which is exactly the silent failure this requirement exists to remove.

**Launch behaviour: hide the Phone option on `/sign-in` behind a flag (`NEXT_PUBLIC_FEATURE_SMS_OTP`, default off) and present email as the sign-in channel.** This is safe because §1.8 measured **100% email coverage across all 867 families**.

The `+1` gate below is still the correct code and should ship - it is what runs the day SNS is out of the sandbox and the flag flips on. It is written now, verified now, and dormant until then.

Server-side, the country check stays enforced regardless of the UI flag, so the mobile app and any direct API caller get the same typed error rather than a silent 200.

### 8.1 Hard constraint

**The gate goes in the route, never in `normalizeContactForKey`.** That function derives both the `contactKeys` doc ID and the Firebase Auth UID (§1.7). Changing it re-keys identities: sign-in misses the existing family and a brand-new auth user is created. `69132b1` was deliberately careful about this.

### 8.2 Work

1. `POST /api/setu/auth/send-code` - after normalization (`route.ts:48`), before the SMS branch (`:160`): if `type === 'phone'` and the canonical value does not start with `+1`, return a typed `400 { error: 'phone-country-unsupported' }`.
2. `POST /api/setu/auth/verify-code` - mirror it, or a non-`+1` user burns verify attempts against a code that was never sent.
3. `sign-in/page.tsx:241-247` - client pre-check; surface the new error; update the hint at `:237-239` and placeholder at `:236`.
4. `sns.ts:17-19` - belt-and-braces: refuse and log any non-`+1` publish so no path can silently bill an undeliverable international SMS.
5. **`apps/portal/docs/MOBILE_API_CHANGELOG.md`** - required; the mobile app calls the same `send-code`.

### 8.3 The design tension to get right

`send-code` currently returns `200 {success:true}` for **unknown** contacts by design (anti-enumeration, `route.ts:128-135`). The new error must be **distinguishable for the country case** without revealing whether a `+1` number is registered. Rule: the country check runs on the **shape of the input**, before any family lookup - so it leaks nothing about who exists.

### 8.4 Profiles are unaffected

Any-country phone numbers on profiles **already work** via registration, which verifies by **email** (`register/family/page.tsx:358-364`). Only the login SMS path is gated.

**Known limitation, not fixed here:** adding a phone to an existing profile (`/family/settings/contacts` → `/api/setu/contacts/send-code`) requires an SMS OTP, so a non-`+1` number cannot be added that way. Registration is unaffected. Recorded as follow-up, not launch-blocking.

### 8.5 Pre-existing data caveat

International numbers registered **before** `69132b1` (2026-07-24) were stored as `+1` + all their digits (e.g. `+1919876543210`). That commit deliberately did not re-key them and no migration exists. Those families' keys derive from the corrupted form. **Nobody has scanned prod/UAT for how many such rows exist** - worth a read-only count during cutover.

---

## 9. Production cutover track

Executed per `docs/runbooks/production-cutover-checklist.md`. Not re-specified here; the runbook is authoritative. The batch adds these to it:

- `audit_log` → portal-owned collection list (§3)
- Any new composite indexes from §4.4 → §5 deploy step, **without `--force`**
- A dated §14 entry for this batch

### Golden rules that constrain everything above

1. Prod `chinmaya-setu-715b8` is **shared** with the live standalone check-in app. Be purely additive.
2. **Never** `firebase deploy --only firestore:indexes --project chinmaya-setu-715b8 --force`.
3. **Never** touch `family-check-ins`, `guest-families`, or RTDB `/roster`.
4. `NEXT_PUBLIC_*` are statically inlined - an env-only change does nothing without a rebuild.
5. `NEXT_PUBLIC_*` are sensitive-by-default on Vercel Production - add with `--no-sensitive` or the client bundle silently gets `undefined`.

### Not described anywhere in the repo

The **domain re-point**. `setu.chinmayatoronto.org` is currently served by a different Vercel project (`cmt-setu-coming-soon`). Moving it to `cmt-setu` is a launch-day step with no existing runbook entry. **This needs an owner and a rehearsal.**

---

## 10. Sequencing and what is cuttable

**Ordering principle:** cutover-blocking work first; feature work behind it; anything unfinished on Sunday morning is a feature, never the cutover.

| Band | Items |
|---|---|
| **Decide first (blocks everything)** | D-A roster population, D-B teacher-roster backfill (§1.9). Both are human calls; both change what the features are built against. |
| **Must ship (cutover)** | Prod Firebase, indexes (no `--force`), **SES only** (SNS stays sandboxed - §1.8), flag flips, domain re-point, prod smoke E2E |
| **Must ship (small, low risk)** | Roster Reset (§6), email-only sign-in posture + `+1` gate (§8.0/§8.2), guest date-key fix D1 (§5.1) |
| **High value, medium risk** | Teacher attendance revamp (§4) |
| **High value, highest risk** | welcome-team full family edit + audit (§2) |
| **Cuttable to week 2** | Coordinator role (§3), `/welcome/visitors` (§5.2), guest→teacher E2E (§5.3) |

The Coordinator role is the cleanest cut: it is additive, affects no existing user, and its absence blocks nobody on launch Sunday.

**Not on the critical path, contrary to first appearances:** the SNS sandbox. It cannot be resolved by Aug 3, and it does not need to be - §1.8 measured 100% email coverage across all 867 families. Start the AWS sandbox-exit and origination-number requests now anyway, because they are long-lead and gate the eventual SMS flip.

---

## 11. Verification - non-negotiable per CLAUDE.md

Green `pnpm test` does **not** mean shipped working. Every item below is required, not aspirational.

1. **Deployed-UAT E2E for every user-facing route touched**, with a realistic multi-instance fixture in its *active* state. A route with no E2E is untested.
2. **The N=2 rule.** Every read path touched must be exercised with **two** of anything plural - two enrollments, two managers, two guest children, two programs. The single-instance fixture is the trap that let a real family's attendance silently vanish (2026-06-01).
3. **Index audit** on every query change (§4.4). Fake-firestore is index-blind.
4. **Full `pnpm test`** before pushing shared route/schema changes - integration tests live in separate dirs and targeted globs miss them.
5. **Mobile API changelog** entry for every `/api/setu/**` shape change (§8.2 at minimum).
6. **Never run the whole Playwright setu suite at once** - it cascades the OTP rate limiter. Run per-spec.
7. Summaries must state plainly what was verified in UAT versus what merely has passing unit tests.

### Specific traps for this batch

- **welcome-team users are usually also parents.** Their primary role is `family-member`; `welcome-team` sits in `extraRoles` (`middleware.ts:123-129`). Any handler comparing the raw `x-portal-role` string instead of using `readSessionFromHeaders`/`getServerSession` + `isWelcomeTeam()` will 403 the actual staff (§2.3). **The fixture must include a staff user who is also a family member** - a staff-only test account will pass while production fails.
- **Coordinator claims must survive sign-in** - `preservedExtras()` (`build-session-claims.ts:125-131`). Test by signing in, not by minting claims directly.
- **Audit rows must be written in the same transaction** as the mutation. Test the failure path: a rejected write must leave no audit row, and a successful write must never lack one.

---

## 12. Open items

| # | Item | Owner |
|---|---|---|
| **D-A** | **Bulk-migrate families or accept a near-empty launch roster (§1.9)** - decides whether requirements 1 and 2 have anything to show | **CMT Developer, before build starts** |
| **D-B** | **Resolve the runbook §6 step 8 self-contradiction (§1.9)** - decides whether teacher rosters are empty on launch Sunday; correct the runbook either way | **CMT Developer, before build starts** |
| O1 | Domain re-point rehearsal (§9) - no runbook entry exists | CMT Developer |
| O2 | Requirement 6 old-portal shutdown (§7) | CMT Developer |
| O3 | Count of pre-`69132b1` corrupted international phone keys (§8.5) | read-only scan during cutover |
| O6 | Open AWS support cases now: SNS sandbox exit, spend-limit raise, Canadian origination number (§1.8). Long-lead; not Aug-3-blocking. | CMT Developer |
| O7 | Confirm whether Stripe live mode is required at launch, or donations stay flag-off (`NEXT_PUBLIC_FEATURE_SETU_DONATIONS`). Not measured in this pass. | CMT Developer |
| O8 | Promote the SES/SNS diagnostics into `scripts/` (an SES equivalent of `debug-sns-config.ts` did not exist; one was written ad hoc for this pass) | follow-up |
| O4 | Confirm Reset leaves `?year=` untouched (§6) | CMT Developer - assumption stated |
| O5 | Teacher-visible donation status + parent contact is a deliberate privacy call (§4.6) | recorded, not blocking |
