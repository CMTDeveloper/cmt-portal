# Slice 2a Code Review

**Reviewer:** worker-5 (code-reviewer)
**Date:** 2026-05-22
**Scope:** Slice 2a — OTP auth wiring
**Baseline:** `pnpm typecheck` FAIL (3 errors), `pnpm lint` PASS, `pnpm test` FAIL (1 suite)

## Verdict
Needs fixes before merge

The implementation is structurally sound and follows the existing patterns well. Two issues block the pre-push hook (`typecheck` + `test` failures in the same file), and one security concern around the `canAccessRoute` catch-all warrants attention before merge.

---

## Critical issues (must fix before merge)

### C1. `find-family-by-contact.test.ts` — broken test suite (typecheck + runtime)

**File:** `apps/portal/src/features/setu/auth/__tests__/find-family-by-contact.test.ts`

**Symptoms (3 typecheck errors + 1 test failure):**
1. Line 30: `vi.mock('firebase-admin/firestore', ...)` — the implementation (`find-family-by-contact.ts`) does NOT import from `firebase-admin/firestore`. It uses `portalFirestore()` from `@cmt/firebase-shared/admin/firestore`. The mock targets a module that isn't imported, so the real Firestore calls are never intercepted.
2. Lines 52 and 79: `result.member` — the test accesses `.member` but the mock setup at lines 41-47 creates mock return values via `mockGetDoc` which is wired to a `firebase-admin/firestore` mock that doesn't match how the implementation works. The mock strategy is entirely misaligned with the implementation.
3. At runtime, Vitest cannot resolve `firebase-admin/firestore` because the portal app imports it through `@cmt/firebase-shared` — the bare specifier is not directly resolvable in the Vitest environment.

