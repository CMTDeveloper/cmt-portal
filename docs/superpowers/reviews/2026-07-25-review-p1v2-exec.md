# Executability Review: P1 v2 (Coordinator Role & Staff Cross-Family Edit)

**Plan:** `docs/superpowers/plans/2026-07-25-launch-p1-roles-and-cross-family-edit-v2.md`
**Repo HEAD at review:** `1dc320f` (plan claims line numbers were "re-verified against `b1395e0`")
**Scope:** executability only. Can a competent engineer who has never seen this codebase follow it without getting stuck or guessing?

**VERDICT: REJECT (6 critical, 14 major, 11 minor)**

v2 is a large improvement on v1 in one dimension: line-number accuracy is genuinely high (Task 5's nine handler citations are byte-exact, `middleware.ts:101/118/123-129/197` are exact, `can-access-route.ts:50/53-58/61-63/67-69/72-74/75/112/246/251-253` are exact, `members/route.ts:29-45/118/124/296` are exact). But it repeats the v1 defect class it claims to have fixed: **Task 1 does not typecheck as scoped**, two test files it says to "append to" cannot be appended to verbatim, one test file it names does not exist, and Track B is not independent of Track A.

---

## Pre-commitment predictions vs actual

| Predicted | Actual |
|---|---|
| Line numbers drifted | Mostly NOT drifted. High accuracy. 4 minor drifts only. |
| A `Record<Role\|GrantableRole, ...>` consumer missed | **Confirmed, twice, in a file the plan never names** (C1). |
| Test files in wrong directories | Confirmed once (C2), and two "append" targets already contain the code (M2). |
| `--project node/jsdom` mismatches | NOT found. All flags match the file extensions. |
| Placeholder test bodies | Confirmed in Tasks 2, 3, 5, 8, 9, 10 (M8, M9, M11, M14). |

---

# CRITICAL

## C1. Task 1 misses TWO compile-breaking sites in a file the plan never mentions. Task 1 cannot typecheck or be committed as written.

The plan states at Task 1 Step 4 (line 210) and again in the Task 1 commit message (line 292):

> `Adding to `GRANTABLE_ROLES` breaks `role-badges.tsx` (a `Record<GrantableRole, ...>`). **Two build breaks, not three** - do not use build failures alone as the checklist`

This is wrong. There are **four** build breaks. The two the plan misses are both in `apps/portal/src/features/admin/users/sevak-manager.tsx`, which appears **nowhere** in the plan: not in the File Structure table (lines 59-73), not in Task 1's Files block (lines 97-105), not in Task 1 Step 7's `git add` list (lines 277-284).

`apps/portal/src/features/admin/users/sevak-manager.tsx:67-69`:
```ts
function snapshotRoles(row: SevakRow): Record<GrantableRole, boolean> {
  return { admin: row.roles.includes('admin'), 'welcome-team': row.roles.includes('welcome-team') };
}
```

`apps/portal/src/features/admin/users/sevak-manager.tsx:116`:
```ts
const [draft, setDraft] = useState<Record<GrantableRole, boolean>>({ admin: false, 'welcome-team': false });
```

Both are `Record<GrantableRole, boolean>` initialized with object literals that will be missing the `coordinator` key the moment `sevak.ts:6` gains `'coordinator'`. TS2739 ("Type ... is missing the following properties") at both sites.

- **Why this matters:** Task 1 Step 6 runs `pnpm typecheck` and the plan says "Expected: PASS." It will not pass. The implementer then has to modify a file the plan never scoped, and Step 7's `git add` list does not include it, so a literal follow of Step 7 produces a commit that does not build. This is precisely the v1 defect ("tasks that could not typecheck on their own") that v2's own preamble at line 95 says it exists to fix.
- **Confidence:** HIGH. Verified by reading both lines.
- **Fix:** Add `apps/portal/src/features/admin/users/sevak-manager.tsx` to the File Structure table, to Task 1's Files block as `Modify: ...sevak-manager.tsx:67-69,91-96,116,587`, and to Step 7's `git add`. Correct line 210 and the commit body to say **four** build breaks. Show the replacement:
```ts
function snapshotRoles(row: SevakRow): Record<GrantableRole, boolean> {
  return Object.fromEntries(
    GRANTABLE_ROLES.map((r) => [r, row.roles.includes(r)]),
  ) as Record<GrantableRole, boolean>;
}
```
and the same construction for the `useState` initializer.

## C2. Task 2's test file does not exist. Two of its commands cannot run, and its only fixture guidance points at nothing.

Task 2 Files block (line 310):
> `- Test: `apps/portal/src/features/setu/auth/__tests__/build-session-claims.test.ts``

That file does not exist. `ls apps/portal/src/features/setu/auth/__tests__/` returns:
```
build-session-claims-gate.test.ts
build-session-claims-kiosk.test.ts
build-session-claims-teacher.test.ts
contact-key-doc-type.test.ts
find-family-by-contact.test.ts
firebase-rest.test.ts
integration-find-and-migrate.test.ts
list-sevaks.test.ts
magic-links.test.ts
manage-roles.test.ts
member-roles.test.ts
mint-password-session.test.ts
revoke-sessions.test.ts
```

Consequences:
1. Step 2 (line 345) and Step 6 (line 389) both run `pnpm --filter @cmt/portal exec vitest run src/features/setu/auth/__tests__/build-session-claims.test.ts --project node`. Vitest exits with "No test files found", not the plan's stated "Expected: FAIL - first two assertions get `{ redirectTo: ... }`".
2. Step 1's only guidance is line 340: `Follow the fixture style already in this file. Match the neighbouring welcome-team cases exactly - a coordinator fixture is the welcome-team one with the role string swapped.` There is no "this file" and there are no "neighbouring welcome-team cases" to match. The nearest analogue is `build-session-claims-kiosk.test.ts`, which the plan never names.

- **Why this matters:** This is exactly the v1 rejection reason ("wrong file paths ... test file locations"). The implementer is blocked at Step 1 with no discoverable pattern.
- **Confidence:** HIGH.
- **Fix:** Change the test target to `apps/portal/src/features/setu/auth/__tests__/build-session-claims-coordinator.test.ts` (matching the existing `-gate` / `-kiosk` / `-teacher` naming), point the fixture guidance at `build-session-claims-kiosk.test.ts` by name, and update both `vitest run` paths. Also write out a real call: `buildSessionClaimsForContact` takes `{ type: 'email' | 'phone'; value: string; contactProvenance: 'otp' | 'magic-link' | 'password' }` (`build-session-claims.ts:10-14`), which the plan's `buildSessionClaimsForContact(/* coordinator-only contact fixture */)` never states.

## C3. Task 6 never threads `role="coordinator"` into the sidebar. `COORDINATOR_NAV_ITEMS` ships as dead code and a coordinator sees four links that middleware denies.

`apps/portal/src/app/welcome/layout.tsx:57-62`:
```tsx
{allowed ? (
  admin ? (
    <AdminSidebarLive displayEmail={email ?? 'Admin'} hasFamily={hasFamily} showTeacher={showTeacher} />
  ) : (
    <DesktopSidebarLive role="welcome-team" displayName="Welcome team" subtitle="Welcome team" showSignOut showTeacher={showTeacher} />
  )
) : (
```

The `role` prop at `:61` is a **hardcoded string literal**. Task 6's Files block (lines 833-841) lists `welcome/layout.tsx` at `:34`, `:88-90`, `:103-105` only. Step 3 (lines 915-923) edits `:34`, `:90`, `:105` and the copy at `:75`. Nothing in Task 6 touches `:61`.

So after Task 6, a non-admin coordinator passes the widened `:34` gate, reaches `<DesktopSidebarLive role="welcome-team" ...>`, and `desktop-sidebar.tsx:101-102` selects `WELCOME_NAV_ITEMS`:
```ts
const navItems =
  role === 'welcome-team' ? WELCOME_NAV_ITEMS : role === 'teacher' ? TEACHER_NAV_ITEMS : familyNavItems();
```
`WELCOME_NAV_ITEMS` (`desktop-sidebar.tsx:66-74`) contains Reports (`/welcome/reports`), Levels & rosters (`/welcome/levels`), Seva (`/welcome/seva`), Prasad (`/welcome/prasad`) - all four denied to a coordinator by Task 4's own rules.

- **Why this matters:** The plan ships exactly the failure it names in its own commit message at line 979 ("mirroring the welcome-team group would have rendered four links (Reports, Levels & rosters, Seva, Prasad) that middleware denies"). Task 11 Step 3 assertion 7 ("The welcome sidebar shows Roster and **not** Reports / Levels & rosters / Seva / Prasad") fails against deployed UAT. The unit test in Task 6 Step 1 renders `<DesktopSidebar role="coordinator" />` directly and passes, so nothing catches it before UAT.
- **Confidence:** HIGH.
- **Fix:** Add `welcome/layout.tsx:61` to Task 6's Files block and Step 3, with explicit code. `admin` is already computed at `:39`; add a `coordinatorOnly` flag and pass it:
```tsx
<DesktopSidebarLive
  role={coordinatorOnly ? 'coordinator' : 'welcome-team'}
  displayName={coordinatorOnly ? 'Coordinator' : 'Welcome team'}
  subtitle={coordinatorOnly ? 'Coordinator' : 'Welcome team'}
  showSignOut showTeacher={showTeacher}
/>
```
where `coordinatorOnly = !isWelcomeTeam(raw as unknown as WithRole) && isCoordinator(raw as unknown as WithRole)`.

## C4. Task 9's `Actor` construction does not typecheck. `session.uid` is `string | null`.

Task 8 Interfaces (line 1129) defines:
> `interface Actor { uid: string; mid: string | null; role: string }`

Task 9 Step 3 (line 1287) constructs it:
```ts
actor: { uid: session.uid, mid: session.mid ?? null, role: session.role },
```

`session` comes from `readSessionFromHeaders(req)`. `apps/portal/src/lib/auth/headers.ts:3-12`:
```ts
export interface PortalSessionHeaders {
  uid: string | null;
  role: Role;
  extraRoles: Role[];
  fid: string | null;
  mid: string | null;
  ...
}
```

`session.uid` is `string | null`. Assigning it to `Actor.uid: string` is TS2322 under this repo's strict config. `headers.ts:23-24` documents this deliberately: *"Returns null only when x-portal-role is missing or not a known Role - uid absence is allowed because family-role routes authenticate via fid, not uid."*

- **Why this matters:** The plan's Self-review claims (line 1501) "`Actor` is defined once in Task 8 and constructed identically in Task 9." It is constructed identically and it does not compile. The implementer copies the shown route body verbatim and Task 9 Step 5's `pnpm test` gate fails on typecheck with no guidance on which side to change.
- **Confidence:** HIGH.
- **Fix:** Either widen `Actor.uid` to `string | null`, or add the guard the sibling handler already uses. `apps/portal/src/app/api/admin/levels/[levelId]/teachers/route.ts:27-29` is the precedent:
```ts
if (!session || !session.uid) {
  return NextResponse.json({ error: 'no-session' }, { status: 401 });
}
```
Show that exact form in Task 9 Step 3 (it also removes the redundant `session.mid ?? null`).

## C5. Track B is NOT independent of Track A. Task 9 needs Tasks 1 and 4, and edits the file Task 4 commits.

Architecture (line 7): *"They share no files and can be built in parallel by two people."*
Self-review (line 1505): *"**Track B (7→8→9→10) needs nothing from Track A** and can be built in parallel."*

Both statements are false. Task 9 Step 1 (lines 1238-1250) adds to `packages/shared-domain/src/__tests__/can-access-route.test.ts`:
```ts
it('denies a coordinator (family edit is excluded from the role)', () => {
  expect(canAccessRoute(coordinator, '/api/welcome/families/CMT-X', 'PATCH')).toBe(false);
});
```
1. `coordinator` is an identifier declared only in **Task 4 Step 1's** snippet (line 520). It does not exist in the file today (the file's consts at `can-access-route.test.ts:5-11` are `admin, teacher, family, manager, member, welcomeTeam, kiosk`). A Track B worker starting from `main` gets TS2304 "Cannot find name 'coordinator'".
2. Even if they declare it, `{ role: 'coordinator' }` is not assignable to `SessionClaims` until **Task 1** widens `ROLES` at `packages/shared-domain/src/auth/role.ts:1`.
3. Task 9 Step 7's `git add` (line 1315) includes `packages/shared-domain/src/__tests__/can-access-route.test.ts`, the same file Task 4 Step 8 commits (line 677). Two parallel workers editing the same file is a guaranteed conflict, not a shared-nothing split.

