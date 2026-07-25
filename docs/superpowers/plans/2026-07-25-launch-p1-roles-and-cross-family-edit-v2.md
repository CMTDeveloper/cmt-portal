# P1 v2 - Coordinator Role & Staff Cross-Family Edit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `coordinator` role that can actually reach Roster + Programs + Levels, and give welcome-team the ability to edit any family, with an audit trail.

**Architecture:** **Track A (Tasks 1-6)** adds the coordinator role through all three authorization gates. **Track B (Tasks 7-10)** adds staff cross-family editing for welcome-team + admin. Task 11 verifies both against deployed UAT.

**Parallelism, stated honestly:** Tasks 7, 8 and 10 are genuinely independent of Track A and can be built alongside it. **Task 9 is not** - its route tests need the `coordinator` fixture and the widened `Role` type, so it needs Tasks 1 and 4 first. That is why Task 4 Step 6c owns the `/api/welcome/families` authorization cases rather than Task 9: two workers editing `can-access-route.test.ts` in parallel is a guaranteed conflict, not a shared-nothing split.

**Tech Stack:** Next.js 16 App Router, TypeScript (`exactOptionalPropertyTypes`), Firebase Admin Firestore, Zod, Vitest, Playwright.

**Supersedes:** `2026-07-25-launch-p1-roles-and-cross-family-edit.md`, which was reviewed as REQUEST CHANGES (7 critical, 14 major). Do not implement that file. Review: `docs/superpowers/reviews/2026-07-25-review-p1.md`.

**Spec:** `docs/superpowers/specs/2026-07-24-aug-3-launch-batch-design.md` §2, §3.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Route access needs THREE gates.** `canAccessRoute` (middleware) + the page layout + the in-handler role check. A grant in only one of them reaches nothing. A green `can-access-route.test` proves nothing about whether the route answers.
- **`canAccessRoute` returns at the FIRST match.** A broad rule placed above a narrow one silently replaces it. Every insertion in this plan names its anchor line and its neighbours.
- **Never loosen the `/api/admin/` catch-all at `can-access-route.ts:75`.** `api/admin/welcome-team/route.ts` has **no** in-handler role check (verified) - only that prefix protects it. Widening it would let a coordinator grant welcome-team. Every admin grant is an explicit clause above `:75`.
- **Never compare the raw `x-portal-role` header.** `middleware.ts:118` sets it to the **primary** role only; extras go to `x-portal-extra-roles` (`:123-129`). Use `readSessionFromHeaders` (`lib/auth/headers.ts:53`) or `getServerSession` (`lib/auth/server-session.ts:13`) plus `isAdmin()` / `isWelcomeTeam()` / `isCoordinator()`.
- **`exactOptionalPropertyTypes` is on.** Never assign `undefined` to an optional property - omit the key.
- **`revalidateTag` takes the `'max'` profile.** Every existing caller passes it (`api/setu/members/route.ts:296`, `[mid]/route.ts:380,509`, `api/setu/family/route.ts:63`). Omitting it means staff edits appear not to save.
- **UAT only.** All Firestore work targets `chinmaya-setu-uat`. Never `chinmaya-setu-715b8`. Never `--force` an index deploy.
- **No em dashes** in code, comments, commit messages or docs.
- **Commit author** is `CMT Developer <developer@chinmayatoronto.org>` (local git config). Never add an agent co-author line.
- **Never `--no-verify`.**

### Role semantics locked for this plan

```
admin        inherits welcome-team, teacher, kiosk, coordinator
coordinator  inherits NOTHING. Not welcome-team. Not teacher.
welcome-team inherits NOTHING. Not coordinator.
```

Coordinator and welcome-team are **siblings**, not a hierarchy, even though spec §3.1 calls coordinator "above" welcome-team. Their grants are disjoint: coordinator gets Programs/Levels/Offerings which welcome-team lacks; welcome-team gets Reports/Seva/Prasad/family-search which coordinator is explicitly denied (spec §3.1 "Still excluded"). Task 1 pins this with a test.

### Deliberate deviations from the spec, and why

1. **`/welcome/visitors` is NOT granted.** The route does not exist (`app/welcome/` contains `family levels prasad reports roster seva`). It is spec §5.2 new work, banded "cuttable to week 2" in §10. Granting a path with no handler, or shipping a nav link to a 404, is worse than omitting it. When §5.2 lands it adds its own clause.
2. **`/api/admin/calendar` is NOT granted.** Spec §3.1's table does not list it. The previous plan widened "the four existing welcome-team clauses" which would have handed coordinator calendar publish rights by accident. Three clauses widen, not four. Task 4 pins the calendar denial with a test.
3. **Spec §3.4 is stale on `/api/admin/levels`.** It lists that path as DENIED while §3.1 GRANTS it. §3.1 is the later revision and wins. Every other §3.4 denial is honoured, including `/api/setu/family/search`, which the previous plan omitted.
4. **Coordinator gets no family-edit rights.** Spec §3.1 "Still excluded: ... family edit." Track B is welcome-team + admin only. This is why `can-access-route.ts:246` needs no change.

### The cheaper alternative, and why this plan does not take it

Defining `isWelcomeTeam()` so a coordinator satisfies it would make Tasks 4 and 6 nearly free - the welcome layout, `/welcome/roster`, and the roster APIs would all pass unchanged. **Rejected:** it would also grant `/welcome/reports`, `/welcome/seva`, `/welcome/prasad` and `/api/setu/family/search`, all four of which spec §3.1 explicitly excludes. Reports in particular was deliberately stripped of collective financial data on 2026-07-15. Over-granting a brand-new staff role during a production cutover is the wrong default. If the owner prefers the cheaper shape, that is a one-line change in Task 1 plus deleting Tasks 4's welcome clauses - but it must be a decision, not a side effect.

---

## File Structure

**Track A - coordinator role**

| File | Responsibility | Task |
|---|---|---|
| `packages/shared-domain/src/auth/role.ts` | `ROLES` + `isCoordinator()` | 1 |
| `packages/shared-domain/src/setu/schemas/sevak.ts` | `GRANTABLE_ROLES` | 1 |
| `apps/portal/src/lib/auth/role-claims.ts` | `Capability` union | 1 |
| `apps/portal/src/lib/auth/roles-reference.ts` | `ROLE_REFERENCE` + `ROLE_REFERENCE_ORDER` | 1 |
| `apps/portal/src/features/admin/users/role-badges.tsx` | `ROLE_CHIP` record | 1 |
| `apps/portal/src/features/setu/auth/member-roles.ts` | drop the local `GrantableRole`, widen the read filter | 1 |
| `apps/portal/src/features/setu/auth/build-session-claims.ts` | session minting for a family-less coordinator | 2 |
| `apps/portal/src/features/setu/auth/manage-roles.ts` | 4 hardcoded role sites | 3 |
| `packages/shared-domain/src/auth/can-access-route.ts` | route rules | 4 |
| 9 handlers under `apps/portal/src/app/api/admin/` | in-handler checks | 5 |
| `apps/portal/src/app/admin/layout.tsx` + `app/welcome/layout.tsx` | shell gates | 6 |
| `apps/portal/src/features/admin/components/admin-sidebar.tsx` + `admin-mobile-nav.tsx` | admin nav filtering | 6 |
| `apps/portal/src/features/family/components/desktop-sidebar.tsx` + `welcome-mobile-nav.tsx` | welcome nav filtering | 6 |

**Track B - staff cross-family edit**

| File | Responsibility | Task |
|---|---|---|
| `apps/portal/src/features/setu/audit/audit-log.ts` | `writeAuditLog(txn, db, entry)` | 7 |
| `apps/portal/src/features/setu/members/write-member.ts` | shared add/update/delete core **plus the required-field matrix** | 8 |
| `apps/portal/src/app/api/welcome/families/[fid]/route.ts` | staff family PATCH | 9 |
| `apps/portal/src/app/api/welcome/families/[fid]/members/route.ts` | staff member POST | 9 |
| `apps/portal/src/app/api/welcome/families/[fid]/members/[mid]/route.ts` | staff member PATCH/DELETE | 9 |
| `apps/portal/src/app/welcome/family/[fid]/members/[mid]/page.tsx` | widen the grade-editor gate | 10 |
| `apps/portal/src/features/setu/rollover/member-grade-editor.tsx` | staff-aware POST target | 10 |

**Verified non-existent, so Task 9 creates rather than edits:** `app/api/welcome/families/route.ts` does not exist. The only route under `families/` today is `families/migration-status/route.ts`.

---

## Track A: the coordinator role

### Task 1: Add `coordinator` to the whole type system, atomically

The previous plan split this across Tasks 1 and 2 and could not typecheck in between: `sevak.ts` exports the shared `GrantableRole`, `manage-roles.ts:6` imports it, and `member-roles.ts:23` declares a **separate, narrower** `GrantableRole` that `manage-roles.ts:64` passes into. Widening one without the other is a type error. All of it lands in one commit.

**Files:**
- Modify: `packages/shared-domain/src/auth/role.ts:1`
- Modify: `packages/shared-domain/src/setu/schemas/sevak.ts:6`
- Modify: `apps/portal/src/lib/auth/role-claims.ts:16`
- Modify: `apps/portal/src/lib/auth/roles-reference.ts` (`ROLE_REFERENCE` + `ROLE_REFERENCE_ORDER:93-101`)
- Modify: `apps/portal/src/features/admin/users/role-badges.tsx:9-12`
- Modify: `apps/portal/src/features/admin/users/sevak-manager.tsx:67-69,116` (two `Record<GrantableRole, boolean>` literals)
- Modify: `apps/portal/src/features/setu/auth/member-roles.ts:23,30,39-41`
- Modify: `apps/portal/src/features/setu/auth/revoke-sessions.ts:33` (`RESURRECTABLE_SEVAK_CAPS`)
- Modify: `apps/portal/src/app/api/setu/members/[mid]/__tests__/route.test.ts:25` (the mock of that constant)
- Test: `packages/shared-domain/src/__tests__/role.test.ts` (note: **`src/__tests__/`**, not `src/auth/__tests__/`, which does not exist)
- Test: `apps/portal/src/lib/auth/__tests__/roles-reference.test.ts`

**Interfaces:**
- Produces: `Role` now includes `'coordinator'`; `isCoordinator(claims: WithRole): boolean`; `GRANTABLE_ROLES` includes `'coordinator'`; `member-roles.ts` re-exports the shared `GrantableRole`.

- [ ] **Step 1: Write the failing tests**

In `packages/shared-domain/src/__tests__/role.test.ts`, **extend the existing import at `:2`** by adding `isCoordinator` to it. Do not write a new import line - `isAdmin`, `isWelcomeTeam` and `ROLES` are already imported there, and a second import of the same names is a duplicate-identifier error. Then append the block:

