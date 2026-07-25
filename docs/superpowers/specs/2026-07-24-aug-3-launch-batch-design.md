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
| Coordinator role | **New role.** ~~Roster + Programs only~~ **SUPERSEDED 2026-07-25 by Vaibhav's list (CMT Developer confirmed): rosters + visitors + program management + levels + teacher assignments.** Still excluded: users/roles, school-year rollover, locations, reports, donations. See §3. |
| W&R edit power | **Full family edit** (everything a family manager can do, on any family) **+ audit log**. |
| "Canadian numbers" at login | **`+1` / NANP** (Canada + US). No area-code allowlist. |
| Requirement 6 (turn off old portal) | **Owned by CMT Developer.** Out of scope for this spec, but sequenced against in §9. |
| If it doesn't fit in 5 days | Plan the full batch; CMT Developer adds capacity. |
| SMS sign-in | **Unsupported, with an explicit error.** Phone numbers are still collected for **WhatsApp**. See §8.0. |

### 0.1 This spec is one of three (split decided 2026-07-25)

Vaibhav's 2026-07-25 note restated this meeting and added two genuinely new features. Of his ten items, seven were already specced here or already shipped in `b1395e0`; one (visitor grade filter, §5.4) is a small addition folded in. The two new ones get **their own specs**, because they carry policy that is not yet finalized, need different reviewers (accounting; program leadership), and must be able to slip **without** taking the production cutover with them:

| Spec | Covers | Status |
|---|---|---|
| **This one** - `2026-07-24-aug-3-launch-batch-design.md` | Production cutover + roles + teacher view + visitors + roster reset + SMS posture | Ready for planning |
| `2026-07-25-adult-study-class-design.md` | Adult Study Class program, BV-exemption fee logic, which-parent selection, both-parents-teachers rule | To be written |
| `2026-07-25-monthly-pledge-pad-design.md` | Monthly pledge via pre-authorized debit: bank-detail capture, cheque upload, `processing` donation state, accounting hand-off | To be written |

All three target Aug 3. The dependency runs one way: the two new specs consume the **Coordinator role** and **programs** surfaces defined here, so this spec is built first.

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

### 1.9a RESOLVED: D-A and D-B (CMT Developer, 2026-07-24)

**D-A resolved: bulk-migrate at production cutover.** Runbook §6 step 2 runs. Verified consequences below.

**D-B resolved: do NOT run the BV enrollment backfill** (runbook §6 step 8). The 2026-07-20 note is correct and the "Recommended for launch" sentence above it is stale and must be deleted from the runbook. Teachers see returning students through the existing **"Not in this class yet"** section instead; marking one present enrolls them. Requirement: that list must be visibly populated on launch Sunday, while the Enrolled roster behaves normally.

#### D-B verification (code-level, done)

The section exists and is wired end to end:
- UI: `features/setu/teacher/components/not-in-class-section.tsx:177` heading, `:192` the copy quoted by CMT Developer
- It renders **two groups**: *Previous students* (carry-forwards, passed server-side) and *Registered · not enrolled* (lazy-loaded on expand via `GET /api/setu/teacher/grade-eligible`)
- Read model: `features/setu/teacher/grade-eligible.ts:68-123`

**It populates from exactly what the bulk migration writes**, so D-A is what makes D-B work:
- `grade-eligible.ts:78` - `families.where('location','==', level.location)`; `lazy-migrate.ts:197` writes `location: legacy.location` ✅
- `grade-eligible.ts:109-117` - needs `type:'Child'` + `schoolGrade`; `lazy-migrate.ts:177-183` writes both ✅
- `grade-eligible.ts:89-99` - excludes children already actively enrolled for the level's `pid` ✅
- Bulk reads only, **no new Firestore index** (`grade-eligible.ts:58-62`) ✅
- Roster data supports it: **1,061 children in the snapshot, 100% have a grade** ✅