- **Why this matters:** The plan's headline organizing claim is wrong, and "Known risk" (line 1509) tells the reader Track B can ship while Track A slips. It cannot, as scoped.
- **Confidence:** HIGH.
- **Fix:** Either move the three `canAccessRoute` cases from Task 9 Step 1 into Task 4 Step 1 (where `coordinator` is already in scope and the role type already exists), or restate Track B's dependency as "Tasks 7, 8, 10 are independent; Task 9 needs Task 1 and Task 4." Also drop `can-access-route.test.ts` from Task 9's `git add`.

## C6. Task 6 Step 4's "apply the identical change to `admin-mobile-nav.tsx`" is not executable. That file has no `NAV_GROUPS`, and its bottom tabs link to two routes a coordinator is denied.

Task 6 Step 4 (lines 927-929):
> `admin-sidebar.tsx` - add `coordinator?: true` to the `NAV_GROUPS` item type, mark **only** `{ label: 'Programs', ... }` and `{ label: 'Level management', ... }`, then accept `canSeeAdminOnly: boolean` and filter each group's items ... **Apply the identical change to `admin-mobile-nav.tsx`.**

`apps/portal/src/features/admin/components/admin-mobile-nav.tsx` has no `NAV_GROUPS`. Its structure is three separate constants:
```ts
// :11-16
const TABS: { id: Tab; label: string; icon: keyof typeof SetuIcon; href: string }[] = [
  { id: 'home',     label: 'Home',     icon: 'home',     href: '/admin' },
  { id: 'programs', label: 'Programs', icon: 'people',   href: '/admin/programs' },
  { id: 'levels',   label: 'Levels',   icon: 'check',    href: '/admin/levels' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/admin/calendar' },
];
// :22-31
const MORE_THEMED: { label: string; icon: keyof typeof SetuIcon; href: string }[] = [ ... 8 entries ... ];
// :33-38
const MORE_LEGACY: { label: string; href: string }[] = [ ... 4 entries ... ];
```

