# Admin Revamp — Phase 2: Users & Roles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Spec: `docs/superpowers/specs/2026-06-08-admin-section-revamp-design.md` (Phase 2 + the "⚠️ Real role model" correction).

**Goal:** One unified `/admin/users` screen (admin-only) that lists every staff person with their effective roles, lets an admin grant/revoke admin & welcome-team through the **correct dual-path** (family→`roleAssignments/{mid}`, non-family→auth-claims), surfaces teacher status read-only, and shows a roles reference — replacing the three fragmented grant screens. Mobile + mobile-API ready.

**Architecture:** Extract the proven dual-path grant/revoke logic from `scripts/grant-admin.ts` into a shared server module `features/setu/auth/manage-roles.ts` (CLI + API both call it). Build a merged, **deduped-by-person** `listStaff()` reader over `roleAssignments` + Auth claims + `teacherAssignments`. Thin themed UI + JSON API on top.

**Tech Stack:** Next.js 16 App Router (server components + route handlers), Firebase Admin (Auth + Firestore), Zod shared schemas, Vitest (+ fake-firestore / auth mocks), Setu `.csp` tokens.

**Standing constraints:** roles via `isAdmin`/`isWelcomeTeam` helpers (never strict equality); `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`; tests in the SAME commit as branching logic; **N=2 fixtures** for every merged read; UAT-only DB; mobile layout + mobile API for every screen; designer pass on UI tasks; `.csp` scoping; never `--no-verify`; commit per task (controller pushes after review). Subagents on Opus.

