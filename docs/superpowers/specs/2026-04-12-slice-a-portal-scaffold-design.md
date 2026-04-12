# Slice A — Portal Monorepo Scaffold

| Field | Value |
|---|---|
| **Date** | 2026-04-12 |
| **Status** | Approved (brainstorming complete; pending user spec review) |
| **Sub-project** | Slice A of the Chinmaya Mission Toronto Portal program |
| **Owner** | CMT Developer |
| **Implements** | Foundation for the unified Chinmaya Mission Toronto portal |
| **Successors** | Slices B (port family-check-in), C (port event-registration), D (unified auth), E+ (future modules) |
| **Reference materials** | `docs/superpowers/specs/reference/Chinmaya Setu Prototype.{md,pdf}` |

---

## 1. Background

Chinmaya Mission Toronto operates two production Next.js applications and one half-built portal effort:

| Repo | Status | What it does |
|---|---|---|
| `chinmaya-event-registration` | Production. Next 16, React 19, Vitest, 90 tests. | Event registration with Stripe + Interac e-Transfer + Google Sheet backup. Owns `events/{campaign}/registrations` in Firestore; reads `roster` in RTDB. |
| `chinmaya-family-check-in` | Production. Next 14, no tests. | Family check-in kiosk at the Ashram entry. Implements Phase 1 of the Chinmaya Setu Prototype. Owns `family-check-ins/*` in Firestore; reads `roster` in RTDB. Uses passphrase-based auth (`APP_PASSPHRASE`, `TEACHER_PASSPHRASE`). |
| `chinmaya-setu` | Half-built, abandoned. Next 16, Supabase, ~83 shadcn components, ~22-table schema. | Prior portal attempt by another developer. Mostly UI scaffolding; backend integration incomplete. |

The user's goal is to unify all functionality into a single portal under one Next.js app, on the path described in the Chinmaya Setu Prototype document (a four-phase roadmap from check-in → mobile → enrollment → retire-old-registration). Phase 1 of that roadmap is already shipped as `chinmaya-family-check-in`.

The work is too large for a single design spec. It has been decomposed into independent slices, each with its own spec → plan → implementation cycle. **This spec covers slice A only.** It establishes the foundation that all subsequent slices inherit.

The Chinmaya Setu Supabase schema is treated as a reference document for vocabulary (family/member/campus/level/grade naming), not as a migration target. The production data model — RTDB `roster` plus a small set of Firestore collections — already works and will be inherited unchanged.

---

## 2. Slice decomposition (program-level context)

| Slice | Scope | Status |
|---|---|---|
| **A** | Monorepo scaffold + portal app shell + 4 shared packages | **This spec** |
| B | Port `chinmaya-family-check-in` into the portal as `apps/portal/src/app/check-in/*`; upgrade Next 14 → 16; add missing test coverage; rework kiosk mode for portal context | Future |
| C | Port `chinmaya-event-registration` into the portal as `apps/portal/src/app/events/*`; rework event-campaign config from env-per-deploy to data-driven | Future |
| D | Unified portal-level auth across the merged features; consolidate or replace the passphrase model | Future |
| E+ | Phase 3 (programs/enrollment), Phase 4 (Stripe-driven annual registration, retire old portal), and any new modules | Future |

Slices run sequentially. Slice A is the only slice that blocks every other slice; getting it right matters more than getting it fast.

---

## 3. Goals

Ship an empty Turborepo containing one Next.js 16 application (`apps/portal`) and four workspace-only packages (`@cmt/ui`, `@cmt/firebase-shared`, `@cmt/shared-domain`, `@cmt/config`), deployable to Vercel at `cmt-portal.vercel.app`, with:

1. A working landing page at `/` that renders the CMT brand identity (navy/teal palette, Merriweather + Inter fonts, copied logo) and links to two placeholder feature routes.
2. Placeholder routes for `/events` and `/check-in` that render a "Coming Soon" component, ready to be replaced by real implementations in slices B and C.
3. Six structural disciplines in place — lint-enforced where possible, documented where not — that keep the monolith reversibly monolithic.
4. A green CI pipeline (GitHub Actions: `typecheck`, `lint`, `test`, `build`) gating all merges to `main`.
5. A minimal smoke test surface (~8 tests) that exercises every package boundary and proves the build pipeline works end-to-end.

---

## 4. Non-goals

Slice A explicitly does NOT deliver any of the following. Each is deferred to a named future slice or an explicit decision not to implement.