> **Caveat W1 - the silent Brampton default (CORRECTED 2026-07-25).** `legacy-parser.ts:112-116` `mapLocation()` returns **`'Brampton'`** for any unrecognised centre. Measured in the snapshot, the legacy `center` field holds: `Brampton` 1,411 rows, **`"NULL"` 574 rows**, `Scarborough` 548 rows, `"ALL"` 10 rows. At family level, **299 of 867 families (34%) have no usable centre on any row** and migrate as Brampton.
>
> **An earlier revision of this spec claimed 124 of those have an active child. That was wrong** - the measuring script treated the literal string `"NULL"` as a level value. Corrected measurements:
> - **0 of the 299 have an ACTIVE child** (no row carries a real `level`). Every one is dormant.
> - **0 families are misassigned.** There is no case where the parser's `first.center` is NULL while another row of the same family carries a real centre, so `mapLocation(first.center)` never silently mis-picks a centre for an active family. The Brampton default only ever fires on all-NULL families.
> - Of the 299: **124 have any child row, 119 have a child whose legacy grade maps to a `schoolGrade`, totalling 190 children.** Join dates cluster 2020-2023, `classyear` is NULL throughout, payment is `Unpaid`.
>
> **So the risk is the inverse of what was first stated.** Scarborough loses nothing. The real effect is that **~190 dormant children with stale grades would land in Brampton teachers' "Registered · not enrolled" lists** on launch Sunday, because that list is location + grade driven and *not* enrollment driven. A child last registered in Grade 2 in 2023 is now in Grade 5, so they would surface in the wrong level and never appear in class. See §1.9b for the resolution.

> **Trap M1 - the migration would silently use the June 10 snapshot.** `migrate-legacy-families.ts:28` → `listAllFamilies` (`family-lookup.ts:212-217`) → `readRtdb`, and `readRtdb` (`packages/firebase-shared/src/admin/rtdb.ts:45-52`) returns snapshot data **and never touches the network** whenever `RTDB_SNAPSHOT_DIR` is set - which CLAUDE.md instructs you to keep set in `apps/portal/.env.local`.
>
> The local snapshot is `capturedAt: 2026-06-10T11:39:05Z` (`.rtdb-snapshot/meta.json`), i.e. **~7.7 weeks stale at launch**, spanning the summer registration season. Running the prod bulk migration as-is would migrate June-10 data and silently omit every family registered or changed since - with no error.
>
> **Resolution: refresh the snapshot immediately before the prod migration.** Cost is negligible - the whole snapshot is **1.6 MB** (`roster.json` 1,682,067 bytes), so at RTDB's ~$1/GB that is **~$0.0016**, a fraction of a cent. The CLAUDE.md cost rule targets repeated full-node reads in dev/test loops, not one deliberate pre-cutover capture.
> ```bash
> pnpm --filter @cmt/portal snapshot:rtdb   # one live read; rewrites .rtdb-snapshot/
> ```
> Then diff the family count against the current 867 before migrating, so the drift is a measured number rather than an assumption.

### 1.9b W1 resolution: grade-first migration, parent completes the rest (CMT Developer, 2026-07-25)

**The proposal:** the migration carries the child's grade so level placement works; anything missing is filled in by the parent at first sign-in, because their profile is flagged incomplete.

**Verified: the self-healing half already works, and it fixes the stale-grade problem.**
- `REQUIRED_CHILD = ['schoolGrade', 'birthMonthYear']` (`member-required-fields.ts:42`)
- `lazy-migrate.ts:185` writes **`birthMonthYear: null`** for every migrated child
- ⇒ **every migrated child is incomplete by construction**, so the `/family` gate (`app/family/layout.tsx:55,76`) diverts the manager to `/complete-profile` on first sign-in, where `schoolGrade` is re-confirmed alongside the birth month.
- ⇒ a stale 2023 grade is corrected by the parent at the moment they return, exactly as intended. The migration does **not** need to guess how many years to advance a dormant child.

