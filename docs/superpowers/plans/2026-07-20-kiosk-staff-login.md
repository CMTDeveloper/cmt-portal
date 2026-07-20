# Kiosk Staff Login (Sevak) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (or executing-plans) to implement this task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Lock the door-kiosk check-in flow behind a simple shared **staff login** (username `sevak` + password) so only the welcome/sevak team can operate it at the ashram. A random person with the URL should see only a login prompt.

**Architecture:** Reuse the EXISTING kiosk account + `kiosk` role + `password-sign-in` session-cookie machinery. Add (1) a friendly-username→email login endpoint, (2) a public kiosk staff-sign-in page, (3) route gating, (4) a clear session-expiry UX. No bespoke auth backend.

## Global Constraints (standing project rules)
- **UAT only** (`chinmaya-setu-uat`); NEVER touch prod `715b8`; never `--force` index deploys.
- Never use em dash "—" (use "-"); commit author is repo-local `CMT Developer <developer@chinmayatoronto.org>`; never add an agent co-author; never `--no-verify`.
- **Firebase session cookie has a HARD 14-day cap** — the tablet re-logs-in at most every 14 days (owner will inform the team; the UX must handle expiry clearly).
- A public `/api/setu/*` or page route needs BOTH `PUBLIC_ROUTES` (`public-routes.ts`) AND (if applicable) a `canAccessRoute` allowance — `isPublicRoute` runs first in middleware.
- Every new `/api/setu/**` path needs an explicit `canAccessRoute` rule or the manager-only catch-all 401s other roles.
- `exactOptionalPropertyTypes` is on (omit optional keys / use null, never assign undefined).
- Every user-facing route gets a **deployed-UAT Playwright E2E** with a realistic fixture; password sign-in (never OTP; shared 5/15min limiter); run vs `https://cmt-setu.vercel.app`.
- Run the FULL vitest suite before pushing shared route/schema changes; always push after commit (pre-push hook is the gate).
- Keep the prod cutover runbook current (§10 scripts, §14 dated entry) in the same change.

## Current state (code-backed — verified 2026-07-20)
- **`/check-in` (KioskHome)** is in `PUBLIC_ROUTES` (`public-routes.ts:61`, "Kiosk (public)") and gated ONLY by `flags.checkInKiosk` (`= NEXT_PUBLIC_FEATURE_CHECK_IN && NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK`). Both flags are ON in UAT → the deployed page returns 200 to **anyone**.
- Kiosk pages/links: `/check-in`, `/check-in/guest`, `/check-in/lookup` (all currently public). The role-gated `/check-in/{admin,teacher,family}/*` are SEPARATE flows — leave them unchanged.
- The kiosk client (`features/check-in/kiosk/*`) calls: **setu APIs** `/api/check-in/setu/{lookup,check-in}` (ALREADY `isKiosk||isAdmin` per `can-access-route.ts:32`) + **legacy public APIs** `/api/check-in/{families/:id, families/:id/check-in, lookup, guests}` (currently in `PUBLIC_ROUTES`).
- **Dedicated kiosk account already exists**: env `KIOSK_ACCOUNT_EMAIL=kiosk-tablet@chinmayatoronto.org` + `KIOSK_ACCOUNT_PASSWORD` (set locally); role `kiosk` via `seed:kiosk-account` (`addCapability`). Least-privilege; designed for "one generic account signed into the tablet once".
- **`password-sign-in`** (`/api/setu/auth/password-sign-in`, PUBLIC) verifies email+password (`firebaseSignInWithPassword`), builds claims (`buildSessionClaimsForContact`), and sets the `__session` httpOnly cookie (14-day cap via `SESSION_COOKIE_EXPIRES_DAYS`). Honors `?from=`. Rate-limited by the shared OTP limiter.
- **`/sign-in` UI is OTP-only** (email → "Send sign-in code" → 6-digit) — no password box. So the sevak team needs a DIFFERENT login surface.
- **Middleware `deny()`** (`middleware.ts:162`) already redirects unauth non-API routes to `/sign-in` (setu) or `/login` (legacy) with `?from=<path>&error=session-expired` (no-session) / `error=unauthorized`. `/check-in` is NOT in the `isSetuRoute` list → today a gated `/check-in` would wrongly bounce to legacy `/login`. `dashboardForRole` returns null for `kiosk`.

