# P1 - Coordinator Role & Staff Cross-Family Edit - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add a `coordinator` role scoped to roster + visitors + programs + offerings + levels + teacher assignments, and let welcome-team staff edit any family's details with a full audit trail.

**Architecture:** `coordinator` joins the existing three-layer role model (`ROLES`, `GRANTABLE_ROLES`, `Capability`) and is granted through explicit per-route clauses placed **above** the admin catch-alls. Cross-family editing extracts the existing member-write core into a shared module that takes `fid` as a parameter, then exposes it behind new `/api/welcome/families/[fid]/...` routes that derive the target family from the route and the authority from the session. Every staff write records an `audit_log` row inside the same transaction as the mutation.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, Firebase Admin Firestore, Vitest, Playwright.

## Global Constraints

See `2026-07-25-aug-3-launch-INDEX.md` § Global Constraints. Every task below implicitly includes them. The three that bite hardest in this plan:

- **Never** compare the raw `x-portal-role` string. Use `readSessionFromHeaders` + `isWelcomeTeam`/`isAdmin`. Staff are usually parents too, so their primary role is `family-member` with `welcome-team` in `extraRoles`.
- **Never** loosen the `/api/admin/` catch-all at `can-access-route.ts:75`. New grants are explicit clauses placed above it.
- Tests ship in the same commit as the logic.

---

## File Structure

**Role plumbing (Tasks 1-4)**
- `packages/shared-domain/src/auth/role.ts` - add `'coordinator'` to `ROLES`, add `isCoordinator()`
- `packages/shared-domain/src/setu/schemas/sevak.ts` - add to `GRANTABLE_ROLES`
- `apps/portal/src/lib/auth/role-claims.ts` - add to `Capability`
- `apps/portal/src/features/setu/auth/build-session-claims.ts` - preserve in `preservedExtras()`
- `apps/portal/src/features/setu/auth/member-roles.ts` - widen the hardcoded read filter
- `apps/portal/src/features/setu/auth/manage-roles.ts` - add to `ROLE_ORDER`
- `apps/portal/src/lib/auth/roles-reference.ts` - add `ROLE_REFERENCE` entry (build-breaking until done)
- `apps/portal/src/features/admin/users/role-badges.tsx` - add `ROLE_CHIP` entry (build-breaking until done)
- `packages/shared-domain/src/auth/can-access-route.ts` - explicit grant clauses
- `apps/portal/src/components/chrome/desktop-sidebar.tsx` - widen `role` union, add links

**Audit log (Task 5)**
- `apps/portal/src/features/setu/audit/audit-log.ts` - single responsibility: write one audit row inside a caller-supplied transaction

**Cross-family edit (Tasks 6-9)**
- `apps/portal/src/features/setu/members/write-member.ts` - extracted member create/update/delete core, `fid` as a parameter
- `apps/portal/src/app/api/welcome/families/[fid]/members/route.ts` - staff POST
- `apps/portal/src/app/api/welcome/families/[fid]/members/[mid]/route.ts` - staff PATCH + DELETE
- `apps/portal/src/app/api/welcome/families/[fid]/route.ts` - staff family-level PATCH
- `apps/portal/src/app/welcome/family/[fid]/` - edit affordances
- `apps/portal/src/app/welcome/family/[fid]/members/[mid]/page.tsx:73-80` - repoint `MemberGradeEditor`

---

### Task 1: Add `coordinator` to the role type system

Adding the role to `ROLES` deliberately **breaks the build** in three places. That is the guardrail working - each break is a file that must be updated. Fix all of them in this task so the tree stays green.

**Files:**
- Modify: `packages/shared-domain/src/auth/role.ts:1`
- Modify: `packages/shared-domain/src/setu/schemas/sevak.ts:6`
- Modify: `apps/portal/src/lib/auth/role-claims.ts:16`
- Modify: `apps/portal/src/lib/auth/roles-reference.ts` (add entry to `ROLE_REFERENCE`)
- Modify: `apps/portal/src/features/admin/users/role-badges.tsx:9-12`
- Test: `packages/shared-domain/src/auth/__tests__/role.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Role` union now includes `'coordinator'`; `isCoordinator(claims: WithRole): boolean`; `GrantableRole` includes `'coordinator'`; `Capability` includes `'coordinator'`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared-domain/src/auth/__tests__/role.test.ts`:

```ts
import { isCoordinator, isAdmin, ROLES } from '../role';