```ts
describe('isCoordinator', () => {
  it('is true for a primary coordinator', () => {
    expect(isCoordinator({ role: 'coordinator' })).toBe(true);
  });

  it('is true for a coordinator via extraRoles', () => {
    expect(isCoordinator({ role: 'family-manager', extraRoles: ['coordinator'] })).toBe(true);
  });

  it('is true for an admin (admin inherits coordinator)', () => {
    expect(isCoordinator({ role: 'admin' })).toBe(true);
  });

  it('is false for welcome-team', () => {
    expect(isCoordinator({ role: 'welcome-team' })).toBe(false);
  });

  it('does NOT make a coordinator a welcome-team member', () => {
    // Siblings, not a hierarchy. Their grants are disjoint by design:
    // spec 3.1 excludes reports / seva / prasad / family-search from coordinator.
    expect(isWelcomeTeam({ role: 'coordinator' })).toBe(false);
  });

  it('does not make a coordinator an admin', () => {
    expect(isAdmin({ role: 'coordinator' })).toBe(false);
  });

  it('is in ROLES', () => {
    expect(ROLES).toContain('coordinator');
  });
});
```

**Do not add a `ROLE_REFERENCE_ORDER` test.** An earlier draft of this plan told you to write one, on the premise that the order array had no coverage. **That premise is false** - `apps/portal/src/lib/auth/__tests__/roles-reference.test.ts:26-29` already asserts exactly it:

```ts
it('ROLE_REFERENCE_ORDER lists each role exactly once', () => {
  expect([...ROLE_REFERENCE_ORDER].sort()).toEqual([...ROLES].sort());
  expect(new Set(ROLE_REFERENCE_ORDER).size).toBe(ROLE_REFERENCE_ORDER.length);
});
```

That existing test is what will fail in Step 2 once `'coordinator'` joins `ROLES`, and it is what Step 4 satisfies. `ROLE_REFERENCE_ORDER` is still a **silent** break in the sense that matters - it is a plain `Role[]`, so the `_exhaustive` assert at `roles-reference.ts:105` does not cover it and `pnpm typecheck` stays green. The suite catches it; the compiler does not.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @cmt/shared-domain exec vitest run src/__tests__/role.test.ts
pnpm --filter @cmt/portal exec vitest run src/lib/auth/__tests__/roles-reference.test.ts --project node
```

Expected: FAIL - `isCoordinator is not a function`, and `ROLE_REFERENCE_ORDER` missing `'coordinator'`.

- [ ] **Step 3: Widen the two shared unions**

`packages/shared-domain/src/auth/role.ts:1`:

```ts
export const ROLES = ['admin', 'teacher', 'family', 'family-manager', 'family-member', 'welcome-team', 'kiosk', 'coordinator'] as const;
```

Add beside `isWelcomeTeam` in the same file:

```ts
// Programs + Levels + Roster coordinator. Deliberately inherits NOTHING from
// welcome-team and grants nothing to it: the two are siblings with disjoint
// grants (spec 3.1 excludes reports / seva / prasad / family-search from
// coordinator). Admins inherit it, same pattern as isTeacher/isWelcomeTeam.
export function isCoordinator(claims: WithRole): boolean {
  return hasRole(claims, 'coordinator') || hasRole(claims, 'admin');
}
```

`packages/shared-domain/src/setu/schemas/sevak.ts:6`:

```ts
export const GRANTABLE_ROLES = ['admin', 'welcome-team', 'coordinator'] as const;
```

- [ ] **Step 4: Fix the sites the compiler now breaks**

**Four** build breaks. Adding to `ROLES` breaks `roles-reference.ts` (via the `_exhaustive` assert at `:105`). Adding to `GRANTABLE_ROLES` breaks three `Record<GrantableRole, ...>` literals: one in `role-badges.tsx:9-12` and **two in `sevak-manager.tsx`** (`:67-69` `snapshotRoles`, `:116` the `draft` state).

Do not use build failures alone as the checklist anyway - `member-roles.ts`, `ROLE_REFERENCE_ORDER`, `RESURRECTABLE_SEVAK_CAPS` and the two `manage-roles.ts` sites in Task 3 all break **silently**.

`apps/portal/src/lib/auth/roles-reference.ts` - add to `ROLE_REFERENCE`:

```ts
  coordinator: {
    label: 'Coordinator',
    summary: 'Manages Bala Vihar programs, class levels and the family roster. No access to users, roles, reports or family records.',
    grants: [
      'Browse and filter the family roster at /welcome/roster (read-only)',
      'Create and edit programs at /admin/programs',
      'Create and edit class levels at /admin/levels',
      'Set program pricing through offerings',
      'Assign teachers to class levels (shared with admin and welcome-team)',
    ],
  },
```

Add `'coordinator'` to `ROLE_REFERENCE_ORDER` (`:93-101`), after `'welcome-team'`.

`apps/portal/src/features/admin/users/role-badges.tsx:9-12` - add to `ROLE_CHIP`:

```ts
  coordinator: { label: 'Coordinator', bg: 'var(--ok-soft)', fg: 'var(--ok-deep)' },
```

`apps/portal/src/features/admin/users/sevak-manager.tsx` - seed the new key in **both** records, `:67-69` and `:116`:

```ts
function snapshotRoles(row: SevakRow): Record<GrantableRole, boolean> {
  return {
    admin: row.roles.includes('admin'),
    'welcome-team': row.roles.includes('welcome-team'),
    coordinator: row.roles.includes('coordinator'),
  };
}
// ...
  const [draft, setDraft] = useState<Record<GrantableRole, boolean>>({
    admin: false, 'welcome-team': false, coordinator: false,
  });
```

Seeding `coordinator: false` in `snapshotRoles` instead of reading the row would be a live bug, not just a type fix: `saveDraft` at `:197-198` computes `GRANTABLE_ROLES.filter((r) => !draft[r] && openRow.roles.includes(r))` as the revoke set, so an admin opening the drawer for an existing coordinator and pressing Save would **silently revoke the grant**. Never silence this error with a cast.

`apps/portal/src/lib/auth/role-claims.ts:16`:

```ts
export type Capability = 'admin' | 'welcome-team' | 'kiosk' | 'coordinator';
```

- [ ] **Step 5: Unify `member-roles.ts` onto the shared type**

This is the silent one. `member-roles.ts` currently imports **nothing** from `@cmt/shared-domain` and declares its own narrow type at `:23`. Delete that declaration and re-export the shared one, or `manage-roles.ts:64` and `:103` stop compiling.

At `apps/portal/src/features/setu/auth/member-roles.ts:1`, add the import:

```ts
import { GRANTABLE_ROLES, type GrantableRole } from '@cmt/shared-domain';

export type { GrantableRole };
```

Delete line 23 (`export type GrantableRole = 'admin' | 'welcome-team';`). `RoleAssignmentDoc.roles` at `:30` needs no edit - it already reads `GrantableRole[]` and now resolves to the shared type.

Replace the hardcoded filter at `:39-41`:

```ts
  return (data?.roles ?? []).filter((r): r is GrantableRole =>
    (GRANTABLE_ROLES as readonly string[]).includes(r),
  );
```

- [ ] **Step 5b: Widen `RESURRECTABLE_SEVAK_CAPS` - this one is a security hole, not a type fix**

`apps/portal/src/features/setu/auth/revoke-sessions.ts:33` is a literal array, so widening `Capability` does nothing for it:

```ts
export const RESURRECTABLE_SEVAK_CAPS: Capability[] = ['admin', 'welcome-team'];
```

It is the strip-list used on member DELETE (`app/api/setu/members/[mid]/route.ts:493`). Left alone, **Task 2 turns it into a privilege-retention bug**, because Task 2 is what makes a family-less coordinator session possible in the first place. The chain, all verified:

1. A family member is granted coordinator and signs in once. `preservedExtras()` puts `'coordinator'` in `claims.extraRoles`, and `api/setu/auth/verify-code/route.ts:98` persists it via `setCustomUserClaims`.
2. A manager deletes them from the family. `revokeMemberSessions` strips only `admin` and `welcome-team`, so `coordinator` **survives on both auth uids**.
3. They sign in again. `findSetuFamilyByContact` returns `source: null`, and Task 2's new branch at `build-session-claims.ts:210-223` mints a standalone `{ role: 'coordinator' }` session.

A person removed from the system keeps every family's PII through `/api/welcome/roster/report`, plus program/level/pricing write access. Nothing logs it. The file's own header comment (`:20-25`) warns about exactly this escalation for the two roles it does cover.

Derive it so the next grantable role is covered for free:

```ts
import { GRANTABLE_ROLES } from '@cmt/shared-domain';

// Derived, not literal: any role that can be granted must also be stripped when
// the member it was granted to is deleted, or the claim outlives the person and
// resurrects as a standalone session on next sign-in.
export const RESURRECTABLE_SEVAK_CAPS: Capability[] = [...GRANTABLE_ROLES];
```

Update the hardcoded mock at `app/api/setu/members/[mid]/__tests__/route.test.ts:25` to match, and add a test asserting member DELETE strips `coordinator`.

- [ ] **Step 6: Run the tests and the full typecheck**

```bash
pnpm typecheck
pnpm --filter @cmt/shared-domain exec vitest run src/__tests__/role.test.ts
pnpm --filter @cmt/portal exec vitest run src/lib/auth/__tests__ --project node
```

Expected: PASS. `pnpm typecheck` is the real gate here - it proves `manage-roles.ts` still compiles against the widened type.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-domain/src/auth/role.ts \
  packages/shared-domain/src/setu/schemas/sevak.ts \
  packages/shared-domain/src/__tests__/role.test.ts \
  apps/portal/src/lib/auth/role-claims.ts \
  apps/portal/src/lib/auth/roles-reference.ts \
  apps/portal/src/lib/auth/__tests__/roles-reference.test.ts \
  apps/portal/src/features/admin/users/role-badges.tsx \
  apps/portal/src/features/admin/users/sevak-manager.tsx \
  apps/portal/src/features/setu/auth/member-roles.ts \
  apps/portal/src/features/setu/auth/revoke-sessions.ts \
  apps/portal/src/app/api/setu/members/\[mid\]/__tests__/route.test.ts
git commit -m "feat(roles): add the coordinator role to the type system

One commit because the type change is not separable: sevak.ts exports the
shared GrantableRole, manage-roles.ts:6 imports it, and member-roles.ts:23
declared its OWN narrower copy that manage-roles.ts:64 passes into. Widening
one without the other does not typecheck.

Four sites break the build (roles-reference via _exhaustive, plus three
Record<GrantableRole, ...> literals in role-badges and sevak-manager). Five
more fail SILENTLY, which is why build errors are not the checklist:
member-roles.ts's hardcoded read filter, ROLE_REFERENCE_ORDER (a plain array
the _exhaustive assert does not cover), RESURRECTABLE_SEVAK_CAPS, and the two
manage-roles sites in the next commit.

RESURRECTABLE_SEVAK_CAPS is the one that matters. It is the strip-list on
member DELETE, and the NEXT commit is what makes leaving it alone dangerous:
once a family-less coordinator can hold a session, a persisted coordinator
claim outlives deletion from the family and resurrects as a standalone
session with every family's roster PII. Now derived from GRANTABLE_ROLES so
the next grantable role is covered for free.

Coordinator inherits nothing and grants nothing to welcome-team - they are
siblings with disjoint grants per spec 3.1. Tested both directions."
```

