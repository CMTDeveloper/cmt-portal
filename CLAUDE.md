# CLAUDE.md — Agent guidance for cmt-portal

This file orients AI agents (Claude Code, Cursor, etc.) working in this repository. Read before making changes.

## What this is

A Turborepo monorepo for the Chinmaya Mission Toronto unified portal. One Next.js 16 application (`apps/portal`) and four shared workspace packages.

**Slice A status:** ✅ Shipped (merged to `main`). Spec: `docs/superpowers/specs/2026-04-12-slice-a-portal-scaffold-design.md`, plan: `docs/superpowers/plans/2026-04-12-slice-a-portal-scaffold.md`.

**Slice B status:** In progress. B0 + B2 + B3 + B1 + B4 shipped. B5 (notifications & cron) is next. Kiosk is dark-launched in production — standalone app still serves the physical kiosk. Spec: `docs/superpowers/specs/2026-04-13-slice-b-family-check-in-port-design.md`. Decomposed into six sub-slices (B0 → B2 → B3 → B1 → B4 → B5). Slice D (unified auth) is **removed** from the roadmap — B0 absorbs it.

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
- Don't migrate to Tailwind v4, `vercel.ts`, or shadcn v4-only components without a dedicated upgrade slice.
- Don't propose retiring the standalone `chinmaya-event-registration` or `chinmaya-family-check-in` deployments until slices B and C are proven in parallel-run.