**Impact:** `pnpm typecheck` and `pnpm test` both fail, which means the pre-push hook (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`) will reject any push to `main`. This is a hard blocker.

**Fix:** Rewrite the test to mock `@cmt/firebase-shared/admin/firestore` (matching the actual import) and `@/features/check-in/shared/rtdb/family-lookup` (already mocked correctly). The mock should return a fake Firestore with chainable `.collection().doc().get()` that returns the expected snapshots. Remove the `firebase-admin/firestore` mock entirely. The existing pattern in other test files (e.g., `verification-codes.test.ts`) shows how to mock `portalFirestore` correctly.

---

## High-severity issues

### H1. `canAccessRoute` catch-all for `/api/setu/*` is overly broad

**File:** `packages/shared-domain/src/auth/can-access-route.ts:35-37`

```ts
if (pathname.startsWith('/api/setu/')) {
  return isSetuFamily(claims) || isWelcomeTeam(claims) || isAdmin(claims);
}
```

This catch-all allows ANY `family-manager` or `family-member` to access ANY `/api/setu/*` endpoint that isn't already matched by the specific rules above it (lines 24-29). Today those specific rules cover `/api/setu/family*` and `/api/setu/members*`, so the catch-all currently covers paths like `/api/setu/invite/*` (not yet built) or any future `/api/setu/*` endpoint.

The problem is ordering: the specific `/api/setu/family*` and `/api/setu/members*` checks (lines 27-29) use `isSetuFamily`, and then the catch-all (line 35) ALSO matches those same paths — so the catch-all is redundant for existing paths but creates a default-allow for future paths.

**Risk:** When Slice 2c/2d add manager-only mutation endpoints under `/api/setu/members` (POST/PATCH/DELETE), the `canAccessRoute` function will allow `family-member` role to reach those routes at the middleware level. The route handlers themselves should enforce manager-only, but defense-in-depth says middleware should also distinguish.

**Fix:** Either (a) remove the catch-all and add explicit rules as new endpoints are created, or (b) document this as intentional and ensure every route handler validates the specific role internally. Option (a) is safer — the spec explicitly says "default deny for unknown routes."

### H2. No `canAccessRoute` tests for new Setu roles

**File:** `packages/shared-domain/src/__tests__/can-access-route.test.ts`

The test file has comprehensive coverage for legacy roles (`admin`, `teacher`, `family`) but zero test cases for the new roles (`family-manager`, `family-member`, `welcome-team`). Missing coverage:
- `family-manager` accessing `/family`, `/family/members`, `/api/setu/family`, `/api/setu/members`
- `family-member` accessing `/family` (should pass), `/api/setu/members` POST (policy question)
- `welcome-team` accessing `/welcome`, `/welcome/family/123`, `/api/setu/family/search`
- Cross-role denials: `family-manager` denied `/check-in/admin`, `welcome-team` denied `/family`

**Impact:** The new `canAccessRoute` logic could silently break without any test catching it. Given that this is the authorization gate, test coverage is essential.

**Fix:** Add test cases for all three new roles across the new route patterns, including cross-role denial cases.

### H3. `verify-code/route.ts` always assigns `family-manager` for Setu hits

**File:** `apps/portal/src/app/api/setu/auth/verify-code/route.ts:71`

```ts
claims = { role: 'family-manager', fid: result.fid, mid: result.mid, ...contactClaim };
```

Every Setu family member who signs in gets the `family-manager` role, regardless of whether they are actually a manager. The `FindSetuFamilyResult` has a `member` field (with `member.manager` boolean from the Firestore doc), but it's not consulted. A non-manager member should receive `family-member` role.

**Impact:** Until Slice 2c adds the member management endpoints, this is low-risk because both roles have the same access. But it means the session claim is wrong from day one, and if the role check is tightened later without fixing this, members would get manager access.

**Fix:** Check `result.member?.manager === true` to decide between `family-manager` and `family-member`. The member data is already fetched by `findSetuFamilyByContact`.

### H4. `verify-code/route.ts` — response field mismatch between server and client

**File:** `apps/portal/src/app/api/setu/auth/verify-code/route.ts:92` returns `{ redirectTo }`.
**File:** `apps/portal/src/app/sign-in/page.tsx:218` reads `{ redirect }`.

The server sends `redirectTo` but the client destructures `redirect`:
```ts
// verify-code/route.ts line 92
const res = NextResponse.json({ redirectTo }, { status: 200 });

// sign-in/page.tsx line 218
const { redirect } = (await res.json()) as { redirect?: string };
```

**Impact:** The redirect URL from the server is silently ignored. The client falls through to the `?? '/family'` default, which happens to be correct for Setu hits but is wrong for the `source === null` case (should go to `/register?contact=verified`) and for legacy hits (should go to `/check-in/family`).

**Fix:** Either rename the server response field to `redirect` or change the client to read `redirectTo`. The server field name `redirectTo` is more descriptive; update the client.

---

## Medium-severity issues

### M1. `send-code` sends OTP to unverified contacts when `source === 'legacy'` without normalized value

**File:** `apps/portal/src/app/api/setu/auth/send-code/route.ts:53-60`

The route sends the email/SMS using `value` (the raw user input) rather than `normalized`. For email this is fine (SES will deliver to `Raj@Example.com` same as `raj@example.com`), but for phone the raw input like `(416) 555-1234` may not be in E.164 format. The legacy `send-code` route has the same pattern, so this is consistent, but worth noting.

**Fix:** Consider passing `normalized` to the sender for phone contacts, or ensure `resolveSender().sendSMS` normalizes internally.

### M2. `SetuSessionClaimsSchema` in `shared-domain/src/setu/` is not re-exported from `shared-domain/src/index.ts`

**File:** `packages/shared-domain/src/index.ts:1-2` — only exports `./auth` and `./check-in`.
**File:** `packages/shared-domain/src/setu/index.ts` — exports `SetuSessionClaimsSchema`.

The new `setu/` barrel is never wired into the package's main export. This means consumers outside the portal app can't import from `@cmt/shared-domain` to get the Setu session schemas. Currently no external consumer exists, but the design spec anticipates mobile apps consuming `@cmt/shared-domain`.

**Fix:** Add `export * from './setu';` to `packages/shared-domain/src/index.ts`.

### M3. `sign-in/page.tsx` uses `flags.setuAuth` at render time in a `'use client'` component

**File:** `apps/portal/src/app/sign-in/page.tsx:8,430`

```ts
import { flags } from '@/lib/flags';
// ...
export default function SignInPage() {
  if (!flags.setuAuth) {
    return <SignInPrototype />;
  }
  return <SignInReal />;
}
```

The `flags` module reads `process.env` at import time. In a `'use client'` component, `process.env` is available for `NEXT_PUBLIC_*` vars (they're inlined at build time), so this works correctly. However, the flag value is baked into the client bundle at build time — it won't react to runtime env changes. This is fine for the stated use case (dev-time convenience toggle) but worth documenting.

### M4. `handleResend` in `sign-in/page.tsx` doesn't actually re-send the code

**File:** `apps/portal/src/app/sign-in/page.tsx:226-232`

```ts
async function handleResend() {
  setOtp('');
  setPageState('form');
  setTimeout(() => {
    setPageState('form');
  }, 0);
}
```

The "Re-send code" button sets the state back to `'form'` but never calls `handleSendCode()`. The user has to manually click "Send sign-in code" again. The `setTimeout` also sets `pageState` to `'form'` redundantly.

**Fix:** Either call `handleSendCode()` directly (with the stored `contactValue`), or rename the button to "Back to form" to match what it actually does.

### M5. No `error.tsx` for `/api/setu/auth/*` routes — confirm this is intentional

API routes in Next.js don't use `error.tsx` (that's for page routes). The new `/sign-in/error.tsx` correctly handles the sign-in page. No issue here — just confirming that discipline #3 (per-segment error boundaries) is satisfied for the page routes in scope. The `/sign-in/error.tsx` exists and uses the shared `ErrorFallback` component correctly.

---

## Low-severity / nits

### L1. `signout/route.ts` is not feature-flag-gated

**File:** `apps/portal/src/app/api/setu/auth/signout/route.ts`

Unlike `send-code` and `verify-code`, the signout route does not check `flags.setuAuth`. Since signout is a safe operation (just clears a cookie), this is defensible — but it breaks the pattern. If someone hits `/api/setu/auth/signout` when the feature is off, they still get a 303 redirect and cookie clear. Not harmful, but inconsistent.

### L2. `verify-code/route.ts` uses `process.env.SESSION_COOKIE_EXPIRES_DAYS` directly instead of `portalEnv()`

**File:** `apps/portal/src/app/api/setu/auth/verify-code/route.ts:89`

```ts
const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '5');
```

The existing legacy `verify-code` does the same thing (line 86 of the legacy route), so this is consistent. But the env var is declared and validated in `portalEnvSchema` — the validated accessor `portalEnv().SESSION_COOKIE_EXPIRES_DAYS` is available and type-safe. Low priority since both routes are consistent.

### L3. OtpEntry component `trimEnd()` on join may silently drop trailing empty strings

**File:** `apps/portal/src/features/family/components/otp-entry.tsx:25`

```ts
onChange(next.join('').trimEnd());
```

If the user types digit 1 in box 0, the array is `['1','','','','','']`, joined is `'1     '`, trimmed is `'1'`. This is correct behavior. But if the user fills boxes 0 and 2 (skipping 1), the joined string `'1 3   '` trims to `'1 3'` which has a space — the OTP validation regex (`/^\d{6}$/`) would reject it. In practice this edge case is unlikely since the focus-advance logic fills sequentially, but the logic could be cleaner with `.filter(d => d !== '').join('')` or just `.join('')` without trim.

### L4. TypeScript: `FindSetuFamilyResult.family` type changed from `unknown | null` to `Record<string, unknown> | null`

**File:** `apps/portal/src/features/setu/auth/find-family-by-contact.ts:18`

The initial version used `unknown | null` (which simplifies to `unknown`); the current version uses `Record<string, unknown> | null`. The latter is marginally more specific. No issue — just noting the type evolved.

### L5. `verify-code` test does not test the `mode=mobile` branch

**File:** `apps/portal/src/app/api/setu/auth/verify-code/__tests__/route.test.ts`

The verify-code route supports `mode=mobile` (returns a `customToken` instead of setting a session cookie), but no test covers this branch. Low priority since the mobile flow is not launched in Slice 2a.

---

## Things done well

1. **Anti-enumeration discipline in send-code.** Returns 200 regardless of whether the contact exists — no timing or status-code leak. Matches the existing legacy pattern perfectly.

2. **Cookie security attributes are correct.** Both `verify-code` and `signout` set `httpOnly: true, secure: true, sameSite: 'lax', path: '/'` — textbook settings.

3. **Clean feature-flag gating.** The `flags.setuAuth` check at the top of send-code and verify-code returns 404 without leaking endpoint existence. The sign-in page's flag-off fallback preserves the visual prototype cleanly.

4. **Middleware redirect target differentiation.** The `deny()` function correctly routes `/family/*` to `/sign-in` and legacy `/check-in/*` to `/login`. This is a subtle but important detail for the transition period.

5. **Public-routes update is precise.** `/family` and `/family/` correctly removed; `/api/setu/auth/*` correctly added. Tests in `public-routes.test.ts` explicitly verify both additions and removals.

6. **OtpEntry component is well-built.** Accessible (`aria-label`, `role="group"`), supports paste, has `autocomplete="one-time-code"` on the first input for browser autofill, and the keyboard navigation (backspace, arrows) is solid. Test coverage is thorough.

7. **Shared helper reuse from check-in.** The new routes correctly import `normalizeContact`, `storeVerificationCode`, `verifyCode`, `checkAndRecordOtpRateLimit`, and `resolveSender` from the existing check-in shared layer — no reimplementation of OTP infrastructure.

8. **Discriminated union for session claims.** The `SetuSessionClaimsSchema` in `shared-domain/src/setu/session-claims.ts` uses `z.discriminatedUnion('role', ...)` which gives excellent type narrowing and validation. Each role variant correctly requires its specific fields.

9. **Legacy compat preserved.** The `SessionClaims` interface in `session.ts` maintains `familyId` for the legacy `family` role while adding `fid`/`mid` for new roles. Both coexist cleanly.

10. **ToasterMount is minimal.** A thin client wrapper around the shadcn Toaster — no unnecessary abstraction. Mounted once in root layout, not duplicated per page.

---

## Suggested follow-ups (not blockers)

1. **Lazy migration integration.** The design spec (section 5.1) calls for `lazyMigrateLegacyFamily` in the verify-code path when `result.source === 'legacy'`. This is not implemented in Slice 2a (it's in the Slice 2b scope), but the verify-code route is the integration point — the `// TODO` should be added so it's not forgotten.

2. **Rate limit per-contact vs per-IP.** The current rate limiting (via `checkAndRecordOtpRateLimit`) is per-contact-hash. The design spec (section 6.1) also calls for per-IP rate limiting on the family-lookup endpoint. Consider whether send-code should also have per-IP limiting to prevent enumeration via timing of rate-limit responses.

3. **Test coverage for `canAccessRoute` with new roles.** Already flagged as H2, but also a follow-up for Slice 2b when more routes are added — the test file should be extended with each sub-slice.
