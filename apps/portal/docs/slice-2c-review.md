# Slice 2c Code Review

**Reviewer:** worker-5 (code-reviewer)
**Date:** 2026-05-22
**Scope:** Slice 2c — Family CRUD (GET family, POST/PATCH/DELETE members, frontend wiring, edit screen, last-manager guard, canAccessRoute H1 fix)
**Baseline:** `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS (590 tests, 95 suites)

## Verdict
Approve with follow-ups

The implementation is structurally sound. The `canAccessRoute` H1 fix from the Slice 2a review is properly resolved — method-aware middleware now denies `family-member` POST/PATCH(other)/DELETE at the middleware layer, with comprehensive test coverage across both `can-access-route.test.ts` and two separate middleware test files. The last-manager guard is applied at both the demotion (PATCH `manager: false`) and deletion paths. The atomic contactKey lifecycle on PATCH email/phone changes is correct — old key deleted and new key created in the same transaction. One high-severity issue (edit page calling server-only function from a client component) will cause a runtime failure in production. Two medium issues warrant attention before the next sub-slice.

---

## Critical issues

None.

---

## High-severity issues

### H1. Edit page (`'use client'`) calls `getCurrentFamily()` which uses server-only APIs

**File:** `apps/portal/src/app/family/members/[mid]/edit/page.tsx:1,8,58`

```ts
'use client';
// ...
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
// ...
useEffect(() => {
  getCurrentFamily().then((result) => { ... });
}, [mid]);
```

`getCurrentFamily()` (in `features/setu/members/get-current-family.ts:15-16`) dynamically imports `cookies()` from `next/headers` and calls `verifyPortalSessionCookie()` from `@cmt/firebase-shared/admin/session` — both are server-only APIs. The `next/headers` module throws `"invariant: headers() expects to have requestAsyncStorage"` when called outside a server context, and `firebase-admin` will fail to bundle for the client (or crash at runtime if it somehow bundles).

**Why tests pass:** The test mocks `getCurrentFamily` entirely (`vi.mock('@/features/setu/members/get-current-family', ...)`), so the real server-only imports are never resolved. The `pnpm build` also passes because Next.js only tree-shakes the `'use client'` boundary at the page level — the dynamic `import('next/headers')` defers the failure to runtime.

**Impact:** The edit page will crash at runtime when a user navigates to `/family/members/{mid}/edit`. This is a hard blocker for the edit-member feature.

**Fix:** The edit page should fetch its data via the existing `GET /api/setu/family` API route (which already returns the full family + members payload), not by calling `getCurrentFamily()` directly. Replace the `useEffect` with a `fetch('/api/setu/family')` call:

```ts
useEffect(() => {
  fetch('/api/setu/family')
    .then((res) => res.json())
    .then((result) => {
      const member = result.members.find((m) => m.mid === mid);
      if (!member) { setLoading(false); return; }
      // ... populate state from result
    });
}, [mid]);
```

This also removes the need to import `getCurrentFamily` and its `FamilyWithMembers` type — the edit page can define a local response type or import the `MemberDoc` type from `@cmt/shared-domain/setu`.

### H2. POST `/api/setu/members` does not check contactKey existence before writing — contact-key theft

**File:** `apps/portal/src/app/api/setu/members/route.ts:90-107`

When adding a member with an email or phone, the route writes `contactKeys/{hash}` with `txn.set()` (unconditional overwrite) without first reading the doc to check if it already belongs to a different family. If the email `priya@example.com` is already registered under Family B, a manager of Family A can add a member with that email — the `contactKeys` doc is silently overwritten to point at Family A, breaking Family B's sign-in for that contact.

This was flagged as M2 in the Slice 2b review for `registerFamily` — the same pattern is now repeated in the POST members route.

**Impact:** Contact-key theft. A family manager can (accidentally or intentionally) steal another family's contact key by adding a member with that email/phone.

**Fix:** Inside the transaction, before writing each `contactKeys` doc, read it first and throw if it exists and belongs to a different `fid`:

```ts
if (data.email) {
  const hash = hashContactKey('email', data.email);
  const existing = await txn.get(db.collection('contactKeys').doc(hash));
  if (existing.exists && (existing.data() as { fid: string }).fid !== fid) {
    throw Object.assign(new Error('email-already-registered'), { code: 'contact-conflict' });
  }
  txn.set(db.collection('contactKeys').doc(hash), { ... });
}
```

Add corresponding error handling in the catch block to return a 409 with `{ error: 'contact-already-registered' }`.

### H3. PATCH `/api/setu/members/[mid]` does not check contactKey existence before writing — same contact-key theft on email/phone change

**File:** `apps/portal/src/app/api/setu/members/[mid]/route.ts:129-137,148-156`

Same pattern as H2: when a PATCH changes an email or phone, the new `contactKeys` doc is written with `txn.set()` unconditionally. If the new email belongs to a member of another family, the old family's contact key is silently overwritten.

**Fix:** Same as H2 — read the target `contactKeys` doc inside the transaction before writing, and reject if it belongs to a different `fid`.

---

## Medium-severity issues

### M1. POST `/api/setu/members` silently drops `emergencyContacts` from the request body

**File:** `apps/portal/src/app/api/setu/members/route.ts:10-21` (schema) vs `apps/portal/src/app/family/members/new/page.tsx:48-51` (frontend)

The `addMemberSchema` does not include `emergencyContacts`. The frontend's `new/page.tsx` sends `emergencyContacts` in the POST body (line 48-51), but zod's default behavior strips unknown keys. The member doc is always written with `emergencyContacts: [null, null]` (line 87), discarding whatever the user entered on the form.

**Impact:** Emergency contact data entered during "Add member" is silently lost. The user sees no error but the data is not saved.

**Fix:** Add `emergencyContacts` to `addMemberSchema`:

```ts
emergencyContacts: z.tuple([
  z.object({ relation: z.string(), phone: z.string(), email: z.string() }).nullable(),
  z.object({ relation: z.string(), phone: z.string(), email: z.string() }).nullable(),
]).optional(),
```

And use `data.emergencyContacts ?? [null, null]` in the member doc write at line 87.

### M2. `family/page.tsx` still renders mock members in the "My family" avatar row when `setuAuth` is on

**File:** `apps/portal/src/app/family/page.tsx:104-112`

The mobile dashboard's "My family" section iterates over `mockFamily.members` to render avatar circles, regardless of the `flags.setuAuth` value. While `memberCount` is correctly updated from real data (line 101), the avatar row always shows the mock Patel family members.

```ts
{mockFamily.members.map((m, i) => (
  <div key={i} style={{ marginLeft: i > 0 ? -8 : 0 }}>
    <div style={{ border: '2px solid var(--surface)', borderRadius: '50%' }}>
      <SetuAvatar name={m.name} size={36}/>
    </div>
  </div>
))}
```

**Impact:** The mobile dashboard shows incorrect avatar initials (always Patel family) even when a different family is signed in. Desktop layout does not have this issue (it uses the `members` variable which IS updated from real data).

**Fix:** Create a `displayMembers` array from the real data when `flags.setuAuth` is on, and use it for the avatar row. The existing `members/page.tsx` already does this correctly (line 60: `members = data.members.map(memberToDisplay)`).

### M3. `family/page.tsx` hardcodes the greeting date

**File:** `apps/portal/src/app/family/page.tsx:39,142`

```ts
<p style={{ ... }}>Sunday, 14 June 2026</p>
```

Both mobile (line 39) and desktop (line 142) hardcode "Sunday, 14 June 2026". This should use the current date or be removed if the design is still a prototype placeholder.

**Impact:** Cosmetic — the date is wrong for every visit except 14 June 2026. Low urgency but noticeable.

### M4. No cross-family guard on DELETE path — relies solely on Firestore document path

**File:** `apps/portal/src/app/api/setu/members/[mid]/route.ts:177-254`

The DELETE handler reads the `fid` from the session header and constructs the Firestore path `families/{fid}/members/{targetMid}`. If `targetMid` does not exist under the caller's `fid`, the `memberSnap.exists` check fails and returns 404. This is correct behavior — the Firestore path naturally scopes the lookup to the caller's family.

However, unlike the PATCH handler (which has an explicit cross-family check at lines 96-98 via `memberData.mid.startsWith(fid + '-')`), the DELETE handler has no explicit cross-family verification. The Firestore path scoping is sufficient in practice, but the asymmetry between PATCH (explicit check) and DELETE (implicit path-based check) could lead to a future regression if the path construction changes.

**Not a bug today** — the Firestore path scoping is correct. Noting the asymmetry for consistency.

---

## Low-severity / nits

### L1. `canAccessRoute` PATCH self-edit check uses type assertion instead of type narrowing

**File:** `packages/shared-domain/src/auth/can-access-route.ts:59`

```ts
return targetMid !== null && targetMid === (claims as { mid?: string }).mid;
```

The `claims` parameter is typed as `SessionClaims`, which already includes the optional `mid` field. The `as { mid?: string }` cast is unnecessary — `claims.mid` would work directly since `SessionClaims` already has `mid?: string`.

### L2. `patchSchema` accepts `type` change (Adult ↔ Child) without validation of dependent fields

**File:** `apps/portal/src/app/api/setu/members/[mid]/route.ts:18`

A PATCH can change `type` from `Adult` to `Child` (or vice versa) without requiring or clearing the type-specific fields. For example, changing an Adult to a Child doesn't require `schoolGrade` or clear `email`/`phone`/`volunteeringSkills`. This is defensible since PATCH is a partial update and the caller might send both `type` and the relevant fields in the same request, but it allows inconsistent member docs (e.g., a `Child` member with `volunteeringSkills` populated).

### L3. `new/page.tsx` does not catch `fetch` errors

**File:** `apps/portal/src/app/family/members/new/page.tsx:54-68`

The `handleSubmit` function in the add-member page calls `fetch` without a try-catch. If the network request throws (e.g., offline), the error is uncaught and `setSaving(false)` is never called, leaving the button permanently in the "Adding..." disabled state. The edit page (`edit/page.tsx`) correctly wraps the fetch in try-catch (line 121-146).

**Fix:** Wrap the fetch call in try-catch matching the pattern in `edit/page.tsx`.

### L4. `edit/page.tsx` — `removeButton` only renders on desktop, not on mobile

**File:** `apps/portal/src/app/family/members/[mid]/edit/page.tsx:315-324,339-349,368-380`

The `removeButton` variable is rendered in the desktop layout (line 370) but is NOT rendered in the mobile layout (between lines 339-349, only the `formBody` is rendered, not `removeButton`). Managers on mobile can only remove members from the detail page (`[mid]/page.tsx`), not from the edit page. This is inconsistent with the desktop experience.

The detail page `[mid]/page.tsx` has the "Remove from family" button on both mobile (line 82-85) and desktop (line 141-143), but those buttons are not wired to call the DELETE API — they're plain `<button>` elements with no `onClick` handler.

### L5. Detail page "Remove from family" buttons are not functional

**File:** `apps/portal/src/app/family/members/[mid]/page.tsx:82-85,141-143`

Both mobile and desktop layouts have a "Remove from family" button, but it's a plain `<button>` with no `onClick` handler. The functional delete is only available in the edit page. This means the delete workflow requires: detail page → edit page → remove button. This is fine as a UX choice, but the non-functional buttons on the detail page are misleading.

### L6. `get-current-family.ts` has three separate named imports from `@cmt/shared-domain/setu` that could be one line

**File:** `apps/portal/src/features/setu/members/get-current-family.ts:2-4`

```ts
import { SetuSessionClaimsSchema } from '@cmt/shared-domain/setu';
import type { FamilyDoc } from '@cmt/shared-domain/setu';
import type { MemberDoc } from '@cmt/shared-domain/setu';
```

Could be consolidated into:
```ts
import { SetuSessionClaimsSchema, type FamilyDoc, type MemberDoc } from '@cmt/shared-domain/setu';
```

---

## Things done well

1. **canAccessRoute H1 fix is comprehensive.** The method-aware `canAccessRoute` correctly distinguishes GET (read) from POST/PATCH/DELETE (mutation) for `/api/setu/members*`. The PATCH self-edit path correctly extracts the target `mid` from the URL and compares it against the session's `mid`. The catch-all at line 66-68 was tightened from `isSetuFamily` to `isSetuManager || isWelcomeTeam || isAdmin` — `family-member` is now correctly excluded from unknown future endpoints.

2. **Test coverage for the canAccessRoute H1 fix is thorough.** `can-access-route.test.ts` has 8 new describe blocks covering all three new roles across page routes and API routes, including cross-role denials. Both `middleware-setu.test.ts` and `middleware-2c.test.ts` independently test the method-aware behavior end-to-end through the real middleware function.

3. **Last-manager guard is applied at both paths.** `assertNotLastManager` is called in the PATCH handler (line 101-104) when `data.manager === false && memberData.manager === true`, and in the DELETE handler (line 220-222) when the member being deleted is a manager. Both paths correctly read the current family's `managers` array inside the transaction.

4. **Atomic contactKey lifecycle on PATCH is correct.** When email or phone changes on a PATCH, the old `contactKeys` doc is deleted and the new one is created within the same `db.runTransaction()` call (lines 122-156). No partial state is possible — either both the old key deletion and new key creation succeed, or neither does.

5. **`patchSchema` uses `.strict()` to reject immutable fields.** The zod schema at line 34 uses `.strict()` which rejects any keys not in the schema (including `mid`, `uid`, `joinedAt`). Tests explicitly verify that attempts to mutate these fields return 400.

6. **Self-edit manager-flag guard is correct.** Line 73 checks `'manager' in data && !isManager` — a non-manager cannot change the `manager` flag, even on their own profile. The test at `route.test.ts:137-145` explicitly verifies this returns 403 with `manager-flag-requires-manager-role`.

7. **Cross-family isolation via Firestore document path.** All API routes derive `fid` from the session header (set by middleware from the verified cookie), never from the request body or URL. Firestore queries are always scoped to `families/{fid}/members/...`, making cross-family reads structurally impossible. The PATCH handler adds an explicit `mid.startsWith(fid + '-')` check as belt-and-suspenders.

8. **Error boundary discipline maintained.** The new `/family/members/[mid]/edit/` segment has its own `error.tsx` (per discipline #3). It correctly renders mobile and desktop variants with "Try again" and "Back to family" actions.

9. **Feature flag gating is consistent.** All four route handlers (GET family, POST members, PATCH member, DELETE member) check `flags.setuAuth` at the top and return 404 when off. Tests verify this for each handler.

10. **`FieldError` component is minimal and well-placed.** Added to `atoms.tsx` as a thin wrapper — no unnecessary abstraction. Used correctly in the edit form to surface per-field server validation errors.

11. **Manager toggle visibility is correct.** The edit page only shows the manager checkbox when a manager is editing a *different* member (`isEditingOther`). Self-edit never shows the toggle, preventing accidental self-demotion from the UI.

12. **Integration tests cover the full CRUD lifecycle.** The `family-crud-integration.test.ts` file tests GET/POST/PATCH/DELETE through the actual route handlers with realistic mock data, including cross-family denial (Family B manager cannot delete Family A member) and feature-flag-off behavior.

---

## Suggested follow-ups (not blockers unless noted)

1. **Fix H1 (edit page server-only call) — BLOCKER.** The edit page will crash at runtime. Replace `getCurrentFamily()` with a `fetch('/api/setu/family')` call.

2. **Fix H2/H3 (contactKey collision check on POST and PATCH).** Before public launch, both the POST and PATCH routes must verify that new email/phone `contactKeys` don't already belong to a different family. This was Slice 2b M2 and is now replicated in two more code paths.

3. **Fix M1 (emergencyContacts dropped on POST).** Add the field to `addMemberSchema` so emergency contacts entered during "Add member" are persisted.

4. **Fix L3 (missing try-catch on new/page.tsx fetch).** Quick fix to prevent the button getting stuck in "Adding..." state on network errors.

5. **Wire the detail page "Remove" buttons.** Currently the buttons on `/family/members/[mid]` are non-functional. Either wire them with an `onClick` handler that calls DELETE, or remove them and rely on the edit page's remove button exclusively.

6. **Resolve the mock-avatar issue on the mobile dashboard.** When `setuAuth` is on, the "My family" avatar row on the mobile dashboard should show real family members, not mock Patel data.
