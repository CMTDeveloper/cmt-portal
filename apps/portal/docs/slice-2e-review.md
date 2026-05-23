# Slice 2e Code Review

**Reviewer:** worker-5 (code-reviewer)
**Date:** 2026-05-23
**Scope:** Slice 2e — Welcome-team family search (searchFamilies helper, GET /api/setu/family/search, /welcome dashboard, /welcome/family/[fid] detail, sidebar nav, client wrapper, integration tests)
**Baseline:** `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` FAIL (6 failures in welcome-search.test.tsx, 708 passed / 714 total, 107 suites)

## Verdict
Approve with required fixes

The implementation is structurally sound. The searchFamilies helper uses a clean multi-strategy approach (contactKey hash for email/phone, parallel fid + legacyFid + searchKeys queries for text), deduplicates correctly via a Map, and caps results at 20 before fetching member counts. The API route enforces welcome-team-only access at both the middleware level (canAccessRoute) and the route handler level (double-check on x-portal-role header). The welcome detail page includes defense-in-depth role re-checking in the Server Component. The client-server boundary is clean: the `'use client'` WelcomeSearch component uses `searchFamiliesClient` (a fetch wrapper), not the server-only `searchFamilies` function. One critical issue (6 test failures) must be fixed before merge.

---

## Critical issues

### C1. 6 test failures in welcome-search.test.tsx — fake timer / userEvent misconfiguration

**File:** `apps/portal/src/app/welcome/__tests__/welcome-search.test.tsx:82-152`

Tests at lines 82, 103, 121, and 137 (the "renders results", "renders links", "no-results", and "error state" tests) all time out at 5000ms. The root cause: after `beforeEach` calls `vi.useFakeTimers()`, several tests create userEvent with `{ delay: null }` instead of `{ advanceTimers: vi.advanceTimersByTime.bind(vi) }`. With fake timers active, `setTimeout` (used by the 300ms debounce in WelcomeSearch) never fires unless the test explicitly advances timers. Tests at lines 51 and 68 correctly use `{ advanceTimers: vi.advanceTimersByTime.bind(vi) }` and pass.

The "renders results" test at line 82 uses `{ advanceTimers: vi.advanceTimersByTime.bind(vi) }` correctly but the mock resolves data that then needs the debounce timer to fire — this test also times out, suggesting a secondary issue with the `waitFor` not seeing the resolved state because the `advanceTimersByTime` call at line 93 happens but the async resolution from the debounced `setTimeout` callback may not flush in the same microtask. The `vi.advanceTimersByTime(300)` needs to be wrapped inside `act()` or used with `await vi.advanceTimersByTimeAsync(300)` so that React state updates from the resolved promise are flushed before `waitFor` checks.

**Impact:** `pnpm test` fails. This blocks the pre-push hook and prevents merging to main.

**Fix:** For tests at lines 103, 121, 137: change `userEvent.setup({ delay: null })` to `userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })` and add `vi.advanceTimersByTime(300)` before the `waitFor` block. For the timing issue in the "renders results" test at line 82: use `await vi.advanceTimersByTimeAsync(300)` instead of `vi.advanceTimersByTime(300)` so the promise resolution from the debounced callback is properly awaited.

---

## High-severity issues

### H1. Family detail page role check allows no-cookie access — falls through to getFamilyForWelcome without auth

**File:** `apps/portal/src/app/welcome/family/[fid]/page.tsx:19-32`

```ts
const sessionCookie = cookieStore.get('__session')?.value;
if (sessionCookie) {
  // ... role check
}
// If no cookie, falls through to getFamilyForWelcome(fid)
```

The defensive role check only runs when `sessionCookie` is truthy. If the cookie is absent (e.g., expired/cleared), the code falls through past the guard and calls `getFamilyForWelcome(fid)`, which performs its own independent cookie check and returns `null` (triggering `notFound()`). So the behavior is correct in practice — an unauthenticated user sees 404, not family data.