---

### Task 2: Let a family-less coordinator obtain a session

Without this, a standalone coordinator account is bounced to `/register` and no `role: 'coordinator'` session can ever be minted. Every later task is untestable until this lands.

**Files:**
- Modify: `apps/portal/src/features/setu/auth/build-session-claims.ts` (`:111-123` role flags, `:125-131` `preservedExtras`, `:134-141` the register bounce, `:210-223` the family-less claim chain)
- Modify: `apps/portal/src/middleware.ts:145-151` (`dashboardForRole`)
- Test: **create** `apps/portal/src/features/setu/auth/__tests__/build-session-claims-coordinator.test.ts`. There is no `build-session-claims.test.ts` - the directory holds `-gate`, `-kiosk` and `-teacher` variants. **Copy the structure of `build-session-claims-kiosk.test.ts`**: kiosk is the exact precedent, a family-less role gated through `allExistingRoles` at `:123`.
- Test: `apps/portal/src/__tests__/middleware*.test.ts` (follow the existing middleware test file, whichever name it uses)

**Interfaces:**
- Consumes: `isCoordinator`, widened `Capability` (Task 1)
- Produces: a `{ role: 'coordinator' }` session for a sevak with no family; `'coordinator'` preserved in `extraRoles` for a sevak who is also a parent

- [ ] **Step 1: Write the failing tests**

```ts
describe('coordinator sessions', () => {
  it('mints a primary coordinator session for a sevak with no family', async () => {
    const result = await buildSessionClaimsForContact(/* coordinator-only contact fixture */);
    expect(result).not.toHaveProperty('redirectTo');
    expect((result as { claims: { role: string } }).claims.role).toBe('coordinator');
  });

  it('does NOT bounce a family-less coordinator to /register', async () => {
    const result = await buildSessionClaimsForContact(/* coordinator-only contact fixture */);
    expect(result).not.toEqual({ redirectTo: '/register?contact=verified' });
  });

  it('preserves coordinator in extraRoles for a coordinator who is also a parent', async () => {
    const result = await buildSessionClaimsForContact(/* parent + coordinator fixture */);
    const claims = (result as { claims: { role: string; extraRoles?: string[] } }).claims;
    expect(claims.role).toBe('family-manager');
    expect(claims.extraRoles).toContain('coordinator');
  });
});
```

Follow the fixture style already in this file. Match the neighbouring welcome-team cases exactly - a coordinator fixture is the welcome-team one with the role string swapped.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/auth/__tests__/build-session-claims.test.ts --project node
```

Expected: FAIL - first two assertions get `{ redirectTo: '/register?contact=verified' }`.

- [ ] **Step 3: Add the coordinator flag beside the existing role flags**

After `isKioskUser` (`:123`):

```ts
  const isCoordinatorUser =
    allExistingRoles.has('coordinator') || memberRoles.includes('coordinator');
```

- [ ] **Step 4: Preserve it in `preservedExtras()`**

At `:125-131`, after the welcome-team line. Admin already implies coordinator via `isCoordinator()`, so mirror the `&& !isAdminUser` guard the other extras use:

```ts
    if (isCoordinatorUser && !isAdminUser) extras.push('coordinator');
```

- [ ] **Step 5: Admit it at both session-minting sites**

At `:134-141`, add to the bounce guard so a coordinator is not sent to `/register`:

```ts
  if (
    result.source === null &&
    !hasPendingInvite &&
    !isWelcomeTeamUser &&
    !isAdminUser &&
    !isKioskUser &&
    !isCoordinatorUser
  ) {
    return { redirectTo: '/register?contact=verified' };
  }
```

At `:210-223`, add a `coordinator` branch to the family-less chain, after the `isWelcomeTeamUser` branch and before `isKioskUser`. Follow the exact shape of the welcome-team branch in that chain, substituting `role: 'coordinator'`.

- [ ] **Step 5b: Give a coordinator a dashboard in `middleware.ts`**

`middleware.ts:145-151` has no coordinator branch:

```ts
function dashboardForRole(role: unknown): string | null {
  if (role === 'family-manager' || role === 'family-member') return '/family';
  if (role === 'admin') return '/admin';
  if (role === 'welcome-team') return '/welcome';
  if (role === 'kiosk') return '/check-in';
  return null;
}
```

This is a different code path from the `redirectTo` Task 2 fixes above. Without a branch, `null` means a signed-in standalone coordinator visiting `/`, `/sign-in` or `/register` is **not** redirected to a dashboard (`:51-52` needs a non-null return) and just sees the marketing page while holding a valid session. Every authorization denial also routes them to `/sign-in` (`deny()`, `:179-193`) where the same `null` leaves them stranded - which reads as "it signs me out at random".

```ts
  if (role === 'coordinator') return '/welcome/roster';
```

Add a middleware test for it.

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/auth/__tests__/build-session-claims-coordinator.test.ts --project node
```

Expected: PASS, with every pre-existing test in the directory still green.

**Fixture note.** `buildSessionClaimsForContact` takes `{ type: 'email' | 'phone'; value: string; contactProvenance: 'otp' | 'magic-link' | 'password' }` (`build-session-claims.ts:10-14`). A "coordinator-only" fixture is not just an argument - it needs `portalAuth().getUser(uid)` mocked to return `customClaims: { role: 'coordinator' }` and `findSetuFamilyByContact` mocked to return `{ source: null }`. `build-session-claims-kiosk.test.ts` does exactly this shape for kiosk; copy it and swap the role string.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/setu/auth/build-session-claims.ts \
  apps/portal/src/features/setu/auth/__tests__/build-session-claims.test.ts
git commit -m "feat(roles): mint sessions for a family-less coordinator

preservedExtras() alone is not enough. Two other sites decide whether a
sevak with no family gets a session at all: the /register bounce at :134-141
and the claim-minting chain at :210-223, both of which listed only
admin/welcome-team/kiosk. A coordinator-only account was bounced to
/register and no primary coordinator session could exist.

The two existing standalone staff personas in seed-test-accounts.ts are
family-less, so this is a hard prerequisite for the test persona."
```

---

### Task 3: Make a coordinator grant visible in `/admin/users`

`manage-roles.ts` has **four** hardcoded `admin|welcome-team` sites. The previous plan fixed one.

**Files:**
- Modify: `apps/portal/src/features/setu/auth/manage-roles.ts:225-226`, `:358-361`, `:406`
- Test: `apps/portal/src/features/setu/auth/__tests__/list-sevaks.test.ts`

**Interfaces:**
- Consumes: `GRANTABLE_ROLES`, widened `GrantableRole` (Task 1)
- Produces: `listSevaks()` returns coordinator rows

- [ ] **Step 1: Write the failing tests**

```ts
it('includes a coordinator granted via roleAssignments', async () => {
  // seed a roleAssignments doc with roles: ['coordinator']
  const rows = await listSevaks();
  expect(rows.find((r) => r.roles.includes('coordinator'))).toBeDefined();
});

it('includes a standalone coordinator granted via auth claims', async () => {
  // seed a Firebase auth user whose claims carry the coordinator capability
  const rows = await listSevaks();
  expect(rows.find((r) => r.roles.includes('coordinator'))).toBeDefined();
});
```

Follow the mocking pattern already in this file. Note `member-roles.test.ts` mocks `@cmt/firebase-shared/admin/firestore` wholesale (`mockGet.mockResolvedValue({ exists: true, data: () => ({ roles: [...] }) })`) - there is no `seedRoleAssignment` fixture helper, so do not call one.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/auth/__tests__/list-sevaks.test.ts --project node
```

Expected: FAIL on both - no coordinator row.

- [ ] **Step 3: Derive all three sites from `GRANTABLE_ROLES`**

At `:225-226`, replace the two-role fan-out:

```ts
  const assignmentsByRole = await Promise.all(
    GRANTABLE_ROLES.map((role) => listMembersWithRole(role)),
  );
```

Then replace the two hardcoded merge loops that follow (`:231` and `:237`) with one loop over `GRANTABLE_ROLES.entries()` zipped against `assignmentsByRole`, adding each role to the matching mid's `roles` set. Keep the existing `roleByMid` map shape unchanged.

At `:358-361`, replace the hardcoded capability checks:

```ts
      const claimRoles: GrantableRole[] = GRANTABLE_ROLES.filter((role) =>
        hasCapability(claims, role as Capability),
      );
      if (claimRoles.length === 0) continue;
```

At `:406`:

```ts
  const ROLE_ORDER: GrantableRole[] = [...GRANTABLE_ROLES];
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/auth --project node
pnpm typecheck
```

Expected: PASS, all pre-existing sevak tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/auth/manage-roles.ts \
  apps/portal/src/features/setu/auth/__tests__/list-sevaks.test.ts
git commit -m "fix(roles): read every grantable role in listSevaks, not just two

manage-roles.ts had four hardcoded admin|welcome-team sites. :225-226 never
queried coordinator assignments at all, and :358-361 'continue'd past any
standalone auth-claim coordinator - so a coordinator grant would never have
appeared in /admin/users no matter what ROLE_ORDER at :406 said.

All three now derive from GRANTABLE_ROLES, so the next role added to that
constant is picked up here for free."
```

---

### Task 4: Route rules, with one named anchor per clause

The previous plan's imperative ("insert immediately before the `/admin` page catch-all at `:50`") contradicted its own blockquote and, taken literally, put a broad `/api/admin/levels` clause **above** the `/api/admin/levels/{id}/teachers` regex at `:72-74`. Since `canAccessRoute` returns at the first match, welcome-team would have **lost** per-level teacher management in production. Each clause below names its own anchor.

**Files:**
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Test: `packages/shared-domain/src/__tests__/can-access-route.test.ts` (note: **`src/__tests__/`**)

**Interfaces:**
- Consumes: `isCoordinator` (Task 1)
- Produces: coordinator authorization for programs / offerings / levels / roster

- [ ] **Step 1: Write the failing tests**

```ts
const coordinator = { role: 'coordinator' as const, uid: 'u1' };
const welcomeTeam = { role: 'welcome-team' as const, uid: 'u2' };

describe('coordinator - granted', () => {
  it.each([
    ['/admin/programs', 'GET'],
    ['/admin/programs/bala-vihar', 'GET'],
    ['/admin/levels', 'GET'],
    ['/api/admin/programs', 'POST'],
    ['/api/admin/programs/bala-vihar', 'PATCH'],
    ['/api/admin/offerings', 'POST'],
    ['/api/admin/offerings/off-1', 'PATCH'],
    ['/api/admin/levels', 'POST'],
    ['/api/admin/levels/brampton-l2', 'PATCH'],
    ['/api/admin/levels/brampton-l2/teachers', 'POST'],
    ['/api/admin/teacher-assignments', 'POST'],
    ['/api/admin/teachers/search', 'GET'],
    ['/welcome', 'GET'],
    ['/welcome/roster', 'GET'],
    ['/api/welcome/roster/report', 'GET'],
  ])('allows %s %s', (path, method) => {
    expect(canAccessRoute(coordinator, path, method)).toBe(true);
  });
});