There is no "group's items" to filter and no group heading to drop. Worse, `TABS` is the always-visible bottom bar: `Home -> /admin` and `Calendar -> /admin/calendar` are both **denied** to a coordinator by Task 4's own tests (line 547: `['/admin', 'GET']` and line 555: `['/api/admin/calendar', 'POST']`; `/admin/calendar` falls to the `:50` catch-all `isAdmin`).

- **Why this matters:** The instruction cannot be followed as written, so the implementer improvises the mobile IA for a brand-new staff role, and the naive reading (filter nothing because there are no groups) ships a bottom nav where two of four tabs bounce at middleware. No test in Task 6 covers `admin-mobile-nav.tsx` (Step 1 only tests `DesktopSidebar` and `AdminSidebar`).
- **Confidence:** HIGH.
- **Fix:** Replace "apply the identical change" with explicit instructions for this file's actual shape: add `coordinator?: true` to `TABS` and `MORE_THEMED` entries, mark only `programs`/`levels` in `TABS` and nothing in `MORE_THEMED`/`MORE_LEGACY`, filter all three by `canSeeAdminOnly || item.coordinator`, and state what the "More" sheet renders when it is empty. Add an `admin-mobile-nav` test to Step 1.

---

# MAJOR

## M1. `revoke-sessions.ts:33` is a consumer of `Capability` the plan misses entirely. A coordinator capability survives member deletion and gets resurrected on next sign-in.

`apps/portal/src/features/setu/auth/revoke-sessions.ts:28-33`:
```ts
/**
 * Sevak capabilities that build-session-claims can resurrect from persisted
 * custom claims. These must be stripped from a member's auth uids when their
 * role/membership is removed - not just have their roleAssignment deleted.
 */
export const RESURRECTABLE_SEVAK_CAPS: Capability[] = ['admin', 'welcome-team'];
```

Used at `apps/portal/src/app/api/setu/members/[mid]/route.ts:493` as `stripCaps: RESURRECTABLE_SEVAK_CAPS` on the member DELETE path.

Task 2 Step 3 adds `allExistingRoles.has('coordinator')` as a resurrection source. So after Task 2 lands, deleting a member who holds `coordinator` strips `admin` and `welcome-team` from their auth claims but leaves `coordinator`, and the next sign-in mints a full coordinator session for a deleted member. This is the exact failure the comment above documents.

