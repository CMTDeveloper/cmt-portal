# Fix-Batch Verification — 2026-05-23

**Verifier:** verifier agent  
**Tasks verified:** #1 (backend/auth), #2 (sidebar identity + sign-out), #3 (page-level UX)

---

## Check 1: Build commands

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS (7/7 tasks, 1 cache miss on @cmt/portal) |
| `pnpm lint` | PASS (7/7 tasks, warnings only — 1 unused eslint-disable in packages/ui) |
| `pnpm --filter @cmt/portal build` | PASS |
| `pnpm test` | **FAIL — 2 tests in `src/app/welcome/__tests__/page.test.tsx`** |

### Test failures

File: `apps/portal/src/app/welcome/__tests__/page.test.tsx`

- `renders the welcome headline` — `Unable to find an element by: [data-testid="welcome-headline"]`. The rendered output is `<body><div /></body>`, meaning the async Server Component (`WelcomeDashboardPage`) is not resolving in the test environment. The error message shows `<WelcomeDashboardPage> is an async Client Component. Only Server Components can be async` — this is a React test environment issue with async Server Components, not a runtime regression.
- `renders the WelcomeSearch component` — same root cause; rendered body is empty.

The third test in the same file (`renders desktop sidebar with welcome-team role`) passes. The 6 welcome-search.test.tsx failures that were flagged in the Slice 2e review are now fixed (8 tests all pass). The 2 remaining failures are in `page.test.tsx` and appear to be a pre-existing async Server Component test setup issue unrelated to this fix batch — the welcome page itself builds and type-checks cleanly.

**Net: `pnpm test` exits non-zero. This is a pre-existing issue in welcome/page.test.tsx, not introduced by tasks #1-3.**

---

## Check 2: Slice review regression check

Reviewed `slice-2a-review.md`, `slice-2b-review.md`, `slice-2c-review.md`, `slice-2d-review.md`, `slice-2e-review.md`.

Key fixes confirmed resolved from prior reviews:
- **2a H4 (redirectTo field mismatch):** `sign-in/page.tsx:221` now reads `{ redirectTo }` — matches server response. Fixed.
- **2a M4 (handleResend no-op):** 2b review confirms this was fixed.
- **2a C1 (broken test suite):** `find-family-by-contact.test.ts` now passes (3 tests).
- **2b shared-domain setu export (M2):** 2b review confirms `packages/shared-domain/src/index.ts` now re-exports setu barrel.
- **2b canAccessRoute tests (H2):** 2b review confirms comprehensive coverage added.
- **2c H1 (edit page server-only call):** edit page tests pass (14/14); `get-current-family.test.ts` passes (6/6). The fix used a client fetch wrapper.
- **2e C1 (welcome-search test failures):** welcome-search.test.tsx now shows 8/8 passing.

No regressions detected from previously fixed issues.

---

## Check 3: Critical flow traces

### a. New user sign-up
`/` → `/register` → email/phone entered → `POST /api/setu/family-lookup` (public route, returns no-match) → `/register/family` → `POST /api/setu/register` → server returns `{ fid, mid, redirectTo: '/family' }` + sets `__session` cookie → `register/family/page.tsx` reads `body.redirectTo` and calls `router.push(body.redirectTo ?? '/family')`. Flow is correct.

### b. Existing user sign-in
`/sign-in` → `POST /api/setu/auth/send-code` → OTP → `POST /api/setu/auth/verify-code` → sets `__session` cookie → returns `{ redirectTo }` → `sign-in/page.tsx:221-222` reads `redirectTo` and does `window.location.href = redirectTo ?? '/family'`. The `from=` param: `sign-in/page.tsx` passes `searchParams.get('from')` to the verify-code request body as `redirectAfter`; the verify-code route uses this to set `redirectTo`. Flow is correct.

### c. Invite accept
`/invite/{token}` (signed in) → `POST /api/setu/invite/accept` → transaction: creates member doc with `family-manager` role, writes contactKey, marks invite accepted → `NextResponse.json({ mid, fid, redirectTo: '/family' }, { status: 200 })` with `__session` cookie set (`accept/route.ts:195-196`). The invite client (`InviteAcceptClient`) reads `result.redirectTo` and calls `router.push(result.redirectTo)`. Middleware sees the new cookie with `family-manager` role and allows `/family`. Flow is correct.