describe('coordinator role', () => {
  it('is a known role', () => {
    expect((ROLES as readonly string[]).includes('coordinator')).toBe(true);
  });

  it('isCoordinator is true for a primary coordinator', () => {
    expect(isCoordinator({ role: 'coordinator' })).toBe(true);
  });

  it('isCoordinator is true when coordinator is an extra role', () => {
    expect(isCoordinator({ role: 'family-member', extraRoles: ['coordinator'] })).toBe(true);
  });

  it('admin inherits coordinator', () => {
    expect(isCoordinator({ role: 'admin' })).toBe(true);
  });

  it('a plain family member is not a coordinator', () => {
    expect(isCoordinator({ role: 'family-member' })).toBe(false);
  });

  it('a coordinator is NOT an admin', () => {
    expect(isAdmin({ role: 'coordinator' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/shared-domain test -- role.test`
Expected: FAIL - `isCoordinator` is not exported.

- [ ] **Step 3: Add the role and helper**

In `packages/shared-domain/src/auth/role.ts`, line 1 becomes:

```ts
export const ROLES = ['admin', 'teacher', 'family', 'family-manager', 'family-member', 'welcome-team', 'coordinator', 'kiosk'] as const;
```

Add after `isAdmin`:

```ts
// Coordinators manage rosters, visitors, programs, levels and teacher
// assignments. Admin inherits, matching every other capability helper here.
export function isCoordinator(claims: WithRole): boolean {
  return hasRole(claims, 'coordinator') || hasRole(claims, 'admin');
}
```

- [ ] **Step 4: Fix the three build-breaking sites**

`packages/shared-domain/src/setu/schemas/sevak.ts:6`:

```ts
export const GRANTABLE_ROLES = ['admin', 'welcome-team', 'coordinator'] as const;
```

`apps/portal/src/lib/auth/role-claims.ts:16`:

```ts
export type Capability = 'admin' | 'welcome-team' | 'coordinator' | 'kiosk';
```

`apps/portal/src/lib/auth/roles-reference.ts` - add inside `ROLE_REFERENCE`:

```ts
  coordinator: {
    label: 'Coordinator',
    summary: 'Manages rosters, visitors, programs, levels and teacher assignments. Above welcome team, below admin.',
    grants: [
      'Everything a welcome-team volunteer can do (family search, roster, visitors)',
      'Create and edit programs (/admin/programs) and their offerings, including donation amounts',
      'Manage class levels (/admin/levels)',
      'Assign and unassign teachers for any level',
    ],
  },
```

`apps/portal/src/features/admin/users/role-badges.tsx` - add inside `ROLE_CHIP`:

```ts
  coordinator: { label: 'Coordinator', bg: 'var(--info-soft)', fg: 'var(--info-deep)' },
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @cmt/shared-domain test -- role.test && pnpm typecheck`
Expected: PASS. `roles-reference.test.ts` (which asserts `Object.keys(ROLE_REFERENCE)` equals `ROLES`) must also pass - if it fails, the `ROLE_REFERENCE` entry is missing or misspelled.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-domain/src/auth/role.ts \
        packages/shared-domain/src/auth/__tests__/role.test.ts \
        packages/shared-domain/src/setu/schemas/sevak.ts \
        apps/portal/src/lib/auth/role-claims.ts \
        apps/portal/src/lib/auth/roles-reference.ts \
        apps/portal/src/features/admin/users/role-badges.tsx
git commit -m "feat(auth): add coordinator role to the type system

Adds 'coordinator' across all three role layers (ROLES, GRANTABLE_ROLES,
Capability) plus the two exhaustive records that break the build until a
new role is documented (ROLE_REFERENCE, ROLE_CHIP).

Admin inherits coordinator, matching every other capability helper.
Route grants land in the next commit; this one is type plumbing only."
```

---

### Task 2: Close the three silent-failure traps

These three sites fail **without an error**: the role simply does not work. None is caught by the compiler, so each needs its own test.

**Files:**
- Modify: `apps/portal/src/features/setu/auth/build-session-claims.ts:125-131`
- Modify: `apps/portal/src/features/setu/auth/member-roles.ts:39-41`
- Modify: `apps/portal/src/features/setu/auth/manage-roles.ts:406`
- Test: `apps/portal/src/features/setu/auth/__tests__/member-roles.test.ts`

**Interfaces:**
- Consumes: `Role`, `GrantableRole` from Task 1
- Produces: a `coordinator` grant now survives sign-in and appears in `/admin/users`

- [ ] **Step 1: Write the failing test**

Append to `apps/portal/src/features/setu/auth/__tests__/member-roles.test.ts`:

```ts
it('getMemberRoles keeps a coordinator grant', async () => {
  // A roleAssignments doc carrying coordinator must survive the read filter.
  // Before this fix the filter hardcoded admin|welcome-team and silently
  // dropped every other role, so the grant existed in Firestore and did
  // nothing.
  await seedRoleAssignment('CMT-FAM-01', ['coordinator']);
  const roles = await getMemberRoles('CMT-FAM-01');
  expect(roles).toEqual(['coordinator']);
});
```

> If `seedRoleAssignment` does not already exist in this test file, use whatever fixture helper the neighbouring tests use to write a `roleAssignments/{mid}` doc with a `roles` array. Match the existing file's style rather than introducing a new helper.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- member-roles`
Expected: FAIL - `roles` is `[]` because the filter drops `coordinator`.

- [ ] **Step 3: Widen the read filter**

`apps/portal/src/features/setu/auth/member-roles.ts:39-41` becomes:

```ts
  return (data?.roles ?? []).filter((r): r is GrantableRole =>
    (GRANTABLE_ROLES as readonly string[]).includes(r),
  );
```

Import `GRANTABLE_ROLES` from `@cmt/shared-domain` alongside the existing `GrantableRole` type. Deriving the filter from the constant means the next role added never needs this line touched again.

- [ ] **Step 4: Preserve the role at sign-in**

`apps/portal/src/features/setu/auth/build-session-claims.ts` - inside `preservedExtras()`:

```ts
  function preservedExtras(): string[] {
    const extras: string[] = [];
    if (isAdminUser) extras.push('admin');
    if (isWelcomeTeamUser && !isAdminUser) extras.push('welcome-team');
    if (isCoordinatorUser && !isAdminUser) extras.push('coordinator');
    if (isTeacherUser && !isAdminUser) extras.push('teacher');
    return extras;
  }
```

Define `isCoordinatorUser` next to the existing `isWelcomeTeamUser`, resolved the same way from `allExistingRoles`. **Without this line a coordinator who is also a parent loses the role on every sign-in** - the grant persists in Firestore but never reaches their session.

- [ ] **Step 5: Add to the admin listing order**

`apps/portal/src/features/setu/auth/manage-roles.ts:406`:

```ts
  const ROLE_ORDER: GrantableRole[] = ['admin', 'coordinator', 'welcome-team'];
```

Ordered by privilege, descending. A role missing here vanishes from every `/admin/users` row.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @cmt/portal test -- member-roles build-session-claims manage-roles`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/setu/auth/member-roles.ts \
        apps/portal/src/features/setu/auth/build-session-claims.ts \
        apps/portal/src/features/setu/auth/manage-roles.ts \
        apps/portal/src/features/setu/auth/__tests__/member-roles.test.ts
git commit -m "fix(auth): close the three silent-failure traps for new roles

getMemberRoles hardcoded admin|welcome-team and dropped anything else on
read; preservedExtras() would have lost a coordinator grant at sign-in for
anyone who is also a parent; ROLE_ORDER omission hides a role from every
/admin/users row. None of the three produces an error - the role just
silently does not work.

The read filter now derives from GRANTABLE_ROLES so the next role added
never needs that line touched again."
```

---

### Task 3: Grant coordinator its routes

**Files:**
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Test: `packages/shared-domain/src/auth/__tests__/can-access-route.test.ts`

**Interfaces:**
- Consumes: `isCoordinator` from Task 1
- Produces: coordinator access to roster, visitors, programs, offerings, levels, teacher assignments

- [ ] **Step 1: Write the failing test**

Append to `packages/shared-domain/src/auth/__tests__/can-access-route.test.ts`:

```ts
describe('coordinator', () => {
  const coord = { role: 'coordinator' as const };

  // GRANTED
  it.each([
    ['/welcome/roster', 'GET'],
    ['/welcome/visitors', 'GET'],
    ['/api/welcome/roster/report', 'GET'],
    ['/admin/programs', 'GET'],
    ['/admin/programs/bala-vihar', 'GET'],
    ['/api/admin/programs', 'POST'],
    ['/api/admin/programs/bala-vihar', 'PATCH'],
    ['/api/admin/offerings', 'POST'],
    ['/api/admin/offerings/bv-brampton-2026-27', 'PATCH'],
    ['/admin/levels', 'GET'],
    ['/api/admin/levels', 'POST'],
    ['/api/admin/teacher-assignments', 'POST'],
  ])('allows %s %s', (path, method) => {
    expect(canAccessRoute(coord, path, method)).toBe(true);
  });

  // DENIED - these are the assertions that matter most
  it.each([
    ['/admin', 'GET'],
    ['/admin/users', 'GET'],
    ['/api/admin/users', 'POST'],
    ['/api/admin/welcome-team', 'POST'],
    ['/api/admin/welcome-team/uid-123', 'DELETE'],
    ['/api/admin/school-year', 'PUT'],
    ['/api/admin/locations', 'POST'],
    ['/welcome/reports', 'GET'],
    ['/api/welcome/reports/enrollment', 'GET'],
  ])('denies %s %s', (path, method) => {
    expect(canAccessRoute(coord, path, method)).toBe(false);
  });

  it('admin still reaches everything a coordinator can', () => {
    expect(canAccessRoute({ role: 'admin' }, '/admin/programs', 'GET')).toBe(true);
    expect(canAccessRoute({ role: 'admin' }, '/api/admin/welcome-team', 'POST')).toBe(true);
  });
});
```

> `/api/admin/welcome-team` in the denied list is the single most important assertion in this plan. That route has **no in-handler role check** - only the `/api/admin/` prefix protects it. If someone later "simplifies" the grants by widening that prefix, this test is what catches a coordinator gaining the power to grant welcome-team.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/shared-domain test -- can-access-route`
Expected: FAIL on the granted cases - coordinator currently falls through to default-deny.

- [ ] **Step 3: Add the grant clauses**

In `packages/shared-domain/src/auth/can-access-route.ts`, import `isCoordinator` on line 3. Insert **immediately before** the `/admin` page catch-all at `:50`:

```ts
  // Coordinator (2026-07-25): manages programs, their offerings/pricing, class
  // levels and teacher assignments, plus everything welcome-team can see.
  // Each grant is an EXPLICIT clause placed above the /admin/ catch-alls below.
  // Never widen those catch-alls for this role: /api/admin/welcome-team* has no
  // in-handler role check, so a prefix widening would let a coordinator grant
  // the welcome-team role.
  if (
    pathname === '/admin/programs' || pathname.startsWith('/admin/programs/') ||
    pathname === '/admin/levels' || pathname.startsWith('/admin/levels/')
  ) {
    return isAdmin(claims) || isCoordinator(claims);
  }
  if (
    pathname === '/api/admin/programs' || pathname.startsWith('/api/admin/programs/') ||
    pathname === '/api/admin/offerings' || pathname.startsWith('/api/admin/offerings/') ||
    pathname === '/api/admin/levels' || pathname.startsWith('/api/admin/levels/')
  ) {
    return isAdmin(claims) || isCoordinator(claims);
  }
```

Then widen the four existing welcome-team clauses at `:51-73` to add `|| isCoordinator(claims)`, and the `/welcome/*` page rule at `:113` plus the roster/visitors API rules, so a coordinator inherits the welcome-team surface:

```ts
  if (pathname === '/welcome' || pathname.startsWith('/welcome/')) {
    return isWelcomeTeam(claims) || isCoordinator(claims);
  }
```

> **Ordering matters.** The new `/api/admin/levels` clause must sit **above** the existing `/api/admin/levels/[id]/teachers` regex at `:70-73`, or the broader rule shadows it. Both return the same answer for a coordinator, but the narrower rule still needs to run for welcome-team, who gets `/teachers` but not level CRUD.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/shared-domain test -- can-access-route`
Expected: PASS, all granted and all denied cases.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/auth/can-access-route.ts \
        packages/shared-domain/src/auth/__tests__/can-access-route.test.ts
git commit -m "feat(auth): grant coordinator roster, visitors, programs, offerings, levels

Every grant is an explicit clause above the /admin/ catch-alls. The
catch-alls are NOT widened: /api/admin/welcome-team* has no in-handler role
check, so widening the prefix would hand a coordinator the power to grant
welcome-team. A denial test pins that.

Offerings are included because program donation AMOUNTS live in
offering.pricingTiers - without the offerings API a coordinator would see
the pricing panel and 403 on save."
```

---

### Task 4: Surface coordinator in navigation and test accounts

**Files:**
- Modify: `apps/portal/src/components/chrome/desktop-sidebar.tsx:13`
- Modify: the mobile nav component alongside it
- Modify: `apps/portal/scripts/seed-test-accounts.ts`
- Test: `apps/portal/src/components/chrome/__tests__/desktop-sidebar.test.tsx`

**Interfaces:**
- Consumes: `Role` from Task 1
- Produces: a `coordinator` persona in the seeded UAT test accounts

- [ ] **Step 1: Write the failing test**

Append to `apps/portal/src/components/chrome/__tests__/desktop-sidebar.test.tsx`:

```tsx
it('shows roster, visitors and programs to a coordinator', () => {
  render(<DesktopSidebar role="coordinator" />);
  expect(screen.getByRole('link', { name: /roster/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /visitors/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /programs/i })).toBeInTheDocument();
});

it('does not show users & roles to a coordinator', () => {
  render(<DesktopSidebar role="coordinator" />);
  expect(screen.queryByRole('link', { name: /users/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- desktop-sidebar`
Expected: FAIL - the `role` prop union does not accept `'coordinator'`.

- [ ] **Step 3: Widen the sidebar**

In `apps/portal/src/components/chrome/desktop-sidebar.tsx`, widen the `role` prop union at `:13` to include `'coordinator'`, and add the link group. Mirror the existing welcome-team group and add Programs + Levels. Apply the same change to the mobile nav.

- [ ] **Step 4: Add the seeded persona**

In `apps/portal/scripts/seed-test-accounts.ts`, add a coordinator account beside the existing personas, following the file's existing shape exactly (same password source `TEST_ACCOUNTS_PASSWORD`, same UAT guard).

- [ ] **Step 5: Run tests, then seed UAT**

```bash
pnpm --filter @cmt/portal test -- desktop-sidebar
pnpm --filter @cmt/portal seed:test-accounts
```
Expected: tests PASS; seed reports the new coordinator account created.

- [ ] **Step 6: Update the runbook**

Add a dated §14 entry to `docs/runbooks/production-cutover-checklist.md` recording the new role, the seeded persona, and that no index or collection changed. **Required by repo rule** - a UAT DB operation without a runbook entry is an incomplete change.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/components/chrome/ \
        apps/portal/scripts/seed-test-accounts.ts \
        docs/runbooks/production-cutover-checklist.md
git commit -m "feat(nav): surface coordinator links and seed a UAT persona

Sidebar and mobile nav accept role='coordinator' and show roster, visitors,
programs and levels - never users & roles. Adds a coordinator test account
to seed:test-accounts and records the UAT op in the cutover runbook."
```

---

### Task 5: The audit log

Written **inside** the caller's transaction so an audit gap is structurally impossible: a rejected write leaves no row, and a committed write can never lack one.

**Files:**
- Create: `apps/portal/src/features/setu/audit/audit-log.ts`
- Test: `apps/portal/src/features/setu/audit/__tests__/audit-log.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  export interface AuditActor { uid: string | null; mid: string | null; role: string }
  export interface AuditEntry {
    actor: AuditActor;
    action: string;               // e.g. 'member.update'
    fid: string;
    mid: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }
  export function writeAuditLog(
    txn: FirebaseFirestore.Transaction,
    db: FirebaseFirestore.Firestore,
    entry: AuditEntry,
  ): void
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/setu/audit/__tests__/audit-log.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { writeAuditLog } from '../audit-log';

function fakeDb() {
  const doc = vi.fn(() => ({ id: 'audit-1' }));
  return { collection: vi.fn(() => ({ doc })), _doc: doc };
}

describe('writeAuditLog', () => {
  it('writes one row into audit_log via the caller transaction', () => {
    const db = fakeDb();
    const txn = { set: vi.fn() };
    writeAuditLog(txn as never, db as never, {
      actor: { uid: 'uid-1', mid: 'CMT-A-01', role: 'welcome-team' },
      action: 'member.update',
      fid: 'CMT-FAM',
      mid: 'CMT-FAM-02',
      before: { schoolGrade: '2' },
      after: { schoolGrade: '3' },
    });
    expect(db.collection).toHaveBeenCalledWith('audit_log');
    expect(txn.set).toHaveBeenCalledTimes(1);
    const [, payload] = txn.set.mock.calls[0]!;
    expect(payload).toMatchObject({
      action: 'member.update',
      fid: 'CMT-FAM',
      mid: 'CMT-FAM-02',
      actorUid: 'uid-1',
      actorRole: 'welcome-team',
      before: { schoolGrade: '2' },
      after: { schoolGrade: '3' },
    });
    expect(payload.at).toBeDefined();
  });

  it('uses the transaction, never a bare write', () => {
    const db = fakeDb();
    const txn = { set: vi.fn() };
    writeAuditLog(txn as never, db as never, {
      actor: { uid: null, mid: null, role: 'admin' },
      action: 'family.update',
      fid: 'CMT-FAM',
      mid: null,
      before: null,
      after: { location: 'Scarborough' },
    });
    // A doc ref is obtained but nothing is committed outside the txn.
    expect(txn.set).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- audit-log`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Create `apps/portal/src/features/setu/audit/audit-log.ts`:

```ts
import 'server-only';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';

/** Who performed a staff write. `mid` is null for a staff account with no family. */
export interface AuditActor {
  uid: string | null;
  mid: string | null;
  role: string;
}

export interface AuditEntry {
  actor: AuditActor;
  /** Dotted verb, e.g. 'member.create' | 'member.update' | 'member.delete' | 'family.update'. */
  action: string;
  fid: string;
  mid: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * Appends one audit row INSIDE the caller's transaction.
 *
 * Taking the transaction as a parameter rather than opening its own is the
 * whole point: the audit row and the mutation it records commit together or
 * not at all. A rejected write leaves no row; a committed write can never
 * lack one. Callers must not await this - it enlists in the txn, it does not
 * perform I/O itself.
 */
export function writeAuditLog(
  txn: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  entry: AuditEntry,
): void {
  const ref = db.collection('audit_log').doc();
  txn.set(ref, {
    actorUid: entry.actor.uid,
    actorMid: entry.actor.mid,
    actorRole: entry.actor.role,
    action: entry.action,
    fid: entry.fid,
    mid: entry.mid,
    before: entry.before,
    after: entry.after,
    at: FieldValue.serverTimestamp(),
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- audit-log`
Expected: PASS.

- [ ] **Step 5: Update the runbook**

`audit_log` is a new portal-owned collection. Add it to §3's collection ownership map in `docs/runbooks/production-cutover-checklist.md` (the spec already drafted this text) and add a dated §14 entry. No index is needed - nothing queries it yet.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/audit/ docs/runbooks/production-cutover-checklist.md
git commit -m "feat(audit): add audit_log written inside the caller transaction

writeAuditLog takes the transaction as a parameter rather than opening its
own, so the audit row and the mutation commit together or not at all. A
rejected write leaves no row and a committed write can never lack one.

New portal-owned collection recorded in the cutover runbook. No index -
nothing queries it yet."
```

---

### Task 6: Extract the member-write core

Pure refactor. The member-write logic has already caused one data-loss incident (the mid collision fixed in `9ee2de8`), so it is extracted rather than duplicated. **Externally byte-for-byte unchanged** - the existing route tests are the proof and must stay green untouched.

**Files:**
- Create: `apps/portal/src/features/setu/members/write-member.ts`
- Modify: `apps/portal/src/app/api/setu/members/route.ts`
- Modify: `apps/portal/src/app/api/setu/members/[mid]/route.ts`
- Test: existing route tests must pass **without modification**

**Interfaces:**
- Consumes: `writeAuditLog` from Task 5
- Produces:
  ```ts
  export interface WriteMemberContext { fid: string; actor: AuditActor | null }
  export async function createMember(ctx: WriteMemberContext, data: AddMemberInput): Promise<{ mid: string }>
  export async function updateMember(ctx: WriteMemberContext, mid: string, patch: PatchMemberInput): Promise<void>
  export async function deleteMember(ctx: WriteMemberContext, mid: string): Promise<void>
  ```
  `actor: null` means "the family acting on itself" - no audit row. A non-null actor writes one.

- [ ] **Step 1: Confirm the existing tests pass before touching anything**

Run: `pnpm --filter @cmt/portal test -- api/setu/members`
Expected: PASS. Record the count; it must be identical after the refactor.

- [ ] **Step 2: Move the logic**

Create `apps/portal/src/features/setu/members/write-member.ts` and move the transaction bodies from both route handlers verbatim, replacing every read of the `x-portal-fid` header with `ctx.fid`. Preserve exactly:
- `nextMemberMid` allocation - **max(existing suffix) + 1**, never a COUNT
- `txn.create` for the new member doc (fail-closed), **never `txn.set`**
- `contactKey` conflict checks and the `contact-conflict:{type}` error strings
- the last-manager guard
- `syncActiveEnrollmentMemberships` invocation

Then add, at the end of each mutation's transaction, before commit:

```ts
  if (ctx.actor) {
    writeAuditLog(txn, db, {
      actor: ctx.actor,
      action: 'member.update',
      fid: ctx.fid,
      mid,
      before,
      after,
    });
  }
```

- [ ] **Step 3: Make the routes delegate**

Both `/api/setu/members` handlers keep their existing auth checks unchanged (`role !== 'family-manager'` → 403, missing fid → 400) and call the new functions with `{ fid, actor: null }`.

- [ ] **Step 4: Run the existing tests unchanged**

Run: `pnpm --filter @cmt/portal test -- api/setu/members`
Expected: PASS, **same count as Step 1, with no test file edited.** If a test needed changing, the refactor changed behaviour and must be corrected.

- [ ] **Step 5: Run the full suite**

Run: `pnpm --filter @cmt/portal test`
Expected: PASS. Required by repo rule - integration tests live in separate directories and a targeted glob misses them.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/members/write-member.ts \
        apps/portal/src/app/api/setu/members/
git commit -m "refactor(members): extract the write core with fid as a parameter

Pure refactor ahead of staff cross-family editing. The member write path
allocates mids and guards contactKey conflicts inside a transaction and has
already caused one data-loss incident (9ee2de8), so it is extracted rather
than duplicated for staff.

Externally byte-for-byte unchanged: every existing route test passes
without modification. Optional actor writes an audit row inside the same
transaction; family self-service passes actor: null and writes none."
```

---

### Task 7: Staff member routes

**Files:**
- Create: `apps/portal/src/app/api/welcome/families/[fid]/members/route.ts`
- Create: `apps/portal/src/app/api/welcome/families/[fid]/members/[mid]/route.ts`
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Test: `apps/portal/src/app/api/welcome/families/[fid]/members/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `createMember` / `updateMember` / `deleteMember` from Task 6, `readSessionFromHeaders`, `isWelcomeTeam`
- Produces: `POST /api/welcome/families/[fid]/members`, `PATCH|DELETE /api/welcome/families/[fid]/members/[mid]`

- [ ] **Step 1: Write the failing test**

Create the test file:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createMember } = vi.hoisted(() => ({ createMember: vi.fn() }));
vi.mock('@/features/setu/members/write-member', () => ({ createMember }));
vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { POST } from '../route';

function req(body: unknown, headers: Record<string, string>): Request {
  return new Request('https://x/api/welcome/families/CMT-TARGET/members', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ fid: 'CMT-TARGET' }) };
const BODY = { firstName: 'Asha', lastName: 'Rana', gender: 'Female', type: 'Child' };

beforeEach(() => createMember.mockReset());

describe('POST /api/welcome/families/[fid]/members', () => {
  it('401 with no session', async () => {
    const res = await POST(req(BODY, {}), ctx);
    expect(res.status).toBe(401);
  });

  it('403 for a plain family manager', async () => {
    const res = await POST(req(BODY, { 'x-portal-role': 'family-manager', 'x-portal-extra-roles': '' }), ctx);
    expect(res.status).toBe(403);
    expect(createMember).not.toHaveBeenCalled();
  });

  it('allows welcome-team carried in extraRoles (staff are usually parents too)', async () => {
    createMember.mockResolvedValue({ mid: 'CMT-TARGET-03' });
    const res = await POST(
      req(BODY, {
        'x-portal-role': 'family-member',
        'x-portal-extra-roles': 'welcome-team',
        'x-portal-fid': 'CMT-STAFF-OWN-FAMILY',
        'x-portal-mid': 'CMT-STAFF-01',
        'x-portal-uid': 'uid-staff',
      }),
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it('writes to the ROUTE fid, never the caller own fid', async () => {
    createMember.mockResolvedValue({ mid: 'CMT-TARGET-03' });
    await POST(
      req(BODY, {
        'x-portal-role': 'welcome-team',
        'x-portal-extra-roles': '',
        'x-portal-fid': 'CMT-STAFF-OWN-FAMILY',
        'x-portal-mid': 'CMT-STAFF-01',
        'x-portal-uid': 'uid-staff',
      }),
      ctx,
    );
    const [callCtx] = createMember.mock.calls[0]!;
    expect(callCtx.fid).toBe('CMT-TARGET');
    expect(callCtx.actor).toMatchObject({ uid: 'uid-staff', mid: 'CMT-STAFF-01' });
  });
});
```

> The third test is the one that matters. A welcome-team volunteer who is also a parent has `role='family-member'` with `welcome-team` in `extraRoles`. A handler comparing the raw `x-portal-role` string would 403 exactly the people this feature is for.
>
> The fourth pins the privilege boundary: the target comes from the **route**, the authority from the **session**. Mixing them is how a staff endpoint becomes a cross-family write primitive for anyone.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- welcome/families`
Expected: FAIL - route does not exist.

- [ ] **Step 3: Implement the POST route**

```ts
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { createMember } from '@/features/setu/members/write-member';
import { addMemberSchema } from '@/features/setu/members/schemas';

export async function POST(req: Request, ctx: { params: Promise<{ fid: string }> }) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  // Full claims, never the raw x-portal-role string: staff are usually parents
  // too, so their primary role is family-member with welcome-team in extras.
  if (!isWelcomeTeam({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { fid } = await ctx.params;
  const raw = await req.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  // Target family from the ROUTE, authority from the SESSION. Never mixed.
  const result = await createMember(
    { fid, actor: { uid: session.uid, mid: session.mid, role: session.role } },
    parsed.data,
  );

  revalidateTag(`family-${fid}`);
  return NextResponse.json({ ok: true, mid: result.mid });
}
```

Implement `[mid]/route.ts` with `PATCH` and `DELETE` following the identical auth shape, delegating to `updateMember` / `deleteMember`.

> Import `addMemberSchema` from wherever the existing `/api/setu/members` route defines it. If it is declared inline in that route file, move it into a shared module in this task so both routes validate identically - two schemas that drift is how a staff route starts accepting fields the family route rejects.

- [ ] **Step 4: Add the canAccessRoute rule**

Insert **before** the generic `/api/welcome/` handling:

```ts
  // Staff cross-family edit (2026-07-25): welcome-team + admin may write to ANY
  // family. The handlers take the target fid from the route and the authority
  // from the session; this rule only decides who may reach them.
  if (pathname.startsWith('/api/welcome/families/')) {
    return isWelcomeTeam(claims) || isAdmin(claims);
  }
```

Add matching allow/deny cases to `can-access-route.test.ts`: welcome-team and admin allowed; `family-manager`, `coordinator`, and `teacher` denied.

> Coordinator is **denied** here. The spec grants coordinator roster, visitors, programs, levels and teacher assignments - not family editing.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cmt/portal test -- welcome/families && pnpm --filter @cmt/shared-domain test -- can-access-route`
Expected: PASS.

- [ ] **Step 6: Mobile API changelog**

Append a dated, SHA-keyed entry to `apps/portal/docs/MOBILE_API_CHANGELOG.md` describing the three new endpoints, their auth, and their error codes. **Required by repo rule** for any new `/api/*` surface the mobile app may consume.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/api/welcome/families/ \
        packages/shared-domain/src/auth/can-access-route.ts \
        packages/shared-domain/src/auth/__tests__/can-access-route.test.ts \
        apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(welcome): staff endpoints to edit any family member

First endpoints where the acting user's fid differs from the target's. The
target fid comes from the ROUTE and the authority from the SESSION; a test
pins that they are never mixed.

Auth reads full claims via readSessionFromHeaders + isWelcomeTeam rather
than the raw x-portal-role string, because welcome-team staff are usually
parents too and carry welcome-team in extraRoles - a string comparison
would 403 exactly the people this is for. A test covers that case.

Coordinator is explicitly denied: its scope is programs and levels, not
family editing."
```

---

### Task 8: Staff family-level edit + fix the MemberGradeEditor 403

Fixes a **live bug**: welcome-team users are shown `MemberGradeEditor` today and get a 403, because it posts to the admin-only `/api/admin/school-year/set-grade`.

**Files:**
- Create: `apps/portal/src/app/api/welcome/families/[fid]/route.ts`
- Modify: `apps/portal/src/app/welcome/family/[fid]/members/[mid]/page.tsx:73-80`
- Modify: the `MemberGradeEditor` component's POST target
- Test: `apps/portal/src/app/api/welcome/families/[fid]/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `updateMember` (Task 6), `writeAuditLog` (Task 5), the auth shape from Task 7
- Produces: `PATCH /api/welcome/families/[fid]` for family-level fields

- [ ] **Step 1: Write the failing test**

Cover: 401 no session; 403 family-manager; 200 welcome-team; the patch reaches the route `fid`; and an audit row is requested. Follow the Task 7 test shape exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- welcome/families`
Expected: FAIL - route missing.

- [ ] **Step 3: Implement `PATCH /api/welcome/families/[fid]`**

Same auth shape as Task 7. Accepts family-level fields only: `familyAddress`, `familyEmergencyContact`, `location`, `name`. Validate with the existing family patch schema. Write the audit row inside the transaction.

- [ ] **Step 4: Repoint MemberGradeEditor**

Change its POST target from `/api/admin/school-year/set-grade` to `PATCH /api/welcome/families/{fid}/members/{mid}` with `{ schoolGrade }`. The component is rendered at `welcome/family/[fid]/members/[mid]/page.tsx:73-80` for welcome-team users, so it must call an endpoint they can actually reach.

- [ ] **Step 5: Verify against deployed UAT**

Sign in as the **welcome-team** test persona, open a family, change a child's grade, and confirm it saves. This is the exact flow that 403s today.

> A unit test cannot prove this fix. The bug is that a real role hits a real endpoint it is not granted - which lives in middleware, not in the handler. Follow the `verifying-setu-changes-in-uat` skill.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/api/welcome/families/ \
        apps/portal/src/app/welcome/family/ \
        apps/portal/src/features/
git commit -m "fix(welcome): grade editor 403 + staff family-level edit

MemberGradeEditor is rendered for welcome-team on the family detail page but
posted to /api/admin/school-year/set-grade, which is admin-only - so the
control was visible and always failed. It now targets the staff member
PATCH route.

Adds PATCH /api/welcome/families/[fid] for family-level fields (address,
emergency contact, location, name), same auth shape and audit trail as the
member routes."
```

---

### Task 9: Welcome family edit UI

**Files:**
- Modify: `apps/portal/src/app/welcome/family/[fid]/page.tsx`
- Create: `apps/portal/src/features/setu/welcome/family-edit-panel.tsx`
- Test: `apps/portal/src/features/setu/welcome/__tests__/family-edit-panel.test.tsx`

**Interfaces:**
- Consumes: the three staff endpoints from Tasks 7-8
- Produces: edit affordances on the previously read-only `/welcome/family/[fid]`

- [ ] **Step 1: Write the failing test**

Render the panel with a two-adult, two-child family fixture. Assert: an edit control per member; an add-member control; a family-level edit control; and that submitting calls the staff endpoint with the **target** fid.

> Use a **two of each** fixture. A one-member fixture cannot catch a component that renders only the first member or binds every row to the same mid.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- family-edit-panel`
Expected: FAIL - component does not exist.

- [ ] **Step 3: Build the panel**

Client component posting to the Task 7/8 endpoints through a `-client` fetch wrapper (never import a server-only module from a `'use client'` file). Reuse the existing family member form components where they take props rather than reading the session.

- [ ] **Step 4: Wire it into the page**

Replace the read-only member list on `/welcome/family/[fid]` with the panel. Keep the page a server component; the panel is the client island.

- [ ] **Step 5: Run tests and lint**

Run: `pnpm --filter @cmt/portal test -- family-edit-panel && pnpm lint`
Expected: PASS. Lint catches a cross-feature import if the panel reaches into another `features/` directory.

- [ ] **Step 6: Playwright E2E against deployed UAT**

Create `apps/portal/e2e/setu/admin/welcome-family-edit.spec.ts`:
- sign in as the welcome-team persona (**password sign-in, never OTP** - the OTP limiter is shared and cascades)
- open a seeded family with **two adults and two children**
- change a child's grade, add a member, edit the family address
- assert each persists after reload
- clean up what the spec created

Run: `pnpm test:e2e -- welcome-family-edit`
Expected: PASS against `https://cmt-setu.vercel.app`.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/welcome/family/ \
        apps/portal/src/features/setu/welcome/ \
        apps/portal/e2e/setu/admin/welcome-family-edit.spec.ts
git commit -m "feat(welcome): family edit UI on the staff detail page

Replaces the read-only member list with edit affordances backed by the
staff endpoints. Verified end to end against deployed UAT with a
two-adult/two-child fixture, signed in as a welcome-team member who is also
a parent - the claims shape most likely to break."
```

---

## Self-Review

**Spec coverage** - `2026-07-24-aug-3-launch-batch-design.md`:
- §2 welcome-team full family edit + audit → Tasks 5, 6, 7, 8, 9 ✅
- §2.2 step 6 MemberGradeEditor 403 fix → Task 8 ✅
- §3 coordinator role, all 14 touchpoints → Tasks 1, 2, 3, 4 ✅
- §3.1 offerings grant (added 2026-07-25) → Task 3 ✅
- §3.4 negative authorization tests → Task 3 Step 1 ✅
- §11 traps: extraRoles claims shape → Task 7 Step 1 test 3; audit-in-transaction → Task 5 ✅

Not in this plan, by design: §4 teacher view, §5 visitors, §6 roster reset, §8 SMS (all P2); §9 cutover (runbook).

**Placeholder scan:** no TBD/TODO. Every code step carries real code. Two steps intentionally defer to the existing file's conventions rather than inventing them - Task 2 Step 1 (`seedRoleAssignment` fixture helper) and Task 7 Step 3 (`addMemberSchema` location) - and both say explicitly what to do instead.

**Type consistency:** `isCoordinator` (Task 1) is used in Task 3. `AuditActor`/`AuditEntry`/`writeAuditLog` (Task 5) are consumed in Tasks 6, 7, 8 with matching shapes. `WriteMemberContext { fid, actor }` (Task 6) is constructed identically in Tasks 7 and 8. `readSessionFromHeaders` returns `PortalSessionHeaders` with `uid`/`mid`/`role`/`extraRoles`, matching what Task 7 destructures.