The plan never mentions `revoke-sessions.ts`. It is not in the File Structure table, not in any Files block. This adds no build error, so nothing catches it. `apps/portal/src/app/api/setu/members/[mid]/__tests__/route.test.ts:25` hardcodes the mock `RESURRECTABLE_SEVAK_CAPS: ['admin', 'welcome-team']`, so the route tests stay green either way.

- **Why this matters:** A stale privilege that survives member deletion, on a role the plan is introducing, on a launch path. Track B's Task 8 `deleteMember` will route staff deletes through the same code.
- **Confidence:** HIGH (the constant and its single call site are both verified).
- **Fix:** Add to Task 1 Step 4 or Task 2: `revoke-sessions.ts:33` becomes `['admin', 'welcome-team', 'coordinator']`, and update the mock at `[mid]/__tests__/route.test.ts:25` in the same commit.

## M2. The two "Append to" test snippets do not compile when appended, and the roles-reference one is justified by a premise that is false.

**`packages/shared-domain/src/__tests__/role.test.ts`** already begins (`:1-2`):
```ts
import { describe, it, expect } from 'vitest';
import { isAdmin, isTeacher, isFamily, isSetuFamily, isSetuManager, isWelcomeTeam, isKiosk, ROLES } from '../auth/role';
```
Task 1 Step 1 (line 115) says to append:
```ts
import { isAdmin, isCoordinator, isWelcomeTeam, ROLES } from '../auth/role';
```
TS2300 "Duplicate identifier" on `isAdmin`, `isWelcomeTeam`, `ROLES`.

**`apps/portal/src/lib/auth/__tests__/roles-reference.test.ts`** already begins (`:2-3`) with exactly the imports the plan says to append (line 153-154), same TS2300. Worse, the plan's justification (lines 157-160):
> `// ROLE_REFERENCE is compile-checked by the _exhaustive assert at`
> `// roles-reference.ts:105. ROLE_REFERENCE_ORDER is a plain Role[] and is NOT.`
> `// A role missing here gets a reference entry the Users & Roles panel never`
> `// renders - a silent omission. This test is the missing compile check.`

The test is not missing. `apps/portal/src/lib/auth/__tests__/roles-reference.test.ts:26-29`:
```ts
it('ROLE_REFERENCE_ORDER lists each role exactly once', () => {
  expect([...ROLE_REFERENCE_ORDER].sort()).toEqual([...ROLES].sort());
  expect(new Set(ROLE_REFERENCE_ORDER).size).toBe(ROLE_REFERENCE_ORDER.length);
});
```
Byte-identical first assertion to the plan's line 162. The plan's `it('covers every role in ROLES')` at line 161 also duplicates the existing `it` at `:6`, and its `it('has a reference entry for every ordered role')` duplicates `:6-9`.

**`packages/shared-domain/src/__tests__/can-access-route.test.ts`**: Task 4 Step 1 (line 521) declares `const welcomeTeam = { role: 'welcome-team' as const, uid: 'u2' };`. The file already declares it at `:10`: `const welcomeTeam: SessionClaims = { uid: 'w', role: 'welcome-team' };`. TS2451 "Cannot redeclare block-scoped variable".