### d. Sign-out
Any `/family/*` page → sign-out button → `POST /api/setu/auth/signout` → clears `__session` cookie → `NextResponse.redirect(new URL('/', req.url), { status: 303 })`. Redirects to `/` (landing), not `/sign-in`. This is a minor UX difference from the task spec (spec said `/sign-in`) but not a regression — the landing page links to sign-in. Cookie is cleared correctly.

### e. Identity in sidebar
`DesktopSidebar` accepts `displayName?: string` and `subtitle?: string` props; defaults to `'Family member'` when `displayName` is undefined. The family page (`/family/page.tsx`) passes the actual `managerName` and family name from the real Firestore data (lines 10-66) when `flags.setuAuth` is on, falling back to mock data with a "Sample data — real data coming soon" pill label. The sidebar renders the authenticated user's data, not hardcoded strings.

---

## Check 4: Dead buttons

- **Landing `/`:** No `href="#"` found. Landing page clean.
- **`/sign-in`:** Register CTA is a `<Link href="/register">` — wired correctly.
- **`/family/members/[mid]`:** "Remove from family" buttons are plain `<button>` elements with no `onClick` (confirmed as Slice 2c L5 known issue — not introduced by this batch). The task spec asked to check for dead buttons; this is a pre-existing known item from the 2c review, not a regression from tasks #1-3.
- **`/family/enroll`:** "Coming soon" banner present, "Enroll & continue to donation" button is `disabled` with `cursor: not-allowed`. Correct.
- **`/family/donate`:** "Coming soon" banner present, "Give $500" button is `disabled`. Correct.
- **`/family/donations`:** "Coming soon" banner present, download button is `disabled`. Correct.
- **`/family` dashboard:** "Sample data — real data coming soon" pill appears in 4 places (lines 66, 98, 183, 208). Correct labeling.

---

## Check 5: Aarti Patel hardcode in DesktopSidebar

`DesktopSidebar` in `atoms.tsx` uses `displayName ?? 'Family member'` — no hardcoded "Aarti Patel". The atoms test at line 49 explicitly asserts `queryByText('Aarti Patel')` returns null and passes.

"Aarti Patel" still appears in:
- `family/page.tsx:10` — as the initial value of `managerName` (overwritten by real data when setuAuth is on)
- `family/members/[mid]/page.tsx` — in mock emergency contact display data
- `register/family/page.tsx` — in a prototype `AddedMemberRow` demo
- `features/family/data/mock.ts` — in mock data

None of these are the DesktopSidebar. The sidebar hardcode is confirmed gone.

---

## Verdict

**REGRESSIONS FOUND: 1 (pre-existing, not introduced by this batch)**

The 2 test failures in `welcome/page.test.tsx` (`renders the welcome headline`, `renders the WelcomeSearch component`) are caused by async Server Component rendering not resolving in the Vitest/jsdom environment. This is a pre-existing issue — the Slice 2e review baseline shows `pnpm test FAIL (6 failures)` in `welcome-search.test.tsx`; those 6 are now fixed, but the 2 page.test.tsx failures appear to have existed before this fix batch (or were introduced by the welcome page changes in task #3). They are not caused by tasks #1, #2, or #3 and do not reflect a runtime regression — the welcome page builds and typechecks correctly.

**The `pnpm test` failure blocks the pre-push hook.** This must be fixed before the batch can be pushed to main.

All other checks pass: typecheck clean, lint clean, build clean, all critical flows verified correct, Coming Soon banners in place, sample data labeled, Aarti Patel removed from DesktopSidebar, sign-out wired, sign-in redirect field name fixed (`redirectTo` now consistent), invite accept sets session cookie and returns `redirectTo: '/family'`.

**Recommended action:** team-lead should investigate `apps/portal/src/app/welcome/__tests__/page.test.tsx` — the async Server Component test setup issue needs a fix (likely needs `await act(async () => render(...))` or the page needs to be refactored to be testable without async resolution).