- **Authentication of any kind.** Deferred to slice D.
- **Real feature functionality.** `/events` and `/check-in` are placeholder pages.
- **Migration of any actual code** from `chinmaya-event-registration` or `chinmaya-family-check-in`. Deferred to slices C and B respectively.
- **Retirement or modification of the existing production deployments.** Soft-retirement / parallel-run strategy applies during slices B and C.
- **New Firestore collections, RTDB paths, or schema design.** Production already has working collections (`roster` in RTDB, `family-check-ins/*` in Firestore, `events/{campaign}/registrations` in Firestore); slice A inherits them unchanged.
- **Adoption of the `chinmaya-setu` Supabase schema as a data model.** Reference-only — too large, partially abandoned, and reinvents what the production roster already provides.
- **A real domain.** Uses Vercel default `cmt-portal.vercel.app`. DNS work happens when slices B/C trigger cutover.
- **Tailwind v4.** Locked at v3.4 to match existing apps. v4 upgrade is a future slice.
- **Playwright E2E tests.** Deferred to slice B once a real flow exists to test.
- **`vercel.ts` config format.** Uses `vercel.json` for slice A. Migration to `vercel.ts` is a future slice if it provides concrete value.
- **Native mobile app.** Phase 2 of the prototype roadmap; post-slice-D.
- **RBAC tables, roles, or permissions.** Existing apps use passphrases; consolidation is a slice D conversation.

---

## 5. Architecture decision: monolith over multi-zones

Slice A scaffolds a **single Next.js 16 monolith** at `apps/portal`, not a multi-app monorepo with Next.js multi-zones. Future features are added as route segments inside this app, not as sibling apps.

### 5.1 Why monolith

The constraints that drove this decision:

- **One frontend developer.** No team-isolation requirement that would justify the operational overhead of running multiple Vercel projects.
- **Mobile app on the roadmap.** A future React Native client benefits from a single API surface (`cmt-portal.vercel.app/api/*`), which is significantly simpler in a monolith than in a multi-zone setup where API routes are scattered across deployments.
- **Reversibility favors starting simple.** Splitting a monolith into multi-zones later is straightforward — each `apps/portal/src/features/<x>/` directory becomes its own `apps/<x>/` app and adds one rewrite to the portal config. Merging multi-zones back into a monolith is much harder. Start with the cheaper-to-undo direction.
- **Vercel atomic deploys + CI gates already provide most deploy isolation.** A bad build never reaches main if CI is wired up properly. The remaining runtime isolation comes from React error boundaries per route segment.

### 5.2 Trade-off explicitly accepted

Build-time and deploy-time blast radius is now bounded by CI quality, not infrastructure separation. The six disciplines below mitigate this. If the team grows or the deploy isolation requirement becomes real, slice A's structure has been deliberately designed to be split into multi-zones with low refactor cost.

### 5.3 The six disciplines

These are non-negotiable. Eroding them returns the monolith to a Big Ball of Next.

#### Discipline 1 — Strict feature boundaries (lint-enforced)

Every feature lives under `apps/portal/src/features/<name>/` with a single `index.ts` barrel export. A file in feature A cannot import from feature B. Cross-feature dependencies must go through `@cmt/shared-domain` or `@cmt/ui`.

**Enforcement:** `eslint-plugin-boundaries` configured in `packages/config/eslint.config.js` with element types for `feature`, `shared-pkg`, and `app-shell`. Cross-feature imports fail the lint step in CI. The rule is wired up from day one so the first attempted violation in slice B is caught immediately.

#### Discipline 2 — `@cmt/shared-domain` for web + mobile reuse

Pure-TypeScript code (types, Zod schemas, business rules with no DOM/React/Next dependencies) lives in `@cmt/shared-domain`. Designed from day one to be consumed by both `apps/portal` and the future React Native app.

**Enforcement:** Package `peerDependencies` exclude React and Next. ESLint `no-restricted-imports` rule on the package forbids `react`, `next/*`, and `@radix-ui/*` imports. The package physically cannot grow UI code by accident.

#### Discipline 3 — Per-segment React error boundaries

Every top-level route segment under `apps/portal/src/app/` has its own `error.tsx`. A runtime crash in `/events` does not take down `/check-in` or the root layout.

**Enforcement:** Native Next 16 pattern. Slice A ships:
- `apps/portal/src/app/error.tsx` — root level
- `apps/portal/src/app/global-error.tsx` — last resort, catches errors in the root layout itself
- `apps/portal/src/app/events/error.tsx` — segment level
- `apps/portal/src/app/check-in/error.tsx` — segment level
- `apps/portal/src/app/not-found.tsx` — 404

All five render `<ErrorFallback>` from `@cmt/ui` so they share visual identity.

#### Discipline 4 — CI gate on `main`

No PR merges to `main` without `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build` all passing.

**Enforcement:** `.github/workflows/ci.yml` runs all five steps on every PR. Branch protection on `main` (configured manually in repo settings) requires the `ci` check to pass before merge. Vercel preview deployments run in parallel via the GitHub integration.

#### Discipline 5 — Feature flags via env vars

Any feature whose launch is risky or staged-rollout-worthy is gated behind a `NEXT_PUBLIC_FEATURE_*` env var read through `apps/portal/src/lib/flags.ts`. No hardcoded booleans.

**Enforcement:** Convention + code review. The `lib/flags.ts` module exists from slice A with two flags (`events`, `checkIn`) defaulted to `false`. Slice B/C add their gates to this module.