**One gap: `location` is never asked.** The completion gate checks the member matrix plus `isFamilyAddressComplete` (street/city/province/postal). **Neither the gate nor `complete-profile-form.tsx` collects the CMT centre.** The family home address is not the centre - a Mississauga family may attend either. So a family that migrates with the wrong centre stays wrong until staff fix it.

**And `location` cannot simply be left empty.** `FamilyDocSchema.location` is `z.string().min(1)` - non-nullable, non-optional, and **validated on read** (`schemas/family.ts:55`). Writing `null` or `''` would fail validation on *every subsequent read* of that family doc. Widening it is exactly the doc-schema-read-validation trap the repo already has a rule about, so it is not a casual change.

**Resolution: skip dormant families in the bulk migration.** A family with **no centre on any row AND no active level on any row** is not migrated at cutover. Rationale:
- It removes all 190 stale children from Brampton's grade-eligible list, which is the actual launch-day symptom.
- Nothing is lost. Those families are not deleted - `lazyMigrateLegacyFamily` still runs on their first OTP sign-in, kiosk check-in, or teacher add, at which point they enter Setu with a real centre and a parent-confirmed grade.
- It matches the principle already adopted for the 2026-07-20 rollover change: do not pre-create records; let a family's own engagement create them.
- It needs no schema change, no gate change, and no new form field.

Implementation: a filter in `migrate-legacy-families.ts` (dormant = every row's `center` is NULL/empty **and** every row's `level` is NULL/empty), reported in the run summary and the `--csv-out` file so the skipped set is auditable rather than silent.

**Residual, accepted:** an *active* family whose centre is genuinely wrong in the legacy data is not self-correcting. Welcome-team can fix it once the family-edit work in §2 ships, which is in this same batch.

### 1.9c Skipped families must stay findable AND be asked for their centre (CMT Developer, 2026-07-25)

**Requirement:** a family skipped by the dormant filter must still be found when they sign in or register, and because we already know their centre is unknown, they must be **asked** for it.

#### Part 1 - findability: already works, verified

- `find-family-by-contact.ts:62-71` - when the `contactKeys` lookup misses, it falls back to `legacyFindFamilyByContact` against the legacy roster. Pre-migration families sign in normally.
- On a legacy hit, `build-session-claims.ts:174` runs `lazyMigrateLegacyFamily`, so the family enters Setu at that moment. The kiosk path does the same at `resolve-kiosk-family.ts:70`.
- Contact coverage of the 299 dormant families, measured: **299 have an email, 238 also have a phone, 0 have neither.** Every one is reachable, and email is the launch sign-in channel (§1.8).

⇒ Skipping them at bulk-migration time costs them nothing. Nobody becomes unfindable.

#### Part 2 - the centre prompt: registration is fine, sign-in is NOT

- **Registration already asks.** `/register/family` has a required *Primary location* picker (`register/family/page.tsx:59`, validated at `:337`, rendered `:508-519`) fed by `GET /api/setu/locations`.
- **Sign-in does not.** The lazy path runs `legacy-parser.ts:224` `mapLocation(first.center)`, which **silently returns `'Brampton'`** for an unknown centre. A returning dormant family would be assigned Brampton without anyone being asked - precisely the outcome this requirement rejects.

#### Part 3 - the fix

`location` itself cannot be made empty: `FamilyDocSchema.location` is a read-validated `z.string().min(1)` (`schemas/family.ts:55`) and many consumers (grade-eligible, roster filters, level matching, search) assume a string. So the unknown-ness is carried by an **additive marker** instead, leaving `location` a valid string throughout.