- **Why this matters:** Three of the plan's four "append this" snippets fail to compile on first paste, and one of them is sold as closing a gap that is already closed. The plan's self-review claims "m2 -> line numbers re-verified against `b1395e0`" (line 1503); the *contents* of the target files were not.
- **Confidence:** HIGH.
- **Fix:** For each snippet, say "extend the existing import at `:2`" rather than showing a fresh import line. Delete the `ROLE_REFERENCE_ORDER` describe block and its justification comment entirely (Task 1 Step 2's "Expected: FAIL - ... `ROLE_REFERENCE_ORDER` missing `'coordinator'`" is still true via the existing `:27` assertion). For Task 4, reuse the file's existing `welcomeTeam` const and declare only `coordinator`.

## M3. Task 6's `AdminSidebar` test snippets omit two required props, and the plan never notes that `AdminSidebarLive` has a second call site.

`apps/portal/src/features/admin/components/admin-sidebar.tsx:8-14`:
```ts
interface AdminSidebarProps {
  active?: string;
  displayEmail: string;   // required
  hasFamily: boolean;     // required
  showTeacher?: boolean;
}
```
Task 6 Step 1 (lines 874, 884) writes `render(<AdminSidebar canSeeAdminOnly={false} />);` and `render(<AdminSidebar canSeeAdminOnly />);` with neither required prop. TS2739. The plan's stated failure reason (line 896) is only "`AdminSidebar` takes no `canSeeAdminOnly` prop", so the implementer is told to expect a different error than the one they get.

Separately, `AdminSidebarLive` (`admin-sidebar.tsx:186`, `Omit<AdminSidebarProps, 'active'>`) is rendered from **two** places: `apps/portal/src/app/admin/layout.tsx:71` and `apps/portal/src/app/welcome/layout.tsx:59`. Adding a required `canSeeAdminOnly: boolean` breaks both. The plan's Task 6 Step 3 only instructs passing it "at `:62` and `:85`" of `admin/layout.tsx` and never mentions `welcome/layout.tsx:59` (where the correct value is `true`, since that branch is admin-only).

- **Fix:** Add `displayEmail="a@b.c" hasFamily={false}` to both test renders. Add an explicit bullet to Step 3: "`welcome/layout.tsx:59` also renders `AdminSidebarLive`; pass `canSeeAdminOnly` there (that branch is `admin === true`)."

## M4. `AdminSidebar` renders a hardcoded "Dashboard" link to `/admin` that Task 6's filter never touches. A coordinator gets a nav link to a route they are denied.

`admin-sidebar.tsx:108-125` renders a `Dashboard` link to `/admin` **outside** `NAV_GROUPS`:
```tsx
{(() => {
  const dashboardActive = active !== '' && active === '/admin';
  return (
    <Link href="/admin" ... ><span>Dashboard</span></Link>
  );
})()}
```
Task 6 Step 4 (line 927) only says "filter each group's items with `canSeeAdminOnly || item.coordinator`. Drop any group left with zero visible items". The Dashboard link is not in a group. Task 4 Step 1's denial table (line 547) pins `['/admin', 'GET']` as false for a coordinator.

The plan's own rationale for excluding `/welcome/visitors` (line 44) is *"shipping a nav link to a 404 is worse than omitting it."* Same defect, same plan.

- **Fix:** Add to Step 4: "also gate the Dashboard link at `:108-125` on `canSeeAdminOnly`." Add `expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()` to the coordinator test at Step 1. (The footer identity block at `:170` also renders the literal label `Admin` for a coordinator; cosmetic, listed under Minor.)

## M5. The `welcome-mobile-nav.tsx:37-49` range is wrong and excludes the Reports link, which is the one that must be hidden.

Task 6 Step 5 (line 951): *"`welcome-mobile-nav.tsx:37-49` hardcodes five links and takes **no `role` prop**."*

Verified line numbers in `apps/portal/src/features/family/components/welcome-mobile-nav.tsx`:
```
37:      <Link href="/welcome/roster" ...>
40:      <Link href="/welcome/levels" ...>
43:      <Link href="/welcome/seva" ...>
46:      <Link href="/welcome/prasad" ...>
49:      <Link href="/welcome/reports" ...>
50:        <SetuIcon.info /> Reports
51:      </Link>
```
The five links span `:37-51`, not `:37-49`. `:49` is the opening tag of the Reports link; the plan's range cuts it in half. Reports is one of the four surfaces spec 3.1 excludes from coordinator (plan lines 40, 51).

The "takes no `role` prop" half is correct: the signature at `:15` is `({ isAdmin = false, hasFamily = false, showTeacher = false })`.

- **Fix:** Change the range to `:37-51`. Also note `:52-70` contains the conditional Teacher / Admin / My family / Sign out links, which the coordinator branch must decide on (Admin at `:58` is denied to a coordinator).

## M6. `firstMissingRequiredField` is specified two incompatible ways inside Task 8.

Task 8 Interfaces (line 1125):
> `- `firstMissingRequiredField(input, type): string | null``

Task 8 Step 3 (line 1164):
> `Move `addMemberSchema`, `REQUIRED_FIELD_ERROR`, `REQUIRED_FIELD_ORDER` and the picker at `:98-107` into `write-member.ts`, **exporting the picker as `firstMissingRequiredField`**.`

The picker is `apps/portal/src/app/api/setu/members/route.ts:103`:
```ts
function requiredFieldError(missing: MemberRequiredField[]): string | null {
```
It takes a `MemberRequiredField[]` (the output of `whatsMissingForMember`, imported at `route.ts:10`), not `(input, type)`. "Export the picker as `firstMissingRequiredField`" and "`firstMissingRequiredField(input, type)`" are different functions.

Task 9 Step 3 (line 1281) then calls `firstMissingRequiredField(parsed.data, parsed.data.type)`, and Task 8 Step 1's test (line 1136) calls `firstMissingRequiredField({ type: 'Child', firstName: 'A' }, 'Child')` - passing `type` both inside the object and as a second argument, with no statement of what happens if they disagree.

- **Why this matters:** The consuming task (9) and the producing task (8) can be built by different people, and the plan's Self-review (line 1501) asserts these names are consistent. They are not. The implementer must reverse-engineer that the new function wraps `whatsMissingForMember` (`packages/shared-domain/src/setu/member-required-fields.ts`), which the plan never names.
- **Fix:** State the signature once and show the body:
```ts
export function firstMissingRequiredField(
  input: Parameters<typeof whatsMissingForMember>[0],
  type: 'Adult' | 'Child',
): string | null {
  return pickFirst(whatsMissingForMember(input, type));  // pickFirst = the moved requiredFieldError
}
```
Drop "exporting the picker as" and say the picker is moved as a private helper.

## M7. Task 8 says `/api/setu/members/[mid]` delegates to the same core, but that file has a DIFFERENT required-field matrix. Delegating changes PATCH semantics and breaks Step 5's proof obligation.

Task 8 Files block (line 1118): `- Modify: `apps/portal/src/app/api/setu/members/[mid]/route.ts` (delegate)`. Step 4 (line 1168): "`/api/setu/members` and `/api/setu/members/[mid]` call the new functions with `actor: null`."

The `[mid]` route has its own, deliberately different matrix:
```
apps/portal/src/app/api/setu/members/[mid]/route.ts:47:const REQUIRED_FIELD_ERROR: Record<MemberRequiredField, string | null> = {
apps/portal/src/app/api/setu/members/[mid]/route.ts:61:const REQUIRED_FIELD_ORDER: MemberRequiredField[] = [
apps/portal/src/app/api/setu/members/[mid]/route.ts:70:function requiredFieldErrorPatch(missing: MemberRequiredField[]): string | null {
```
Note the value type is `string | null` (PATCH treats some fields as not-enforced), versus `Record<MemberRequiredField, string>` at `route.ts:51` (POST enforces all). The function is named `requiredFieldErrorPatch`, applied at `:206`.

Task 8 Step 3 only moves the POST copies (`route.ts` `:51`, `:66`, the picker). It never mentions that `[mid]` has a divergent matrix, nor whether the delegating PATCH keeps `requiredFieldErrorPatch` or adopts the POST one.

- **Why this matters:** Task 8 Step 5 (line 1178) states: *"Expected: PASS **with the existing route tests unmodified**. If a test needs editing, the refactor changed behaviour - stop and find out why."* An implementer who reads "delegate" as "use the shared matrix" will trip that gate with no diagnosis in the plan. An implementer who keeps `requiredFieldErrorPatch` gets two matrices in two places, which defeats the stated goal ("so the staff routes cannot drift from the family ones", line 1196).
- **Fix:** Say explicitly which matrix the shared `updateMember` uses, that `requiredFieldErrorPatch` stays in `[mid]/route.ts` (or moves as a second export `firstMissingRequiredFieldForPatch`), and that Task 9's member PATCH uses the PATCH variant, not the POST one.

## M8. Task 5's test guidance is one example generalized to roughly thirty tests across nine files, and the example does not match six of them.

Task 5 Step 1 shows three `it()` blocks for `programs` POST, then says (line 763): *"Repeat all three for each handler and each exported method."*

Actual exported methods, verified:
```
programs/route.ts               GET:7   POST:29
programs/[key]/route.ts         PATCH:8
offerings/route.ts              GET:9   POST:32
offerings/[oid]/route.ts        PATCH:13
levels/route.ts                 GET:39  POST:62
levels/[levelId]/route.ts       PATCH:11
levels/[levelId]/teachers/route.ts   POST:58  DELETE:72
teacher-assignments/route.ts    POST:22
teachers/search/route.ts        GET:9
```
That is 13 exported methods x 3 cases = 39 tests, in 9 files. The single example is for `POST(req)`. Six of these handlers take a second argument, e.g. `apps/portal/src/app/api/admin/levels/[levelId]/route.ts:11`:
```ts
export async function PATCH(req: Request, { params }: { params: Promise<{ levelId: string }> }) {
```
The plan's `await POST(req)` form does not work for them, and the plan never shows the `{ params: Promise.resolve({ levelId: 'x' }) }` shape. The bodies are `{ /* valid CreateProgramSchema payload */ }` and `{ /* valid payload */ }` - unstated for all nine.

The plan is also silent that `levels/[levelId]/teachers/route.ts` puts its check in a **shared `guard()` helper at `:22-55`** (the `isAdmin(session) && isWelcomeTeam(session)` test at `:30` is inside it), which serves both POST and DELETE. That is a useful fact the plan's per-line citation obscures.

- **Fix:** Show one worked example for a `[param]` handler with the `params: Promise<...>` argument, name `CreateProgramSchema` (confirmed to exist at `packages/shared-domain/src/setu/schemas/program.ts:48`) and give one concrete valid payload, and note the `guard()` helper at `teachers/route.ts:22` so the implementer does not hunt for two guards.

## M9. Task 10's three tests are empty placeholders, and the existing test file mocks the wrong seam for what the plan proposes.

Task 10 Step 1 (lines 1350-1354):
```tsx
it('posts to the staff route when staff is set', async () => { /* ... */ });
it('posts to the admin route by default, so rollover preview is unaffected', async () => { /* ... */ });
it('rejects a grade that is not a GRADE_LADDER rung', async () => { /* ... */ });
```
All three bodies are `/* ... */`. This is the v1 defect class ("tests described but not written out").

Compounding it: `apps/portal/src/features/setu/rollover/__tests__/member-grade-editor.test.tsx:15` does `vi.mock('../set-grade-client', () => ({ setGradeClient: vi.fn() }))`. Task 10 Step 4 (line 1388) says the staff path should "PATCH `/api/welcome/families/{fid}/members/{mid}`" directly, which is a raw `fetch` the existing mock does not intercept. The plan never says to mock `global.fetch`, and never says how the third test ("rejects a grade that is not a GRADE_LADDER rung") is even observable from the component - `member-grade-editor.tsx:51` already seeds state via `rungForCurrentGrade(currentGrade)` and only renders ladder options, which is why `:58-59` documents the existing cast as safe.

- **Fix:** Write the three test bodies out, including the `vi.stubGlobal('fetch', ...)` setup, and state what the third test asserts against (probably the new route handler, not the component).

## M10. Task 11's E2E command runs against localhost, contradicting the task's own requirement, and uses a form the repo does not document.

Task 11 Step 5 (line 1470):
```bash
pnpm test:e2e --project setu -- coordinator.spec.ts staff-family-edit.spec.ts
```
Step 3 (line 1452) requires: *"Assert, against **deployed** `cmt-setu.vercel.app`"*.

Root `package.json`: `"test:e2e": "pnpm --filter @cmt/portal exec playwright test"`. `apps/portal/e2e/README.md:27` documents that bare `pnpm test:e2e` *"auto-starts `next dev` on :3001 via the `dev:e2e` script"*, and `:29` gives the deployed form:
```
PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm test:e2e
```
`README.md:32` gives the single-project form as `pnpm --filter @cmt/portal exec playwright test --project=setu dashboard` - `--project=setu` with `=`, and a bare positional filter with no `--` separator.

So the plan's command (a) runs local, not deployed, which is the one thing Task 11 exists to prevent and which the repo has a known local-dev hang issue on `/family`, and (b) uses `--project setu -- <files>` where `pnpm run` consumes the first `--`, giving unpredictable arg forwarding.

- **Fix:** `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu coordinator staff-family-edit`.

## M11. Task 3's tests are comment-placeholders, and the "follow the pattern" pointer names the wrong file's pattern.

Task 3 Step 1 (lines 428-438):
```ts
it('includes a coordinator granted via roleAssignments', async () => {
  // seed a roleAssignments doc with roles: ['coordinator']
  const rows = await listSevaks();
```
The seeding is a comment. Then line 441:
> `Follow the mocking pattern already in this file. Note `member-roles.test.ts` mocks `@cmt/firebase-shared/admin/firestore` wholesale (`mockGet.mockResolvedValue({ exists: true, data: () => ({ roles: [...] }) })`) - there is no `seedRoleAssignment` fixture helper, so do not call one.`

That pointer is misleading for this file. `apps/portal/src/features/setu/auth/__tests__/list-sevaks.test.ts` does not use `mockGet` at all. It mocks the *module boundary* (`:48-52`):
```ts
vi.mock('../member-roles', () => ({
  addMemberRole: vi.fn(),
  removeMemberRole: vi.fn(),
  listMembersWithRole: mockListMembersWithRole,
}));
```
and seeds via `list-sevaks.test.ts:100`:
```ts
mockListMembersWithRole.mockImplementation(async (role: string) => {
  if (role === 'admin') { return [ ... ]; }
```
To add a coordinator you extend that `mockImplementation`, not a `mockGet`. Similarly the second test ("granted via auth claims") is seeded through `mockListUsers`, not Firestore at all.

- **Fix:** Point at `list-sevaks.test.ts:100` by line, show the added `if (role === 'coordinator') return [...]` branch and the `mockListUsers` entry, and delete the `member-roles.test.ts` sentence (it is about a different file solving a different problem).

## M12. Task 3 Step 3's central rewrite is prose only.

Line 461:
> `Then replace the two hardcoded merge loops that follow (`:231` and `:237`) with one loop over `GRANTABLE_ROLES.entries()` zipped against `assignmentsByRole`, adding each role to the matching mid's `roles` set. Keep the existing `roleByMid` map shape unchanged.`

Every other edit in Task 3 (and in Task 4, Task 5, Task 7) is shown as code. This one is not, and it is the only structurally non-trivial one: the current code (`manage-roles.ts:229-241`) has a `?? { fid: a.fid, roles: new Set<GrantableRole>() }` default plus an `if (!entry.fid && a.fid) entry.fid = a.fid;` fixup per loop that must be preserved.

- **Fix:** Show the replacement loop.

## M13. Task 7 Step 1's second test is a syntax error.

Line 1032:
```ts
writeAuditLog(txn, db, { /* ...entry... */, _test: true });
```
`{ /* comment */, _test: true }` is not valid JavaScript - a leading comma in an object literal is a parse error. The file will not even collect.

- **Fix:** Spell out the entry object (it is already spelled out five lines earlier in the same snippet).

## M14. Task 2's three tests all call `buildSessionClaimsForContact` with a comment instead of arguments, and the argument shape is never given.

Lines 321, 327, 332: `buildSessionClaimsForContact(/* coordinator-only contact fixture */)` and `(/* parent + coordinator fixture */)`.

`build-session-claims.ts:10-14` requires:
```ts
export interface BuildSessionClaimsArgs {
  type: 'email' | 'phone';
  value: string;
  contactProvenance: 'otp' | 'magic-link' | 'password';
}
```
None of the three fields is stated anywhere in Task 2, and (per C2) the file the plan says to copy the fixture style from does not exist. Additionally, a "coordinator-only contact fixture" is not just an argument: it requires mocking `portalAuth().getUser(uid)` to return `customClaims: { role: 'coordinator' }` and `findSetuFamilyByContact` to return `{ source: null }`, neither of which the plan mentions.

- **Fix:** Write the fixture out, modeled on `build-session-claims-kiosk.test.ts` (named explicitly).

---

# MINOR

1. **`manage-roles.ts` merge-loop lines off by one.** Task 3 Step 3 (line 461) cites the two loops as `:231` and `:237`. The `for` statements are at `:230` (`for (const a of admins) {`) and `:236` (`for (const w of welcomeTeam) {`); `:231`/`:237` are the first lines inside each body.

2. **`members/route.ts` picker lines wrong.** Task 8 (line 1113) says the matrix is *"applied at `:105-107`"* and Step 3 (line 1164) calls it *"the picker at `:98-107`"*. The picker function is `:103-111` (`:97-102` is its JSDoc), and it is **applied** at `:160` (`const missingError = requiredFieldError(missing);`). `:105-107` is the `for`/`if`/`return` inside the picker's own body.

3. **`seed-test-accounts.ts` interface lines off by one.** Task 11 (line 1424) cites `:88-94` for `StandalonePersona.role`. The interface is `:89-95`; the `role: 'admin' | 'welcome-team';` line is `:93`; `:88` is blank.

4. **Task 6 "pass it in at `:62` and `:85`" points at destructures, not render sites.** `admin/layout.tsx:62` and `:85` are `const { allowed, ... } = await resolveAdminIdentity();`. The JSX that must receive `canSeeAdminOnly` is `:71` (`<AdminSidebarLive .../>`) and `:98` (`<AdminMobileNav .../>`). Same issue at line 951: "thread it from `welcome/layout.tsx:90`" - `:90` is the `if (!raw || !isWelcomeTeam(...)) return null;` guard; the render is `:94`.

5. **Task 10's `canEditGrade` is provably always `true` at its use site.** Step 3 (line 1367) adds `const canEditGrade = !!raw && isWelcomeTeam(raw as unknown as WithRole);` at `page.tsx:42`. But `page.tsx:43-49` already returns the access-denied view when `!raw || !isWelcomeTeam(...)`. By `:73` the value cannot be false. Harmless but confusing; the gate should just be `{profile.type === 'Child' && (` with a comment.

6. **`SetuSessionClaimsSchema` has no `coordinator` variant and the plan never mentions it.** `packages/shared-domain/src/setu/session-claims.ts:66-73` is a `z.discriminatedUnion('role', [...])` over family-manager / family-member / welcome-team / family / teacher / admin. A `role: 'coordinator'` object fails `safeParse` outright. Rated MINOR because the only two call sites (`features/setu/search/get-family-for-welcome.ts:21`, `features/setu/members/get-current-family.ts:24`) sit behind `/welcome/family/*` and `/family`, both denied to a coordinator by Task 4's rules, and because `kiosk` already lives with the identical omission. Worth a one-line note in the plan so the next role addition does not trip on it.

7. **`sevak-manager.tsx` functional gaps beyond the compile breaks.** `:91-96` `FILTER_CHIPS` gets no "Coordinators" chip, and `:587` `useState<GrantableRole>('welcome-team')` is the Add-dialog default. Neither errors; both make the new role second-class in the Users & Roles screen the plan's Task 3 exists to fix. `apps/portal/src/features/admin/users/__tests__/sevak-manager.test.tsx` exists and is not in any Files block.

8. **Task 4's test consts drop the file's type annotation.** `can-access-route.test.ts:5-11` annotates every fixture (`const admin: SessionClaims = { uid: 'a', role: 'admin' };`). The plan (lines 520-521) writes `const coordinator = { role: 'coordinator' as const, uid: 'u1' };`. Works structurally, inconsistent with the file.

9. **Task 10's inline `fetch` departs from the repo's `-client` wrapper convention.** The plan's reason for not editing `set-grade-client.ts` is sound (verified: exactly two callers, `member-grade-editor.tsx:60` and `components/promotion-preview.tsx:251`). But the repo-consistent answer is a *new* wrapper (`set-grade-staff-client.ts`) beside it, not a raw `fetch` inside a `'use client'` component - which is also what makes M9's mocking problem appear.

10. **`components/promotion-preview.tsx` written without its package prefix.** Line 1344 names it relative to `features/setu/rollover/`, which resolves correctly to `apps/portal/src/features/setu/rollover/components/promotion-preview.tsx`, but is ambiguous with `apps/portal/src/features/admin/components/` which the same plan references two tasks earlier. Use the full path.

11. **Task 9's routes omit two repo-standard concerns.** The shown handler (lines 1270-1292) has no `if (!flags.setuAuth)` 404 guard that its `/api/setu/members` sibling opens with (`route.ts:113-116`), and the plan gives no note that route tests calling `revalidateTag` need `vi.mock('next/cache')` in this harness.

---

# What the plan gets right on the axes I was asked to check (context, not credit)

Stated only because the counts above would otherwise be misleading about where the risk is:
- Task 5's nine handler citations are **all byte-exact**, including the `!session ||` prefix distinction at `offerings/route.ts:11` and `levels/route.ts:41`.
- `can-access-route.ts` anchors `:50`, `:53-58`, `:61-63`, `:67-69`, `:72-74`, `:75`, `:112`, `:117`, `:246`, `:251-253`, `:315` are all exact, and the ordering argument in Task 4 Step 5 is correct: a broad `/api/admin/levels` clause above `:72-74` would indeed revoke welcome-team's per-level teacher management.
- The claim that `api/admin/welcome-team/route.ts` has no in-handler role check is **verified true** (`:14 export async function GET()` reads claims but never checks the caller).
- All `--project node` / `--project jsdom` flags match the `.test.ts` / `.test.tsx` extensions the plan names, against `apps/portal/vitest.config.ts`'s two projects.
- Runbook sections `3`, `10`, `14` referenced by Tasks 7 and 11 all exist in `docs/runbooks/production-cutover-checklist.md`.
- `app/api/welcome/families/route.ts` genuinely does not exist (line 87 verified); the only child is `families/migration-status/route.ts`, and a `[fid]` sibling does not collide with it.

---

# Minimum bar to make this executable

1. C1: add `sevak-manager.tsx` to Task 1 with both `Record<GrantableRole, boolean>` fixes; correct "two build breaks" to four.
2. C2: rename Task 2's test target to an existing-convention filename and point the fixture guidance at `build-session-claims-kiosk.test.ts`.
3. C3: add `welcome/layout.tsx:61` to Task 6 with the `role={coordinatorOnly ? 'coordinator' : 'welcome-team'}` code.
4. C4: fix the `Actor` / `session.uid` type mismatch in Task 9 (add the `!session.uid` guard).
5. C5: move Task 9's three `canAccessRoute` cases into Task 4 and restate the Track B dependency honestly.
6. C6: replace "apply the identical change" with real instructions for `admin-mobile-nav.tsx`'s `TABS`/`MORE_THEMED` shape.
7. M1: add `revoke-sessions.ts:33` to Task 1 or Task 2.
8. M2: change all three "append" snippets to "extend the existing import"; delete the false `ROLE_REFERENCE_ORDER` premise and its duplicate test.
9. M6/M7: settle `firstMissingRequiredField`'s single signature and state what happens to `requiredFieldErrorPatch`.
10. M8/M9/M11/M13/M14: write out the placeholder test bodies, or scope them down to what will actually be written.
11. M10: fix the E2E command to the documented deployed form.

Until C1-C6 are addressed, the plan repeats the v1 failure mode: an implementer following it task by task hits a typecheck failure in Task 1 with no file to edit, an unrunnable command in Task 2, a shipped-but-broken nav in Task 6, and a false parallelization promise between the two tracks.
