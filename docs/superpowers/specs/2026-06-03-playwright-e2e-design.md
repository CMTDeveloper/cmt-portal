# Playwright E2E for Setu Family/Admin Flows — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) → pending implementation plan

## Goal

Add a browser-level end-to-end regression net for the new **Setu family + admin** flows, to catch the "green unit tests but broken in the actual UI" class of bug that has repeatedly reached the deployed app this cycle: the dashboard attendance hijack, the enroll-page donation wording (`donation coming soon` vs `Your family is enrolled.`), the `/family/programs` enrolled state, and the admin calendar id collision. Authentication **bypasses OTP** by signing in through the existing password route.

**Non-goal (v1):** completing payments, mutating Firestore from specs, CI integration, mobile viewports. See *Out of scope*.

## Background — current state (already in the repo)

- **Playwright is configured:** `apps/portal/playwright.config.ts` — `testDir ./e2e`, chromium project, `webServer` runs `pnpm --filter @cmt/portal dev -- --port=3001`, `baseURL` overridable via `PLAYWRIGHT_BASE_URL`, `trace: retain-on-failure`, `screenshot: only-on-failure`. `@playwright/test ^1.50.0` is a dependency.
- **Existing specs are stale Slice-B:** `e2e/b0-auth…b5-notifications.spec.ts` target the *legacy* check-in routes (`/login/family`, `/check-in/*`, kiosk, teacher); their OTP login is `test.skip`-guarded and was never finished. They do **not** cover the new Setu routes (`/sign-in`, `/family`, `/family/enroll/[programKey]`, `/family/programs`, `/family/calendar`, `/admin/*`). `e2e/fixtures.ts` is a bare `base.extend({})` stub.
- **Auth mechanics:** a successful sign-in mints an `__session` httpOnly Firebase session cookie via `createPortalSessionCookie(idToken, days)`. `POST /api/setu/auth/password-sign-in` (`{email, password}`) produces the **same** cookie (Firebase REST `firebaseSignInWithPassword` → custom token → id-token exchange → session cookie). So a seeded account **with a password** logs in with no OTP. `set-password` and magic-link routes also exist.
- **DB:** local `pnpm dev` reads `.env.local` (`PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat`) → **UAT** Firestore. UAT-only-writes rule holds. `_test:true` sweep + `wipe:test-leaks` / `wipe:uat-leaks` exist for cleanup. Attendance is read from `family-check-ins/{legacyFid}` (owned by the standalone app in prod, but writable in portal-only UAT).

## Architecture

### Auth bypass — password sign-in + `storageState` (decided)

- **`e2e/auth.setup.ts`** (a Playwright *setup* project, runs first): uses `request.post('/api/setu/auth/password-sign-in', { data: { email, password } })`, then `request.storageState({ path: 'e2e/.auth/family.json' })` to persist the `__session` cookie. `e2e/.auth/` is gitignored.
- The main **`chromium`** project `dependencies: ['setup']` and `use.storageState: 'e2e/.auth/family.json'` → every spec starts authenticated as the seeded family.
- An **`unauthenticated`** project (no storageState) runs the sign-in/redirect specs.
- *(Optional, for the admin spec)* a second setup signs in an admin test account → `e2e/.auth/admin.json`. Admin auth path resolved in the plan (likely the same password route if the test account carries the admin role). Kept optional.

### Seed script — `scripts/seed-e2e-family.ts`

- Alias `pnpm --filter @cmt/portal seed:e2e-family` (`tsx --env-file=.env.local`). **UAT-guarded** (refuse unless `PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'`), **idempotent**, fixed known fid (e.g. `CMT-E2E0001`).
- Creates/updates, via admin SDK:
  1. Firebase auth user for `E2E_FAMILY_EMAIL` with `E2E_FAMILY_PASSWORD` (so password-sign-in works).
  2. Family doc + members: 1 manager adult + ≥1 child, with a `legacyFid` used in step 4.
  3. An active **Bala Vihar** enrollment in an offering whose window contains the seeded check-ins, and an active **no-donation program** enrollment (om-chanting or tabla).
  4. A few `family-check-ins/{legacyFid}/checkIns/{date}` records **inside the BV offering window**, so the dashboard attendance assertion ("X of N Sundays") is deterministic. (This is the only reason the seed touches `family-check-ins`; UAT-only.)