1. **Schema** - add `locationNeedsConfirmation: z.boolean().nullable().optional()` to `FamilyDocSchema`. Nullable + optional, so it is safe on read for every existing doc (this widens, it never tightens).
2. **Parser** - `mapLocation` reports whether it fell back to the default; `lazy-migrate` persists `locationNeedsConfirmation: true` in that case. Bulk-migrated families with a real centre never get the flag.
3. **Gate** - `ProfileCompletionGate` (`app/family/layout.tsx:55`) adds the manager-scoped check next to the existing `isFamilyAddressComplete` one, so a returning family is diverted to `/complete-profile` exactly as it already is for a missing home address.
4. **Form** - `complete-profile-form.tsx` gains a centre selector, shown only when the flag is set. This fits the existing shape: the form already collects **family-level** fields (`familyAddress`, `ProvinceSelect` at `:17`, `:203`, `:238-242`), and `/api/setu/locations` is already family-readable (`can-access-route.ts:199-205`). On save, `location` is set and the flag is cleared.

**Both changes ship together and are complementary:** the dormant skip keeps the 190 stale-grade children out of Brampton's teacher lists on launch Sunday, and the centre prompt guarantees that any of those families who *do* return are asked for their centre instead of being silently defaulted.

**Bonus:** the flag doubles as a work queue - welcome-team can be shown "families with an unconfirmed centre" once the §2 edit surface exists.

### 1.9 The two decisions that outrank the features (now resolved - see §1.9a)

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
- Sole exception: `MemberGradeEditor` at `welcome/family/[fid]/members/[mid]/page.tsx:73-80` posts to `/api/admin/school-year/set-grade`, which is **admin-only** - and is itself gated on `admin &&` at `:73`, so welcome-team never sees it

> **CORRECTED 2026-07-25.** An earlier draft of this section claimed welcome-team users are shown `MemberGradeEditor` and get a live **403** when they use it. **That bug does not exist.** Line 73 reads `{admin && profile.type === 'Child' && (`, so the control is never rendered for welcome-team - there is no 403 because there is nothing to click. What is true is the plain statement above it: **welcome-team has no way to edit a child's grade at all.** That is a missing capability, not a broken one. Requirement 1 asks for the capability; plan it as new work, not as a fix, and do not write a test asserting a 403 that never fires.

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
6. **Give welcome-team a grade editor** - widen the `admin &&` gate at `welcome/family/[fid]/members/[mid]/page.tsx:73` to admin-or-welcome-team, and point the component at the new staff member-PATCH route rather than the admin-only `set-grade` endpoint. (Corrected 2026-07-25: this is new capability, not a 403 fix. See the note under §1.2.)
7. **Last-manager guard** must hold on the staff paths too (existing rule: every demotion path checks it).

### 2.3 Risks

- **Route access needs THREE independent gates, not one.** Added 2026-07-25 after the coordinator-role plan was written against `canAccessRoute` alone - every one of its six API grants and both page grants would have been dead on arrival. A role reaches a route only if all three pass:
  1. **`canAccessRoute`** (`packages/shared-domain/src/auth/can-access-route.ts`), called once from `middleware.ts:101`. It returns at the **first matching rule**, so a broad rule placed above a narrow one silently replaces it. Narrow grants must be inserted *above* the catch-alls.
  2. **The page layout.** `app/admin/layout.tsx:56` renders "Access denied. Admin role required." for any non-admin; `app/welcome/layout.tsx:75` does the same for non-welcome-team. A page grant that is not also matched here renders an access-denied screen to a user the middleware just let through.
  3. **The in-handler check.** `api/admin/{programs,offerings,levels}/route.ts` each re-check `isAdmin` internally. An API grant not matched here still 403s.

  **Consequence:** any task that adds a role must widen all three layers together, and each layer needs its own test - a green `canAccessRoute` unit test proves nothing about whether the route actually answers. This is also why §2.2 step 6 is a UI gate change (`page.tsx:73`) *and* a route change, not just a route change.

