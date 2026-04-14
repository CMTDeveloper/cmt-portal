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
- **Slice B** — 🚧 In progress — Port `chinmaya-family-check-in` + portal-wide auth foundation (subsumes former slice D)
- **Slice C** — Port `chinmaya-event-registration` into `apps/portal/src/app/events/*`
- **Slice E+** — Future modules (programs, enrollment, retirement of old portal)

## Environment variables

Slice B0 introduced a dual Firebase project model: the portal app uses one Firebase project for Firestore + Auth, and a second for read-only RTDB. Copy the complete variable list from `apps/portal/.env.example` to your local `apps/portal/.env.local`. The required keys are:

```
# Portal Firebase (Firestore + Auth)
PORTAL_FIREBASE_PROJECT_ID
PORTAL_FIREBASE_CLIENT_EMAIL
PORTAL_FIREBASE_PRIVATE_KEY
NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY
NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID
NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID

# Master Firebase (RTDB reads — always prod)
MASTER_FIREBASE_PROJECT_ID
MASTER_FIREBASE_CLIENT_EMAIL
MASTER_FIREBASE_PRIVATE_KEY
MASTER_FIREBASE_DATABASE_URL
NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL

# Auth
TEACHER_PASSPHRASE
SESSION_COOKIE_EXPIRES_DAYS  # default 5

# AWS (consumed in slice B5)
AWS_SES_REGION  # default ca-central-1
AWS_SNS_REGION  # default us-east-1
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_SES_FROM_EMAIL
AWS_SNS_TOPIC_ARN
```

## Bootstrapping the first admin

Before `/login/admin` works, there must be at least one Firebase user with the `admin` custom claim. Run:

```sh
pnpm --filter @cmt/portal seed:admin --email=your-admin@example.com
```

The script prompts for a password (8+ chars), creates the user in the portal Firebase project if missing, and sets the `admin` claim. It is idempotent — re-running it updates the password.

## End-to-end tests (Playwright)

```sh
pnpm test:e2e
```

Playwright runs against a locally-served `pnpm --filter @cmt/portal dev -- --port=3001`. Set `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` in your environment before running — the "admin can sign in" test is skipped without them. Playwright is **not** on the pre-push hook; run it before every production promotion.

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