However, the defense-in-depth intent is undermined: the Server Component's role check should be a hard gate, not a conditional that silently passes when the cookie is missing. If `getFamilyForWelcome` were ever refactored to accept a passed-in session (removing its own cookie check), the detail page would leak data.

**Impact:** No data leak today, but the guard is structurally weaker than intended. The middleware also blocks unauthenticated access to `/welcome/*`, so this is defense-in-depth layer 2 of 3.

**Fix:** Restructure as:
```ts
if (!sessionCookie) notFound();
const raw = await verifyPortalSessionCookie(sessionCookie);
if (!raw) notFound();
const parsed = SetuSessionClaimsSchema.safeParse(raw);
if (!parsed.success || parsed.data.role !== 'welcome-team') {
  return <AccessDenied />;
}
```

### H2. `searchFamiliesClient` silently swallows errors — returns `[]` on non-OK response

**File:** `apps/portal/src/features/setu/search/search-families-client.ts:12`

```ts
if (!res.ok) return [];
```

When the API returns 401, 403, or 500, the client wrapper returns an empty array instead of throwing. This means the WelcomeSearch component shows "No matching families found" instead of the error toast ("Search failed. Please try again.") — the catch block at line 35 of welcome-search.tsx never fires because no error is thrown.

A 401 or 403 from the search API likely means the session expired. The user sees "no results" and has no indication that they need to re-authenticate.

**Impact:** Misleading UX when the session expires mid-use. The welcome-team user searches, sees "no results", and doesn't know they've been logged out.

**Fix:** Throw on non-OK responses so the WelcomeSearch catch block can show the error state:
```ts
if (!res.ok) {
  throw new Error(res.status === 401 ? 'session-expired' : 'search-failed');
}
```

---

## Medium-severity issues

### M1. FamilySearchHit type diverges between server and client — `managerEmail` and `managerPhone` missing from client type

**Files:**
- `apps/portal/src/features/setu/search/search-families.ts:6-11` (server type)
- `apps/portal/src/features/setu/search/search-families-client.ts:1-7` (client type)

The server-side `FamilySearchHit` was originally defined with `managerEmail` and `managerPhone` fields (visible in the route test fixture at `route.test.ts:27-33`), but the final `searchFamilies` implementation does not return these fields. The client-side `FamilySearchHit` also omits them. The route test fixture (`sampleHit`) still includes `managerEmail` and `managerPhone`, which pass through JSON serialization but are never set by the real `searchFamilies`.

The two `FamilySearchHit` types should be a single shared type to prevent future drift. The `location` field is typed as `string` on the server but also `string` on the client — consistent, but the server `toHit` defaults to `'Brampton'` which may not match the `FamilyDocSchema`'s enum constraint.

**Impact:** No runtime bug today (both types align on the fields actually used by the UI), but the duplicate type definitions will drift.

**Fix:** Export `FamilySearchHit` from the server module only and import it in the client wrapper (or put it in a shared barrel).

### M2. `get-family-for-welcome.ts` duplicates session verification logic — should reuse existing helper

**File:** `apps/portal/src/features/setu/search/get-family-for-welcome.ts:12-25`

This function reads the session cookie, verifies it, parses with `SetuSessionClaimsSchema`, and checks `role === 'welcome-team'` — all of which is already done by the middleware and duplicated by the detail page's Server Component. The triple-check is defensive, but the function accepts no claims parameter, meaning every call re-verifies the cookie from scratch (an extra Firebase Admin SDK call per request).

The existing `getCurrentSessionContact()` pattern (used in other setu features) reads from headers set by middleware rather than re-verifying the cookie. This approach would be cheaper and more consistent.

**Impact:** Performance (extra cookie verification per detail page load) and maintenance (three places enforce the same role check with slightly different error handling).

**Fix:** Accept verified claims as a parameter, or read from `x-portal-role` / `x-portal-uid` headers set by middleware.

### M3. `searchFamilies` member count uses `limit(100).get()` then `.docs.length` — undercounts for families with 100+ members

