# CLAUDE.md — Agent guidance for cmt-portal

This file orients AI agents (Claude Code, Cursor, etc.) working in this repository. Read before making changes.

## What this is

A Turborepo monorepo for the Chinmaya Mission Toronto unified portal. One Next.js 16 application (`apps/portal`) and four shared workspace packages.

**Slice A status:** ✅ Shipped (merged to `main`). Spec: `docs/superpowers/specs/2026-04-12-slice-a-portal-scaffold-design.md`, plan: `docs/superpowers/plans/2026-04-12-slice-a-portal-scaffold.md`.

**Slice B status:** ✅ Shipped (merged to `main`). All six sub-slices complete (B0 → B2 → B3 → B1 → B4 → B5). Real AWS SES/SNS senders active (`NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=true`). Vercel Cron wired for daily cache-reset and weekly payment reminders. Spec: `docs/superpowers/specs/2026-04-13-slice-b-family-check-in-port-design.md`. Slice D (unified auth) is **removed** from the roadmap — B0 absorbs it.

**Slice C status:** ❌ Removed (2026-05-22). Event registration was shipped to the portal as a port from the standalone app, then removed because events now live entirely at https://events.chinmayatoronto.org/ (the standalone `chinmaya-event-registration` repo). All `/events/*` pages, `/api/events/*` routes, `features/events/`, `packages/shared-domain/src/events/`, related tests, and the `NEXT_PUBLIC_FEATURE_EVENTS*` flags have been deleted. If the portal ever needs to surface events again it should link out to the standalone domain. Reference: `docs/superpowers/specs/2026-04-13-slice-c-event-registration-port-design.md` (historical only).

**2026 redesign status:** ⏳ In progress. Direction locked to "Cool Mist · Orange CTA" (see `docs/superpowers/specs/2026-05-16-portal-2026-redesign-brief.md`). Family-flow visual prototypes shipped at `/`, `/sign-in`, `/register`, `/register/family`, `/invite/[token]`, `/family`, `/family/members`, `/family/members/[mid]`, `/family/members/new`, `/family/enroll`, `/family/donate`, `/family/donations`.