**Authoritative reference to read first:**
- `apps/portal/src/features/setu/auth/build-session-claims.ts` — how roles resolve into a session (the merge this screen must mirror).
- `apps/portal/scripts/grant-admin.ts` — the dual-path grant/revoke/list logic to extract (currently hardcoded to `'admin'`; generalize to `GrantableRole`).
- `apps/portal/src/features/setu/auth/member-roles.ts` — `getMemberRoles`/`addMemberRole`/`removeMemberRole`/`listMembersWithRole`.
- `apps/portal/src/lib/auth/role-claims.ts` — `addCapability`/`removeCapability`/`hasCapability`.
- `apps/portal/src/features/setu/teacher/assignments.ts` — `getTeacherLevelIds`/`isTeacherAssigned`.
- `apps/portal/src/features/setu/auth/find-family-by-contact.ts` — contact → `{source, fid, mid, member, legacyFid}`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/shared-domain/src/setu/schemas/staff.ts` | Shared `StaffRow`, grant/revoke request/response Zod schemas + types | Create |
| `apps/portal/src/features/setu/auth/manage-roles.ts` | Dual-path `grantRole`/`revokeRole` + merged `listStaff()` | Create |
| `apps/portal/src/features/setu/auth/__tests__/manage-roles.test.ts` | Unit tests (fake-firestore + auth mock, N=2) | Create |
| `apps/portal/scripts/grant-admin.ts` | Refactor to call the shared module | Modify |
| `apps/portal/src/app/api/admin/users/route.ts` | `GET` list, `POST` grant | Create |
| `apps/portal/src/app/api/admin/users/roles/route.ts` | `DELETE` revoke (body `{contact, role}`) | Create |
| `apps/portal/src/features/admin/users/users-client.ts` | Client fetch wrappers (throw on non-OK) | Create |
| `apps/portal/src/features/admin/users/*` | Staff list, add form, role badges, access summary, roles reference (desktop + mobile) | Create |
| `apps/portal/src/app/admin/users/page.tsx` + `error.tsx` | The screen | Create |
| `apps/portal/src/lib/auth/roles-reference.ts` | Curated role→access descriptions (shared by panel + access summary) | Create |
| dashboard/sidebar/mobile-nav + redirects | Re-point "Welcome-team grants" → "Users & roles"; redirects | Modify |

---

## Task 1: Shared schemas (`staff.ts`)

**Files:** Create `packages/shared-domain/src/setu/schemas/staff.ts`; export from the setu barrel.

- [ ] **Step 1: Write the failing test** `packages/shared-domain/src/setu/__tests__/staff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { StaffRowSchema, GrantRoleBodySchema, RevokeRoleBodySchema } from '../schemas/staff';

describe('staff schemas', () => {
  it('accepts a valid StaffRow', () => {
    const row = { key: 'CMT-X-01', mid: 'CMT-X-01', fid: 'CMT-X', uid: null, name: 'Asha', contact: 'a@b.com', roles: ['admin'], isTeacher: true, teacherLevels: ['Level 2 (West)'], source: 'family' };
    expect(StaffRowSchema.parse(row)).toEqual(row);
  });
  it('rejects an unknown role in the grant body', () => {
    expect(GrantRoleBodySchema.safeParse({ contact: 'a@b.com', role: 'teacher' }).success).toBe(false);
    expect(GrantRoleBodySchema.safeParse({ contact: 'a@b.com', role: 'admin' }).success).toBe(true);
  });
  it('revoke body requires contact + grantable role', () => {
    expect(RevokeRoleBodySchema.safeParse({ contact: '', role: 'admin' }).success).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/staff.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `staff.ts`:

```ts
import { z } from 'zod';

export const GRANTABLE_ROLES = ['admin', 'welcome-team'] as const;
export const GrantableRoleSchema = z.enum(GRANTABLE_ROLES);
export type GrantableRole = z.infer<typeof GrantableRoleSchema>;

export const StaffRowSchema = z.object({
  key: z.string().min(1),                 // mid when known, else tid, else uid — dedupe key
  mid: z.string().nullable(),
  fid: z.string().nullable(),
  uid: z.string().nullable(),
  name: z.string().min(1),
  contact: z.string(),                    // email/phone for display + revoke routing
  roles: z.array(GrantableRoleSchema),    // effective admin/welcome-team grants, deduped
  isTeacher: z.boolean(),
  teacherLevels: z.array(z.string()),
  source: z.enum(['family', 'staff']),
});
export type StaffRow = z.infer<typeof StaffRowSchema>;

export const GrantRoleBodySchema = z.object({
  contact: z.string().min(1),             // email or phone
  role: GrantableRoleSchema,
});
export type GrantRoleBody = z.infer<typeof GrantRoleBodySchema>;

export const RevokeRoleBodySchema = z.object({
  contact: z.string().min(1),
  role: GrantableRoleSchema,
});
export type RevokeRoleBody = z.infer<typeof RevokeRoleBodySchema>;

export const StaffListResponseSchema = z.object({ staff: z.array(StaffRowSchema) });
export type StaffListResponse = z.infer<typeof StaffListResponseSchema>;
```

Export these from `packages/shared-domain/src/setu/index.ts` (and the root barrel if staff types are re-exported there — follow the existing pattern for `donation`/`enrollment`).

- [ ] **Step 4:** Run the test → PASS. Run `pnpm --filter @cmt/shared-domain exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit** `feat(shared): StaffRow + grant/revoke role schemas (admin Users & Roles)`.

---

## Task 2: Shared `manage-roles.ts` — dual-path grant/revoke

**Files:** Create `apps/portal/src/features/setu/auth/manage-roles.ts` + tests. Reads/writes `roleAssignments` (family) and Auth claims (non-family), exactly mirroring `grant-admin.ts` but generalized to `GrantableRole` and role-parameterized.

- [ ] **Step 1: Write failing tests** `__tests__/manage-roles.test.ts` covering BOTH paths (mock `findSetuFamilyByContact`, `member-roles`, and `portalAuth`):
  - grant `welcome-team` to a **family** contact → calls `addMemberRole({mid, fid, role:'welcome-team', grantedVia})`, returns `{path:'roleAssignments', mid, fid}`.
  - grant `admin` to a **non-family** contact → creates auth user if missing, `setCustomUserClaims` with `addCapability(...,'admin')`, returns `{path:'auth-claim', uid}`.
  - revoke `welcome-team` from a **family** contact → `removeMemberRole(mid,'welcome-team')`.
  - revoke `admin` from a **non-family** contact with the claim → `removeCapability`; without the claim → `{revoked:false}`.

- [ ] **Step 2:** Run → FAIL (module missing).

- [ ] **Step 3: Implement** `manage-roles.ts` by lifting the routing from `grant-admin.ts` (read it). Signatures:

```ts
import 'server-only';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import type { GrantableRole } from '@cmt/shared-domain';
import { addCapability, removeCapability, hasCapability, type ClaimsShape, type Capability } from '@/lib/auth/role-claims';
import { findSetuFamilyByContact } from './find-family-by-contact';
import { addMemberRole, removeMemberRole } from './member-roles';

function detectType(c: string): 'email' | 'phone' { return c.includes('@') ? 'email' : 'phone'; }
function uidOf(type: 'email' | 'phone', value: string): string { return sha256Hex(normalizeContactForKey(type, value)); }

export interface GrantResult { path: 'roleAssignments' | 'auth-claim'; mid: string | null; fid: string | null; uid: string | null; }

export async function grantRole(args: { contact: string; role: GrantableRole }): Promise<GrantResult> {
  const type = detectType(args.contact);
  const result = await findSetuFamilyByContact(type, args.contact);
  if (result.source === 'setu' && result.fid && result.mid) {
    await addMemberRole({ mid: result.mid, fid: result.fid, role: args.role, grantedVia: args.contact });
    return { path: 'roleAssignments', mid: result.mid, fid: result.fid, uid: null };
  }
  // non-family → auth claim on the canonical uid
  const auth = portalAuth();
  const uid = uidOf(type, args.contact);
  let existing: ClaimsShape | null = null;
  try { existing = ((await auth.getUser(uid)).customClaims as ClaimsShape | undefined) ?? null; }
  catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser(type === 'email' ? { uid, email: args.contact, disabled: false } : { uid, disabled: false });
    } else throw err;
  }
  const next = addCapability(existing, args.role as Capability, type === 'email' ? args.contact : undefined);
  await auth.setCustomUserClaims(uid, next);
  return { path: 'auth-claim', mid: null, fid: null, uid };
}

export async function revokeRole(args: { contact: string; role: GrantableRole }): Promise<{ path: GrantResult['path']; revoked: boolean }> {
  const type = detectType(args.contact);
  const result = await findSetuFamilyByContact(type, args.contact);
  if (result.source === 'setu' && result.mid) {
    await removeMemberRole(result.mid, args.role);
    return { path: 'roleAssignments', revoked: true };
  }
  const auth = portalAuth();
  const uid = uidOf(type, args.contact);
  try {
    const existing = ((await auth.getUser(uid)).customClaims as ClaimsShape | undefined) ?? null;
    if (!hasCapability(existing, args.role as Capability)) return { path: 'auth-claim', revoked: false };
    await auth.setCustomUserClaims(uid, removeCapability(existing, args.role as Capability));
    return { path: 'auth-claim', revoked: true };
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') return { path: 'auth-claim', revoked: false };
    throw err;
  }
}
```
  Note: `Capability` in role-claims is `'admin' | 'welcome-team'` — identical to `GrantableRole`, so the casts are safe; if TS complains, widen `addCapability`/`removeCapability` param to accept `GrantableRole` (they already only branch on the value).

- [ ] **Step 4:** Run tests → PASS.

- [ ] **Step 5: Refactor `grant-admin.ts`** to call `grantRole`/`revokeRole` (role `'admin'`), keeping its CLI output + the `--allow-prod`/UAT guard. Don't change its behavior. Run its existing tests if any; otherwise `tsc` clean.

- [ ] **Step 6: Commit** `feat(setu): shared dual-path grantRole/revokeRole module (extracted from grant-admin CLI)`.

---

## Task 3: `listStaff()` — merged, deduped-by-person reader

**Files:** add `listStaff()` to `manage-roles.ts` (or a sibling `list-staff.ts`); tests with **N=2** fixtures.

**Merge algorithm (dedupe key = mid when known, else tid, else uid):**
1. **roleAssignments** — `listMembersWithRole('admin')` + `listMembersWithRole('welcome-team')`; accumulate roles per `mid`. Resolve name/contact from `families/{fid}/members/{mid}` (firstName+lastName; email or phone). `source:'family'`.
2. **teacherAssignments** — read all docs. For ref that matches a member `mid` already in the map (or resolvable as `families/*/members/{mid}` via a collectionGroup query on `mid`): set `isTeacher=true` + join `levels` (levelId→levelName) for `teacherLevels`, merging into that row. For a standalone `tid` (resolve `teachers/{tid}`): add a `source:'staff'` row keyed by tid.
3. **Auth claims** — `listUsers()` paginated; for each user whose claims carry admin/welcome-team: resolve their contact (`claims.email`/`claims.phone`/auth email) → `findSetuFamilyByContact`. If it maps to a `mid`, **merge** roles into that mid's row (dedup — don't double count). Else add a `source:'staff'` row keyed by `uid` with the contact.

- [ ] **Step 1: Write failing test** with a fixture exercising **two of each** + the dedup case:
  - two family admins (`roleAssignments`), one of whom is ALSO welcome-team;
  - one non-family auth-claim admin;
  - one legacy auth-claim whose contact resolves to an existing family mid (must MERGE, not duplicate);
  - two teachers: one parent (`mid` present in a row) + one standalone `tid`.
  Assert: row count = distinct persons (no dup for the legacy-claim-on-existing-mid), the dual-role person has `roles:['admin','welcome-team']`, both teachers have `isTeacher` + their level names, tid teacher is its own row.

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** `listStaff(): Promise<StaffRow[]>` per the algorithm. Use `Promise.all` for the two role lists + level lookups. Sort by name. Guard every array index (`noUncheckedIndexedAccess`).

- [ ] **Step 4:** Run → PASS.

- [ ] **Step 5: Commit** `feat(setu): listStaff() — merged deduped admin/welcome-team/teacher reader`.

---

## Task 4: API routes (`/api/admin/users`, `/api/admin/users/roles`)

**Files:** Create the two route files. Admin-only (the `/api/admin/*` catch-all in `canAccessRoute` already gates these — verify, add a test, no new rule needed).

- [ ] **Step 1: Write failing route tests** (mock the manage-roles module + `readSessionFromHeaders`):
  - `GET` returns `{staff}` for an admin session; 403/empty for non-admin (note: middleware gates, but the handler re-checks `isAdmin` defensively).
  - `POST {contact, role}` → calls `grantRole`, 201 with the resulting row/summary; 400 on bad body (Zod).
  - `DELETE {contact, role}` → calls `revokeRole`; **self-lockout guard**: revoking `admin` from your OWN contact/uid → 409; **last-admin guard**: revoking the only remaining admin → 409.

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement.** Pattern (mirror `/api/admin/teacher-assignments/route.ts`): `readSessionFromHeaders(req)` → `isAdmin(session)` else 403. Parse with the Zod body schemas. Call `grantRole`/`revokeRole`/`listStaff`. For guards: compare the target contact's resolved key to `session.uid`/`session.mid`; for last-admin, count admins from `listStaff()` before revoke. Revalidate nothing (claims refresh at next sign-in; surface a UI note).

```ts
// DELETE guard sketch
if (role === 'admin') {
  const staff = await listStaff();
  const admins = staff.filter((s) => s.roles.includes('admin'));
  if (admins.length <= 1) return NextResponse.json({ error: 'last-admin' }, { status: 409 });
  // self-lockout: does this contact resolve to the caller?
}
```

- [ ] **Step 4:** Run → PASS. Add a `can-access-route` test asserting `/api/admin/users` + `/api/admin/users/roles` require admin (and deny welcome-team/family).

- [ ] **Step 5: Commit** `feat(api): /api/admin/users GET/POST + /roles DELETE (dual-path, guarded)`.

---

## Task 5: Screen `/admin/users` (desktop + mobile) + client wrappers

**Files:** `users-client.ts`, `roles-reference.ts`, `features/admin/users/*` components, `app/admin/users/page.tsx` + `error.tsx`. **Designer pass required** (UI/UX + mobile).

- [ ] **Step 1:** `roles-reference.ts` — exported `ROLE_REFERENCE: Record<Role, { label: string; grants: string[] }>` authored from `canAccessRoute` (admin = all admin tools; welcome-team = family search/roster, seva, teacher-assign; teacher = own levels' attendance; family-manager = manage own family; family-member = view own family). Pure data; unit-test it lists every role in `ROLES`.

- [ ] **Step 2:** `users-client.ts` — `listStaffClient()`, `grantRoleClient(body)`, `revokeRoleClient(body)` — fetch the API, **throw on non-OK** (so the UI fires an error toast, per the welcome-search pattern). These are the client/server boundary wrappers; the page's client components import THESE, never the server module.

- [ ] **Step 3:** `page.tsx` (server component, `await connection()` since it touches Firebase Admin) calls `listStaff()` for the initial render; hands `StaffRow[]` to a client list component for live grant/revoke + filter. Sections: header + add-staff form, staff list (role chips filter + search), roles reference panel. Reuse `themed-add-form.tsx`/`themed-list.tsx` patterns from `features/admin/welcome-team/` as the styling reference.
  - Add form: contact input + role select (admin/welcome-team) → `grantRoleClient` → optimistic refresh + success toast (note "applies at their next sign-in").
  - Per-row: role badges (admin/welcome-team/teacher+levels), "What can they access?" expand (from `ROLE_REFERENCE`), grant/revoke buttons, "Manage as teacher" deep-link to `/admin/levels`. Surface 409 (last-admin/self-lockout) as a clear toast.

- [ ] **Step 4:** **Mobile layout** (`block md:hidden`): stacked staff cards, add via a sheet, role chips horizontally scrollable, ≥44px tap targets, `.csp` scoping. Same client wrappers/API.

- [ ] **Step 5:** Tests: component test for the list (renders badges, dual-role person shows two chips — N=2; teacher row shows levels), roles-reference test. Designer review (desktop + 375px mobile) → apply fixes.

- [ ] **Step 6: Commit** (may be 2 commits: data/client+page, then mobile+polish) `feat(admin): Users & Roles screen (/admin/users) — list, grant/revoke, reference`.

---

## Task 6: Wire-up — nav re-point + redirects

**Files:** `admin/page.tsx`, `admin-sidebar.tsx` (+ test), `admin-mobile-nav.tsx`, redirect routes.

- [ ] **Step 1:** Re-point "Welcome-team grants" → **"Users & roles"** (`/admin/users`) in the dashboard People & access group, the sidebar `NAV_GROUPS`, and the mobile `MORE_THEMED`. Move legacy "Admin users" out of the Legacy group (it's absorbed). Update `deriveAdminActive` to map `/admin/users`. Update the sidebar test (label `Users & roles` → `/admin/users`; school-year etc. unchanged).

- [ ] **Step 2:** Redirects (mirror `donation-periods`): `app/admin/welcome-team/page.tsx` → `redirect('/admin/users')`; `app/check-in/admin/users/page.tsx` → `redirect('/admin/users')` (guard the flag/legacy behavior; keep the API routes intact for back-compat or point them at the shared module). Keep `/api/admin/welcome-team` working (now a shim over `manage-roles`) so nothing 404s mid-migration.

- [ ] **Step 3:** Tests for `deriveAdminActive('/admin/users')` + the renamed nav label. Manual: nav + redirects resolve.

- [ ] **Step 4: Commit** `refactor(admin): point nav at Users & roles; redirect old grant screens`.

---

## Final verification (after all tasks)

- [ ] `pnpm --filter @cmt/portal test` green; `pnpm typecheck && pnpm lint && pnpm build` clean (pre-push enforces).
- [ ] Code-review pass (correctness, dual-path routing, dedup, guards, `canAccessRoute`) + designer pass (UI/UX + mobile) — both as separate review lanes.
- [ ] **Mock-free UAT walkthrough (operator — needs admin OTP):** open `/admin/users`; confirm the list shows family-member staff (from roleAssignments), non-family staff (claims), and teachers (with levels) without dupes; grant welcome-team to a test family contact → re-sign-in that contact → role applies; revoke → applies; last-admin/self-lockout guards fire. Distinguish "tests pass" from "verified in UAT".
- [ ] If any UAT DB writes happen during validation, update `docs/runbooks/production-cutover-checklist.md` + §14 change-log.
- [ ] `git push` (single push after review).

## Notes for later phases
- Phase 3 (Roster) and Phase 4 (Reports) re-point their own nav entries + add `/api/welcome/*` `canAccessRoute` rules.
- The `roles-reference.ts` data is reused by Phase 3/4 access summaries.