describe('coordinator - denied', () => {
  it.each([
    ['/admin', 'GET'],
    ['/admin/users', 'GET'],
    ['/admin/school-year', 'GET'],
    ['/admin/locations', 'GET'],
    ['/api/admin/users', 'GET'],
    ['/api/admin/welcome-team', 'POST'],
    ['/api/admin/welcome-team/uid-1', 'DELETE'],
    ['/api/admin/calendar', 'POST'],
    ['/api/admin/calendar/weekly', 'POST'],
    ['/api/admin/school-year/set-grade', 'POST'],
    ['/welcome/reports', 'GET'],
    ['/welcome/seva', 'GET'],
    ['/welcome/prasad', 'GET'],
    ['/api/welcome/reports', 'GET'],
    ['/api/setu/family/search', 'GET'],
    ['/api/welcome/families/CMT-X', 'PATCH'],
  ])('denies %s %s', (path, method) => {
    expect(canAccessRoute(coordinator, path, method)).toBe(false);
  });
});

describe('welcome-team regressions (must stay true)', () => {
  // The v1 plan's insertion point would have broken exactly this: a broad
  // /api/admin/levels clause above the :72-74 regex wins on first match.
  it('keeps per-level teacher add/remove for welcome-team', () => {
    expect(canAccessRoute(welcomeTeam, '/api/admin/levels/brampton-l2/teachers', 'POST')).toBe(true);
  });

  it('still denies welcome-team level CRUD', () => {
    expect(canAccessRoute(welcomeTeam, '/api/admin/levels', 'POST')).toBe(false);
  });

  it('keeps calendar publish for welcome-team', () => {
    expect(canAccessRoute(welcomeTeam, '/api/admin/calendar', 'POST')).toBe(true);
  });

  it('keeps reports for welcome-team', () => {
    expect(canAccessRoute(welcomeTeam, '/welcome/reports', 'GET')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @cmt/shared-domain exec vitest run src/__tests__/can-access-route.test.ts
```

Expected: the "granted" block fails; both other blocks already pass.

- [ ] **Step 3: Insert the page clauses immediately BEFORE line 50**

Line 50 is `if (pathname === '/admin' || pathname.startsWith('/admin/')) return isAdmin(claims);`. These two go directly above it, so the narrow paths match before the catch-all:

```ts
  // Coordinator: Programs + Level management pages. Explicit narrow clauses
  // ABOVE the admin page catch-all - never by loosening it.
  if (pathname === '/admin/programs' || pathname.startsWith('/admin/programs/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  if (pathname === '/admin/levels' || pathname.startsWith('/admin/levels/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
```

- [ ] **Step 4: Widen exactly THREE existing welcome-team clauses**

teacher-assignments (`:53-58`), teachers/* (`:67-69`), and the levels/{id}/teachers regex (`:72-74`). Each becomes:

```ts
    return isAdmin(claims) || isWelcomeTeam(claims) || isCoordinator(claims);
```

**Do NOT touch the calendar clause at `:61-63`.** Spec §3.1 does not grant the class calendar to coordinator, and the denial test in Step 1 pins it.

- [ ] **Step 5: Insert the API clauses immediately BEFORE line 75, AFTER the `:72-74` regex**

Line 75 is `if (pathname.startsWith('/api/admin/')) return isAdmin(claims);`. Placement is load-bearing: the broad `/api/admin/levels` clause must sit **below** the `:72-74` teachers regex or welcome-team loses that capability.

```ts
  // Coordinator API surface: programs, offerings (pricing lives in
  // offering.pricingTiers), and level CRUD. These MUST sit after the
  // /api/admin/levels/{id}/teachers regex above - canAccessRoute returns at
  // the first match, so a broad levels clause placed higher would swallow it
  // and revoke welcome-team's teacher management.
  if (pathname === '/api/admin/programs' || pathname.startsWith('/api/admin/programs/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  if (pathname === '/api/admin/offerings' || pathname.startsWith('/api/admin/offerings/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  if (pathname === '/api/admin/levels' || pathname.startsWith('/api/admin/levels/')) {
    return isAdmin(claims) || isCoordinator(claims);
  }
```

- [ ] **Step 6: Insert the welcome clauses immediately BEFORE line 112**

Line 112 is `if (pathname === '/welcome' || pathname.startsWith('/welcome/'))`. `/welcome` root redirects to `/welcome/roster`, so the bare `/welcome` path needs the allowance too or a coordinator is denied before the redirect runs:

```ts
  // Coordinator: roster browse + read-only family detail. /welcome root is
  // included because it redirects to /welcome/roster - denying it would block
  // the redirect itself. /welcome/family/* is included because EVERY roster row
  // is a link to it (roster-browser.tsx:134 and :172); without it the one screen
  // the role is granted is a dead end that 302s on click. Spec 3.1 excludes
  // family EDIT from coordinator, not family read, and the roster already
  // exposes the same PII. Reports, seva and prasad stay welcome-team-only via
  // the clause below.
  if (
    pathname === '/welcome' ||
    pathname === '/welcome/roster' ||
    pathname.startsWith('/welcome/roster/') ||
    pathname === '/welcome/family' ||
    pathname.startsWith('/welcome/family/')
  ) {
    return isWelcomeTeam(claims) || isCoordinator(claims);
  }
  if (pathname === '/api/welcome/roster' || pathname.startsWith('/api/welcome/roster/')) {
    return isWelcomeTeam(claims) || isCoordinator(claims);
  }
```

Note the second clause replaces the existing `:251-253` rule rather than adding a duplicate. Delete the old one.

- [ ] **Step 6b: Widen the two page-side gates that `/welcome/family/*` carries**

Granting the route is not enough - the pages re-check. `app/welcome/family/[fid]/members/[mid]/page.tsx:43` (and its `[fid]` sibling) return an access-denied view on `!isWelcomeTeam(...)`. Widen those to `isWelcomeTeam(...) || isCoordinator(...)`.

**Task 10's grade editor must stay `isWelcomeTeam`-gated** so a coordinator gets read-only detail. That is the whole point of granting read but not edit.

- [ ] **Step 6c: Add the Track B denial cases here, not in Task 9**

These belong in this task because the `coordinator` fixture and the widened `Role` type both live here. Task 9 must not re-declare them.

```ts
it('allows welcome-team to PATCH a family', () => {
  expect(canAccessRoute(welcomeTeam, '/api/welcome/families/CMT-X', 'PATCH')).toBe(true);
});
it('denies a coordinator - family EDIT is excluded even though family READ is granted', () => {
  expect(canAccessRoute(coordinator, '/api/welcome/families/CMT-X', 'PATCH')).toBe(false);
});
it('denies a plain family-manager', () => {
  expect(canAccessRoute(manager, '/api/welcome/families/CMT-X', 'PATCH')).toBe(false);
});
```

`welcomeTeam` and `manager` are already declared at `can-access-route.test.ts:10` and `:8` - reuse them, and declare only `coordinator`, annotated `: SessionClaims` to match the file's style.

- [ ] **Step 7: Run the tests**

```bash
pnpm --filter @cmt/shared-domain exec vitest run src/__tests__/
```

Expected: PASS, including `can-access-route-multi-role.test.ts` and `can-access-route-disclaimers.test.ts` unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-domain/src/auth/can-access-route.ts \
  packages/shared-domain/src/__tests__/can-access-route.test.ts
git commit -m "feat(roles): authorize coordinator for programs, offerings, levels, roster

Every grant is an explicit narrow clause above a catch-all; the /api/admin/
prefix at :75 is never loosened, because api/admin/welcome-team has no
in-handler role check and only that prefix protects it.

Placement is load-bearing. The broad /api/admin/levels clause sits BELOW the
/api/admin/levels/{id}/teachers regex: canAccessRoute returns at the first
match, so placing it higher would have matched welcome-team's teacher POST
and revoked a capability that works in production today. A regression test
pins it.

Widens three existing welcome-team clauses, not four - the class calendar is
not in spec 3.1's grant table, and is now pinned as denied. Also pins the
/api/setu/family/search denial that spec 3.4 requires.

This alone does NOT make the role work: see the next two commits for the
in-handler and layout gates.

NOTE: /welcome/visitors is deliberately not granted. The route does not exist
yet (spec 5.2); a nav link to a 404 is worse than no link."
```

---

### Task 5: Widen the in-handler checks (gate 2 of 3)

Without this, every route Task 4 authorized still returns 403 - from the handler instead of the middleware.

**The sweep rule: for EVERY path Task 4 grants, find its handler and check it.** Not just `/api/admin/*`. An earlier draft of this task listed only the nine admin handlers and missed `/api/welcome/roster/report`, which is the coordinator's **only data source** - `/welcome/roster` would have rendered an empty screen. Re-derive the list from Task 4's grant table rather than trusting this one.

**Files:**
- Modify: `apps/portal/src/app/api/welcome/roster/report/route.ts:19` - **the coordinator's only data endpoint.** `roster-client.ts:9` (`fetchRosterReportClient`) and `roster-export-button.tsx:42` (CSV) both hit it, and `fetchRosterReportClient` throws on non-OK, so a 403 here means the roster renders nothing.
- Modify: `apps/portal/src/app/api/admin/programs/route.ts:12,34`
- Modify: `apps/portal/src/app/api/admin/programs/[key]/route.ts:16`
- Modify: `apps/portal/src/app/api/admin/offerings/route.ts:11,37`
- Modify: `apps/portal/src/app/api/admin/offerings/[oid]/route.ts:21`
- Modify: `apps/portal/src/app/api/admin/levels/route.ts:41,67`
- Modify: `apps/portal/src/app/api/admin/levels/[levelId]/route.ts:16`
- Modify: `apps/portal/src/app/api/admin/levels/[levelId]/teachers/route.ts:30`
- Modify: `apps/portal/src/app/api/admin/teacher-assignments/route.ts:27`
- Modify: `apps/portal/src/app/api/admin/teachers/search/route.ts:12`
- Test: one `__tests__/route.test.ts` per directory, following the existing route-test shape

**Interfaces:**
- Consumes: `isCoordinator` (Task 1)

- [ ] **Step 1: Write the failing tests**

For each of the nine handlers, add a coordinator case. Example for `programs`:

```ts
it('allows a coordinator to create a program', async () => {
  const req = new Request('http://localhost/api/admin/programs', {
    method: 'POST',
    headers: { 'x-portal-role': 'coordinator', 'x-portal-uid': 'u1' },
    body: JSON.stringify({ /* valid CreateProgramSchema payload */ }),
  });
  const res = await POST(req);
  expect(res.status).not.toBe(403);
});

it('allows a coordinator whose PRIMARY role is family-manager', async () => {
  // The realistic case: staff are usually also parents, so the primary role
  // slot is taken by the family role and coordinator lands in extraRoles.
  // A handler comparing the raw x-portal-role string would 403 real staff.
  const req = new Request('http://localhost/api/admin/programs', {
    method: 'POST',
    headers: {
      'x-portal-role': 'family-manager',
      'x-portal-extra-roles': 'coordinator',
      'x-portal-uid': 'u1',
    },
    body: JSON.stringify({ /* valid payload */ }),
  });
  expect((await POST(req)).status).not.toBe(403);
});

it('still denies a plain family-manager', async () => {
  const req = new Request('http://localhost/api/admin/programs', {
    method: 'POST',
    headers: { 'x-portal-role': 'family-manager', 'x-portal-uid': 'u1' },
    body: JSON.stringify({ /* valid payload */ }),
  });
  expect((await POST(req)).status).toBe(403);
});
```

The second test is the one that matters. Repeat all three for each handler and each exported method.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @cmt/portal exec vitest run src/app/api/admin --project node
```

Expected: the coordinator cases FAIL with 403.

- [ ] **Step 3: Widen the six admin-only handlers**

In `programs/route.ts`, `programs/[key]/route.ts`, `offerings/route.ts`, `offerings/[oid]/route.ts`, `levels/route.ts`, `levels/[levelId]/route.ts`, import `isCoordinator` from `@cmt/shared-domain` alongside `isAdmin`, and change each guard:

```ts
  if (!isAdmin(session) && !isCoordinator(session)) {
```

Preserve the existing `!session ||` prefix where it is present today (`offerings/route.ts:11`, `levels/route.ts:41`):

```ts
  if (!session || (!isAdmin(session) && !isCoordinator(session))) {
```

- [ ] **Step 4: Widen the three shared admin handlers**

In `levels/[levelId]/teachers/route.ts:30`, `teacher-assignments/route.ts:27`, `teachers/search/route.ts:12`:

```ts
  if (!isAdmin(session) && !isWelcomeTeam(session) && !isCoordinator(session)) {
```

In `levels/[levelId]/teachers/route.ts` the check lives inside a shared `guard()` helper (`:22-55`) serving both `POST` (`:58`) and `DELETE` (`:72`) - one edit covers both methods.

- [ ] **Step 4b: Widen the roster report handler**

`apps/portal/src/app/api/welcome/roster/report/route.ts:19`. Note the different call shape - this handler builds the claims object inline rather than passing `session`:

```ts
  const claims = { role: session.role, extraRoles: session.extraRoles };
  if (!isWelcomeTeam(claims) && !isCoordinator(claims)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
```

Same three test cases as the admin handlers. This is the assertion that makes Task 11's "lands on `/welcome/roster` with rows rendered" mean something.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @cmt/portal exec vitest run src/app/api/admin --project node
```

Expected: PASS, with every pre-existing admin route test still green.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/api/admin apps/portal/src/app/api/welcome/roster
git commit -m "feat(roles): widen the in-handler checks for coordinator

canAccessRoute is only the first of three gates. All ten handlers behind the
routes the previous commit authorized re-check the role independently, so a
coordinator still got a 403 - from the handler instead of the middleware.

Six admin handlers were isAdmin-only; three already allowed welcome-team.
The tenth is api/welcome/roster/report, the coordinator's ONLY data source:
without it /welcome/roster renders an empty screen, because
fetchRosterReportClient throws on non-OK. Deriving the handler list from the
route grants rather than from a directory is what surfaces that one.

Every handler gets a test for a coordinator whose PRIMARY role is
family-manager with coordinator in extraRoles. That is the realistic shape -
staff are usually parents too - and it is what a raw x-portal-role string
comparison would 403.

api/admin/welcome-team is deliberately untouched: it has no in-handler check
at all and is protected only by the /api/admin/ prefix, which stays admin-only."
```

---

### Task 6: Widen the shell gates and filter the navs (gate 3 of 3)

`/admin/layout.tsx:37` sets `allowed = isAdmin(raw)` and `:63`/`:86` render *"Access denied. Admin role required."*. `/welcome/layout.tsx:34` does the same with `isWelcomeTeam`, plus `:88-90` and `:103-105` return `null` for the mobile nav and scope bar. A coordinator who clears middleware lands on an access-denied screen.

**The layout gate is not the per-page allow-list - middleware is.** `middleware.ts:197`'s matcher covers every non-static path and `:101` runs `canAccessRoute` on pages as well as APIs. So a coordinator can only ever *reach* `/admin/programs` and `/admin/levels`; the layout only needs to decide "is this person staff enough for the admin shell". Do not add per-page role logic to the layout, and do not `redirect()` from it - the repo has a standing rule against layout redirects keyed on a header pathname.

**Files:**
- Modify: `apps/portal/src/app/admin/layout.tsx` - `resolveAdminIdentity` (`:26-50`), the `AdminIdentity` interface (`:20`), render sites `:71` (`AdminSidebarLive`) and `:98` (`AdminMobileNav`), and `SchoolYearScopeBar` at `:73`/`:95`
- Modify: `apps/portal/src/app/welcome/layout.tsx` - gate `:34`, guards `:90` and `:105`, copy `:75`, **`:59`** (`AdminSidebarLive` second call site), **`:61`** (the hardcoded `role="welcome-team"`), `:94` (mobile nav render site)
- Modify: `apps/portal/src/features/admin/components/admin-sidebar.tsx:16-40` (`NAV_GROUPS`), `:108-125` (the Dashboard link, outside the groups), `:8-14` (props)
- Modify: `apps/portal/src/features/admin/components/admin-mobile-nav.tsx:11-16` (`TABS`), `:22-31` (`MORE_THEMED`), `:33-38` (`MORE_LEGACY`)
- Modify: `apps/portal/src/features/family/components/desktop-sidebar.tsx:13` (`role` union), `:65-73` (`WELCOME_NAV_ITEMS`), `:101-102` (the `navItems` ternary)
- Modify: `apps/portal/src/features/family/components/welcome-mobile-nav.tsx:15` (props), `:37-51` (five links)
- Test: `apps/portal/src/features/family/components/__tests__/desktop-sidebar.test.tsx` (note: **`features/family/components/`**, NOT `components/chrome/`)
- Test: `apps/portal/src/features/admin/components/__tests__/admin-sidebar.test.tsx`
- Test: `apps/portal/src/features/admin/components/__tests__/admin-mobile-nav.test.tsx`

**Interfaces:**
- Consumes: `isCoordinator` (Task 1)
- Produces: `DesktopSidebarProps['role']` widened to include `'coordinator'`; `admin-sidebar` accepts a `canSeeAdminOnly: boolean` prop

- [ ] **Step 1: Write the failing tests**

```tsx
describe('DesktopSidebar - coordinator', () => {
  it('shows the Roster link', () => {
    render(<DesktopSidebar role="coordinator" />);
    expect(screen.getByText('Roster')).toBeInTheDocument();
  });

  it.each(['Reports', 'Levels & rosters', 'Seva', 'Prasad'])(
    'does NOT show the %s link, which a coordinator is denied',
    (label) => {
      render(<DesktopSidebar role="coordinator" />);
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    },
  );

  it('still shows every welcome-team link for welcome-team', () => {
    render(<DesktopSidebar role="welcome-team" />);
    for (const label of ['Roster', 'Reports', 'Levels & rosters', 'Seva', 'Prasad']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe('AdminSidebar - coordinator', () => {
  // displayEmail and hasFamily are REQUIRED props (admin-sidebar.tsx:8-14).
  // Omitting them is a compile error, not the missing-prop error you might expect.
  const base = { displayEmail: 'a@b.c', hasFamily: false };

  it('shows only Programs and Level management', () => {
    render(<AdminSidebar {...base} canSeeAdminOnly={false} />);
    expect(screen.getByText('Programs')).toBeInTheDocument();
    expect(screen.getByText('Level management')).toBeInTheDocument();
    expect(screen.queryByText('Users & roles')).not.toBeInTheDocument();
    expect(screen.queryByText('School year rollover')).not.toBeInTheDocument();
    expect(screen.queryByText('Locations')).not.toBeInTheDocument();
    expect(screen.queryByText('Class calendar')).not.toBeInTheDocument();
    // Rendered outside NAV_GROUPS, so the group filter alone misses it.
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('shows everything for an admin', () => {
    render(<AdminSidebar {...base} canSeeAdminOnly />);
    expect(screen.getByText('Users & roles')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/family/components/__tests__/desktop-sidebar.test.tsx src/features/admin/components/__tests__ --project jsdom
```

Expected: FAIL - `role="coordinator"` is not assignable, and `AdminSidebar` takes no `canSeeAdminOnly` prop.

- [ ] **Step 3: Widen the two layout gates**

`app/admin/layout.tsx` - import `isCoordinator`. Hoist a flag **above** the `if (sessionCookie)` block, because `raw` is block-scoped inside it (`:33-49`) and the function returns at `:50` - you cannot compute this in the return expression:

```ts
  let allowed = false;
  let adminOnly = false;
  // ... inside the existing if (sessionCookie) block, replacing :37:
    // Staff-shell gate only. WHICH /admin/* pages a coordinator may reach is
    // decided by canAccessRoute in middleware (middleware.ts:101), which runs
    // on pages as well as APIs - do not duplicate that allow-list here.
    if (raw) {
      adminOnly = isAdmin(raw as unknown as WithRole);
      allowed = adminOnly || isCoordinator(raw as unknown as WithRole);
    }
```

Add `adminOnly: boolean` to the `AdminIdentity` interface (`:20`) and to the `:50` return. Destructure it at `:62` and `:85`, and pass it as `canSeeAdminOnly` to the **render sites**: `<AdminSidebarLive>` at `:71` and `<AdminMobileNav>` at `:98`.

Also pass it to `SchoolYearScopeBar` at `:73` and `:95`, which today hardcodes `canManage` - that renders a link to `/admin/school-year`, denied to a coordinator. `welcome/layout.tsx:70` already does this correctly with `canManage={admin}`; copy that.

Change the `AccessDenied` copy at `:56` to `Access denied. Admin or coordinator role required.`

`app/welcome/layout.tsx` - import `isCoordinator`, and at `:34`:

```ts
    if (raw && (isWelcomeTeam(raw as unknown as WithRole) || isCoordinator(raw as unknown as WithRole))) {
      allowed = true;
    }
```

Apply the same widening at the single-line guards `:90` and `:105` so the mobile nav and scope bar render for a coordinator. Update the `:75` copy to `Access denied. Welcome-team or coordinator role required.`

**`:59` also renders `AdminSidebarLive`** - pass `canSeeAdminOnly` there too. That branch is `admin === true`, so the value is `true`.

- [ ] **Step 3b: Thread the coordinator role into the welcome sidebar - without this, Step 5 is dead code**

`welcome/layout.tsx:61` hardcodes the prop:

```tsx
<DesktopSidebarLive role="welcome-team" displayName="Welcome team" subtitle="Welcome team" showSignOut showTeacher={showTeacher} />
```

`desktop-sidebar.tsx:101-102` selects its nav list off that prop, so a coordinator would render the **full welcome-team sidebar** - Reports, Levels & rosters, Seva, Prasad, all four denied by Task 4 and each a 302 to `/sign-in`. The Step 1 unit test renders `<DesktopSidebar role="coordinator" />` directly and passes while production shows all five links.

Compute the flag beside `admin` (already at `:39`) and pass it:

```tsx
const coordinatorOnly =
  !isWelcomeTeam(raw as unknown as WithRole) && isCoordinator(raw as unknown as WithRole);
// ...
<DesktopSidebarLive
  role={coordinatorOnly ? 'coordinator' : 'welcome-team'}
  displayName={coordinatorOnly ? 'Coordinator' : 'Welcome team'}
  subtitle={coordinatorOnly ? 'Coordinator' : 'Welcome team'}
  showSignOut
  showTeacher={showTeacher}
/>
```

`displayName` is not cosmetic here: `desktop-sidebar.tsx:103-105` only special-cases `'welcome-team'` and `'teacher'` for the fallback, so a coordinator with no `displayName` renders "Family member".

- [ ] **Step 4: Filter the admin sidebar**

`admin-sidebar.tsx` - `canSeeAdminOnly` must be **optional with a `true` default** (`canSeeAdminOnly?: boolean`), not required. `AdminSidebarLive` is `Omit<AdminSidebarProps, 'active'>` (`:186`) and has two call sites - `admin/layout.tsx:71` and `welcome/layout.tsx:59` - so a required prop is a compile error in the second.

Add `coordinator?: true` to the `NAV_GROUPS` item type (`:16-40`), mark **only** `{ label: 'Programs', href: '/admin/programs', coordinator: true }` and `{ label: 'Level management', href: '/admin/levels', coordinator: true }`, then filter each group's items with `canSeeAdminOnly || item.coordinator`. Drop any group left with zero visible items so no empty heading renders.

**Also gate the Dashboard link at `:108-125`.** It renders `<Link href="/admin">` **outside** `NAV_GROUPS`, so the group filter never touches it, and `/admin` is denied to a coordinator by Task 4's own test. Same defect this plan cites as its reason for excluding `/welcome/visitors`.

- [ ] **Step 4b: Filter the admin mobile nav - it has a different shape**

`admin-mobile-nav.tsx` has **no `NAV_GROUPS`**. Three separate constants:

- `:11-16` `TABS` - the always-visible bottom bar: Home `/admin`, Programs `/admin/programs`, Levels `/admin/levels`, Calendar `/admin/calendar`. **Two of the four are denied to a coordinator.**
- `:22-31` `MORE_THEMED` - 8 entries, all denied to a coordinator.
- `:33-38` `MORE_LEGACY` - 4 `/check-in/admin/*` entries, all denied.

Add `coordinator?: true` to the `TABS` and `MORE_THEMED` item types. Mark **only** the `programs` and `levels` tabs. Filter all three lists by `canSeeAdminOnly || item.coordinator`. When the "More" sheet has zero visible entries, do not render the More trigger at all. Accept the same optional `canSeeAdminOnly?: boolean` and thread it from `admin/layout.tsx:98`.

Add an `admin-mobile-nav` case to Step 1's tests - a coordinator must see exactly two tabs and no More trigger.

- [ ] **Step 5: Filter the welcome navs**

`desktop-sidebar.tsx:13`:

```ts
  role?: 'family' | 'welcome-team' | 'teacher' | 'coordinator';
```

Add a dedicated list beside `WELCOME_NAV_ITEMS` (`:65-73`) rather than mirroring it - four of those seven links point at paths a coordinator is denied:

```ts
// Coordinator sees Roster only. Reports / Levels & rosters / Seva / Prasad are
// welcome-team-only per spec 3.1 and would bounce at middleware.
const COORDINATOR_NAV_ITEMS: [SidebarTab, string, keyof typeof SetuIcon, string, boolean?][] = [
  ['home', 'Roster', 'search', '/welcome/roster'],
];
```

Select it in the `navItems` ternary at `:101-102`, which currently reads `role === 'welcome-team' ? WELCOME_NAV_ITEMS : role === 'teacher' ? ...`.

`welcome-mobile-nav.tsx` hardcodes **five** links at `:37-51` (Roster, Levels, Seva, Prasad, **Reports** - the Reports link opens at `:49` and closes at `:51`) and takes **no `role` prop**; its signature at `:15` is `({ isAdmin = false, hasFamily = false, showTeacher = false })`. Add `role?: 'welcome-team' | 'coordinator'`, thread it from the render site at `welcome/layout.tsx:94`, and render only the Roster link when `role === 'coordinator'`. Decide the conditional block at `:52-70` too - the Admin link at `:58` is denied to a coordinator.

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/family/components src/features/admin/components --project jsdom
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/admin/layout.tsx apps/portal/src/app/welcome/layout.tsx \
  apps/portal/src/features/admin/components apps/portal/src/features/family/components
git commit -m "feat(roles): let a coordinator into the admin and welcome shells

The third gate. admin/layout.tsx:37 and welcome/layout.tsx:34 each render an
'Access denied' screen for the wrong role, so a coordinator who cleared both
middleware and the handlers still saw nothing.

The layout gate is deliberately a plain role check, not a per-page allow-list.
middleware.ts's matcher covers every non-static path and runs canAccessRoute
on pages too, so it already decides which /admin/* and /welcome/* pages a
coordinator reaches. Duplicating that in the layout would invert ~15 admin
pages from deny-by-default to allow-by-default.

Navs are filtered instead of mirrored: mirroring the welcome-team group would
have rendered four links (Reports, Levels & rosters, Seva, Prasad) that
middleware denies. Tests assert their absence for a coordinator and their
presence for welcome-team."
```

---

## Track B: staff cross-family edit

Independent of Tasks 1-6. Welcome-team + admin only - spec §3.1 excludes family edit from coordinator, which is why `can-access-route.ts:246` needs no change.

### Task 7: The audit-log helper

**Files:**
- Create: `apps/portal/src/features/setu/audit/audit-log.ts`
- Test: `apps/portal/src/features/setu/audit/__tests__/audit-log.test.ts`

**Interfaces:**
- Produces: `writeAuditLog(txn: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, entry: AuditEntry): void`

- [ ] **Step 1: Write the failing test**

```ts
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

describe('writeAuditLog', () => {
  it('writes through the caller transaction, never its own', () => {
    const set = vi.fn();
    const txn = { set } as unknown as FirebaseFirestore.Transaction;
    const doc = vi.fn(() => ({ id: 'audit-1' }));
    const db = { collection: vi.fn(() => ({ doc })) } as unknown as FirebaseFirestore.Firestore;

    writeAuditLog(txn, db, {
      actorUid: 'u1', actorMid: null, actorRole: 'welcome-team',
      action: 'member.update', fid: 'CMT-X', mid: 'CMT-X-02',
      before: { schoolGrade: 3 }, after: { schoolGrade: 4 },
    });

    expect(db.collection).toHaveBeenCalledWith('audit_log');
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]![1]).toMatchObject({ action: 'member.update', at: 'SERVER_TS' });
  });

  it('carries a _test marker when one is supplied', () => {
    // E2E cleanup sweeps on `_test: true`; without this, Playwright audit rows
    // accumulate in UAT forever.
    const set = vi.fn();
    const txn = { set } as unknown as FirebaseFirestore.Transaction;
    const db = { collection: () => ({ doc: () => ({ id: 'a' }) }) } as unknown as FirebaseFirestore.Firestore;

    writeAuditLog(txn, db, { /* ...entry... */, _test: true });

    expect(set.mock.calls[0]![1]).toMatchObject({ _test: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/audit --project node
```

Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';

export interface AuditEntry {
  actorUid: string;
  actorMid: string | null;
  actorRole: string;
  action: string;
  fid: string;
  mid: string | null;
  before: unknown;
  after: unknown;
  /** Set by E2E fixtures so the cleanup sweep can find these rows. */
  _test?: true;
}

/**
 * Appends one audit row INSIDE the caller's transaction. Taking the txn rather
 * than opening its own is the whole point: a rejected write leaves no row, and
 * a committed write can never lack one.
 */
export function writeAuditLog(
  txn: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  entry: AuditEntry,
): void {
  const ref = db.collection('audit_log').doc();
  txn.set(ref, { ...entry, at: FieldValue.serverTimestamp() });
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/audit --project node
```

Expected: PASS.

- [ ] **Step 5: Update the cutover runbook**

`audit_log` is a new portal-owned collection. Add it to `docs/runbooks/production-cutover-checklist.md` §3 (collection ownership map) and add a dated §14 entry. This is a repo rule, not optional.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/audit docs/runbooks/production-cutover-checklist.md
git commit -m "feat(audit): transactional audit-log helper for staff edits

Takes the caller's transaction rather than opening its own, so an audit gap
is structurally impossible: a rejected write leaves no row, a committed write
can never lack one.

Carries an optional _test marker so Playwright-created rows are reachable by
the E2E cleanup sweep, which keys on _test: true.

New portal-owned collection, so the cutover runbook 3 and 14 are updated in
the same commit."
```

---

### Task 8: Extract the member write core, required-field matrix included

`api/setu/members/route.ts` validates in two stages: `addMemberSchema.safeParse`, then a required-field matrix (`REQUIRED_FIELD_ERROR:51-61`, `REQUIRED_FIELD_ORDER:66`, applied at `:105-107`) returning `grade-required`, `birthmonth-required`, `foodAllergies-required`, `contact-required`, `skills-required`. That matrix sits **outside** the transaction. Extracting only "the transaction bodies" would leave it behind, and since every field except `firstName/lastName/type/gender` is `.nullish()`, staff could create a Child with no grade and no birth month - which immediately trips the family's own `/complete-profile` gate.

**Files:**
- Create: `apps/portal/src/features/setu/members/write-member.ts`
- Modify: `apps/portal/src/app/api/setu/members/route.ts` (delegate; move the inline `addMemberSchema` at `:29-45` into the shared module)
- Modify: `apps/portal/src/app/api/setu/members/[mid]/route.ts` (delegate)
- Test: `apps/portal/src/features/setu/members/__tests__/write-member.test.ts`

**Interfaces:**
- Consumes: `writeAuditLog` (Task 7)
- Produces:
  - `addMemberSchema` (moved, unchanged)
  - `firstMissingRequiredField(input, type: 'Adult' | 'Child'): string | null` - **a new wrapper, not a rename.** The existing picker at `api/setu/members/route.ts:103` is `requiredFieldError(missing: MemberRequiredField[])`, taking the output of `whatsMissingForMember` (imported at `route.ts:10` from `@cmt/shared-domain/setu/member-required-fields`). Move that picker as a private helper and export the wrapper:
    ```ts
    export function firstMissingRequiredField(
      input: Parameters<typeof whatsMissingForMember>[0],
      type: 'Adult' | 'Child',
    ): string | null {
      return pickFirst(whatsMissingForMember(input, type));
    }
    ```
  - `firstMissingRequiredFieldForPatch(input, type): string | null` - **PATCH has its own matrix and it is deliberately different.** `api/setu/members/[mid]/route.ts:47` is `Record<MemberRequiredField, string | null>` (some fields not enforced on PATCH) against `:51`'s `Record<MemberRequiredField, string>` on POST, with its own `REQUIRED_FIELD_ORDER` at `:61` and picker `requiredFieldErrorPatch` at `:70`. Move both matrices, export both wrappers, and keep them distinct. Collapsing them into one would change PATCH semantics and trip Step 5's "existing tests unmodified" gate.
  - `addMember(args: { fid: string; input: AddMemberInput; actor: Actor | null }): Promise<Result>`
  - `updateMember(args: { fid: string; mid: string; patch: UpdateMemberInput; actor: Actor | null }): Promise<Result>`
  - `deleteMember(args: { fid: string; mid: string; actor: Actor | null }): Promise<Result>`
  - `interface Actor { uid: string; mid: string | null; role: string }` - `null` means a family self-serve write, which writes no audit row

- [ ] **Step 1: Write the failing tests**

```ts
describe('firstMissingRequiredField', () => {
  it('returns grade-required for a Child with no schoolGrade', () => {
    expect(firstMissingRequiredField({ type: 'Child', firstName: 'A' }, 'Child')).toBe('grade-required');
  });

  it('returns null for a complete Child', () => {
    expect(firstMissingRequiredField(completeChild, 'Child')).toBeNull();
  });
});

describe('addMember', () => {
  it('writes an audit row when an actor is supplied', async () => { /* ... */ });
  it('writes NO audit row for a family self-serve write (actor null)', async () => { /* ... */ });
  it('allocates the next mid as max-suffix + 1, never count + 1', async () => {
    // Regression guard for the 2026-07-19 data-loss incident: allocating from
    // a COUNT collides on any numbering gap and txn.set silently overwrites.
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/members/__tests__/write-member.test.ts --project node
```

Expected: FAIL - module not found.

- [ ] **Step 3: Move the logic, byte-for-byte where possible**

Move `addMemberSchema`, `REQUIRED_FIELD_ERROR`, `REQUIRED_FIELD_ORDER` and the picker at `:98-107` into `write-member.ts`, exporting the picker as `firstMissingRequiredField`. Move the three transaction bodies. Keep `nextMemberMid` (max-suffix + 1) exactly as it is. Add the `actor` parameter and, when it is non-null, call `writeAuditLog(txn, db, ...)` inside the same transaction.

- [ ] **Step 4: Delegate from the family routes**

`/api/setu/members` and `/api/setu/members/[mid]` call the new functions with `actor: null`.

**Deviation from spec §2.3, recorded deliberately:** these two routes keep their existing raw `x-portal-role` comparison (`route.ts:118,124`) in this task. Spec §2.3 asks the refactor to carry them onto `readSessionFromHeaders`. Changing the auth of a path that caused a data-loss incident in the same commit that moves its write logic doubles the blast radius of a mistake, and the comparison is currently safe (a family-manager who is also welcome-team keeps `role='family-manager'`). Migrate it in a follow-up commit whose diff is auth-only. All **new** routes in Task 9 use the helper pattern from the start.

- [ ] **Step 5: Prove the refactor is behaviour-preserving**

```bash
pnpm --filter @cmt/portal exec vitest run src/app/api/setu/members --project node
```

Expected: PASS **with the existing route tests unmodified**. If a test needs editing, the refactor changed behaviour - stop and find out why.

- [ ] **Step 6: Run the full suite**

```bash
pnpm test
```

The members path is shared; targeted globs miss the integration tests in separate directories.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/setu/members apps/portal/src/app/api/setu/members
git commit -m "refactor(members): extract the member write core for reuse by staff routes

Moves addMemberSchema (previously inline at route.ts:29), the required-field
matrix, and the three transaction bodies into features/setu/members/
write-member.ts so the staff routes cannot drift from the family ones.

The required-field matrix moves too. It sits outside the transaction, so
extracting only the transaction bodies would have left it behind - and since
every field except firstName/lastName/type/gender is .nullish(), staff could
then create a Child with no grade or birth month, which immediately trips the
family's own /complete-profile gate.

nextMemberMid (max-suffix + 1) is carried over unchanged; a regression test
pins it against the count+1 collision that caused the 2026-07-19 data loss.

Existing route tests pass UNMODIFIED, which is the proof obligation for a
refactor of this path.

Deviation recorded: the two family routes keep their raw x-portal-role
comparison here rather than moving to readSessionFromHeaders as spec 2.3
asks. Changing auth in the same commit that moves write logic doubles the
blast radius; that migration gets its own auth-only diff."
```

---

### Task 9: Staff family + member routes

**No new `canAccessRoute` rule is needed.** `can-access-route.ts:246` already covers `/api/welcome/families` and every path under it with `isWelcomeTeam(claims)`, and `isWelcomeTeam` already inherits admin (`role.ts:48-52`). There is no "generic `/api/welcome/` handling" to insert before - every `/api/welcome/*` path has an explicit clause and anything unmatched hits the default-deny at `:315`. Add test cases only.

**Files:**
- Create: `apps/portal/src/app/api/welcome/families/[fid]/route.ts` (PATCH)
- Create: `apps/portal/src/app/api/welcome/families/[fid]/members/route.ts` (POST)
- Create: `apps/portal/src/app/api/welcome/families/[fid]/members/[mid]/route.ts` (PATCH, DELETE)
- Test: one `__tests__/route.test.ts` beside each
- Test: `packages/shared-domain/src/__tests__/can-access-route.test.ts` (add cases only)

**Interfaces:**
- Consumes: `addMember` / `updateMember` / `deleteMember` / `firstMissingRequiredField` (Task 8), `writeAuditLog` (Task 7)

- [ ] **Step 1: Write the failing tests**

Per route, cover: 401 with no session; 403 for a plain family-manager; 200 for welcome-team; **200 for a welcome-team volunteer whose primary role is `family-member`** (`x-portal-role: family-member`, `x-portal-extra-roles: welcome-team`); the write lands on the **route** `fid`, not the session `fid`; an audit row is written; and `grade-required` for a Child with no `schoolGrade`.

The fourth case is the important one - welcome-team volunteers are usually parents, so a raw header comparison would 403 exactly the people this feature is for. The fifth is the privilege boundary: authority comes from the session, target comes from the route param, and they must never be mixed.

**Do not touch `can-access-route.test.ts` in this task.** Its authorization cases live in Task 4 Step 6c, where the `coordinator` fixture and the widened `Role` type already exist. Adding them here would need both, which is what makes this task depend on Tasks 1 and 4.

Two repo-standard concerns the shown route body below omits, both of which its `/api/setu/members` sibling has:
- route tests that hit `revalidateTag` need `vi.mock('next/cache')` in this harness, or they throw "static generation store missing" and look like a transaction flake
- decide whether these routes need the `if (!flags.setuAuth)` 404 guard that `api/setu/members/route.ts:113-116` opens with; `/api/welcome/*` siblings do not have it, so the answer is probably no - record it either way

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @cmt/portal exec vitest run src/app/api/welcome/families --project node
```

Expected: FAIL - modules missing.

- [ ] **Step 3: Implement the member POST route**

```ts
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { addMember, addMemberSchema, firstMissingRequiredField } from '@/features/setu/members/write-member';

export async function POST(req: Request, { params }: { params: Promise<{ fid: string }> }) {
  const session = readSessionFromHeaders(req);
  // `uid` is `string | null` on PortalSessionHeaders (headers.ts:4) because
  // family routes authenticate via fid. Actor.uid is `string`, so the null
  // check is load-bearing, not defensive. Same form as the sibling handler at
  // api/admin/levels/[levelId]/teachers/route.ts:27-29.
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Authority from the session, target from the route. Never mixed.
  const { fid } = await params;

  const parsed = addMemberSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const missing = firstMissingRequiredField(parsed.data, parsed.data.type);
  if (missing) return NextResponse.json({ error: missing }, { status: 400 });

  const result = await addMember({
    fid,
    input: parsed.data,
    actor: { uid: session.uid, mid: session.mid ?? null, role: session.role },
  });

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json(result);
}
```

The `'max'` profile is not optional - every existing caller passes it, and omitting it makes staff edits appear not to save.

- [ ] **Step 4: Implement the family PATCH and member PATCH/DELETE routes**

Same auth shape. The family PATCH accepts family-level fields only: `familyAddress`, `familyEmergencyContact`, `location`, `name`. Validate with the existing family patch schema. The member PATCH/DELETE delegate to `updateMember` / `deleteMember` and must apply the same last-manager guard the family paths enforce at every demotion path.

- [ ] **Step 5: Run the tests, then the full suite**

```bash
pnpm --filter @cmt/portal exec vitest run src/app/api/welcome/families --project node
pnpm test
```

- [ ] **Step 6: Record the mobile API contract change**

`/api/welcome/*` is not `/api/setu/*`, so `MOBILE_API_CHANGELOG.md` is not strictly required - but check whether the mobile app mirrors any welcome route before skipping it. If it does, add the dated SHA-keyed entry.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/api/welcome/families
git commit -m "feat(welcome): staff routes to edit any family and its members

Three new routes under /api/welcome/families/[fid]. No canAccessRoute change:
:246 already covers the whole prefix with isWelcomeTeam, which inherits admin.
Coordinator is denied, per spec 3.1 excluding family EDIT even though it now
grants family READ - pinned by a test in the canAccessRoute commit.

Authority comes from the session, target from the route param, never mixed.
Every route has a test for a welcome-team volunteer whose primary role is
family-member with welcome-team in extraRoles: staff are usually parents, so
that is the realistic shape and the one a raw header comparison would 403.

Shares the required-field matrix with the family routes, so a staff-created
Child cannot be missing the grade and birth month that the family's own
/complete-profile gate demands."
```

---

### Task 10: Give welcome-team a grade editor

**There is no live 403 bug here.** `welcome/family/[fid]/members/[mid]/page.tsx:73` reads `{admin && profile.type === 'Child' && (`, so welcome-team never renders the control and never reaches the endpoint. The gap is a missing capability. That changes the work: the **render gate** must be widened, not just the POST target - repointing the target alone would ship a no-op.

**Files:**
- Modify: `apps/portal/src/app/welcome/family/[fid]/members/[mid]/page.tsx:42,73`
- Modify: `apps/portal/src/features/setu/rollover/member-grade-editor.tsx:60`
- Test: `apps/portal/src/features/setu/rollover/__tests__/member-grade-editor.test.tsx`

**Do NOT edit `features/setu/rollover/set-grade-client.ts`.** It has two callers: `member-grade-editor.tsx:60` and `components/promotion-preview.tsx:251`, the latter being the `/admin/school-year` rollover screen. Changing the shared wrapper would silently reroute admin rollover through the staff route. Give `MemberGradeEditor` a `staff?: boolean` prop instead and let it choose the endpoint, leaving `promotion-preview.tsx` on the admin path untouched.

**Preserve grade validation.** `SetMemberGradeBodySchema` constrains `schoolGrade` to a canonical `GRADE_LADDER` rung; a generic member PATCH does not. Validate the rung in the staff path too.

- [ ] **Step 1: Write the failing test**

```tsx
it('posts to the staff route when staff is set', async () => { /* ... */ });
it('posts to the admin route by default, so rollover preview is unaffected', async () => { /* ... */ });
it('rejects a grade that is not a GRADE_LADDER rung', async () => { /* ... */ });
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/rollover --project jsdom
```

- [ ] **Step 3: Widen the render gate**

At `page.tsx:42`, compute a staff flag beside `admin`:

```ts
  const canEditGrade = !!raw && isWelcomeTeam(raw as unknown as WithRole);
```

`isWelcomeTeam` already inherits admin, so this covers both. At `:73`:

```tsx
      {canEditGrade && profile.type === 'Child' && (
        <MemberGradeEditor
          fid={profile.fid}
          mid={profile.mid}
          childName={profile.firstName}
          currentGrade={profile.schoolGrade}
          staff={!admin}
        />
      )}
```

Update the comment at `:66-69`, which currently says welcome-team keeps the page read-only.

- [ ] **Step 4: Add the staff endpoint to the editor**

In `member-grade-editor.tsx`, accept `staff?: boolean` and when set, PATCH `/api/welcome/families/{fid}/members/{mid}` with `{ schoolGrade }` after validating the ladder rung. Leave the default path calling `setGradeClient` exactly as today.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @cmt/portal exec vitest run src/features/setu/rollover --project jsdom
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/welcome/family apps/portal/src/features/setu/rollover
git commit -m "feat(welcome): let welcome-team edit a child's grade

Corrects a false premise carried in the spec and the v1 plan: there was no
live 403. page.tsx:73 gates the editor on 'admin &&', so welcome-team never
saw the control. The gap was a missing capability, which means the RENDER gate
had to be widened - repointing the POST target alone would have been a no-op.

set-grade-client.ts is deliberately untouched. It has two callers, and the
other one is the /admin/school-year rollover preview; editing the shared
wrapper would have silently rerouted admin rollover through the staff route.
MemberGradeEditor takes a staff prop and picks the endpoint instead.

GRADE_LADDER rung validation is preserved on the new path - a generic member
PATCH would not enforce it."
```

---

### Task 11: Seed personas and verify against deployed UAT

Green unit tests do not mean shipped. Everything above is invisible to mocks: the layout gates, the middleware allow-list, and the nav filtering all live in the integration layer.

**Files:**
- Modify: `apps/portal/scripts/seed-test-accounts.ts:88-94` (`StandalonePersona.role` union) and the `PERSONAS` array
- Create: `apps/portal/e2e/setu/admin/coordinator.spec.ts`
- Create: `apps/portal/e2e/setu/admin/staff-family-edit.spec.ts`

- [ ] **Step 1: Widen the persona union and add two personas**

**Three** sites, not one. The union at `StandalonePersona.role` (`:89-95`, the role line is `:93`):

```ts
  role: 'admin' | 'welcome-team' | 'coordinator';
```

and the second hardcoded union at `:200`:

```ts
async function grantStandaloneRole(email: string, role: 'admin' | 'welcome-team' | 'coordinator')
```

Add a standalone `setu-test-coordinator` (landing `/welcome/roster`). Task 2 is a hard prerequisite - the existing standalone personas are family-less, and before Task 2 a family-less coordinator could not get a session at all.

Then the **second** persona, attached to a family, which covers the realistic `role='family-manager'` + `extraRoles=['coordinator']` shape. A staff-only persona passes while production fails. This one is **not** an array entry: `interface FamilyPersona` (`:74-88`) has no role field at all and nothing in the script writes `roleAssignments`. Add:

```ts
interface FamilyPersona {
  // ...existing fields...
  /** Sevak roles granted to this persona's manager mid, written to roleAssignments/{mid}. */
  sevakRoles?: GrantableRole[];
}
```

and a write of `roleAssignments/{mid}` with `{ mid, fid, roles: sevakRoles, grantedAt, grantedVia }` for any persona that declares it. That persona is the only end-to-end exercise of Task 5's `extraRoles` handling and of the `RESURRECTABLE_SEVAK_CAPS` path from Task 1 Step 5b.

- [ ] **Step 2: Seed against UAT**

```bash
pnpm --filter @cmt/portal seed:test-accounts
```

- [ ] **Step 3: Write the coordinator E2E**

Password sign-in, never OTP - the OTP limiter is shared (5/15min) and cascades. Assert, against **deployed** `cmt-setu.vercel.app`:

1. The standalone coordinator signs in and lands on `/welcome/roster` with rows rendered.
2. `/admin/programs` loads and shows the programs UI - **not** "Access denied".
3. `/admin/levels` loads.
4. Editing a program's pricing **saves** - this is the assertion that would have caught the in-handler 403.
5. `/admin/users` shows access-denied or redirects.
6. `/welcome/reports` is denied.
7. The welcome sidebar shows Roster and **not** Reports / Levels & rosters / Seva / Prasad.
8. The family-attached coordinator persona gets the same results, proving the `extraRoles` path.

- [ ] **Step 4: Write the staff-family-edit E2E**

Sign in as the welcome-team persona, open a family with **at least two members**, change a child's grade, confirm it saves and the new value survives a reload, and confirm an `audit_log` row exists. Then confirm the coordinator persona is denied the same edit.

- [ ] **Step 5: Run against deployed UAT**

```bash
PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu coordinator staff-family-edit
```

The `PLAYWRIGHT_BASE_URL` prefix is the whole point of this task. Bare `pnpm test:e2e` auto-starts `next dev` on :3001 (`apps/portal/e2e/README.md:27`) and runs against **localhost**, which is the one thing this task exists to prevent - and local `next dev` has a known `/family` hang. Note `--project=setu` with the `=`, and bare positional filters with no `--` separator, matching `e2e/README.md:32`.

Never run the whole setu Playwright suite - the OTP limiter cascade makes it unreliable.

- [ ] **Step 6: Clean up and update the runbook**

The mutation specs must delete what they created, including `audit_log` rows (they carry `_test: true` from Task 7). Add the coordinator personas to `docs/runbooks/production-cutover-checklist.md` §10 and a dated §14 entry.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/scripts/seed-test-accounts.ts apps/portal/e2e/setu/admin \
  docs/runbooks/production-cutover-checklist.md
git commit -m "test(e2e): deployed-UAT coverage for coordinator and staff family edit

Two personas, because a staff-only account passes while production fails:
one standalone coordinator and one attached to a family, which exercises the
realistic role='family-manager' + extraRoles=['coordinator'] shape.

The load-bearing assertion is that editing program pricing SAVES. A green
can-access-route unit test passes whether or not the handler and layout gates
were widened; only a real save proves all three."
```

---

## Self-review

**Spec coverage.** §3.1 grant table: Roster (Tasks 4, 6), Programs (4, 5, 6), Offerings (4, 5), Levels (4, 5, 6), Teacher assignments (4, 5). Visitors is deliberately excluded and the reason is recorded. §3.2 touchpoint table: every row maps to Task 1, 2, 3, 4 or 6, **plus** the in-handler and layout rows §3.2 omits, which are Tasks 5 and 6. §3.4 negative tests: Task 4 Step 1, including the `/api/setu/family/search` case the v1 plan missed; the §3.4-vs-§3.1 contradiction on `/api/admin/levels` is resolved in favour of §3.1 and recorded under Deliberate deviations. §2.2 staff edit: Tasks 7-10. §2.2 step 6: Task 10, reframed.

**Type consistency.** `isCoordinator` (Task 1) is used verbatim in Tasks 2, 4, 5, 6. `writeAuditLog(txn, db, entry)` (Task 7) is called with that exact arity in Tasks 8 and 9. `Actor` is defined once in Task 8 and constructed identically in Task 9. `canSeeAdminOnly` is the same prop name in Task 6's tests and implementation.

**Every review finding is addressed:** C1→Task 5, C2/C3→Task 6, C4→Task 4 Steps 3/5, C5→Task 1 atomic, C6→Task 2, C7→Task 10. M1→Task 3, M2→Task 1 Step 4 + test, M3→Task 4 Step 4 + denial test, M4/M8→Task 6 with corrected paths, M5→corrected test paths throughout, M6→excluded with reason, M7→Task 9 preamble, M9→Task 8, M10→Task 10's do-not-edit note, M11→Task 8 Step 4 recorded deviation, M12→Task 1 Step 5, M13→Task 11 Step 1, M14→Task 4 Step 1 + deviations. m1→Global Constraints + Task 9 Step 3, m2→line numbers re-verified against `b1395e0`, m3→Task 1 Step 4 states two, m4→Task 6 declares no Task 1 dependency for the sidebar prop, m5→Task 3 Step 1 note, m6→Task 7 `_test`, m7→Task 7 Step 1 mock.

**Task independence.** Tasks 1→2→3 are sequential (shared types). Task 4 needs Task 1. Tasks 5 and 6 need Task 4 to be meaningful but are independently mergeable. **Tasks 7, 8 and 10 need nothing from Track A** and can be built in parallel with it; **Task 9 needs Tasks 1 and 4** for its fixtures and types. Task 11 needs both tracks.

## Review history

This plan has been through one adversarial review round (two independent reviewers, 2026-07-25). Reports: `docs/superpowers/reviews/2026-07-25-review-p1v2-authz.md` and `-exec.md`. Everything they found that I re-verified against the code is folded in above. The four that changed the most:

1. **`RESURRECTABLE_SEVAK_CAPS` (Task 1 Step 5b)** - the plan was *creating* a privilege-retention hole. Task 2 makes a family-less coordinator session possible; the strip-list on member DELETE only covered admin and welcome-team, so a deleted member's coordinator claim would resurrect as a standalone session with every family's roster PII.
2. **`api/welcome/roster/report` (Task 5 Step 4b)** - the coordinator's only data endpoint, missed because Task 5 scoped itself to a directory (`api/admin/`) instead of to Task 4's grant table.
3. **`welcome/layout.tsx:61` (Task 6 Step 3b)** - `role="welcome-team"` is hardcoded, so `COORDINATOR_NAV_ITEMS` would have shipped as dead code while production showed four denied links. The unit test renders the component directly and would have passed.
4. **`/welcome/family/*` (Task 4 Step 6)** - every roster row links there, so the one screen the role is granted was a dead end.

Also corrected: a test this plan told you to write **already exists** (`roles-reference.test.ts:26-29`), three "append this import" snippets duplicated imports already in their files, `Actor.uid` did not typecheck against `session.uid`, PATCH has a deliberately different required-field matrix from POST, and the E2E command ran against localhost.

**The lesson for whoever implements this:** every claim here was verified against the code at least once and several were still wrong. Re-check before you trust, especially anything asserting that something does *not* exist.

## Known risk

Eleven tasks, two of which (5 and 6) did not exist in the v1 plan. The three-gate structure is the reason: it is not extra scope, it is the scope that was missing. If the timeline forces a cut, **Track B (Tasks 7-11 staff edit) is the more self-contained half** and Track A can slip without leaving a half-authorized role in production. Shipping Track A partially - middleware without handlers, or handlers without layouts - produces a role that looks granted and reaches nothing, which is worse than not shipping it.