### Test-data strategy (v1 = read/render only)

- v1 specs **read/render** against the seeded family and assert the donate CTA **reaches Stripe checkout** (navigate to it; do **not** complete payment). No DB mutations, no payment → deterministic, no cleanup needed.
- **Future (out of scope):** mutating specs (submit an enroll, complete a Stripe-test donation) using ephemeral `_test:true` data + a global-teardown sweep.

### Config & run model

- Reuse `playwright.config.ts`; add the `setup` + `unauthenticated` projects and the `storageState` dependency wiring. Default local-dev `webServer`; setting `PLAYWRIGHT_BASE_URL` points at a deployed UAT/preview URL (webServer is then bypassed — document this).
- **On-demand only — NOT in the pre-push gate** (needs UAT creds + a browser; too slow). Root `pnpm test:e2e` already runs Playwright.
- **Naming-clash fix:** `apps/portal` `package.json` currently also defines `test:e2e` = the vitest server-e2e (`vitest run --config vitest.e2e.config.ts`). Rename that to **`test:integration`** and update the CLAUDE.md reference, so "test:e2e" unambiguously means Playwright.
- **Env required:** `.env.local` UAT creds + `E2E_FAMILY_EMAIL`, `E2E_FAMILY_PASSWORD` (+ admin equivalents if the admin spec is included). Specs/setup **self-skip** when these are absent (mirroring the existing skip-guard pattern), so the suite never hard-fails for a contributor without creds.

## Specs (v1)

1. **`auth.setup.ts`** — programmatic family login → `storageState`.
2. **`dashboard.spec.ts`** — authed: greeting renders; the **Bala Vihar card shows "Enrolled" + attendance "X of N Sundays"** for the seeded family (guards the attendance-hijack regression); the non-BV program renders its own card.
3. **`enroll-wording.spec.ts`** — `/family/enroll/bala-vihar` shows the dakshina block + suggested amount; `/family/enroll/<no-donation program>` shows "no donation requirement", the already-enrolled banner **without** "Proceed to donate below", and the enrolled state reads **"Your family is enrolled."** (never "donation coming soon").
4. **`programs.spec.ts`** — `/family/programs` shows **"✓ Enrolled · View enrollment"** for enrolled programs and "Enroll →" otherwise.
5. **`unauth.spec.ts`** (unauthenticated project) — visiting `/family` redirects to `/sign-in`.
6. *(optional, admin storageState)* **`admin-calendar.spec.ts`** — creating a second program's calendar entry on a date/location Bala Vihar already occupies returns **no 409**, and the editor list filters to the selected program.

## Stale Slice-B specs

Move `e2e/b0-auth…b5-notifications.spec.ts` (and their `./fixtures` import) into **`e2e/legacy/`** — kept, still skip-guarded, but out of the new Setu suite's path so the regression net is unmistakable. Adjust `testMatch`/`testDir` if needed so both still run under `pnpm test:e2e` but are clearly separated.

## Acceptance criteria

- `pnpm test:e2e` (Playwright) against local dev → UAT, with the seeded family present, runs the v1 specs **green**.
- The dashboard / enroll-wording / programs specs assert the **exact strings/states tied to the bugs fixed this cycle**, so a regression of any of them fails the suite.
- **No prod writes; all data in UAT; no payment completed.**
- The pre-push gate is unchanged (Playwright stays on-demand).

## Out of scope / future

- Mutating enroll / donate-completion specs + teardown cleanup.
- CI integration (GitHub Actions / Vercel checks).
- Mobile-viewport variants.
- Reviving the legacy check-in specs.

## Risks / notes

- **Attendance determinism:** the seed must write `family-check-ins` for the seeded `legacyFid` within the BV offering window; confirm the collection is writable in UAT (portal-side it is; the standalone app owns it only in prod).
- **`firebaseSignInWithPassword`** needs the Firebase Web API key in the runtime env (`NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY`) — present.
- **Session 14-day cap** is irrelevant — `storageState` is regenerated each run.
- The seeded account's email must be on `SETU_EMAIL_ALLOWLIST` only if a spec triggers real OTP/email; v1 uses password-sign-in, so no email is sent.