**Future upgrade path:** If env-based flags become limiting, swap `lib/flags.ts` to read from a Firestore `config/feature-flags` doc with a 60-second in-memory cache. Approximately 30 lines, no consumer changes.

#### Discipline 6 — No premature package extraction

Code lives in the consuming app until two consumers exist. Portal chrome (header, footer, nav) lives in `apps/portal/src/components/chrome/`, NOT in a `@cmt/portal-chrome` package, because there is only one consumer.

**Enforcement:** Convention + code review. `CLAUDE.md` documents the rule. Any new package proposal in slice B+ must justify two-or-more consumers.

---

## 6. Repository layout

```
chinmaya-mission-portal/
├── .github/
│   └── workflows/
│       └── ci.yml                        # typecheck, lint, test, build on PRs to main
├── .gitignore
├── .nvmrc                                # 22
├── .prettierrc                           # extends @cmt/config/prettier
├── apps/
│   └── portal/                           ← THE ONLY app
│       ├── public/
│       │   ├── cmt-logo.png              # copied from chinmayatoronto.org
│       │   └── favicon.ico
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx            # root layout: fonts, theme, chrome
│       │   │   ├── page.tsx              # landing — hero + feature cards
│       │   │   ├── error.tsx             # root error boundary
│       │   │   ├── global-error.tsx      # last-resort error boundary
│       │   │   ├── not-found.tsx         # 404 page
│       │   │   ├── globals.css           # tailwind directives + token CSS vars
│       │   │   ├── events/
│       │   │   │   ├── page.tsx          # "Coming Soon" placeholder
│       │   │   │   └── error.tsx         # per-segment error boundary
│       │   │   └── check-in/
│       │   │       ├── page.tsx          # "Coming Soon" placeholder
│       │   │       └── error.tsx         # per-segment error boundary
│       │   ├── components/
│       │   │   ├── chrome/               # header, footer, nav (portal-specific)
│       │   │   │   ├── header.tsx
│       │   │   │   ├── footer.tsx
│       │   │   │   └── nav.tsx
│       │   │   └── coming-soon.tsx       # shared placeholder component
│       │   ├── features/                 # empty in slice A; B/C populate
│       │   │   └── .gitkeep
│       │   └── lib/
│       │       └── flags.ts              # discipline 5 — feature flag reader
│       ├── next.config.ts
│       ├── package.json
│       ├── tsconfig.json                 # extends @cmt/config/tsconfig.next.json
│       ├── tailwind.config.ts            # extends @cmt/config/tailwind.preset
│       ├── vitest.config.ts
│       ├── vitest.setup.ts
│       └── vercel.json                   # framework: nextjs
├── packages/
│   ├── ui/                               # shadcn-based design system
│   │   ├── src/
│   │   │   ├── components/               # 12 seeded shadcn components
│   │   │   │   ├── button.tsx
│   │   │   │   ├── card.tsx
│   │   │   │   ├── input.tsx
│   │   │   │   ├── label.tsx
│   │   │   │   ├── form.tsx
│   │   │   │   ├── dialog.tsx
│   │   │   │   ├── sheet.tsx
│   │   │   │   ├── sonner.tsx
│   │   │   │   ├── alert.tsx
│   │   │   │   ├── skeleton.tsx
│   │   │   │   ├── avatar.tsx
│   │   │   │   └── separator.tsx
│   │   │   ├── lib/
│   │   │   │   └── cn.ts                 # class merge utility
│   │   │   ├── styles/
│   │   │   │   └── tokens.css            # CSS variables for CMT brand
│   │   │   ├── error-fallback.tsx        # shared error UI
│   │   │   └── index.ts                  # barrel export
│   │   ├── components.json               # shadcn CLI config (target: this package)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md                     # documents manual-upgrade discipline
│   ├── firebase-shared/
│   │   ├── src/
│   │   │   ├── admin.ts                  # entry: @cmt/firebase-shared/admin
│   │   │   ├── client.ts                 # entry: @cmt/firebase-shared/client
│   │   │   ├── env.ts                    # zod-validated env reader
│   │   │   └── index.ts                  # types only
│   │   ├── package.json                  # exports field with /admin and /client
│   │   └── tsconfig.json
│   ├── shared-domain/
│   │   ├── src/
│   │   │   ├── types/                    # empty in slice A; B/C add types
│   │   │   ├── schemas/                  # empty; B/C add Zod schemas
│   │   │   ├── utils/                    # empty; B/C add pure utils
│   │   │   └── index.ts                  # barrel; web + mobile-friendly
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── config/
│       ├── tsconfig.base.json
│       ├── tsconfig.next.json
│       ├── eslint.config.js              # flat config; includes boundaries plugin
│       ├── tailwind.preset.ts
│       ├── prettier.config.js
│       ├── package.json
│       └── README.md
├── docs/
│   └── superpowers/
│       └── specs/
│           ├── 2026-04-12-slice-a-portal-scaffold-design.md   ← this document
│           └── reference/
│               ├── Chinmaya Setu Prototype.md
│               └── Chinmaya Setu Prototype.pdf
├── package.json                          # workspace root, dev tooling
├── pnpm-lock.yaml
├── pnpm-workspace.yaml                   # apps/* and packages/*
├── turbo.json                            # build, dev, lint, typecheck, test pipelines
├── README.md                             # repo orientation, setup instructions
└── CLAUDE.md                             # AI agent guidance, mirrors structure here
```

