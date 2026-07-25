# Authorization review: P1 v2 - Coordinator Role & Staff Cross-Family Edit

**Plan:** `docs/superpowers/plans/2026-07-25-launch-p1-roles-and-cross-family-edit-v2.md`
**Scope:** authorization correctness only. Every claim below was checked against the real files at `b1395e0` (branch `main`).
**Verdict:** REQUEST CHANGES - 2 critical, 9 major, 7 minor.

Mode: escalated to ADVERSARIAL after the first CRITICAL was confirmed (adjacent files - `revoke-sessions.ts`, `sevak-manager.tsx`, `seed-test-accounts.ts`, `middleware.ts` `dashboardForRole` - were pulled into scope and each yielded a finding).

---

## Summary of what the plan gets RIGHT (verified, not re-litigated below)

These were the five things I was asked to check hardest. All four route-rule placements are correct.

1. **Anchor placement (Task 4) is correct on every clause.** Real line numbers confirmed in `packages/shared-domain/src/auth/can-access-route.ts`: `:50` is the `/admin` page catch-all, `:53-58` teacher-assignments, `:61-63` calendar, `:67-69` teachers/*, `:72-74` the `/^\/api\/admin\/levels\/[^/]+\/teachers\/?$/` regex, `:75` the `/api/admin/` catch-all, `:112` the `/welcome/*` rule, `:246` `/api/welcome/families*`, `:250-253` the `/api/welcome/roster*` rule the plan deletes, `:315` default-deny.
   - The broad `/api/admin/levels` clause placed **below** the `:72-74` regex does **not** swallow `/api/admin/levels/{id}/teachers`. Confirmed there is exactly one route file at that depth (`app/api/admin/levels/[levelId]/teachers/route.ts`) and no `teachers/[uid]` sub-route, so the regex's `\/?$` anchor covers every real path. Welcome-team keeps teacher add/remove.
   - The new `/welcome` + `/welcome/roster*` clause returns `isWelcomeTeam || isCoordinator`, a strict superset of the `:112` clause it sits above for those exact paths. No revocation. Admin still passes (`isWelcomeTeam` inherits admin, `role.ts:48-52`).
   - The `/admin/programs*` and `/admin/levels*` page clauses above `:50` are supersets of `isAdmin`. No revocation.
   - Moving the `/api/welcome/roster*` rule from `:251` up to before `:112` shadows nothing: no clause between `:112` and `:250` matches that prefix.
2. **`/api/admin/` catch-all at `:75` is never loosened.** Verified the constraint is real: `app/api/admin/welcome-team/route.ts` (GET `:14`, POST `:35`) and `welcome-team/[uid]/route.ts` (DELETE `:5`) contain **zero** role checks.
3. **"Middleware is the per-page allow-list" (Task 6) HOLDS.** `middleware.ts:197` matcher excludes only static assets; `:101` calls `canAccessRoute(claims, pathname, req.method)` before any page renders; and `PUBLIC_ROUTES` (`packages/shared-domain/src/auth/public-routes.ts`) contains no `/admin/*` or `/welcome/*` entry, so `isPublicRoute` at `middleware.ts:65` cannot short-circuit an admin/welcome page. Widening `admin/layout.tsx` to `isAdmin || isCoordinator` therefore does **not** open the other ~12 `/admin/*` pages.
4. **Role inheritance is consistent.** Adding `'coordinator'` to `ROLES` changes nothing in `isAdmin`/`isTeacher`/`isFamily`/`isSetuFamily`/`isSetuManager`/`isWelcomeTeam`/`isKiosk` (`role.ts:26-60`) - none of them enumerate roles. `readSessionFromHeaderBag` validates against `ROLES` (`lib/auth/headers.ts:33,39`), so `x-portal-role: coordinator` and `x-portal-extra-roles: coordinator` both parse once Task 1 lands. `GrantRoleBodySchema`/`SevakRowSchema` derive from `GRANTABLE_ROLES` (`sevak.ts:7,17,26`), so `/api/admin/users` accepts the new role with no route edit - the plan is right not to list one.
5. **Track B's claim is correct.** `can-access-route.ts:246` (`pathname === '/api/welcome/families' || pathname.startsWith('/api/welcome/families/')` -> `isWelcomeTeam(claims)`) covers `/api/welcome/families/[fid]`, `/[fid]/members`, `/[fid]/members/[mid]` for all methods, and coordinator is correctly DENIED (`isWelcomeTeam` does not inherit coordinator). No new rule needed. Also confirmed `app/api/welcome/families/route.ts` does not exist and `migration-status/route.ts` is the only child today.
6. **Task 5's nine in-handler anchors are all accurate** (`programs/route.ts:12,34`; `programs/[key]:16`; `offerings/route.ts:11,37`; `offerings/[oid]:21`; `levels/route.ts:41,67`; `levels/[levelId]:16`; `levels/[levelId]/teachers:30`; `teacher-assignments:27`; `teachers/search:12`), including the `!session ||` prefixes it calls out. Task 10's anchors (`page.tsx:42`, `:73`, comment `:66-69`) are accurate. `members/route.ts:118,124` raw-header claim is accurate.
7. **No over-granting against spec 3.1's "Still excluded" list.** Coordinator is denied `/admin/users`, `/admin/school-year*`, `/admin/locations`, `/welcome/reports`, `/api/welcome/reports*`, `/api/setu/family/search`, `/api/admin/calendar*`, `/api/welcome/families/*` (family edit) - each falls to an existing `isAdmin`/`isWelcomeTeam` clause below the new insertions. The three widened welcome-team clauses (teacher-assignments, teachers/*, levels/{id}/teachers) are all in spec 3.1's grant table. Not touching the calendar clause at `:61-63` is correct.

Everything below is a defect.

---

## CRITICAL

### C1. A deleted family member keeps `coordinator` forever - `RESURRECTABLE_SEVAK_CAPS` is never widened

**Confidence: HIGH. Evidence:**

`apps/portal/src/features/setu/auth/revoke-sessions.ts:33`
```ts
export const RESURRECTABLE_SEVAK_CAPS: Capability[] = ['admin', 'welcome-team'];
```
consumed at `apps/portal/src/app/api/setu/members/[mid]/route.ts:493` (`stripCaps: RESURRECTABLE_SEVAK_CAPS`) on the member DELETE path.

The plan touches `Capability` (Task 1, `role-claims.ts:16`) and both session-minting sites (Task 2) but **never mentions `RESURRECTABLE_SEVAK_CAPS`**. It is a literal array, not derived, so widening `Capability` does nothing for it.

The escalation chain, all verified:
1. Task 2 Step 4 adds `if (isCoordinatorUser && !isAdminUser) extras.push('coordinator');` to `preservedExtras()` (`build-session-claims.ts:125-131`). Those extras land in `claims.extraRoles` at `:160-166` / `:184-190`.
2. `app/api/setu/auth/verify-code/route.ts:98` persists them: `await auth.setCustomUserClaims(uid, claims);`
3. On the next sign-in, `build-session-claims.ts:88-95` reads `customClaims.extraRoles` back into `existingExtraRoles`, merged into `allExistingRoles` at `:105-108`.
4. Task 2 Step 3 computes `isCoordinatorUser = allExistingRoles.has('coordinator') || ...`, Task 2 Step 5 removes the `/register` bounce for that user **and** mints `{ role: 'coordinator' }` in the `result.source === null` chain at `:210-223`.

So: grant coordinator to a family member -> they sign in once (claim persists) -> a manager deletes them from the family -> `revokeMemberSessions` strips only `admin`/`welcome-team` -> `coordinator` survives on both auth uids -> next sign-in `findSetuFamilyByContact` returns `source: null` -> **a standalone `role: 'coordinator'` session is minted for a person who is no longer in the system.** That grants the full roster (every family's PII via `/api/welcome/roster/report`) plus program/level/pricing write access.

This is precisely the failure mode the file's own header comment warns about (`revoke-sessions.ts:20-25`: *"for a DELETED member, escalates into a standalone admin/welcome-team session"*). Task 2 is what makes it reachable - before Task 2 a family-less coordinator could not get a session at all, so the plan **creates** this hole and does not close it.

No test will catch it: `apps/portal/src/app/api/setu/members/[mid]/__tests__/route.test.ts:25` hardcodes the mock as `RESURRECTABLE_SEVAK_CAPS: ['admin', 'welcome-team']`.

**Realist check:** no mitigation applies. There is no deployment gate, monitoring, or upstream retry that revokes a persisted Firebase custom claim, and detection is silent (nothing logs a resurrected session). Retained privilege after removal is a security finding by definition, so no downgrade.

**Fix (Task 1 or Task 2, with a test):**
```ts
// revoke-sessions.ts
import { GRANTABLE_ROLES } from '@cmt/shared-domain';
// Derive so the next grantable role is covered for free.
export const RESURRECTABLE_SEVAK_CAPS: Capability[] = [...GRANTABLE_ROLES];
```
and update the mock at `members/[mid]/__tests__/route.test.ts:25`. Add a Task 2 test: persisted `extraRoles: ['coordinator']` + `source: null` mints a coordinator session, and a Task 8/9 test that member delete strips it.

---

### C2. The coordinator's ONLY data endpoint 403s - `api/welcome/roster/report` is missing from Task 5

**Confidence: HIGH. Evidence:**

```ts
// apps/portal/src/app/api/welcome/roster/report/route.ts:17-20
  const session = readSessionFromHeaders(req);
  ...
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
```

Task 4 Step 6 grants `/api/welcome/roster*` to `isWelcomeTeam || isCoordinator`. Task 5's file list is **nine handlers, all under `apps/portal/src/app/api/admin/`** - this route is not among them, and no other task touches it. `isWelcomeTeam` does not inherit coordinator (Task 1 pins that deliberately), so the handler returns 403.

`/welcome/roster` is the only welcome-side screen the role is granted, and this is its only data source: `roster-client.ts:9` (`fetchRosterReportClient`) and `roster-export-button.tsx:42` (CSV) both hit it. `fetchRosterReportClient` throws on non-OK (`roster-client.ts:10`), so the coordinator lands on a roster that renders nothing.

This is the identical failure class that got v1 rejected - a `canAccessRoute` grant with no matching in-handler widening - reproduced in the v2 plan on the one route its own Task 11 E2E step 1 asserts ("lands on `/welcome/roster` with rows rendered"). That E2E would catch it, but only after Tasks 1-10 are built and deployed.

**Realist check:** fails closed, no data exposure, and the Task 11 E2E would eventually surface it. But it ships the role in a state where it reaches nothing, which the plan's own "Known risk" section calls *"worse than not shipping it"*, and the whole reason v2 exists is to close this exact gap. Not downgraded: it is a shipped-broken authorization on the role's primary surface.

**Fix:** add `apps/portal/src/app/api/welcome/roster/report/route.ts:19` to Task 5's file list and Step 4's shared-handler group:
```ts
if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles }) &&
    !isCoordinator({ role: session.role, extraRoles: session.extraRoles })) {
```
with the same three-case test (primary coordinator / coordinator in `extraRoles` / plain family-manager denied). Then sweep every `/api/welcome/*` handler Task 4 grants, not just `/api/admin/*`.

---

## MAJOR

### M1. Task 6 never passes `role="coordinator"` to the welcome sidebar

`apps/portal/src/app/welcome/layout.tsx:57-62`:
```tsx
{allowed ? (
  admin ? (
    <AdminSidebarLive ... />
  ) : (
    <DesktopSidebarLive role="welcome-team" displayName="Welcome team" subtitle="Welcome team" showSignOut showTeacher={showTeacher} />
  )
```
`role="welcome-team"` is a hardcoded literal. Task 6's file list for this file names only `:34`, `:88-90`, `:103-105`, and Step 3 widens only those gates. Step 5 says *"Select it wherever `WELCOME_NAV_ITEMS` is chosen today"* - that selection lives at `desktop-sidebar.tsx:100-101` and keys off the `role` prop, which nothing will ever set to `'coordinator'`.

Result: the coordinator gets the **full welcome-team sidebar** - Reports, Levels & rosters, Seva, Prasad (`desktop-sidebar.tsx:65-73`) - every one of which middleware denies, so each click 302s a signed-in user to `/sign-in?...&error=unauthorized`. The plan's own Task 6 Step 1 test (`render(<DesktopSidebar role="coordinator" />)`) will pass while production shows all five links.

**Fix:** in `WelcomeChromeAndChildren`, compute `const coordinatorOnly = !admin && !isWelcomeTeam(raw) && isCoordinator(raw);` (or simply `!isWelcomeTeam(raw)` inside the widened `allowed` branch) and pass `role={coordinatorOnly ? 'coordinator' : 'welcome-team'}` plus a matching `displayName`/`subtitle`. Add `app/welcome/layout.tsx:61` to Task 6's file list.

### M2. Making `canSeeAdminOnly` a required prop breaks `welcome/layout.tsx:59` (typecheck)

Task 6 Interfaces: *"`admin-sidebar` accepts a `canSeeAdminOnly: boolean` prop"* (required). `AdminSidebarLive` has a **second** call site the plan does not list: `apps/portal/src/app/welcome/layout.tsx:59`
```tsx
<AdminSidebarLive displayEmail={email ?? 'Admin'} hasFamily={hasFamily} showTeacher={showTeacher} />
```
`AdminSidebarLive` is `Omit<AdminSidebarProps, 'active'>` (`admin-sidebar.tsx:186`), so a required prop makes this a compile error in a file Task 6's `git add` does include but whose change it never describes. `pnpm typecheck` in Step 6 fails.

**Fix:** either declare `canSeeAdminOnly?: boolean` defaulting to `true` (safer for the existing call site), or explicitly instruct passing `canSeeAdminOnly` from `welcome/layout.tsx` (an admin is the only role that reaches that branch, so `true`).

### M3. `admin-mobile-nav.tsx` has no `NAV_GROUPS` - "apply the identical change" is not implementable

Task 6 Step 4 ends with *"Apply the identical change to `admin-mobile-nav.tsx`."* That file has a completely different shape:
- `admin-mobile-nav.tsx:11-16` `TABS` - bottom tab bar: Home `/admin`, Programs `/admin/programs`, Levels `/admin/levels`, Calendar `/admin/calendar`. **Two of the four (`/admin` and `/admin/calendar`) are denied to a coordinator** and are not in any group the plan describes filtering.
- `:22-31` `MORE_THEMED` - `/welcome`, `/admin/users`, `/admin/school-year`, `/admin/prasad`, `/admin/volunteering-skills`, `/admin/locations`, `/welcome/seva`, `/welcome/reports`. All denied to a coordinator.
- `:33-38` `MORE_LEGACY` - four `/check-in/admin/*` paths, all denied.

An implementer following the instruction literally will find no `NAV_GROUPS` to edit and either skip the file (shipping a mobile nav that is ~90% dead links for the new role) or invent a shape.

**Fix:** spell out the mobile nav separately - filter `TABS` to Programs + Levels, hide the entire "More" sheet's themed and legacy groups for a non-admin, and thread the same `canSeeAdminOnly` prop from `admin/layout.tsx:98`.

### M4. The admin sidebar's "Dashboard" link is outside `NAV_GROUPS` and stays visible

`admin-sidebar.tsx:108-125` renders a Dashboard `<Link href="/admin">` **before** the `NAV_GROUPS.map` at `:126`. Task 6 Step 4 filters only group items, so a coordinator keeps a top-of-nav link to `/admin`, which `can-access-route.ts:50` denies -> `middleware.ts:189` bounces them to `/sign-in`.

**Fix:** gate the Dashboard link on `canSeeAdminOnly` too (or point coordinators at `/admin/programs`).

### M5. `middleware.ts dashboardForRole()` has no coordinator branch

```ts
// apps/portal/src/middleware.ts:145-151
function dashboardForRole(role: unknown): string | null {
  if (role === 'family-manager' || role === 'family-member') return '/family';
  if (role === 'admin') return '/admin';
  if (role === 'welcome-team') return '/welcome';
  if (role === 'kiosk') return '/check-in';
  return null;
}
```
Not mentioned in any task. Two consequences:
1. A signed-in standalone coordinator who visits `/`, `/sign-in`, `/register`, or `/register/family` (`AUTH_ENTRY_ROUTES`, `:10`) is **not** redirected to a dashboard (`:51-52` needs a non-null return) and is shown the marketing/sign-in page while holding a valid session.
2. Every authorization denial routes them to `/sign-in` (`deny()` `:179-193`, `/welcome*` and `/admin*` are both `isSetuRoute`), where the same null return means they are not bounced back out. Combined with M1/M3/M4's dead links this reads as "signing out at random".

Task 2 fixes `build-session-claims`'s `redirectTo` (the post-sign-in hop) but that is a different code path from this one.

**Fix:** add `if (role === 'coordinator') return '/welcome/roster';` to `dashboardForRole`, in Task 2, with a middleware test.

### M6. The coordinator's roster is a dead end - `/welcome/family/[fid]` is not granted

Every roster row is a link into family detail:
```tsx
// apps/portal/src/features/setu/roster/roster-browser.tsx:134
<Link key={row.fid} href={`/welcome/family/${row.fid}`} ...>
// ... and :172 for the search-hit card
```
`/welcome/family/*` falls to `can-access-route.ts:112` -> `isWelcomeTeam(claims)` -> **false for coordinator**. So the single granted screen's primary interaction 302s to `/sign-in?from=/welcome/family/X&error=unauthorized` (and, per M5, stalls there).

The plan does not raise this. Spec 3.1 grants "Roster" and its exclusion list says *"family edit"*, not family read - so this needs an explicit decision, not silence. Task 11 Step 3's assertion is only *"lands on `/welcome/roster` with rows rendered"*, which passes while the feature is unusable.

**Fix:** either (a) grant `/welcome/family/*` GET to coordinator (read-only; note `welcome/family/[fid]/members/[mid]/page.tsx:43` re-checks `isWelcomeTeam` and would also need widening, and Task 10's grade editor must stay `isWelcomeTeam`-gated so a coordinator cannot edit), or (b) record the decision that coordinator roster is list-only and suppress the row links for that role. Either way add the E2E assertion.

### M7. Task 1 claims "two build breaks, not three" - there are four; `sevak-manager.tsx` is missing entirely

`apps/portal/src/features/admin/users/sevak-manager.tsx` is in neither Task 1's file list nor its `git add`, and widening `GrantableRole` breaks it in two places:
```ts
// :67-69
function snapshotRoles(row: SevakRow): Record<GrantableRole, boolean> {
  return { admin: row.roles.includes('admin'), 'welcome-team': row.roles.includes('welcome-team') };
}
// :116
const [draft, setDraft] = useState<Record<GrantableRole, boolean>>({ admin: false, 'welcome-team': false });
```
Both are `Record<GrantableRole, boolean>` object literals missing the new key -> TS2739. Step 4's explicit instruction *"Two build breaks, not three - do not use build failures alone as the checklist"* is wrong and actively misleads: it tells the implementer to stop looking after `roles-reference.ts` and `role-badges.tsx`.

This also matters beyond typecheck. `saveDraft` at `:197-198` computes
```ts
const toRevoke = GRANTABLE_ROLES.filter((r) => !draft[r] && openRow.roles.includes(r));
```
If either literal were widened with the wrong default (or if someone silences the error with a cast), an admin opening the drawer for an existing coordinator and pressing Save would compute `!undefined === true` and **silently revoke the coordinator grant**. The compiler catches it today; the plan should name the file so nobody casts around it.

**Fix:** add `apps/portal/src/features/admin/users/sevak-manager.tsx` to Task 1's file list, `git add`, and commit message; correct "two build breaks" to four; seed `coordinator: false` in both records.

### M8. Task 2's test file does not exist

Task 2 names `apps/portal/src/features/setu/auth/__tests__/build-session-claims.test.ts` and Step 1 says *"Follow the fixture style already in this file"*. That file is **not present**. The directory contains:
```
build-session-claims-gate.test.ts
build-session-claims-kiosk.test.ts
build-session-claims-teacher.test.ts
```
Step 2's `vitest run .../build-session-claims.test.ts` will report "No test files found", which reads as a pass to a careless implementer and leaves the highest-risk task (session minting for a brand-new standalone role) untested.

Ironic given the plan explicitly corrects two other test paths ("note: `src/__tests__/`, not `src/auth/__tests__/`").

**Fix:** point Task 2 at a new `build-session-claims-coordinator.test.ts` and name `build-session-claims-kiosk.test.ts` as the pattern - kiosk is the exact precedent (a family-less role gated by `allExistingRoles`, `:123`).

### M9. Task 11's family-attached coordinator persona has no machinery in the seed script

Task 11 Step 1 widens only `StandalonePersona.role`. Two other sites block it:
- `apps/portal/scripts/seed-test-accounts.ts:200` `async function grantStandaloneRole(email: string, role: 'admin' | 'welcome-team')` - a second hardcoded union.
- `interface FamilyPersona` (`:74-88`) has **no** role/extraRoles/sevak-grant field at all, and nothing in the script writes `roleAssignments` for a family mid.

So *"Add a second coordinator persona attached to a family, so the realistic `role='family-manager'` + `extraRoles=['coordinator']` shape is covered"* cannot be done by adding an array entry - it needs a new `FamilyPersona.sevakRoles` field plus a `roleAssignments/{mid}` write. That persona is the one the plan itself calls load-bearing ("A staff-only persona passes while production fails") and is the only way Task 5's `extraRoles` handling and C1's resurrection path get exercised end to end.

**Fix:** add the `grantStandaloneRole` union widening and a `FamilyPersona.sevakRoles?: GrantableRole[]` field (writing `roleAssignments/{mid}`) to Task 11 Step 1 explicitly.

---

## MINOR

### m1. `/api/welcome/families/migration-status` stays denied but the strip renders for coordinators
`roster-browser.tsx:318` renders `<MigrationStrip/>` unconditionally; `roster-client.ts:15` fetches `/api/welcome/families/migration-status`, which `can-access-route.ts:246` restricts to `isWelcomeTeam`. A coordinator sees a "Check migration status" button that always fails. It fails quiet by design (`migration-strip.tsx:10-12` and the `state === 'error'` branch), so this is cosmetic - but the plan should say whether the strip is hidden for coordinators or the endpoint is opened.

### m2. The admin school-year scope bar is hardcoded `canManage`
`app/admin/layout.tsx:73` and `:95` render `<SchoolYearScopeBar years={years} liveYear={liveYear} canManage />`. `canManage` renders a link to the manage screen (`school-year-scope-bar.tsx:207-209`, `:242-243`), i.e. `/admin/school-year`, which a coordinator is denied. Contrast `welcome/layout.tsx:70`, which correctly passes `canManage={admin}`. Task 6 should pass the new `adminOnly` flag here.

### m3. Task 6's `adminOnly` return does not compile as described
`raw` is block-scoped inside `if (sessionCookie) { ... }` (`admin/layout.tsx:33-49`); the function returns at `:50`. *"return `adminOnly: isAdmin(raw as unknown as WithRole)`"* needs a hoisted `let adminOnly = false;` set inside the block, not an expression at the return.

### m4. The gated-member short-circuit is not coordinator-aware
`build-session-claims.ts:152` and `:177` read `if (isMemberGated(result.member) && !isAdminUser && !isWelcomeTeamUser)`. Task 2 does not add `!isCoordinatorUser`, so a `portalAccess: 'pending'` member holding a coordinator grant gets `{ pendingApproval: true }` and no session. This fails **closed**, so it is not a security issue, but it is inconsistent with Task 2's stated goal and will look like a bug in UAT. Decide and record it either way.

### m5. Off-by-one anchors (the plan asserts line numbers were re-verified against `b1395e0`)
- `ROLE_REFERENCE_ORDER` is `roles-reference.ts:92-100`; plan says `:93-101`.
- `WELCOME_NAV_ITEMS` is `desktop-sidebar.tsx:65-73`; plan says `:66-74`.
- `NAV_GROUPS` is `admin-sidebar.tsx:16-40`; plan says `:16-38`.
- `welcome-mobile-nav.tsx` hardcodes **five** links at `:37-51`; plan says `:37-49`.
- `StandalonePersona` is `seed-test-accounts.ts:89-95`; plan says `:88-94`.
- Task 6 says "pass it into the sidebar and mobile nav at `:62` and `:85`" - those are the destructure lines in `admin/layout.tsx`; the actual render sites are `:71` (`AdminSidebarLive`) and `:98` (`AdminMobileNav`).
- Task 6 preamble says `welcome/layout.tsx` "`:88-90` and `:103-105`"; the actual guards are single lines `:90` and `:105` (Step 3 gets this right).

### m6. Coordinator display name falls through to "Family member"
`desktop-sidebar.tsx:103-105` only special-cases `'welcome-team'` and `'teacher'` for the name/avatar fallback. A `role="coordinator"` sidebar with no `displayName` renders "Family member". Cosmetic, but it is in the file Task 6 edits.

### m7. The welcome layout is not a gate on mobile
`welcome/layout.tsx:122-137` (the `block md:hidden` branch) renders `{children}` with **no** role check; only `WelcomeChromeAndChildren` (desktop) gates. So Task 6's premise - *"A coordinator who clears middleware lands on an access-denied screen"* - is only true on desktop for `/welcome`. Middleware still protects the route, so this is not exploitable, but the "three gates" model has two on mobile and the plan should not imply otherwise. Pre-existing, not introduced here.

---

## Gate-completeness matrix (Track A)

| Granted route | Gate 1 canAccessRoute (T4) | Gate 2 in-handler (T5) | Gate 3 page layout / render (T6) |
|---|---|---|---|
| `/admin/programs`, `/admin/programs/[key]` | yes | n/a (page) | yes (`admin/layout.tsx:37`); no in-page check exists - verified |
| `/admin/levels` | yes | n/a (page) | yes; no in-page check exists - verified |
| `/api/admin/programs`, `/programs/[key]` | yes | yes (`:12,34`; `[key]:16`) | n/a |
| `/api/admin/offerings`, `/offerings/[oid]` | yes | yes (`:11,37`; `[oid]:21`) | n/a |
| `/api/admin/levels`, `/levels/[levelId]` | yes | yes (`:41,67`; `[levelId]:16`) | n/a |
| `/api/admin/levels/[id]/teachers` | already open, widened | yes (`:30`) | n/a |
| `/api/admin/teacher-assignments` | widened | yes (`:27`) | n/a |
| `/api/admin/teachers/search` | widened | yes (`:12`) | n/a |
| `/welcome`, `/welcome/roster` | yes | n/a | layout gate yes (`welcome/layout.tsx:34/:90/:105`) but **sidebar role not wired - M1** |
| `/api/welcome/roster/report` | yes | **MISSING - C2**, handler 403s at `:19-20` | n/a |

**The matrix is how C2 surfaced.** Task 5 scoped itself to `app/api/admin/` and never swept the `/api/welcome/*` route Task 4 also grants. `app/welcome/roster/page.tsx` has no in-page role check (verified), so the layout is the only page-side gate there - that part is fine.

Track B gates are complete as specified: middleware `:246`, in-handler `isWelcomeTeam(session)` in each new route (Task 9 Step 3), render gate widened at `welcome/family/[fid]/members/[mid]/page.tsx:73` (Task 10 Step 3). Note that `PATCH /api/welcome/families/[fid]` (Task 9 Step 4) ships with **no UI** - spec 2.2 step 5 asks for family-level edit affordances on `/welcome/family/[fid]` and no task delivers them. Not an authorization defect, but the plan's self-review claims full 2.2 coverage.

---

## Recommended minimum before implementation

1. Widen `RESURRECTABLE_SEVAK_CAPS` (C1) - blocking.
2. Add `api/welcome/roster/report/route.ts` to Task 5 and sweep all `/api/welcome/*` grants (C2) - blocking.
3. Wire `role="coordinator"` at `welcome/layout.tsx:61` and make `canSeeAdminOnly` optional (M1, M2).
4. Rewrite Task 6 Step 4's mobile-nav instruction against the real `TABS`/`MORE_THEMED`/`MORE_LEGACY` shape, and gate the Dashboard link (M3, M4).
5. Add `dashboardForRole` to Task 2 (M5).
6. Decide and record `/welcome/family/[fid]` for coordinator (M6).
7. Add `sevak-manager.tsx` to Task 1 and correct "two build breaks" to four (M7).
8. Fix Task 2's test path to a new `build-session-claims-coordinator.test.ts` (M8).