- **Privilege boundary.** These are the first endpoints where the acting user's `fid` and the target `fid` differ. Every handler must derive the target `fid` from the **route param** and the authority from the **session**, never mix them.
- **Read roles through the helpers, never the raw header.** `middleware.ts:118` sets `x-portal-role` to the **primary** role only; extras go into a separate comma-separated `x-portal-extra-roles` header (`middleware.ts:123-129`). A welcome-team member who is also a parent has `role='family-member'`, `extraRoles=['welcome-team']` - so a bare `x-portal-role` string comparison **403s real staff**, who are usually also parents.
  The correct readers already exist and the newer `/api/welcome/*` routes already use them: `readSessionFromHeaders` (`lib/auth/headers.ts:53`) and `getServerSession` (`lib/auth/server-session.ts:13`), combined with `isWelcomeTeam()` / `isAdmin()`.
  The **old** pattern is what to avoid - `/api/setu/members/route.ts:118` does `role !== 'family-manager'` on the raw header. The extraction in §2.2 step 1 should carry the new routes onto the helper-based pattern rather than propagate the header comparison.
  > This is the single most likely launch-day bug in this requirement, and it fails *closed* (staff locked out), so it will surface immediately in testing rather than silently.
- `audit_log` must be added to the runbook's portal-owned collection list (§3 of the cutover checklist).

---

## 3. Requirement 2 - Coordinator role

### 3.1 Scope (REVISED 2026-07-25 - Vaibhav's definition, confirmed by CMT Developer)

Coordinator sits **above** welcome-team. Granted:

| Area | Routes |
|---|---|
| **Roster** | `/welcome/roster` + `GET /api/welcome/roster/report` |
| **Visitors** | `/welcome/visitors` (new, §5.2) + its read API |
| **Programs** | `/admin/programs`, `/admin/programs/[key]`, `/api/admin/programs`, `/api/admin/programs/[key]` |
| **Offerings + pricing** | `/api/admin/offerings`, `/api/admin/offerings/[oid]` - **added 2026-07-25.** Program *amounts* live in `offering.pricingTiers`, written through this API. Without it a coordinator sees the offerings panel and gets a **403 on save**. Required by the Adult Study Class spec §4.3b (coordinators set the class fee). |
| **Levels** | `/admin/levels` (Level management) + `/api/admin/levels/*` |
| **Teacher assignments** | `/api/admin/teacher-assignments/*`, `/api/admin/teachers/*`, `/api/admin/levels/[id]/teachers` |

Still **excluded**: users/roles (`/admin/users`), school-year rollover, locations, reports, donations, family edit.

**Most of the added surface is nearly free.** `can-access-route.ts:51-73` already opens teacher-assignments, `teachers/search`, and `levels/[id]/teachers` to `isAdmin || isWelcomeTeam` - Coordinator joins those existing clauses. Only `/admin/levels` **page** access and full level CRUD are genuinely new grants.