### 6.1 Notable structural choices

- **No `apps/events` or `apps/check-in` directories.** These become route segments inside `apps/portal/src/app/` in slices B and C. The empty `apps/portal/src/features/.gitkeep` directory establishes where feature internal modules will live so the lint boundaries plugin has a target from day one.
- **Package scope `@cmt/`** matches the chinmayatoronto.org short brand. All shared packages are workspace-only (`"private": true`); none are published to npm.
- **Prototype documents are moved out of the repo root** into `docs/superpowers/specs/reference/` so design specs sit alongside the source materials they reference.
- **No `vercel.ts`.** Slice A uses minimal `apps/portal/vercel.json`. Migration to `vercel.ts` (which requires `@vercel/config`) is deferred until it provides concrete value.

---

## 7. Toolchain and dependencies

### 7.1 Versions locked

| Tool | Version | Rationale |
|---|---|---|
| Node | **22 LTS** (latest 22.x) | Vercel default; supported by Next 16; pinned via `.nvmrc` and `engines.node` |
| pnpm | **^9.15.0** | Workspace-aware, fast, used by both existing apps |
| Turborepo | **^2.x** (latest) | Standard monorepo orchestrator; first-class on Vercel |
| Next.js | **^16.2.x** | Match events app exactly so slice C migration is friction-free |
| React | **^19.2.x** | Match events app |
| TypeScript | **^5.x** strict | `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` |
| Tailwind CSS | **^3.4.x** | Match both existing apps; defer v4 to its own slice |
| Vitest | **^4.x** | Match events app's existing test infrastructure |
| ESLint | **^9.x** flat config | Next 16 supports flat config natively |
| Prettier | **^3.x** | Standard |
| shadcn CLI | latest | Configured via `packages/ui/components.json` to write into `packages/ui/src/components/` |
| Firebase Web SDK | **^12.x** | Match events app |
| Firebase Admin SDK | **^13.x** | Match events app |
| Zod | **^3.x** | Used by `packages/firebase-shared/env.ts` for env validation |

### 7.2 Root `package.json`

```json
{
  "name": "cmt-portal",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "format": "prettier --write \"**/*.{ts,tsx,md,json}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,md,json}\""
  },
  "devDependencies": {
    "turbo": "^2.x",
    "typescript": "^5.x",
    "prettier": "^3.x",
    "@types/node": "^22.x"
  }
}
```