**File:** `apps/portal/src/features/setu/search/search-families.ts:99-103`

```ts
familiesCol
  .doc(fid)
  .collection('members')
  .limit(100)
  .get()
  .then((snap) => snap.docs.length),
```

The member count query limits to 100 documents and counts the returned docs. Any family with more than 100 members would show "100 members" instead of the true count. While unlikely for a family, the limit is arbitrary.

Firestore's `count()` aggregation (available since 2023) would be more accurate and cheaper:
```ts
familiesCol.doc(fid).collection('members').count().get().then((snap) => snap.data().count)
```

**Impact:** Low (100+ member families are extremely unlikely), but `count()` is also cheaper (no document reads billed).

---

## Low-severity / nits

### L1. Unused import: `verifyPortalSessionCookie` at top of family detail page

**File:** `apps/portal/src/app/welcome/family/[fid]/page.tsx:6`

```ts
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
```

This import is used at line 21, so it's not truly unused — but it's a server-only import in a Server Component page, which is fine. No issue here. (Retracted after re-reading.)

### L2. Sidebar footer shows hardcoded "Aarti Patel" — prototype remnant

**File:** `apps/portal/src/features/family/components/atoms.tsx:280-284`

```ts
<SetuAvatar name="Aarti Patel" size={32}/>
<div style={{ fontSize: 13, fontWeight: 600 }}>Aarti Patel</div>
<div style={{ fontSize: 11, color: 'var(--muted)' }}>Patel · FID 4421</div>
```

The sidebar footer always shows "Aarti Patel" regardless of who is signed in. This is a prototype remnant — the sidebar doesn't receive the authenticated user's name or FID. For the welcome-team role, the footer could show the team member's name or simply show "Welcome team" without a fake identity.

**Impact:** Visual only — no data leak (the hardcoded name is not real data). But it's confusing for real welcome-team users who see someone else's name.

**Fix:** Either pass the authenticated user's display name to `DesktopSidebar`, or show a role-based label ("Welcome team") when `role === 'welcome-team'`.

### L3. `WelcomeSearch` debounce ref cleanup does not cancel in-flight fetch

**File:** `apps/portal/src/app/welcome/welcome-search.tsx:28-46`

The debounce clears the timeout on unmount/re-render, but once the `searchFamiliesClient` call is in flight, it cannot be cancelled. If the user types "pat", waits 300ms (triggering a fetch), then types "patel" before the first fetch returns, the first result will overwrite the hits state, then the second result will overwrite again. The final state is correct (the second result wins), but there's a brief flash of stale results.

**Fix:** Use `AbortController` to cancel in-flight fetches when a new debounce fires, or add a sequence counter that discards stale results:
```ts
const seqRef = useRef(0);
// In the debounce callback:
const seq = ++seqRef.current;
const results = await searchFamiliesClient(trimmed);
if (seq !== seqRef.current) return; // stale
setHits(results);
```

### L4. `toHit` defaults location to `'Brampton'` — may surprise

**File:** `apps/portal/src/features/setu/search/search-families.ts:33`

```ts
location: typeof data.location === 'string' && data.location ? data.location : 'Brampton',
```

When a family doc has no `location` field (corrupt or partially migrated data), the search hit shows "Brampton" as the location. This matches the test expectation at `search-families.test.ts:476`, but it's a silent default rather than showing "Unknown" or `null`.

**Impact:** Cosmetic — a family in Mississauga with a missing location field would appear as "Brampton" in search results.

### L5. Route test fixture includes `managerEmail` and `managerPhone` that the real implementation never returns

**File:** `apps/portal/src/app/api/setu/family/search/__tests__/route.test.ts:26-34`

```ts
const sampleHit = {
  fid: 'FAM001ABCD12',
  name: 'Patel',
  location: 'Brampton',
  managerEmail: 'raj@example.com',
  managerPhone: '4165551234',
  memberCount: 3,
  legacyFid: null,
};
```

