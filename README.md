# CMT Portal

The Chinmaya Mission Toronto unified portal. A Turborepo monorepo containing one Next.js 16 application and four shared packages.

## Quick start

```sh
# Install dependencies
pnpm install

# Run the portal in dev mode
pnpm dev

# Run tests
pnpm test

# Typecheck and lint everything
pnpm typecheck
pnpm lint
```

The portal runs at <http://localhost:3000>.

## What's here

```
apps/
  portal/                 # Next.js 16 app — the only app
packages/
  ui/                     # @cmt/ui — shadcn-based design system + brand tokens
  firebase-shared/        # @cmt/firebase-shared — admin and client Firebase init
  shared-domain/          # @cmt/shared-domain — pure TS types and business logic (web + mobile reusable)
  config/                 # @cmt/config — shared TS, ESLint, Tailwind, Prettier configs
docs/superpowers/specs/   # Design specs for each slice
docs/superpowers/plans/   # Implementation plans for each slice
```

## Toolchain

- Node 22 LTS (pinned in `.nvmrc`)
- pnpm 9.15.0 workspaces
- Turborepo 2
- Next.js 16, React 19
- TypeScript 5 (strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Tailwind CSS 3.4
- Vitest 4
- ESLint 9 flat config

## Commit identity

All commits in this repo must be authored by `CMT Developer <developer@chinmayatoronto.org>`. The local repo config is set to enforce this — verify with:

```sh
git config user.name && git config user.email
```

If not set, run:

```sh
git config user.name "CMT Developer"
git config user.email "developer@chinmayatoronto.org"
```

## Slice-based development

This project ships in slices, each with its own design spec and implementation plan. See `docs/superpowers/specs/` and `docs/superpowers/plans/` for the current state.

- **Slice A** — ✅ **Shipped** — Monorepo scaffold + portal app shell + 4 shared packages
- **Slice B** — Port `chinmaya-family-check-in` into the portal as `apps/portal/src/app/check-in/*` (next)
- **Slice C** — Port `chinmaya-event-registration` into the portal as `apps/portal/src/app/events/*`
- **Slice D** — Unified portal-level auth
- **Slice E+** — Future modules (programs, enrollment, retirement of old portal)

## Workflow (solo-dev, main-only)

All changes commit directly to `main`. Before every `git push`, a local **pre-push hook** runs the full validation suite:

```
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

If any step fails, the push is aborted. Fix the underlying issue; do **not** bypass with `--no-verify`.

The hook is installed automatically by the root `package.json` `prepare` script on `pnpm install`. Hook source lives at `scripts/git-hooks/pre-push`.

A dormant `.github/workflows/ci.yml` is retained for a future feature-branch/PR workflow if the project ever grows beyond solo-dev. It is not the enforcement mechanism today.