### 7.3 `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] }
  }
}
```

### 7.4 Per-package dependencies

| Package | Production deps | Dev deps |
|---|---|---|
| `apps/portal` | `next`, `react`, `react-dom`, `@cmt/ui`, `@cmt/firebase-shared`, `@cmt/shared-domain` | `@cmt/config`, `vitest`, `@vitejs/plugin-react`, `@testing-library/react`, `jsdom`, `eslint`, `eslint-plugin-boundaries` |
| `@cmt/ui` | `react`, `react-dom`, `@radix-ui/*` (per-component), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner` | `@cmt/config`, `tailwindcss`, `typescript` |
| `@cmt/firebase-shared` | `firebase`, `firebase-admin`, `zod` | `@cmt/config`, `vitest`, `typescript` |
| `@cmt/shared-domain` | `zod` | `@cmt/config`, `vitest`, `typescript` |
| `@cmt/config` | `eslint`, `eslint-plugin-boundaries`, `eslint-config-next`, `@typescript-eslint/*`, `tailwindcss` | none |

### 7.5 `apps/portal/next.config.ts`

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },
  transpilePackages: ['@cmt/ui', '@cmt/shared-domain'],
};

export default config;
```

### 7.6 `apps/portal/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
```

### 7.7 `packages/firebase-shared/package.json` exports

```json
{
  "name": "@cmt/firebase-shared",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./admin": { "types": "./dist/admin.d.ts", "default": "./dist/admin.js" },
    "./client": { "types": "./dist/client.d.ts", "default": "./dist/client.js" }
  }
}
```

Importers do `import { getAdminApp } from '@cmt/firebase-shared/admin'` (server only) or `import { getClientApp } from '@cmt/firebase-shared/client'` (browser only). The two never bleed into each other.

### 7.8 ESLint boundaries config (in `packages/config/eslint.config.js`)

```js
{
  settings: {
    'boundaries/elements': [
      { type: 'feature', pattern: 'apps/portal/src/features/*', mode: 'folder' },
      { type: 'shared-pkg', pattern: 'packages/*', mode: 'folder' },
      { type: 'app-shell', pattern: 'apps/portal/src/{app,components,lib}/**' },
    ],
  },
  rules: {
    'boundaries/element-types': ['error', {
      default: 'allow',
      rules: [
        { from: 'feature',
          allow: ['feature', 'shared-pkg', 'app-shell'],
          message: 'Cross-feature imports forbidden — go through @cmt/shared-domain or @cmt/ui' },
        { from: 'feature', disallow: ['feature'], importKind: 'value',
          message: 'Cross-feature imports forbidden' },
      ],
    }],
  }
}
```

In slice A there are no features yet, so this rule applies to nothing — but the config exists and is wired into CI from day one.

### 7.9 `proxy.ts` vs `middleware.ts`

Next 16 renames `middleware.ts` to `proxy.ts`. Slice A does not need either — there is no auth, no rewrites, no request interception. When slice D adds auth, it ships as `apps/portal/src/proxy.ts`. This spec records the rename so slice D does not regress to the old name.

---

## 8. Apps and packages

### 8.1 `apps/portal`

The only application in the monorepo. Houses the landing page, the placeholder feature routes, the portal chrome, and (in future slices) all feature route segments and API handlers.

**Public surface in slice A:**
- `/` — Landing page (hero + two feature cards)
- `/events` — "Coming Soon" placeholder
- `/check-in` — "Coming Soon" placeholder

**Internal structure:**
- `src/app/` — Next.js App Router routes, layouts, error boundaries
- `src/components/chrome/` — Portal-specific header, footer, nav (not extracted to a package per discipline 6 — only one consumer)
- `src/components/coming-soon.tsx` — Shared placeholder component used by both slice-A placeholder routes
- `src/features/.gitkeep` — Empty in slice A; populated in slices B and C
- `src/lib/flags.ts` — Feature flag reader (discipline 5)
- `public/cmt-logo.png` — Logo copied from chinmayatoronto.org

### 8.2 `@cmt/ui`

Shadcn-based design system, theming, and shared UI primitives. All other apps and packages may consume it freely.

**Public surface:**
- 12 seeded shadcn components: `Button`, `Card`, `Input`, `Label`, `Form`, `Dialog`, `Sheet`, `Sonner`, `Alert`, `Skeleton`, `Avatar`, `Separator`
- `<ErrorFallback />` — Shared error UI consumed by all `error.tsx` files
- `cn()` utility — Tailwind class merge helper
- `tokens.css` — CMT brand variables in HSL format

**Component lift mechanism:** Instead of running the shadcn CLI fresh, copy the 12 component source files directly from `/Users/dineshmatta/projects/chinmaya-setu/components/ui/` (the prior dev's work) into `packages/ui/src/components/`. Each copy is reviewed for:
- Removal of any Setu-specific prop additions
- Verification that imports use `cn` from `@cmt/ui/lib/cn` (not from a Setu path)
- Verification that CSS variable references (`hsl(var(--primary))` etc.) match the token names defined in §9

**`packages/ui/components.json`** is configured so future `pnpm dlx shadcn add <component>` runs target this package, not `apps/portal`. Slice B/C just need to run the CLI to land new components in the right place.

**Manual upgrade discipline:** Documented in `packages/ui/README.md`. Quarterly diff audits against upstream shadcn. Each new component PR pastes the upstream commit hash so drift is auditable.

### 8.3 `@cmt/firebase-shared`

Single source of truth for Firebase initialization across the monorepo. Two entry points (`/admin` for server, `/client` for browser) so server code never accidentally pulls in browser SDK code, and vice versa.

**Public surface:**
- `import { getAdminApp, getAdminFirestore, getAdminDatabase } from '@cmt/firebase-shared/admin'` — server-side
- `import { getClientApp, getClientAuth, getClientFirestore } from '@cmt/firebase-shared/client'` — browser-side
- Types-only exports from the root path (`@cmt/firebase-shared`)

**Internal structure:**
- `src/admin.ts` — Admin SDK init (lazy, memoized)
- `src/client.ts` — Web SDK init (lazy, memoized)
- `src/env.ts` — Zod-validated env reader (throws on missing required vars)
- `src/index.ts` — Type re-exports only

**Slice A scope:** Package builds and is importable. No actual app code consumes it yet — slices B and C are the first consumers. Smoke tests verify that admin init returns a valid app object given mock env vars.

**Env var convention** (matches existing apps):
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_DATABASE_URL`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL`

These are documented in `.env.example` but NOT required to be set in slice A (no consumer yet).

### 8.4 `@cmt/shared-domain`

Pure-TypeScript domain layer designed for web + future mobile reuse. Empty in slice A; populated by slices B and C as they extract types and business rules from the existing apps.

**Public surface:** Empty barrel in slice A. Future structure will include `types/`, `schemas/`, `utils/`.

**Constraints:** No React, no Next, no DOM, no Radix imports — enforced via lint rule and `peerDependencies` exclusions.

### 8.5 `@cmt/config`

Workspace-only package containing shared TypeScript, ESLint, Tailwind, and Prettier configuration. Consumed by every other package and the portal app.

**Public surface:**
- `tsconfig.base.json` — strict TypeScript baseline
- `tsconfig.next.json` — Next-specific extension of base
- `eslint.config.js` — flat config including boundaries plugin
- `tailwind.preset.ts` — base Tailwind config + tokens
- `prettier.config.js`

---

## 9. Brand and design tokens

Mined from the live `chinmayatoronto.org` WordPress site.

### 9.1 Color tokens (`packages/ui/src/styles/tokens.css`)

```css
@layer base {
  :root {
    /* CMT brand — mined from chinmayatoronto.org */
    --background: 0 0% 100%;             /* #ffffff */
    --foreground: 205 38% 30%;           /* #30566a — body text */

    --primary: 192 44% 23%;              /* #214a54 — navy/teal */
    --primary-foreground: 0 0% 100%;     /* #ffffff */

    --secondary: 177 51% 79%;            /* #b3e1de — light teal */
    --secondary-foreground: 192 44% 23%; /* navy on light teal */

    --accent: 35 95% 67%;                /* #fbb559 — warm gold */
    --accent-foreground: 192 44% 23%;    /* navy on gold */

    --muted: 50 21% 95%;                 /* #f5f4f0 — warm beige */
    --muted-foreground: 0 0% 44%;        /* #6f6f6f */

    --heading: 200 36% 32%;              /* #335b70 — slightly deeper teal-gray */

    --border: 50 21% 90%;
    --input: 50 21% 90%;
    --ring: 192 44% 23%;                 /* primary for focus rings */

    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 98%;

    --radius: 0.5rem;
  }
}
```

HSL format because shadcn's CSS-variable theming convention uses HSL channels — keeps compatibility with `hsl(var(--primary))` references in component class strings without conversion logic.

### 9.2 Fonts

- **Headings: Merriweather** (serif, free on Google Fonts) — direct match to live site
- **Body: Inter** (sans-serif, free on Google Fonts) — substitute for the paid Maax font used by the live site; also matches what `chinmaya-event-registration` already uses, so slice C migration has no font change

Both loaded via `next/font/google` for zero-runtime overhead. **No paid fonts.**

### 9.3 Font wiring (`apps/portal/src/app/layout.tsx`)

```tsx
import { Inter, Merriweather } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const merriweather = Merriweather({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-serif',
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${merriweather.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
```

### 9.4 Tailwind preset (`packages/config/tailwind.preset.ts`)

```ts
export default {
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        heading: 'hsl(var(--heading))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
};
```

Headings use `font-serif` (Merriweather), body uses `font-sans` (Inter), via Tailwind utility classes — no CSS overrides needed.

### 9.5 Logo

- **Source:** `https://chinmayatoronto.org/wp-content/uploads/2020/05/main_site_logo.png`
- **Destination:** `apps/portal/public/cmt-logo.png` (fetched once during slice A implementation)
- **Used by:** `Header` component and the landing page hero
- **Format:** PNG only in slice A. SVG version from CMT comms team is a nice-to-have; swap-in is one PR.

---

## 10. Landing page

### 10.1 IA

```
┌─────────────────────────────────────────────┐
│  [CMT logo]   nav: Home | About (ext)      │  ← Header from src/components/chrome/header.tsx
├─────────────────────────────────────────────┤
│                                             │
│         [CMT logo, larger]                  │
│                                             │
│      Chinmaya Mission Toronto               │  ← H1, Merriweather, --heading color
│                                             │
│   "Bridging knowledge, community,           │  ← lead paragraph, muted-foreground
│    and spiritual practice."                 │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│   ┌──────────────┐  ┌──────────────┐       │
│   │   Events     │  │  Family      │       │  ← shadcn Card components
│   │              │  │  Check-in    │       │     each links to /events or /check-in
│   │  Register    │  │              │       │
│   │  for         │  │  Sign in at  │       │
│   │  upcoming    │  │  the Ashram  │       │
│   │  events      │  │              │       │
│   │              │  │              │       │
│   │  [→ Open]    │  │  [→ Open]    │       │  ← shadcn Button (variant: ghost)
│   └──────────────┘  └──────────────┘       │
│                                             │
├─────────────────────────────────────────────┤
│  © 2026 Chinmaya Mission Toronto           │  ← Footer from src/components/chrome/footer.tsx
└─────────────────────────────────────────────┘
```

- Two cards in slice A. Future slices add more cards (Programs, Attendance, etc.) to the same grid.
- Cards use the seeded `Card`, `CardHeader`, `CardContent`, `CardFooter` components from `@cmt/ui`.
- Each card's "Open" button uses Next `<Link>` to navigate to the placeholder route (soft navigation, in-app).
- The "About" link in the header is an external link to `chinmayatoronto.org` (the existing WordPress site stays live).

### 10.2 Coming Soon placeholder

`apps/portal/src/components/coming-soon.tsx`:

```tsx
import { Card, CardContent } from '@cmt/ui';
import Link from 'next/link';

export function ComingSoon({ feature }: { feature: string }) {
  return (
    <div className="container mx-auto max-w-2xl py-16">
      <Card>
        <CardContent className="space-y-4 p-8 text-center">
          <h1 className="font-serif text-3xl text-heading">{feature}</h1>
          <p className="text-muted-foreground">
            This feature is coming soon. We're moving the existing {feature.toLowerCase()} app
            into the Chinmaya Mission Toronto portal.
          </p>
          <Link href="/" className="text-primary underline">
            ← Back to portal home
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
```

`apps/portal/src/app/events/page.tsx` and `apps/portal/src/app/check-in/page.tsx` both render this single shared component with their own `feature` prop. Slice B replaces `apps/portal/src/app/check-in/page.tsx` with the real implementation; slice C replaces `apps/portal/src/app/events/page.tsx`.

### 10.3 Why each seeded component is in the slice A bundle

| Component | Why it's in the seed |
|---|---|
| `Button` | Used by every form, every CTA, every nav link |
| `Card` (+ Header/Content/Footer/Title/Description) | Landing feature cards, Coming Soon placeholder, future dashboard tiles |
| `Input` | Every text field across registration, check-in, future enrollment |
| `Label` | Pairs with Input; required for shadcn Form pattern |
| `Form` | Full react-hook-form + Zod integration; slice B/C depend on this |
| `Dialog` | Modal confirmations across both events and check-in flows |
| `Sheet` | Mobile nav drawer + future filters/details panels |
| `Sonner` (Toast) | Async feedback (success/failure notifications) |
| `Alert` | Inline warnings on landing or feature pages |
| `Skeleton` | Loading state for client-side fetches |
| `Avatar` | Future user identity in header (slice D) |
| `Separator` | Visual divider in cards, dropdowns, footers |

---

## 11. Deployment

### 11.1 Vercel project configuration (manual, one-time)

- Create new Vercel project → import from `github.com/CMTDeveloper/cmt-portal`
- **Root directory:** `apps/portal` (Vercel detects monorepo and prompts; this tells it where the Next app lives)
- **Framework preset:** Next.js (auto-detected)
- **Build command:** Vercel default (`pnpm build` resolves through Turborepo)
- **Install command:** Vercel default (`pnpm install`)
- **Node version:** 22 (set in project settings to match `.nvmrc`)
- **Production branch:** `main`

### 11.2 `apps/portal/vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs"
}
```

That is the entire file for slice A. No rewrites, no headers, no crons (those land in slice B for the family-check-in roster cron). No regions specified (use Vercel default; `iad1` is fine for slice A).

### 11.3 Environment variables (slice A)

| Variable | Where | Required for slice A? |
|---|---|---|
| `NEXT_PUBLIC_FEATURE_EVENTS` | Vercel + `.env.local` | No (defaults to `false`) |
| `NEXT_PUBLIC_FEATURE_CHECK_IN` | Vercel + `.env.local` | No (defaults to `false`) |

That is the entire env var surface for slice A. No Firebase env vars are needed yet because the package is built but not consumed by any feature. Slices B and C add the Firebase env vars when their features call into firebase-shared.

A `.env.example` file at the repo root documents what is needed across all slices, so future-you (or another dev) sees the full picture without digging.

### 11.4 GitHub Actions CI (`.github/workflows/ci.yml`)

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

### 11.5 Branch protection (manual setup)

Configured in GitHub repo settings on `main`:

- Require passing status check `ci`
- Require PR before merging
- Require linear history
- No force pushes
- Require branches to be up to date before merging

This must be done manually after the first PR runs CI (so the `ci` check name exists in GitHub's drop-down). Slice A implementation includes a step to verify branch protection is configured.

### 11.6 Deployment flow

```
Developer pushes branch
        │
        ▼
GitHub PR opened
        │
        ├─────────────────────┐
        │                     │
        ▼                     ▼
GitHub Actions CI       Vercel preview
(typecheck, lint,       (build + deploy
 test, build)            preview URL)
        │                     │
        └─────────────────────┘
                    │
        Both green → merge allowed
                    │
                    ▼
            Merge to main
                    │
                    ▼
        Vercel production deploy
                    │
                    ▼
        cmt-portal.vercel.app
```

---

## 12. Test surface

Eight smoke tests across four packages. None touch the network. They prove infrastructure works, not that any features work — features come in slices B and C with their own test suites.

| File | Test | What it proves |
|---|---|---|
| `apps/portal/src/app/__tests__/page.test.tsx` | Landing page renders heading, both feature cards, footer | Landing wired up; chrome included |
| `apps/portal/src/app/events/__tests__/page.test.tsx` | `/events` renders ComingSoon component with "Events" label | Placeholder route exists; feature directory boundary OK |
| `apps/portal/src/app/check-in/__tests__/page.test.tsx` | `/check-in` renders ComingSoon component with "Family Check-in" label | Same |
| `packages/ui/src/__tests__/button.test.tsx` | Button renders with primary brand color class | UI package + tokens wired through |
| `packages/ui/src/__tests__/card.test.tsx` | Card composes header/content/footer correctly | UI package composition works |
| `packages/firebase-shared/src/__tests__/admin.test.ts` | `getAdminApp()` returns a valid app object given mock env vars; throws on missing required vars | Package builds, env validation works, no real network |
| `packages/firebase-shared/src/__tests__/env.test.ts` | Zod env schema accepts valid envs and rejects invalid ones | Env validation contract |
| `packages/shared-domain/src/__tests__/index.test.ts` | Package exports its barrel without crashing | Package builds and is importable |

---

## 13. Acceptance criteria

A reviewer can verify slice A is complete by checking all of the following:

1. `pnpm install` from a fresh clone produces no errors
2. `pnpm typecheck` passes across all packages and the portal app
3. `pnpm lint` passes (including the boundaries config — even though it has nothing to enforce yet)
4. `pnpm test` runs and all 8 smoke tests pass
5. `pnpm build` produces a successful Next build with no warnings about deprecated APIs
6. `pnpm dev` starts the portal at `localhost:3000`; the landing page renders correctly with brand colors and Merriweather/Inter fonts loaded
7. Clicking the Events card navigates to `/events` and shows the "Coming Soon" placeholder
8. Clicking the Family Check-in card navigates to `/check-in` and shows the same
9. The deployed `cmt-portal.vercel.app` URL shows the same thing as local dev
10. GitHub Actions CI passes on a clean PR
11. Branch protection on `main` is configured and requires the `ci` check
12. `CLAUDE.md` exists at the repo root and documents the architecture, the 6 disciplines, and the package layout
13. `README.md` exists at the repo root with setup instructions
14. `docs/superpowers/specs/reference/Chinmaya Setu Prototype.{md,pdf}` exist (moved from root)
15. First commit (and all subsequent ones) authored by `CMT Developer <developer@chinmayatoronto.org>` via local `.git/config`

When all 15 boxes are checked, slice A ships and slice B planning begins.

---

## 14. Operational notes

### 14.1 Commit identity

All commits in this repository must be authored by `CMT Developer <developer@chinmayatoronto.org>`. Set via local repo config (not global) at slice A implementation time:

```sh
git config user.name "CMT Developer"
git config user.email "developer@chinmayatoronto.org"
```

Matches the existing apps' commit history convention.

### 14.2 `CLAUDE.md` and `README.md`

Slice A creates two top-level documentation files:

- **`README.md`** — Repo orientation, setup instructions (`pnpm install`, `pnpm dev`), package layout summary, commit identity reminder
- **`CLAUDE.md`** — AI agent guidance: architecture overview, the 6 disciplines (especially discipline 6 — "do not propose new packages without two consumers"), package layout, naming conventions, where each feature lives

Both are kept up to date as slices land. Slice A's `CLAUDE.md` is the canonical reference for slice B's onboarding.

### 14.3 Reference materials

`docs/superpowers/specs/reference/` contains:

- `Chinmaya Setu Prototype.md` — Original product brief (4-phase roadmap)
- `Chinmaya Setu Prototype.pdf` — Same content as PDF

These are moved here from the repo root as part of slice A implementation. They are reference materials, not specs — the spec for each slice lives at `docs/superpowers/specs/YYYY-MM-DD-slice-X-*.md`.

---

## 15. Open questions deferred to future slices

These are explicitly noted so future slices have a checklist of what they inherit unresolved.

- **Auth model** (slice D). The existing apps use passphrase-based auth (`APP_PASSPHRASE`, `TEACHER_PASSPHRASE`). Slice D will decide whether to keep that, replace it with Firebase Auth, or use a hybrid. Slice A does not commit to either direction.
- **Event campaign config** (slice C). The events app uses `NEXT_PUBLIC_EVENT_CAMPAIGN` env per deployment. The portal cannot redeploy on every event, so slice C must rework this to be data-driven (Firestore doc, env JSON, or admin UI).
- **Family check-in kiosk mode** (slice B). The check-in app currently runs as a kiosk at the Ashram entry. When ported into the portal in slice B, it needs a route guard or kiosk mode so it remains appropriate for that use case.
- **Cron jobs and webhooks** (slices B and C). Family check-in has a Saturday roster cache refresh; events has a Stripe payment-status webhook. These coexist in one Next app from slice C onward and need consolidated config in `vercel.json`.
- **Tailwind v4 upgrade** (future slice). Locked at v3.4 in slice A.
- **`vercel.ts` migration** (future slice). Uses `vercel.json` in slice A.
- **Mobile app architecture** (post-slice-D). Phase 2 of the prototype roadmap. Slice A's `@cmt/shared-domain` package is designed to be one half of the answer; the other half is decided when mobile is scoped.