> **Security constraint (unchanged and non-negotiable):** every grant is an explicit per-route clause placed **above** the `/api/admin/` catch-all at `:75`. That prefix is never loosened, because `/api/admin/welcome-team*` has no in-handler role check (§1.3) and widening the prefix would let a Coordinator grant welcome-team.

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
4. **Grade filter on the visitor list** (added 2026-07-25 from Vaibhav's list) - teachers filter visitors by school grade. Cheap: `getLevelVisitorsView` already carries `grade` on every `VisitorRow` (`visitors.ts:25-31`) and already grade-matches to the level, so this is a client-side filter control, no new read and no index.

> Already shipped in `b1395e0`, listed here because Vaibhav's note restates them as requirements: per-child **name + school grade** capture, and **mandatory parent email + phone** on the guest form. No further work - the contact fields are enforced at the route, and grade drives the level matching in `guestMatchesLevel` (`visitors.ts:15-23`). The outstanding items are 1-4 above.

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

### 8.0 Launch posture: SMS sign-in is unsupported and says so (REVISED 2026-07-25)

**Decision (Vaibhav's wording, confirmed by CMT Developer):** keep collecting international phone numbers - they are used for **WhatsApp outreach**, not authentication - and **show an explicit error if someone tries to sign in by SMS, because that method is not supported.**

This supersedes the earlier "hide the Phone option behind a flag" plan, and it is the better design:
- It matches the measured reality exactly (§1.8: SNS sandboxed, no origination number, so SMS reaches nobody).
- It is honest. A user who expects SMS is *told why* and redirected to email, instead of finding the option mysteriously absent.
- It removes the launch dependency on the `+1`/NANP gate entirely - **"no SMS" is a strictly simpler rule than "some countries only"**.

**Behaviour:**
- `/sign-in` keeps the Phone/Email toggle. Choosing Phone shows an inline notice: SMS sign-in is unavailable, please use your email address. The submit path is blocked client-side.
- `POST /api/setu/auth/send-code` returns a typed **`400 { error: 'sms-signin-unsupported' }`** for `type: 'phone'`, so the mobile app and any direct API caller get the same clear answer rather than today's silent `200` with no code (`route.ts:173`).
- `verify-code` mirrors it, so no one burns verify attempts against a code that was never sent.
- Phone number **capture** is untouched everywhere else: registration, member add/edit, and profile all keep accepting any country's number for WhatsApp.

**Gating:** the block is controlled by one flag (`NEXT_PUBLIC_FEATURE_SMS_OTP`, default **off**). When SNS eventually clears the sandbox and an origination number is registered, flipping it on restores SMS sign-in, and *that* is when the `+1`/NANP gate in §8.2 becomes the operative rule. The gate is written and tested now, dormant until then.

> Safe because §1.8 measured **100% email coverage across all 867 families** - 767 with both, 100 email-only, zero phone-only.

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
| **Cutover data steps (decided - §1.9a)** | Refresh the RTDB snapshot (trap M1), bulk-migrate families (D-A), **skip** the BV enrollment backfill (D-B), verify "Not in this class yet" is populated per level |
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
| ~~D-A~~ | RESOLVED - bulk-migrate at cutover (§1.9a) | done |
| ~~D-B~~ | RESOLVED - skip the BV backfill; rely on "Not in this class yet" (§1.9a). **Runbook §6 step 8 must have its stale "Recommended for launch" sentence deleted.** | done |
| ~~W1~~ | RESOLVED (§1.9b) - skip dormant families (no centre **and** no active level) in the bulk migration; they lazy-migrate on first engagement. Earlier "124 with an active child" figure was a measuring error; corrected to **0 active, 190 stale children across 119 dormant families**. | done |
| ~~W2~~ | RESOLVED (§1.9c) - additive `locationNeedsConfirmation` flag + gate check + centre selector on `/complete-profile`, so an unknown-centre family is asked instead of silently defaulted to Brampton. Findability verified: legacy fallback works and **all 299 dormant families have an email, 0 have neither contact**. | done |
| **W3** | An **active** family whose legacy centre is simply *wrong* (not missing) is not flagged and does not self-correct. Fixed by welcome-team edit (§2). Accepted for launch. | accepted |
| **M1** | **Refresh `.rtdb-snapshot` before the prod migration** (§1.9a) - it is 7.7 weeks stale and `readRtdb` prefers it silently. ~$0.0016. | **CMT Developer, at cutover** |
| O1 | Domain re-point rehearsal (§9) - no runbook entry exists | CMT Developer |
| O2 | Requirement 6 old-portal shutdown (§7) | CMT Developer |
| O3 | Count of pre-`69132b1` corrupted international phone keys (§8.5) | read-only scan during cutover |
| O6 | Open AWS support cases now: SNS sandbox exit, spend-limit raise, Canadian origination number (§1.8). Long-lead; not Aug-3-blocking. | CMT Developer |
| O7 | Confirm whether Stripe live mode is required at launch, or donations stay flag-off (`NEXT_PUBLIC_FEATURE_SETU_DONATIONS`). Not measured in this pass. | CMT Developer |
| O8 | Promote the SES/SNS diagnostics into `scripts/` (an SES equivalent of `debug-sns-config.ts` did not exist; one was written ad hoc for this pass) | follow-up |
| O4 | Confirm Reset leaves `?year=` untouched (§6) | CMT Developer - assumption stated |
| O5 | Teacher-visible donation status + parent contact is a deliberate privacy call (§4.6) | recorded, not blocking |