## Design decisions (settled with owner)
- **Username `sevak`** (friendly; the team shouldn't type a full email), mapped server-side to `KIOSK_ACCOUNT_EMAIL`. Configurable via new env `KIOSK_USERNAME` (default `sevak`). Password = `KIOSK_ACCOUNT_PASSWORD`.
- **Access = `isKiosk || isAdmin`** (admins retain access for testing). Welcome-team members do NOT use their own accounts — the whole team shares the one `sevak` credential.
- **Dedicated PUBLIC staff-sign-in page** `/check-in/staff-sign-in`; the kiosk pages are gated; unauth → redirected there.
- **Session expiry (14-day cap):** show a CLEAR "Your session expired - please sign in again" state, BOTH on the redirect (`?error=session-expired`) and when a kiosk API returns 401 mid-use.

---

## Task 1 — Shared password-session helper + kiosk-sign-in endpoint
**Files:** create `apps/portal/src/app/api/setu/auth/kiosk-sign-in/route.ts`; refactor `apps/portal/src/app/api/setu/auth/password-sign-in/route.ts`; edit `packages/shared-domain/src/auth/public-routes.ts`.
- [ ] Extract the cookie-minting core of `password-sign-in` (rate-limit → `firebaseSignInWithPassword` → `buildSessionClaimsForContact` → `setCustomUserClaims`/`createCustomToken`/`exchangeCustomTokenForIdToken`/`createPortalSessionCookie` → set `__session`) into a shared helper `mintPasswordSession({ email, password, from, mode })` so both routes stay in sync. `password-sign-in` keeps its pending-approval + redirect logic.
- [ ] New `POST /api/setu/auth/kiosk-sign-in`: body `{ username: string, password: string }`. Reject if `username !== (process.env.KIOSK_USERNAME ?? 'sevak')` with **401 `invalid-credentials`** (do NOT reveal which field was wrong). Resolve `email = process.env.KIOSK_ACCOUNT_EMAIL`; call `mintPasswordSession`. Defensively assert the resolved claims are the `kiosk` role (`isKiosk`) else 403. Return `{ redirectTo: safeFrom(from) ?? '/check-in' }` + the `__session` cookie. Gated behind `flags.setuAuth` (same as password-sign-in). Reuse the shared OTP rate-limiter (protects the shared credential from brute force).
- [ ] Add `/api/setu/auth/kiosk-sign-in` to `PUBLIC_ROUTES` (it IS the login).
- [ ] Tests: valid `sevak`+correct password → 200 + `__session` set + `redirectTo`; wrong username → 401; wrong password → 401; honors `?from` (safeFrom); non-kiosk resolved role → 403.

## Task 2 — Staff sign-in page (username + password, expiry banner)
**Files:** create `apps/portal/src/app/check-in/staff-sign-in/page.tsx` + a client form component under `features/check-in/kiosk/`; edit `public-routes.ts`.
- [ ] Public page `/check-in/staff-sign-in`: `CspRoot` + `SetuLogo`, kiosk-friendly large touch inputs. **Username** field (placeholder/default `sevak`), **password** field, submit → `POST /api/setu/auth/kiosk-sign-in` (credentials same-origin) → on 200 `window.location.assign(redirectTo)` (HARD nav so the gate re-runs server-side). On 401 show a clear inline error ("Wrong username or password"). Reads `?from=` and forwards it.
- [ ] If `?error=session-expired` (or `error=unauthorized`) is present → prominent banner: **"Your session expired. Please sign in again."** (session-expired) / "Please sign in to use the kiosk." (unauthorized).
- [ ] Add `/check-in/staff-sign-in` to `PUBLIC_ROUTES`.
- [ ] Tests: renders username+password + "Staff sign-in"; submit success → navigates to redirectTo; 401 → inline error, no nav; `?error=session-expired` → the expiry banner shows.

## Task 3 — Gate the kiosk pages + legacy kiosk APIs
**Files:** `packages/shared-domain/src/auth/public-routes.ts`, `packages/shared-domain/src/auth/can-access-route.ts` (+ tests).
- [ ] REMOVE from `PUBLIC_ROUTES`: `/check-in`, `/check-in/guest`, `/check-in/lookup`, `/api/check-in/families/:familyId`, `/api/check-in/families/:familyId/check-in`, `/api/check-in/lookup`, `/api/check-in/guests`. (Keep `/check-in/staff-sign-in` + `/api/setu/auth/kiosk-sign-in` public.)
- [ ] ADD `canAccessRoute` rules (before the `/api/check-in/setu/` rule, alongside the existing check-in blocks): the three kiosk PAGES + the four legacy APIs → `isKiosk(claims) || isAdmin(claims)`. (The setu APIs are already `isKiosk||isAdmin`.)
- [ ] Tests (`can-access-route` + a `public-routes` assertion): kiosk role allowed on all kiosk pages+APIs; family / welcome-team / no-session denied; `/check-in/staff-sign-in` + `/api/setu/auth/kiosk-sign-in` are public.

## Task 4 — Middleware: route unauth kiosk → staff-sign-in (+ expiry param)
**Files:** `apps/portal/src/middleware.ts` (+ any middleware test).
- [ ] In `deny()`: when the (now non-public) pathname is `/check-in`, `/check-in/guest`, or `/check-in/lookup`, redirect to **`/check-in/staff-sign-in`** with `?from=<path>&error=session-expired|unauthorized` (NOT `/sign-in`, NOT `/login`). Leave `/check-in/{admin,teacher,family}` on their existing legacy logins.
- [ ] Optional nicety: `dashboardForRole('kiosk') → '/check-in'` so a signed-in tablet that hits `/` lands on the kiosk.
- [ ] Test: unauth GET `/check-in` → 3xx to `/check-in/staff-sign-in?from=/check-in&error=session-expired`.

## Task 5 — Session-expiry UX inside the kiosk (mid-use 401)
**Files:** `features/check-in/kiosk/{family-id-lookup-form,family-lookup-form,kiosk-check-in-panel}.tsx` (+ a small shared helper) + tests.
- [ ] Add `handleKioskAuthExpiry(res)`: when a kiosk API call returns **401**, hard-navigate to `/check-in/staff-sign-in?error=session-expired` (so a tablet left idle past 14 days shows the clear "session expired" prompt on the next tap instead of a silent failure). Wire it into every kiosk fetch's non-OK path.
- [ ] Tests: a 401 from `/api/check-in/setu/lookup` (or the legacy lookup) triggers the redirect-to-staff-sign-in.

## Task 6 — Env, seed, config
**Files:** `apps/portal/.env.local` (local), Vercel UAT env, `docs/runbooks/production-cutover-checklist.md`.
- [ ] Add `KIOSK_USERNAME=sevak` to local `.env.local` and Vercel UAT (runtime server env - NOT `NEXT_PUBLIC`, so no `turbo.json` passthrough needed; it's read at request time in the endpoint).
- [ ] Confirm `KIOSK_ACCOUNT_EMAIL` + `KIOSK_ACCOUNT_PASSWORD` are set in **Vercel UAT** (already local). Verify the kiosk Auth user exists in UAT; if not, run `pnpm --filter @cmt/portal seed:kiosk-account`.
- [ ] Runbook §14 dated entry (access-control change + new env `KIOSK_USERNAME` + new endpoint/page) and §6 prod-cutover TODO: at prod launch set `KIOSK_USERNAME` + `KIOSK_ACCOUNT_*` in prod Vercel and seed the kiosk account into prod (the seed currently refuses non-UAT - add an `--allow-prod` guard or a documented manual step; the kiosk account MUST exist in prod for the tablet to sign in). No new Firestore index/collection.

## Task 7 — Full gate + deployed-UAT E2E + walkthrough
**Files:** create `apps/portal/e2e/check-in/staff-login.spec.ts`.
- [ ] Run the FULL vitest suite + lint + build (pre-push gate) green.
- [ ] Deployed-UAT E2E (`https://cmt-setu.vercel.app`): (a) a FRESH context GET `/check-in` → redirected to `/check-in/staff-sign-in`; (b) sign in with `sevak` + `KIOSK_ACCOUNT_PASSWORD` (from env, like other seeded-password E2Es) → lands on `/check-in`, kiosk visible; (c) a Family-ID lookup returns 200 (authorized); (d) a FRESH context `GET /api/check-in/lookup` (or `/api/check-in/families/1075`) → **401**; (e) hitting `/check-in/staff-sign-in?error=session-expired` shows the expiry banner. Be mindful of the shared 5/15min sign-in limiter (`clear:otp-rate-limit` on the kiosk email if it trips).
- [ ] Mock-free walkthrough in a real browser: incognito `/check-in` → login prompt only; sign in as sevak → kiosk; do a lookup + a test check-in; confirm a random visitor can't reach the kiosk.
- [ ] **MOBILE_API_CHANGELOG: none** - kiosk-web only; the gated `/api/check-in/*` are not consumed by the mobile family app, and `kiosk-sign-in` is web-only. (Note this explicitly in the commit.)

## Risks / notes
- The kiosk **password is a real credential** - never commit it; set via env only. The E2E reads `KIOSK_ACCOUNT_PASSWORD` from `.env.local` (same pattern as the seeded family E2E).
- 14-day session cap → periodic re-login; owner informs the team; Tasks 2/4/5 make expiry unmistakable.
- Leave `/check-in/{admin,teacher,family}` untouched (separate role logins).
- The setu kiosk APIs are already role-gated, so most of the check-in submit path is already secure; this plan closes the PAGE + legacy-lookup gap and adds the friendly login.