The test fixture includes `managerEmail` and `managerPhone` which are not part of the actual `FamilySearchHit` type returned by `searchFamilies`. The test passes because the mock returns whatever it's given, and the route handler just forwards the hits array as-is. This tests mock behavior, not real behavior.

**Fix:** Remove `managerEmail` and `managerPhone` from the test fixture to match the real return type.

---

## Things done well

1. **Multi-strategy search is well-designed.** Email/phone queries take the fast contactKey hash path; text queries fan out to fid + legacyFid + searchKeys in parallel with `Promise.all`. Deduplication via `Map<string, RawFamilyData>` is correct and efficient.

2. **`canAccessRoute` coverage is correct.** The welcome pages (`/welcome`, `/welcome/*`) are gated by `isWelcomeTeam(claims)` at line 33-35. The search API (`/api/setu/family/search`) has an explicit rule at line 38-39, placed before the general `/api/setu/family/` rule at line 43 — order matters because the search path is a prefix match of the family path.

3. **Defense-in-depth on detail page.** The Server Component re-checks `welcome-team` role at lines 18-32, even though middleware already enforces it. This matches the pattern established in the Slice 2d review.

4. **Client-server boundary is clean.** `WelcomeSearch` is `'use client'` and imports `searchFamiliesClient` (a fetch wrapper). `searchFamilies` imports `'server-only'` at line 1 — Next.js will error at build time if a client component tries to import it. `getFamilyForWelcome` uses `next/headers` (server-only) correctly.

5. **Error boundaries are in place.** Both `/welcome/error.tsx` and `/welcome/family/[fid]/error.tsx` exist with the standard `ErrorFallback` pattern.

6. **Feature flag gating is consistent.** The search route checks `flags.setuAuth` at line 9 and returns 404 when off. Tests verify this (both route.test.ts:42-50 and integration-search.test.ts:418-426).

7. **Debounce is correctly implemented.** 300ms delay with cleanup on unmount (line 44). Empty/whitespace queries short-circuit without calling the API (line 21-26).

8. **Responsive layout is consistent.** Both the dashboard and detail pages render mobile (`block md:hidden`) and desktop (`hidden md:flex`) layouts with the same pattern used in the family flow pages.

9. **Sidebar nav correctly branches on role.** The `DesktopSidebar` shows `WELCOME_NAV_ITEMS` (Search, Pending, Donation periods) when `role === 'welcome-team'` and `FAMILY_NAV_ITEMS` for the default family role. Future tabs are grayed out with "Soon" label.

10. **Integration tests are thorough.** 16 scenarios covering name search, direct fid, legacy fid, email via contactKey, phone via contactKey, deduplication, multiple results, empty query, whitespace, non-existent, role enforcement (family-manager, family-member, welcome-team), flag-off, member count, and unauthenticated access.

11. **No Firestore composite index needed.** The searchFamilies queries use single-field operations (`array-contains` on searchKeys, `==` on legacyFid, direct doc read by fid). No new composite index entry is required in `firestore.indexes.json`.

12. **searchKeys query uses `array-contains` not `array-contains-any`.** This is correct — each query searches for a single lowercased token, and `array-contains` is a single-field index (auto-created by Firestore). No deployment step needed.

---

## Suggested follow-ups (not blockers unless noted)

1. **Fix C1 (test failures) — BLOCKER.** The 6 failing tests in welcome-search.test.tsx must be fixed for the pre-push hook to pass.

2. **Fix H1 (role check fall-through on missing cookie).** Quick restructure to make the guard unconditional.

3. **Fix H2 (client wrapper swallows errors).** Throw on non-OK responses so the error toast fires correctly.

4. **Fix M1 (duplicate FamilySearchHit type).** Consolidate to a single shared type export.

5. **Consider M2 (session re-verification in getFamilyForWelcome).** Read from middleware headers instead of re-verifying the cookie.

6. **Consider L3 (race condition on rapid typing).** Add a sequence counter or AbortController to discard stale fetch results.