**Slice 2 sub-slice status** (design: `docs/superpowers/specs/2026-05-22-slice-2-setu-auth-family-api-design.md`, plan: `docs/superpowers/plans/2026-05-22-slice-2-setu-auth-family-api.md`):
- **2a — OTP auth wiring**: ✅ Shipped (commit `3da1cd2`). `POST /api/setu/auth/{send-code,verify-code,signout}` reusing existing AWS SES/SNS pipeline. New session-claims roles (`family-manager`, `family-member`, `welcome-team`). Middleware redirects `/family/*` unauth to `/sign-in`. Review: `apps/portal/docs/slice-2a-review.md`.
- **2b — Registration + dedupe + lazy migration**: ✅ Shipped (commit `3d5cdb8`). `POST /api/setu/family-lookup`, `POST /api/setu/register`, `POST /api/setu/family/join`. Atomic Firestore transactions for the dedupe transaction. `lazyMigrateLegacyFamily` runs on verify-code legacy hits. Review: `apps/portal/docs/slice-2b-review.md`.
- **2c — Family CRUD + edit screen**: ✅ Shipped (commit `2edcac1`). `GET /api/setu/family` + `POST/PATCH/DELETE /api/setu/members`. canAccessRoute H1 tightening (method-aware). last-manager-guard at every demotion path. New `/family/members/[mid]/edit/` screen. Review: `apps/portal/docs/slice-2c-review.md`.
- **2d — Invite flow**: ✅ Shipped. SES family-invite template + `POST /api/setu/invite/send` (manager-only) + `GET /api/setu/invite/[token]` (any-session) + `POST /api/setu/invite/accept` (any-session, enforces email-match). 14-day TTL via `SETU_INVITE_TTL_DAYS`. `crypto.randomBytes(24).toString('base64url')` tokens. Atomic accept transaction with contactKey theft check. New `invites` collectionGroup index in `firestore.indexes.json` (deploy to UAT only — never `--force` against prod). canAccessRoute opens `/api/setu/invite/accept` and `/api/setu/invite/{token}` GET to any signed-in role; `/send` stays manager-only via the catch-all. Review: `apps/portal/docs/slice-2d-review.md`.
- **2e — Welcome-team family search**: ✅ Shipped. `searchFamilies()` helper covers all 5 criteria (name via `searchKeys` array-contains, new fid direct lookup, legacyFid where-eq, email/phone via `contactKeys/{hash}`). Dedupe by fid; top 20. `GET /api/setu/family/search?q=...` is welcome-team-only (already gated in `canAccessRoute`). `/welcome` dashboard (search hero) + `/welcome/family/[fid]` read-only detail page; the detail page defensively re-verifies welcome-team role before reading data. `DesktopSidebar` now accepts `role='welcome-team'`. `searchFamiliesClient` throws on non-OK so the UI fires the error toast (not the empty-results state). `FamilySearchHit` lives in a side-effect-free `types.ts` so server + client both import the same shape. Review: `apps/portal/docs/slice-2e-review.md`.
- **2f — Bulk legacy migration script**: ✅ Shipped. `apps/portal/scripts/migrate-legacy-families.ts` reads every family from prod RTDB (MASTER_FIREBASE) and pre-populates Setu Firestore (PORTAL_FIREBASE, UAT by default) via the existing `lazyMigrateLegacyFamily()`. Idempotent — re-runs skip already-migrated families. Modes: `--dry-run`, `--limit N`, `--fid X`, `--csv-out path`, `--allow-prod` (otherwise refuses if target isn't UAT). Discovered 864 families in prod roster; 5 migrated to UAT during validation. Full UAT migration is on-demand: `pnpm --filter @cmt/portal exec tsx scripts/migrate-legacy-families.ts --csv-out /tmp/migration.csv` (~15 min).

**Release timing for Slice 2:** Per CMT Developer's 2026-05-22 decision — the Setu auth flow merges to `main` as sub-slices land, but is NOT announced to real families until Slices 3 (donations) and 4 (teacher + attendance) are also complete. Until then the new routes are reachable but no families know about them. Legacy `/login` + `/check-in/*` remains the production entry point for sevaks and existing BV families.

## Architecture in one paragraph

`apps/portal` is a single Next.js 16 monolith. Future features (events, check-in, programs, etc.) are added as **internal route segments** under `apps/portal/src/app/<feature>/`, NOT as sibling apps in the monorepo. Cross-feature dependencies must go through shared packages (`@cmt/shared-domain` or `@cmt/ui`), enforced by `eslint-plugin-boundaries`. The choice to stay monolithic was deliberate — it preserves operational simplicity and gives future mobile apps a single API surface. The structure has been designed so that splitting into Next.js multi-zones later is cheap if needed.

## The 6 disciplines (non-negotiable)

1. **Strict feature boundaries** — Files under `apps/portal/src/features/<a>/` cannot import from `apps/portal/src/features/<b>/`. Lint-enforced via `eslint-plugin-boundaries`.
2. **`@cmt/shared-domain`** is for pure TypeScript that web + mobile can both consume. No React, no Next, no DOM imports — enforced by ESLint `no-restricted-imports`.
3. **Per-segment React error boundaries** — Every top-level route segment under `src/app/` has its own `error.tsx`.
4. **Pre-push hook on `main`** — Every `git push` runs `pnpm typecheck && pnpm lint && pnpm test && pnpm build` via a local git hook installed by the root `package.json` `prepare` script (hook source at `scripts/git-hooks/pre-push`). If any check fails, the push is aborted. Fix the underlying issue; never bypass with `--no-verify`. The `.github/workflows/ci.yml` workflow is retained as a dormant fallback for a future feature-branch/PR workflow but is not the enforcement mechanism today.
5. **Feature flags via env vars** — All risky features gated through `apps/portal/src/lib/flags.ts`. No hardcoded booleans.
6. **No premature package extraction** — Code lives in the consuming app until two consumers exist. Portal chrome (header, footer, nav) lives in `apps/portal/src/components/chrome/`, NOT in a `@cmt/portal-chrome` package. New shared packages require justification.

## Where things live

- **Routes** → `apps/portal/src/app/<segment>/page.tsx`
- **API handlers** → `apps/portal/src/app/api/<endpoint>/route.ts` (slice B/C+)
- **Feature internal modules** → `apps/portal/src/features/<name>/`
- **Portal-only components** (header, footer, etc.) → `apps/portal/src/components/`
- **Shared UI primitives** (Button, Card, etc.) → `packages/ui/src/components/`
- **Shared types/schemas/utils** → `packages/shared-domain/src/`
- **Firebase init** → `packages/firebase-shared/src/{admin,client}.ts`
- **Brand tokens** → `packages/ui/src/styles/tokens.css`

## Naming conventions

- Workspace packages use the `@cmt/` scope: `@cmt/ui`, `@cmt/firebase-shared`, `@cmt/shared-domain`, `@cmt/config`. None are published to npm.
- The Next app is `@cmt/portal`.
- Feature directories use kebab-case: `check-in`, not `checkIn`.
- React components use PascalCase: `ComingSoon`, not `coming-soon`.

## Workflow expectations

- **Solo-dev main-only workflow** — All commits go directly to `main`. No feature branches, no PRs for routine work. The pre-push hook validates `typecheck && lint && test && build` locally before every push; a failed hook aborts the push. Larger experimental changes may still warrant a feature branch, but it's not the default.
- **Tests are TDD** — write the failing test, run it to confirm it fails, implement, run it again, commit. See existing tests in `packages/firebase-shared/src/__tests__/` for the pattern.
- **Frequent commits** — Each task in the implementation plan corresponds to one (or a few) commits. Don't bundle unrelated changes.
- **Commit author** — Always `CMT Developer <developer@chinmayatoronto.org>` (set in local `.git/config`, not global).
- **Never bypass `--no-verify`** on commits or pushes unless explicitly told.
- **`pnpm test:e2e`** — runs the E2E integration suite against real UAT Firestore (`chinmaya-setu-uat`). Run on-demand before releases. NOT included in the pre-push hook. Requires `.env.local` with `PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat` and matching service account creds. Files live in `apps/portal/src/__tests__/e2e/`.

## Pre-ship verification (don't skip)

Green `pnpm test` does NOT mean shipped working. Unit tests with mocks verify code correctness — they don't verify feature correctness. Several Slice B/C bugs landed in prod despite green CI because the actual user flow was never exercised. To avoid the cycle of *push → 500 → fix → push → 500 → fix*:

1. **Pre-code constraint check.** Before writing code that touches a third-party API or framework boundary, spend 5 minutes verifying its constraints. Firebase Auth's `createSessionCookie` has a hard 14-day cap. AWS SNS publishes to Canadian numbers need an Origination Number per region. Sonner toast variants vary by version. Read the docs first — fix-after-500 is 5× more expensive than read-before-code.
2. **Mock-free walkthrough.** After `pnpm test` passes, walk the user's exact path in UAT before declaring done. For sign-in: open `/sign-in`, enter creds, follow each redirect, land where you expect. For a route change: click through it as a user would. Mocks lie; browsers don't.
3. **Audit config when porting.** If a legacy app works with the same credentials but the new code doesn't — the answer is almost always config (region, env var, allowlist, sender identity), not code. Audit the working app's config first; don't spend an hour rewriting the publish path.
4. **Explicit verification status in summaries.** End-of-task summaries must distinguish "tests pass" from "end-to-end verified in UAT." Never bury an "I think this works" behind a "all checks green." If you can't or didn't test the UI, say so plainly.
5. **Carry intent through multi-step flows.** When wiring a UX path (forgot-password → OTP → reset), think about where the user ends up at every step, not just whether the API returns 200. Walk the whole flow as the user, not just the route handler.

This list is open — when a new "green tests but broken in prod" pattern bites, add the rule here.

## Reading the prototype

The original 4-phase product brief is in `docs/superpowers/specs/reference/Chinmaya Setu Prototype.{md,pdf}`. **Phase 1 of that brief is already implemented as the standalone `chinmaya-family-check-in` app and will be ported into this portal in slice B.** The Setu prototype's `chinmaya-setu` repo (a different prior-dev attempt with a Supabase schema and ~83 shadcn components) is REFERENCE ONLY — its data model is intentionally NOT being adopted because it reinvents what production already has. We did salvage the 12 shadcn components in slice A.

## B2 notes

1. **Family UID derivation**: `sha256(normalizedContact)` is used as the Firebase Auth UID for family users. The hash is unsalted — deliberate, because the same contact must produce the same UID across redeploys. UIDs are therefore computable by anyone who knows a user's email/phone, but UID alone is not a credential.

2. **Firestore composite index requirement**: the family dashboard query requires a composite index on `check_in_events(fid ASC, checkedInAt DESC)`. The index is declared in `firestore.indexes.json` at the repo root (added in B2). Before the first production deploy after B2, run `firebase deploy --only firestore:indexes` against the prod Firebase project (`chinmaya-setu-715b8`) and UAT (`chinmaya-setu-uat`). The portal will fail at runtime with a "query requires an index" error if the index is not deployed.

3. **Legacy roster schema**: the RTDB roster uses a different schema than what the Family type suggests — student-row-keyed with `fname/lname/pemail/phphone/payment/grade` fields. The parser in `features/check-in/shared/rtdb/family-lookup.ts` adapts the legacy shape into the portal's `Family` type. Parent rows are identified by `grade === 99`. Payment status defaults to `'partial'` on unknown/missing data so sevaks notice.

4. **Timestamps**: all user-facing timestamps render in `America/Toronto` timezone regardless of Vercel function region.

## Things not to do

- Don't add a new package to `packages/` without justifying two-or-more consumers (discipline 6).
- Don't import across feature directories — go through `@cmt/shared-domain` or `@cmt/ui`.
- Don't add React/Next imports to `@cmt/shared-domain` — lint will fail and the discipline matters.
- Don't bypass the pre-push hook with `--no-verify`. If `pnpm test` or any check fails, fix the test or the code, not the hook.
- Don't migrate to Tailwind v4 or shadcn v4-only components without a dedicated upgrade slice. (`vercel.ts` was adopted in slice B5 for cron declarations — it's fine.)
- Don't propose retiring the standalone `chinmaya-event-registration` or `chinmaya-family-check-in` deployments until slices B and C are proven in parallel-run.
- **Never run `firebase deploy --only firestore:indexes --project chinmaya-setu-715b8 --force`.** Prod Firestore is shared with the standalone `chinmaya-family-check-in` app, which has its own composite indexes deployed there. A forced deploy from this repo would delete them and break the standalone kiosk in production. Always deploy without `--force`; the CLI will warn that there are "extra" indexes not in our file — leave them alone. This rule stays in effect until the standalone app is retired via kiosk cutover (`NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=true`). UAT (`chinmaya-setu-uat`) is portal-only, so forced deploys there are safe.
