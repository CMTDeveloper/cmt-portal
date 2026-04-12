# Slice A — Portal Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a Turborepo containing one Next.js 16 app (`apps/portal`) and four shared packages (`@cmt/ui`, `@cmt/firebase-shared`, `@cmt/shared-domain`, `@cmt/config`), deployable to `cmt-portal.vercel.app`, with the six structural disciplines from the spec enforced from day one.

**Architecture:** Single monolithic Next.js application containing all features as internal route segments (no multi-app monorepo). Cross-feature imports lint-forbidden via `eslint-plugin-boundaries`. Brand identity (navy/teal palette, Merriweather + Inter fonts) baked into `@cmt/ui` and consumed by `apps/portal`. Empty `apps/portal/src/features/` directory, two placeholder routes (`/events`, `/check-in`) ready to be replaced by slices B and C.

**Tech Stack:** Node 22 LTS, pnpm 9.15, Turborepo 2, Next.js 16.2, React 19.2, TypeScript 5 strict, Tailwind v3.4, Vitest 4, ESLint 9 flat config, shadcn/ui components, Firebase 12/13 SDKs, Zod 3.

**Spec:** `docs/superpowers/specs/2026-04-12-slice-a-portal-scaffold-design.md`

---

## Pre-flight notes

The repo has already been initialized. Two commits exist on `main`:
- `facb92c` — initial design spec
- `af7bb69` — spec self-review fix

The local git config is already set to `CMT Developer <developer@chinmayatoronto.org>` (set during brainstorming). Verify before starting:

```sh
cd /Users/dineshmatta/projects/chinmaya-mission-portal
git config user.name && git config user.email
```

Expected: `CMT Developer` and `developer@chinmayatoronto.org`. If not set, run:

```sh
git config user.name "CMT Developer"
git config user.email "developer@chinmayatoronto.org"
```

**Working directory for all tasks:** `/Users/dineshmatta/projects/chinmaya-mission-portal`

**Branching:** Each task in this plan is its own commit on a single feature branch `slice-a/scaffold`. Create it now:

```sh
git checkout -b slice-a/scaffold
```

The branch is squash-merged or rebased onto `main` at the end after CI passes.

---

## File structure overview

The plan creates these files in this rough order. Each task below specifies its own file list. This map exists so the engineer can hold the whole shape in mind.

```
chinmaya-mission-portal/
├── .nvmrc                                 [Task 1]
├── .prettierrc                            [Task 1]
├── .env.example                           [Task 1]
├── package.json                           [Task 1]
├── pnpm-workspace.yaml                    [Task 1]
├── turbo.json                             [Task 1]
├── .github/workflows/ci.yml               [Task 19]
├── README.md                              [Task 18]
├── CLAUDE.md                              [Task 18]
│
├── packages/
│   ├── config/                            [Task 2]
│   │   ├── package.json
│   │   ├── tsconfig.base.json
│   │   ├── tsconfig.next.json
│   │   ├── eslint.config.js
│   │   ├── tailwind.preset.ts
│   │   ├── prettier.config.js
│   │   └── README.md
│   │
│   ├── shared-domain/                     [Task 3]
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types/.gitkeep
│   │       ├── schemas/.gitkeep
│   │       ├── utils/.gitkeep
│   │       └── __tests__/index.test.ts
│   │
│   ├── firebase-shared/                   [Task 4]
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── env.ts
│   │       ├── admin.ts
│   │       ├── client.ts
│   │       └── __tests__/
│   │           ├── env.test.ts
│   │           └── admin.test.ts
│   │
│   └── ui/                                [Tasks 5, 6, 7]
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── components.json
│       ├── README.md
│       └── src/
│           ├── index.ts
│           ├── lib/cn.ts
│           ├── styles/tokens.css
│           ├── error-fallback.tsx
│           ├── components/
│           │   ├── button.tsx
│           │   ├── card.tsx
│           │   ├── input.tsx
│           │   ├── label.tsx
│           │   ├── form.tsx
│           │   ├── dialog.tsx
│           │   ├── sheet.tsx
│           │   ├── sonner.tsx
│           │   ├── alert.tsx
│           │   ├── skeleton.tsx
│           │   ├── avatar.tsx
│           │   └── separator.tsx
│           └── __tests__/
│               ├── button.test.tsx
│               └── card.test.tsx
│
└── apps/
    └── portal/                            [Tasks 8–17]
        ├── package.json                   [Task 8]
        ├── tsconfig.json                  [Task 8]
        ├── next.config.ts                 [Task 8]
        ├── tailwind.config.ts             [Task 8]
        ├── postcss.config.js              [Task 8]
        ├── vitest.config.ts               [Task 8]
        ├── vitest.setup.ts                [Task 8]
        ├── vercel.json                    [Task 8]
        ├── public/
        │   ├── cmt-logo.png               [Task 11]
        │   └── favicon.ico                [Task 11]
        └── src/
            ├── app/
            │   ├── globals.css            [Task 9]
            │   ├── layout.tsx             [Task 13]
            │   ├── page.tsx               [Task 14]
            │   ├── error.tsx              [Task 17]
            │   ├── global-error.tsx       [Task 17]
            │   ├── not-found.tsx          [Task 17]
            │   ├── __tests__/page.test.tsx [Task 14]
            │   ├── events/
            │   │   ├── page.tsx           [Task 15]
            │   │   ├── error.tsx          [Task 17]
            │   │   └── __tests__/page.test.tsx [Task 15]
            │   └── check-in/
            │       ├── page.tsx           [Task 16]
            │       ├── error.tsx          [Task 17]
            │       └── __tests__/page.test.tsx [Task 16]
            ├── components/
            │   ├── coming-soon.tsx        [Task 14]
            │   └── chrome/
            │       ├── header.tsx         [Task 12]
            │       ├── footer.tsx         [Task 12]
            │       └── nav.tsx            [Task 12]
            ├── features/
            │   └── .gitkeep               [Task 8]
            └── lib/
                └── flags.ts               [Task 10]
```

**Total file count:** ~70 files. Each task lists its own subset.

---

## Task 1: Workspace foundation

**Files:**
- Create: `.nvmrc`
- Create: `.prettierrc`
- Create: `.env.example`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`

This task lays down the bare-minimum monorepo metadata so subsequent tasks can `pnpm install` and have something to work with. No app code or package code yet.

- [ ] **Step 1: Create `.nvmrc`**

```
22
```

Pin Node 22 LTS for everyone using `nvm` or `fnm`.

- [ ] **Step 2: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

Standalone for now; `@cmt/config/prettier.config.js` will land in Task 2 and the root file can be migrated to extend it later if desired.

- [ ] **Step 3: Create `.env.example`**

```
# Feature flags (slice A)
NEXT_PUBLIC_FEATURE_EVENTS=false
NEXT_PUBLIC_FEATURE_CHECK_IN=false

# Firebase (slice B/C — not required for slice A)
# FIREBASE_PROJECT_ID=
# FIREBASE_CLIENT_EMAIL=
# FIREBASE_PRIVATE_KEY=
# FIREBASE_DATABASE_URL=
# NEXT_PUBLIC_FIREBASE_API_KEY=
# NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
# NEXT_PUBLIC_FIREBASE_PROJECT_ID=
# NEXT_PUBLIC_FIREBASE_DATABASE_URL=

# Stripe (slice C — not required for slice A)
# STRIPE_API_KEY=
# STRIPE_CHECKOUT_URL=
# WEBHOOK_API_KEY=
```

Documents the full eventual env surface so future slices have a checklist.

- [ ] **Step 4: Create root `package.json`**

```json
{
  "name": "cmt-portal",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "format": "prettier --write \"**/*.{ts,tsx,md,json,css}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,md,json,css}\""
  },
  "devDependencies": {
    "turbo": "^2.3.3",
    "typescript": "^5.7.2",
    "prettier": "^3.4.2",
    "@types/node": "^22.10.5"
  }
}
```

The `packageManager` field is read by Corepack and pins the pnpm version for everyone.

- [ ] **Step 5: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 6: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    }
  }
}
```

`^build` means "build all upstream workspace dependencies first" — needed because consumers of `@cmt/ui` etc. need those packages built.

- [ ] **Step 7: Run `pnpm install` to generate lockfile**

```sh
pnpm install
```

Expected: `pnpm install` completes successfully, creates `pnpm-lock.yaml` and a top-level `node_modules/` symlink. No packages to install yet aside from the four root devDeps.

- [ ] **Step 8: Verify the lockfile and node_modules exist**

```sh
ls pnpm-lock.yaml node_modules
```

Expected: both exist.

- [ ] **Step 9: Commit**

```sh
git add .nvmrc .prettierrc .env.example package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml
git commit -m "chore: scaffold workspace foundation (pnpm + turborepo)"
```

---

## Task 2: `@cmt/config` package

**Files:**
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.base.json`
- Create: `packages/config/tsconfig.next.json`
- Create: `packages/config/eslint.config.js`
- Create: `packages/config/tailwind.preset.ts`
- Create: `packages/config/prettier.config.js`
- Create: `packages/config/README.md`

The shared configuration package. Other packages and the portal app extend these files instead of duplicating settings.

- [ ] **Step 1: Create `packages/config/package.json`**

```json
{
  "name": "@cmt/config",
  "version": "0.0.0",
  "private": true,
  "main": "./eslint.config.js",
  "exports": {
    "./eslint": "./eslint.config.js",
    "./prettier": "./prettier.config.js",
    "./tailwind": "./tailwind.preset.ts",
    "./tsconfig.base": "./tsconfig.base.json",
    "./tsconfig.next": "./tsconfig.next.json"
  },
  "dependencies": {
    "@typescript-eslint/eslint-plugin": "^8.19.0",
    "@typescript-eslint/parser": "^8.19.0",
    "eslint": "^9.17.0",
    "eslint-config-next": "^16.2.0",
    "eslint-plugin-boundaries": "^5.0.1",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 2: Create `packages/config/tsconfig.base.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,

    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,

    "jsx": "react-jsx"
  },
  "exclude": ["node_modules", "dist", ".next", "coverage"]
}
```

Strict + the three "extra strict" flags from the spec (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, plus we add `noImplicitOverride` and `noFallthroughCasesInSwitch` as cheap wins).

- [ ] **Step 3: Create `packages/config/tsconfig.next.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  }
}
```

The Next.js extension. `noEmit: true` because Next handles compilation.

- [ ] **Step 4: Create `packages/config/eslint.config.js`**

```js
import nextPlugin from 'eslint-config-next';
import boundariesPlugin from 'eslint-plugin-boundaries';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      boundaries: boundariesPlugin,
    },
    settings: {
      'boundaries/elements': [
        {
          type: 'feature',
          pattern: 'apps/portal/src/features/*',
          mode: 'folder',
        },
        {
          type: 'shared-pkg',
          pattern: 'packages/*',
          mode: 'folder',
        },
        {
          type: 'app-shell',
          pattern: 'apps/portal/src/{app,components,lib}/**',
        },
      ],
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: 'feature',
              disallow: ['feature'],
              message:
                'Cross-feature imports forbidden — go through @cmt/shared-domain or @cmt/ui',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/shared-domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: '@cmt/shared-domain must not depend on React' },
            { name: 'react-dom', message: '@cmt/shared-domain must not depend on React' },
          ],
          patterns: [
            { group: ['next/*'], message: '@cmt/shared-domain must not depend on Next.js' },
            { group: ['@radix-ui/*'], message: '@cmt/shared-domain must not depend on UI libs' },
          ],
        },
      ],
    },
  },
];
```

Two scoped sections: the global rules (boundaries enforcement) and a `shared-domain`-only section that physically forbids React/Next/Radix imports — this is discipline 2's enforcement.

**Note:** Verify the exact `eslint-plugin-boundaries` v5 API at implementation time by reading https://github.com/javierbrea/eslint-plugin-boundaries — the rule shape may have shifted between v4 and v5. The intent here is correct but the exact field names should be checked.

- [ ] **Step 5: Create `packages/config/tailwind.preset.ts`**

```ts
import type { Config } from 'tailwindcss';

const preset: Partial<Config> = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        heading: 'hsl(var(--heading))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};

export default preset;
```

**Note the `card` and `popover` extensions:** the spec only lists 7 brand color tokens but the shadcn Card component uses `bg-card text-card-foreground` and Popover/Dialog use `bg-popover text-popover-foreground`. These are added to keep the lifted shadcn components rendering correctly. The CSS variables themselves are defined in `apps/portal/src/app/globals.css` (Task 9) — they default to the same values as `background`/`foreground`.

- [ ] **Step 6: Create `packages/config/prettier.config.js`**

```js
/** @type {import('prettier').Config} */
export default {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
};
```

- [ ] **Step 7: Create `packages/config/README.md`**

```markdown
# @cmt/config

Workspace-only shared configuration. Consumed by every other package and `apps/portal`.

## What's here

- `tsconfig.base.json` — strict TypeScript baseline (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- `tsconfig.next.json` — Next.js extension of the base
- `eslint.config.js` — flat config with `eslint-plugin-boundaries` for feature-isolation enforcement
- `tailwind.preset.ts` — base Tailwind config wired to CSS-variable brand tokens
- `prettier.config.js` — formatting rules

## How packages consume it

```json
{
  "extends": "@cmt/config/tsconfig.next"
}
```

```js
// apps/portal/tailwind.config.ts
import preset from '@cmt/config/tailwind';
export default { presets: [preset], content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'] };
```
```

- [ ] **Step 8: Install the deps**

```sh
pnpm install
```

Expected: pnpm reads the new `packages/config/package.json`, installs the listed deps into the workspace, updates `pnpm-lock.yaml`.

- [ ] **Step 9: Commit**

```sh
git add packages/config pnpm-lock.yaml
git commit -m "feat(config): add @cmt/config shared workspace configuration"
```

---

## Task 3: `@cmt/shared-domain` package

**Files:**
- Create: `packages/shared-domain/package.json`
- Create: `packages/shared-domain/tsconfig.json`
- Create: `packages/shared-domain/vitest.config.ts`
- Create: `packages/shared-domain/src/index.ts`
- Create: `packages/shared-domain/src/types/.gitkeep`
- Create: `packages/shared-domain/src/schemas/.gitkeep`
- Create: `packages/shared-domain/src/utils/.gitkeep`
- Test: `packages/shared-domain/src/__tests__/index.test.ts`

The pure-TypeScript domain layer. Empty in slice A; placeholder structure plus a smoke test that proves the package builds and exports a barrel.

- [ ] **Step 1: Create `packages/shared-domain/package.json`**

```json
{
  "name": "@cmt/shared-domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc --noEmit",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@cmt/config": "workspace:*",
    "vitest": "^4.1.2",
    "typescript": "^5.7.2"
  }
}
```

`main` and `types` point at source `.ts` for slice A — Next's `transpilePackages` setting (Task 8) handles compilation. No build step needed.

- [ ] **Step 2: Create `packages/shared-domain/tsconfig.json`**

```json
{
  "extends": "@cmt/config/tsconfig.base",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/shared-domain/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 4: Create the empty subdirectory placeholders**

```sh
mkdir -p packages/shared-domain/src/types
mkdir -p packages/shared-domain/src/schemas
mkdir -p packages/shared-domain/src/utils
touch packages/shared-domain/src/types/.gitkeep
touch packages/shared-domain/src/schemas/.gitkeep
touch packages/shared-domain/src/utils/.gitkeep
```

These exist so the directory structure communicates intent even though there are no files yet.

- [ ] **Step 5: Write the failing smoke test**

```ts
// packages/shared-domain/src/__tests__/index.test.ts
import { describe, it, expect } from 'vitest';
import * as sharedDomain from '../index';

describe('@cmt/shared-domain', () => {
  it('exports a barrel that loads without throwing', () => {
    expect(sharedDomain).toBeDefined();
  });

  it('is empty in slice A (no exports yet)', () => {
    expect(Object.keys(sharedDomain)).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```sh
cd packages/shared-domain && pnpm test
```

Expected: FAIL — `Cannot find module '../index'` or similar (because `src/index.ts` doesn't exist yet).

- [ ] **Step 7: Create the empty barrel**

```ts
// packages/shared-domain/src/index.ts
// Slice A: empty barrel.
// Slice B/C populate this with re-exports from ./types, ./schemas, ./utils.
export {};
```

- [ ] **Step 8: Run the test to verify it passes**

```sh
pnpm test
```

Expected: PASS — both tests green.

- [ ] **Step 9: Commit**

```sh
cd ../..
git add packages/shared-domain pnpm-lock.yaml
git commit -m "feat(shared-domain): scaffold @cmt/shared-domain package skeleton"
```

---

## Task 4: `@cmt/firebase-shared` package

**Files:**
- Create: `packages/firebase-shared/package.json`
- Create: `packages/firebase-shared/tsconfig.json`
- Create: `packages/firebase-shared/vitest.config.ts`
- Create: `packages/firebase-shared/src/index.ts`
- Create: `packages/firebase-shared/src/env.ts`
- Create: `packages/firebase-shared/src/admin.ts`
- Create: `packages/firebase-shared/src/client.ts`
- Test: `packages/firebase-shared/src/__tests__/env.test.ts`
- Test: `packages/firebase-shared/src/__tests__/admin.test.ts`

The single-source-of-truth for Firebase SDK initialization. Two entry points: `/admin` (server) and `/client` (browser). Slice A only verifies env validation works and that admin init returns a valid app object given mock env vars — no actual network calls.

- [ ] **Step 1: Create `packages/firebase-shared/package.json`**

```json
{
  "name": "@cmt/firebase-shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./admin": {
      "types": "./src/admin.ts",
      "default": "./src/admin.ts"
    },
    "./client": {
      "types": "./src/client.ts",
      "default": "./src/client.ts"
    }
  },
  "scripts": {
    "build": "tsc --noEmit",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "firebase": "^12.0.0",
    "firebase-admin": "^13.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@cmt/config": "workspace:*",
    "vitest": "^4.1.2",
    "typescript": "^5.7.2"
  }
}
```

The `exports` field with subpath conditions is what enforces "import `/admin` for server, `/client` for browser, never both in one file".

- [ ] **Step 2: Create `packages/firebase-shared/tsconfig.json`**

```json
{
  "extends": "@cmt/config/tsconfig.base",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/firebase-shared/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 4: Write the failing env test**

```ts
// packages/firebase-shared/src/__tests__/env.test.ts
import { describe, it, expect } from 'vitest';
import { adminEnvSchema, clientEnvSchema } from '../env';

describe('adminEnvSchema', () => {
  it('accepts a fully-populated admin env', () => {
    const result = adminEnvSchema.safeParse({
      FIREBASE_PROJECT_ID: 'chinmaya-setu-715b8',
      FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----',
      FIREBASE_DATABASE_URL: 'https://chinmaya-setu-715b8.firebaseio.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing FIREBASE_PROJECT_ID', () => {
    const result = adminEnvSchema.safeParse({
      FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'fake',
      FIREBASE_DATABASE_URL: 'https://example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed FIREBASE_DATABASE_URL', () => {
    const result = adminEnvSchema.safeParse({
      FIREBASE_PROJECT_ID: 'p',
      FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'fake',
      FIREBASE_DATABASE_URL: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

describe('clientEnvSchema', () => {
  it('accepts a fully-populated client env', () => {
    const result = clientEnvSchema.safeParse({
      NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSyExample',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'chinmaya-setu-715b8.firebaseapp.com',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'chinmaya-setu-715b8',
      NEXT_PUBLIC_FIREBASE_DATABASE_URL: 'https://chinmaya-setu-715b8.firebaseio.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing NEXT_PUBLIC_FIREBASE_PROJECT_ID', () => {
    const result = clientEnvSchema.safeParse({
      NEXT_PUBLIC_FIREBASE_API_KEY: 'k',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'd.firebaseapp.com',
      NEXT_PUBLIC_FIREBASE_DATABASE_URL: 'https://example.com',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 5: Run the env test to verify it fails**

```sh
cd packages/firebase-shared && pnpm test
```

Expected: FAIL — `Cannot find module '../env'`.

- [ ] **Step 6: Implement `packages/firebase-shared/src/env.ts`**

```ts
import { z } from 'zod';

export const adminEnvSchema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  FIREBASE_DATABASE_URL: z.string().url(),
});

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_DATABASE_URL: z.string().url(),
});

export type AdminEnv = z.infer<typeof adminEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function readAdminEnv(): AdminEnv {
  const parsed = adminEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `[firebase-shared] Missing or invalid Firebase admin env vars: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export function readClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_DATABASE_URL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });
  if (!parsed.success) {
    throw new Error(
      `[firebase-shared] Missing or invalid Firebase client env vars: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
```

- [ ] **Step 7: Run env tests, verify they pass**

```sh
pnpm test -- env.test
```

Expected: PASS — all 5 env tests green.

- [ ] **Step 8: Write the failing admin test**

```ts
// packages/firebase-shared/src/__tests__/admin.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const VALID_ENV = {
  FIREBASE_PROJECT_ID: 'chinmaya-setu-715b8-test',
  FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ\\n-----END PRIVATE KEY-----',
  FIREBASE_DATABASE_URL: 'https://chinmaya-setu-715b8-test.firebaseio.com',
};

describe('getAdminApp', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    Object.assign(process.env, VALID_ENV);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a Firebase app instance when env vars are valid', async () => {
    const { getAdminApp } = await import('../admin');
    const app = getAdminApp();
    expect(app).toBeDefined();
    expect(app.name).toBeDefined();
  });

  it('throws when FIREBASE_PROJECT_ID is missing', async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    const { getAdminApp } = await import('../admin');
    expect(() => getAdminApp()).toThrow(/Missing or invalid Firebase admin env vars/);
  });

  it('memoizes the app instance across calls', async () => {
    const { getAdminApp } = await import('../admin');
    const a = getAdminApp();
    const b = getAdminApp();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 9: Run admin test, verify it fails**

```sh
pnpm test -- admin.test
```

Expected: FAIL — `Cannot find module '../admin'`.

- [ ] **Step 10: Implement `packages/firebase-shared/src/admin.ts`**

```ts
import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getDatabase, type Database } from 'firebase-admin/database';
import { readAdminEnv } from './env';

let cachedApp: App | undefined;

export function getAdminApp(): App {
  if (cachedApp) return cachedApp;

  const env = readAdminEnv();
  const existing = getApps().find((a) => a.name === '[DEFAULT]');
  if (existing) {
    cachedApp = existing;
    return cachedApp;
  }

  cachedApp = initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // Private keys can have escaped newlines from env files; restore them.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    databaseURL: env.FIREBASE_DATABASE_URL,
  });

  return cachedApp;
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminDatabase(): Database {
  return getDatabase(getAdminApp());
}
```

The `replace(/\\n/g, '\n')` handles the common case where `FIREBASE_PRIVATE_KEY` is stored in an env file with literal `\n` escapes that need to become real newlines for the JWT signer.

**Verify against firebase-admin v13 docs** at implementation time: https://firebase.google.com/docs/admin/setup

- [ ] **Step 11: Run admin test, verify it passes**

```sh
pnpm test -- admin.test
```

Expected: PASS — all 3 admin tests green. Note: the memoization test relies on Vitest module caching; if it fails, swap to using `vi.resetModules()` between calls.

- [ ] **Step 12: Implement `packages/firebase-shared/src/client.ts`**

```ts
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getDatabase, type Database } from 'firebase/database';
import { readClientEnv } from './env';

let cachedApp: FirebaseApp | undefined;

export function getClientApp(): FirebaseApp {
  if (cachedApp) return cachedApp;

  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return cachedApp;
  }

  const env = readClientEnv();
  cachedApp = initializeApp({
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    databaseURL: env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });

  return cachedApp;
}

export function getClientAuth(): Auth {
  return getAuth(getClientApp());
}

export function getClientFirestore(): Firestore {
  return getFirestore(getClientApp());
}

export function getClientDatabase(): Database {
  return getDatabase(getClientApp());
}
```

No tests for `client.ts` in slice A — it requires a browser-like environment to instantiate, and slice A's smoke test discipline says "no network, no browser bootstrapping". The contract is identical to `admin.ts` and is exercised in slices B/C when feature code consumes it.

- [ ] **Step 13: Implement `packages/firebase-shared/src/index.ts`**

```ts
// Type-only re-exports. Runtime imports must use /admin or /client subpaths.
export type { AdminEnv, ClientEnv } from './env';
```

- [ ] **Step 14: Run all firebase-shared tests**

```sh
pnpm test
```

Expected: PASS — env tests (5) + admin tests (3) = 8 tests in this package.

- [ ] **Step 15: Commit**

```sh
cd ../..
git add packages/firebase-shared pnpm-lock.yaml
git commit -m "feat(firebase-shared): add @cmt/firebase-shared with admin and client entries"
```

---

## Task 5: `@cmt/ui` package skeleton

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/components.json`
- Create: `packages/ui/README.md`
- Create: `packages/ui/src/index.ts` (will be expanded in Task 6)
- Create: `packages/ui/src/lib/cn.ts`
- Create: `packages/ui/src/styles/tokens.css`
- Create: `packages/ui/src/error-fallback.tsx`

The UI package skeleton — no shadcn components yet (those land in Task 6), but everything else needed for those components to drop in cleanly.

- [ ] **Step 1: Create `packages/ui/package.json`**

```json
{
  "name": "@cmt/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./styles/tokens.css": "./src/styles/tokens.css",
    "./lib/cn": {
      "types": "./src/lib/cn.ts",
      "default": "./src/lib/cn.ts"
    }
  },
  "scripts": {
    "build": "tsc --noEmit",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@radix-ui/react-avatar": "^1.1.2",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-label": "^2.1.1",
    "@radix-ui/react-separator": "^1.1.1",
    "@radix-ui/react-slot": "^1.1.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.469.0",
    "react-hook-form": "^7.54.2",
    "@hookform/resolvers": "^3.10.0",
    "sonner": "^1.7.1",
    "tailwind-merge": "^2.6.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@cmt/config": "workspace:*",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.7",
    "@types/react-dom": "^19.0.3",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^26.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vitest": "^4.1.2"
  }
}
```

Radix dependencies are listed per-component as the components need them. Verify exact Radix package names against the Setu component imports during Task 6 — if a component imports `@radix-ui/react-X` not in this list, add it.

- [ ] **Step 2: Create `packages/ui/tsconfig.json`**

```json
{
  "extends": "@cmt/config/tsconfig.base",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/ui/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 4: Create `packages/ui/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "../../apps/portal/tailwind.config.ts",
    "css": "src/styles/tokens.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@cmt/ui/components",
    "utils": "@cmt/ui/lib/cn",
    "ui": "@cmt/ui/components"
  }
}
```

Future `pnpm dlx shadcn add <component>` invocations from inside `packages/ui/` use this config and write components into `src/components/`.

- [ ] **Step 5: Create `packages/ui/src/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

The class-merge utility every shadcn component uses. Lifted shadcn components import this as `cn`; the import path in their copies will be rewritten in Task 6 from `@/lib/utils` to a relative path.

- [ ] **Step 6: Create `packages/ui/src/styles/tokens.css`**

```css
@layer base {
  :root {
    /* CMT brand — mined from chinmayatoronto.org */
    --background: 0 0% 100%;
    --foreground: 205 38% 30%;

    /* Card and popover use background/foreground by default in slice A.
       The shadcn Card and Dialog components reference these. */
    --card: 0 0% 100%;
    --card-foreground: 205 38% 30%;
    --popover: 0 0% 100%;
    --popover-foreground: 205 38% 30%;

    --primary: 192 44% 23%;             /* #214a54 navy/teal */
    --primary-foreground: 0 0% 100%;

    --secondary: 177 51% 79%;           /* #b3e1de light teal */
    --secondary-foreground: 192 44% 23%;

    --accent: 35 95% 67%;               /* #fbb559 warm gold */
    --accent-foreground: 192 44% 23%;

    --muted: 50 21% 95%;                /* #f5f4f0 warm beige */
    --muted-foreground: 0 0% 44%;

    --heading: 200 36% 32%;             /* #335b70 deeper teal-gray */

    --border: 50 21% 90%;
    --input: 50 21% 90%;
    --ring: 192 44% 23%;

    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 98%;

    --radius: 0.5rem;
  }
}
```

- [ ] **Step 7: Create `packages/ui/src/error-fallback.tsx`**

```tsx
'use client';

import * as React from 'react';

interface ErrorFallbackProps {
  error: Error & { digest?: string };
  reset: () => void;
  feature?: string;
}

export function ErrorFallback({ error, reset, feature }: ErrorFallbackProps) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[ErrorFallback]', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="container mx-auto flex min-h-[40vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 py-16 text-center"
    >
      <h2 className="font-serif text-2xl text-heading">
        {feature ? `Something went wrong in ${feature}` : 'Something went wrong'}
      </h2>
      <p className="text-muted-foreground">
        We hit an unexpected error. The rest of the portal is still working — you can try this
        section again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground transition hover:bg-primary/90"
      >
        Try again
      </button>
      {error.digest && <p className="text-xs text-muted-foreground">Error ID: {error.digest}</p>}
    </div>
  );
}
```

The shared error UI rendered by every `error.tsx` segment file (Task 17). Has its own minimal Tailwind classes — does not depend on the Button component being lifted yet.

- [ ] **Step 8: Create the initial `packages/ui/src/index.ts`** (will be expanded in Task 6)

```ts
export { cn } from './lib/cn';
export { ErrorFallback } from './error-fallback';
// Component exports are added in Task 6.
```

- [ ] **Step 9: Create `packages/ui/README.md`**

```markdown
# @cmt/ui

CMT design system. Built on shadcn/ui (Radix Primitives + Tailwind), themed with CMT brand tokens.

## Public surface

- 12 shadcn components — `Button`, `Card`, `Input`, `Label`, `Form`, `Dialog`, `Sheet`, `Sonner`, `Alert`, `Skeleton`, `Avatar`, `Separator`
- `<ErrorFallback />` — shared error UI consumed by all `error.tsx` segments in `apps/portal`
- `cn()` — Tailwind class merge utility
- `styles/tokens.css` — CMT brand variables in HSL format

## Adding a new component

We use the shadcn CLI but configured to land components in this package, not in the consuming app:

```sh
cd packages/ui
pnpm dlx shadcn add <component-name>
```

The CLI reads `components.json`, downloads the upstream component, and writes it into `src/components/`. **After every `add`:**

1. Open the new file and verify the import for `cn` is correct (`'../lib/cn'`, NOT `'@/lib/utils'`)
2. Add an export to `src/index.ts`
3. Note the upstream commit hash in the PR description for drift auditing later

## Manual upgrade discipline

The shadcn model is "you own the source". Component bug fixes upstream do NOT arrive via dependency upgrade — they have to be re-applied manually. To manage drift:

- Run `pnpm dlx shadcn diff` quarterly to see what's changed upstream
- Apply only the fixes that matter; document any local divergences in this README
- Each new component PR must paste the upstream commit hash so future audits can compare

## Token theming

Colors are HSL CSS variables in `styles/tokens.css`. To rebrand, edit that file — every component picks up the change automatically because they reference `hsl(var(--primary))` etc. via the Tailwind preset in `@cmt/config/tailwind`.
```

- [ ] **Step 10: Install deps**

```sh
pnpm install
```

Expected: pnpm installs all the new Radix, react-hook-form, sonner, etc. dependencies.

- [ ] **Step 11: Commit**

```sh
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): scaffold @cmt/ui package with tokens, cn util, and ErrorFallback"
```

---

## Task 6: Lift 12 shadcn components from `chinmaya-setu` into `@cmt/ui`

**Files (created):**
- `packages/ui/src/components/button.tsx`
- `packages/ui/src/components/card.tsx`
- `packages/ui/src/components/input.tsx`
- `packages/ui/src/components/label.tsx`
- `packages/ui/src/components/form.tsx`
- `packages/ui/src/components/dialog.tsx`
- `packages/ui/src/components/sheet.tsx`
- `packages/ui/src/components/sonner.tsx`
- `packages/ui/src/components/alert.tsx`
- `packages/ui/src/components/skeleton.tsx`
- `packages/ui/src/components/avatar.tsx`
- `packages/ui/src/components/separator.tsx`

**Files (modified):**
- `packages/ui/src/index.ts` (add exports for all 12)

The 12 components live at `/Users/dineshmatta/projects/chinmaya-setu/components/ui/<name>.tsx`. Each is lifted as-is, with one mechanical edit: the import path for `cn` is rewritten from `@/lib/utils` (the Setu alias) to `../lib/cn` (our package-relative path).

**General copy procedure** (apply to every component below):

1. `cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/<name>.tsx packages/ui/src/components/<name>.tsx`
2. Open the file and replace `import { cn } from "@/lib/utils"` with `import { cn } from "../lib/cn"`
3. If the file imports any other Setu-aliased path (`@/components/...`, `@/hooks/...`), replace with the correct relative path or remove if unused
4. If the file imports a Radix package not in `packages/ui/package.json`, add the package to `dependencies` (e.g., `@radix-ui/react-slot` for Button — already listed)
5. Verify the file compiles: `cd packages/ui && pnpm typecheck`
6. Add a re-export to `src/index.ts`

- [ ] **Step 1: Copy `button.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/button.tsx packages/ui/src/components/button.tsx
```

Open `packages/ui/src/components/button.tsx` and replace the import line:

```diff
- import { cn } from "@/lib/utils"
+ import { cn } from "../lib/cn"
```

The Button uses `@radix-ui/react-slot` and `class-variance-authority` — both already in dependencies.

- [ ] **Step 2: Copy `card.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/card.tsx packages/ui/src/components/card.tsx
```

Replace `@/lib/utils` → `../lib/cn`. Card has no Radix imports.

- [ ] **Step 3: Copy `input.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/input.tsx packages/ui/src/components/input.tsx
```

Replace `@/lib/utils` → `../lib/cn`.

- [ ] **Step 4: Copy `label.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/label.tsx packages/ui/src/components/label.tsx
```

Replace `@/lib/utils` → `../lib/cn`. Uses `@radix-ui/react-label` (already in deps).

- [ ] **Step 5: Copy `form.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/form.tsx packages/ui/src/components/form.tsx
```

Replace `@/lib/utils` → `../lib/cn`.

The Form component imports from `@/components/ui/label` (the local Label component). Replace this import with:

```diff
- import { Label } from "@/components/ui/label"
+ import { Label } from "./label"
```

Form uses `react-hook-form` and `@hookform/resolvers` — both already in deps.

- [ ] **Step 6: Copy `dialog.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/dialog.tsx packages/ui/src/components/dialog.tsx
```

Replace `@/lib/utils` → `../lib/cn`. Uses `@radix-ui/react-dialog` (already in deps) and `lucide-react` for the close icon (already in deps).

- [ ] **Step 7: Copy `sheet.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/sheet.tsx packages/ui/src/components/sheet.tsx
```

Replace `@/lib/utils` → `../lib/cn`. Sheet is built on `@radix-ui/react-dialog` (same package, different presentation) — already in deps. Uses `class-variance-authority` and `lucide-react`.

- [ ] **Step 8: Copy `sonner.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/sonner.tsx packages/ui/src/components/sonner.tsx
```

This is the Toaster wrapper around the `sonner` library. Replace `@/lib/utils` → `../lib/cn` if it imports `cn`. Sonner is in deps.

The Sonner component may use `useTheme` from `next-themes`. We are NOT using next-themes in slice A. If the file imports it, replace the theme detection with a hardcoded `theme="light"` prop on the Toaster:

```diff
- import { useTheme } from "next-themes"
- ...
- const { theme = "system" } = useTheme()
- return <Sonner theme={theme as ToasterProps["theme"]} ... />
+ return <Sonner theme="light" ... />
```

- [ ] **Step 9: Copy `alert.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/alert.tsx packages/ui/src/components/alert.tsx
```

Replace `@/lib/utils` → `../lib/cn`. Uses `class-variance-authority`.

- [ ] **Step 10: Copy `skeleton.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/skeleton.tsx packages/ui/src/components/skeleton.tsx
```

Replace `@/lib/utils` → `../lib/cn`. No external deps.

- [ ] **Step 11: Copy `avatar.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/avatar.tsx packages/ui/src/components/avatar.tsx
```

Replace `@/lib/utils` → `../lib/cn`. Uses `@radix-ui/react-avatar` (already in deps).

- [ ] **Step 12: Copy `separator.tsx`**

```sh
cp /Users/dineshmatta/projects/chinmaya-setu/components/ui/separator.tsx packages/ui/src/components/separator.tsx
```

Replace `@/lib/utils` → `../lib/cn`. Uses `@radix-ui/react-separator` (already in deps).

- [ ] **Step 13: Update `packages/ui/src/index.ts` to export everything**

```ts
// packages/ui/src/index.ts
export { cn } from './lib/cn';
export { ErrorFallback } from './error-fallback';

export { Button, buttonVariants } from './components/button';
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from './components/card';
export { Input } from './components/input';
export { Label } from './components/label';
export {
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
  useFormField,
} from './components/form';
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './components/dialog';
export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from './components/sheet';
export { Toaster } from './components/sonner';
export { Alert, AlertTitle, AlertDescription } from './components/alert';
export { Skeleton } from './components/skeleton';
export { Avatar, AvatarImage, AvatarFallback } from './components/avatar';
export { Separator } from './components/separator';
```

**Verify against actual file contents:** Some Setu component files may export slightly different names. After Step 12, open each component file and confirm the exported names match what `index.ts` imports. Fix discrepancies inline.

- [ ] **Step 14: Run typecheck to catch any import or type errors**

```sh
cd packages/ui && pnpm typecheck
```

Expected: PASS. If it fails, the most likely cause is a missed import path rewrite — re-grep for `@/lib/utils` or `@/components/ui/`:

```sh
grep -rn '@/' src/components
```

Should return zero matches.

- [ ] **Step 15: Commit**

```sh
cd ../..
git add packages/ui/src
git commit -m "feat(ui): lift 12 shadcn components from chinmaya-setu prior work"
```

---

## Task 7: `@cmt/ui` smoke tests (Button + Card)

**Files:**
- Test: `packages/ui/src/__tests__/button.test.tsx`
- Test: `packages/ui/src/__tests__/card.test.tsx`

Two smoke tests that verify components render with the brand tokens applied. They prove the package + tokens are wired through.

- [ ] **Step 1: Write the failing Button test**

```tsx
// packages/ui/src/__tests__/button.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../components/button';

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeDefined();
  });

  it('applies the default variant classes (bg-primary)', () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole('button', { name: 'Primary' });
    expect(btn.className).toContain('bg-primary');
    expect(btn.className).toContain('text-primary-foreground');
  });

  it('applies the secondary variant classes when variant=secondary', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const btn = screen.getByRole('button', { name: 'Secondary' });
    expect(btn.className).toContain('bg-secondary');
  });
});
```

- [ ] **Step 2: Run the button test, expect failure**

```sh
cd packages/ui && pnpm test
```

Expected: FAIL — likely because `@testing-library/react` isn't set up yet (no setup file). If it fails for that reason, proceed to Step 3 to add a setup file.

- [ ] **Step 3: Add a Vitest setup file for testing-library** (if needed)

Update `packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

For slice A this is sufficient — no extra `setupFiles` needed because we're not using DOM matchers like `toBeInTheDocument`. If the test still fails, the issue is the `react/jsx-runtime` resolution; verify `@vitejs/plugin-react` is properly transforming JSX.

Re-run:

```sh
pnpm test -- button.test
```

Expected: PASS — all 3 button tests green.

- [ ] **Step 4: Write the failing Card test**

```tsx
// packages/ui/src/__tests__/card.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../components/card';

describe('Card', () => {
  it('composes header, content, and footer', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Hello</CardTitle>
        </CardHeader>
        <CardContent>Body content here</CardContent>
        <CardFooter>Footer text</CardFooter>
      </Card>,
    );

    expect(screen.getByTestId('card')).toBeDefined();
    expect(screen.getByText('Hello')).toBeDefined();
    expect(screen.getByText('Body content here')).toBeDefined();
    expect(screen.getByText('Footer text')).toBeDefined();
  });

  it('applies card background color class', () => {
    render(<Card data-testid="card">contents</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-card');
  });
});
```

- [ ] **Step 5: Run the card test, verify it passes**

```sh
pnpm test -- card.test
```

Expected: PASS — both card tests green.

- [ ] **Step 6: Run all UI tests to confirm both files green**

```sh
pnpm test
```

Expected: 5 tests pass (3 button + 2 card).

- [ ] **Step 7: Commit**

```sh
cd ../..
git add packages/ui
git commit -m "test(ui): add smoke tests for Button and Card with brand tokens"
```

---

## Task 8: `apps/portal` scaffold

**Files:**
- Create: `apps/portal/package.json`
- Create: `apps/portal/tsconfig.json`
- Create: `apps/portal/next.config.ts`
- Create: `apps/portal/tailwind.config.ts`
- Create: `apps/portal/postcss.config.js`
- Create: `apps/portal/vitest.config.ts`
- Create: `apps/portal/vitest.setup.ts`
- Create: `apps/portal/vercel.json`
- Create: `apps/portal/src/features/.gitkeep`

The Next.js app structure — config files, Tailwind setup, Vitest setup. No UI yet (that's Tasks 9–17).

- [ ] **Step 1: Create `apps/portal/package.json`**

```json
{
  "name": "@cmt/portal",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@cmt/firebase-shared": "workspace:*",
    "@cmt/shared-domain": "workspace:*",
    "@cmt/ui": "workspace:*",
    "next": "^16.2.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@cmt/config": "workspace:*",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.10.5",
    "@types/react": "^19.0.7",
    "@types/react-dom": "^19.0.3",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.17.0",
    "eslint-plugin-boundaries": "^5.0.1",
    "jsdom": "^26.0.0",
    "postcss": "^8.5.1",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 2: Create `apps/portal/tsconfig.json`**

```json
{
  "extends": "@cmt/config/tsconfig.next",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules", ".next", "dist", "coverage"]
}
```

- [ ] **Step 3: Create `apps/portal/next.config.ts`**

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Workspace packages must be transpiled because they ship .ts source
  transpilePackages: ['@cmt/ui', '@cmt/shared-domain', '@cmt/firebase-shared'],
};

export default config;
```

- [ ] **Step 4: Create `apps/portal/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';
import preset from '@cmt/config/tailwind';

const config: Config = {
  presets: [preset as Config],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};

export default config;
```

The `content` array includes `packages/ui/src/**` so Tailwind sees the class names used inside the lifted shadcn components and includes them in the final CSS.

- [ ] **Step 5: Create `apps/portal/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create `apps/portal/vitest.config.ts`**

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
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 7: Create `apps/portal/vitest.setup.ts`**

```ts
// Vitest setup for apps/portal.
// Slice A is intentionally minimal — no global mocks, no DOM matchers.
// Slice B/C will add fetch mocks and Firebase emulator hooks here.
```

The empty setup file exists so the import in `vitest.config.ts` resolves and so future slices have a known location.

- [ ] **Step 8: Create `apps/portal/vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs"
}
```

- [ ] **Step 9: Create `apps/portal/src/features/.gitkeep`**

```sh
mkdir -p apps/portal/src/features apps/portal/src/lib apps/portal/src/components/chrome apps/portal/public
touch apps/portal/src/features/.gitkeep
```

Empty features directory exists from day one so the `boundaries` lint rule has a target.

- [ ] **Step 10: Install deps**

```sh
pnpm install
```

Expected: Next.js, React, Tailwind, Vitest, etc. all install.

- [ ] **Step 11: Verify the app's typecheck command works (will pass trivially because there are no source files yet)**

```sh
cd apps/portal && pnpm typecheck
```

Expected: PASS (or "No inputs were found in config file" — both are acceptable at this stage).

- [ ] **Step 12: Commit**

```sh
cd ../..
git add apps/portal pnpm-lock.yaml
git commit -m "feat(portal): scaffold apps/portal Next.js 16 app config"
```

---

## Task 9: `apps/portal` `globals.css` + token import

**Files:**
- Create: `apps/portal/src/app/globals.css`

The CSS entry point. Imports the tokens file from `@cmt/ui` and declares Tailwind directives.

- [ ] **Step 1: Create `apps/portal/src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import '@cmt/ui/styles/tokens.css';

@layer base {
  html {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  body {
    @apply bg-background text-foreground font-sans;
  }

  h1, h2, h3, h4, h5, h6 {
    @apply font-serif text-heading;
  }
}
```

The `@import` pulls the brand variables into scope; the `@layer base` block applies Inter to body and Merriweather to all headings via the CSS variables defined by `next/font/google` in `layout.tsx` (Task 13).

- [ ] **Step 2: Verify CSS file syntax (no execution yet — CSS is loaded by the layout in Task 13)**

```sh
cd apps/portal && cat src/app/globals.css
```

Expected: file contents print correctly.

- [ ] **Step 3: Commit**

```sh
cd ../..
git add apps/portal/src/app/globals.css
git commit -m "feat(portal): add globals.css with Tailwind directives and brand tokens"
```

---

## Task 10: `apps/portal/src/lib/flags.ts`

**Files:**
- Create: `apps/portal/src/lib/flags.ts`

The discipline-5 feature flag reader. Two flags, both default to `false`.

- [ ] **Step 1: Create `apps/portal/src/lib/flags.ts`**

```ts
/**
 * Feature flags for slice A.
 *
 * Both flags default to `false`. Slice B enables `checkIn` after the family
 * check-in port lands and is verified in preview. Slice C enables `events`.
 *
 * To upgrade beyond env-based flags later, swap this module to read a Firestore
 * `config/feature-flags` document with a 60-second in-memory cache. The exported
 * shape stays the same so consumers do not change.
 */

export const flags = {
  events: process.env.NEXT_PUBLIC_FEATURE_EVENTS === 'true',
  checkIn: process.env.NEXT_PUBLIC_FEATURE_CHECK_IN === 'true',
} as const;

export type FeatureFlags = typeof flags;
```

- [ ] **Step 2: Verify it typechecks**

```sh
cd apps/portal && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```sh
cd ../..
git add apps/portal/src/lib/flags.ts
git commit -m "feat(portal): add env-based feature flag reader (discipline 5)"
```

---

## Task 11: Logo and favicon

**Files:**
- Create: `apps/portal/public/cmt-logo.png`
- Create: `apps/portal/public/favicon.ico`

Fetch the CMT logo from the live WordPress site and store it locally so the portal does not depend on the external host.

- [ ] **Step 1: Download the CMT logo**

```sh
curl -L -o apps/portal/public/cmt-logo.png \
  "https://chinmayatoronto.org/wp-content/uploads/2020/05/main_site_logo.png"
```

Expected: a PNG file appears in `apps/portal/public/cmt-logo.png`. Verify with:

```sh
file apps/portal/public/cmt-logo.png
```

Expected output: `apps/portal/public/cmt-logo.png: PNG image data, ...`

If the curl fails or the file is empty, fall back to: open `https://chinmayatoronto.org/` in a browser, right-click the header logo, "Save image as", and place it at the same path.

- [ ] **Step 2: Create a simple `favicon.ico`**

For slice A, use the same logo as the favicon. The simplest approach is to copy the PNG (browsers will accept a PNG named `.ico` but proper conversion is better):

```sh
cp apps/portal/public/cmt-logo.png apps/portal/public/favicon.ico
```

A proper `.ico` conversion is a follow-up task — slice A just needs a placeholder so Next does not warn about a missing favicon.

- [ ] **Step 3: Commit**

```sh
git add apps/portal/public/cmt-logo.png apps/portal/public/favicon.ico
git commit -m "chore(portal): add CMT logo and placeholder favicon"
```

---

## Task 12: Portal chrome components (header, footer, nav)

**Files:**
- Create: `apps/portal/src/components/chrome/header.tsx`
- Create: `apps/portal/src/components/chrome/footer.tsx`
- Create: `apps/portal/src/components/chrome/nav.tsx`

The portal chrome — header with logo and nav, footer, mobile nav. These are NOT extracted to a package per discipline 6 (only one consumer).

- [ ] **Step 1: Create `apps/portal/src/components/chrome/nav.tsx`**

```tsx
import Link from 'next/link';

interface NavItem {
  label: string;
  href: string;
  external?: boolean;
}

const items: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'About', href: 'https://chinmayatoronto.org/', external: true },
];

export function Nav() {
  return (
    <nav aria-label="Primary" className="flex items-center gap-6">
      {items.map((item) =>
        item.external ? (
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-foreground transition-colors hover:text-primary"
          >
            {item.label}
          </a>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className="text-sm text-foreground transition-colors hover:text-primary"
          >
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}
```

- [ ] **Step 2: Create `apps/portal/src/components/chrome/header.tsx`**

```tsx
import Image from 'next/image';
import Link from 'next/link';
import { Nav } from './nav';

export function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-3" aria-label="Chinmaya Mission Toronto home">
          <Image
            src="/cmt-logo.png"
            alt="Chinmaya Mission Toronto"
            width={48}
            height={48}
            priority
          />
          <span className="hidden font-serif text-lg text-heading sm:inline">
            Chinmaya Mission Toronto
          </span>
        </Link>
        <Nav />
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Create `apps/portal/src/components/chrome/footer.tsx`**

```tsx
export function Footer() {
  return (
    <footer className="border-t border-border bg-muted">
      <div className="container mx-auto px-4 py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Chinmaya Mission Toronto. Built with care.
      </div>
    </footer>
  );
}
```

- [ ] **Step 4: Verify typecheck**

```sh
cd apps/portal && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
cd ../..
git add apps/portal/src/components/chrome
git commit -m "feat(portal): add chrome components (header, footer, nav)"
```

---

## Task 13: Root layout

**Files:**
- Create: `apps/portal/src/app/layout.tsx`

The root Next.js layout. Loads Inter and Merriweather via `next/font/google`, imports `globals.css`, wraps content in the chrome.

- [ ] **Step 1: Create `apps/portal/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { Inter, Merriweather } from 'next/font/google';
import { Header } from '@/components/chrome/header';
import { Footer } from '@/components/chrome/footer';
import './globals.css';

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

export const metadata: Metadata = {
  title: 'Chinmaya Mission Toronto',
  description:
    'Bridging knowledge, community, and spiritual practice — Chinmaya Mission Toronto portal.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${merriweather.variable}`}>
      <body className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Run typecheck**

```sh
cd apps/portal && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```sh
cd ../..
git add apps/portal/src/app/layout.tsx
git commit -m "feat(portal): add root layout with Inter + Merriweather + chrome"
```

---

## Task 14: Landing page + ComingSoon component + smoke test

**Files:**
- Create: `apps/portal/src/components/coming-soon.tsx`
- Create: `apps/portal/src/app/page.tsx`
- Test: `apps/portal/src/app/__tests__/page.test.tsx`

Landing page hero + two feature cards, plus the shared `ComingSoon` component used by `/events` and `/check-in`.

- [ ] **Step 1: Create `apps/portal/src/components/coming-soon.tsx`**

```tsx
import { Card, CardContent } from '@cmt/ui';
import Link from 'next/link';

interface ComingSoonProps {
  feature: string;
}

export function ComingSoon({ feature }: ComingSoonProps) {
  return (
    <div className="container mx-auto max-w-2xl py-16">
      <Card>
        <CardContent className="space-y-4 p-8 text-center">
          <h1 className="font-serif text-3xl text-heading">{feature}</h1>
          <p className="text-muted-foreground">
            This feature is coming soon. We&apos;re moving the existing {feature.toLowerCase()} app
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

- [ ] **Step 2: Write the failing landing page test**

```tsx
// apps/portal/src/app/__tests__/page.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../page';

describe('Landing page', () => {
  it('renders the heading', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: /Chinmaya Mission Toronto/i, level: 1 })).toBeDefined();
  });

  it('renders both feature cards as links', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: /events/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /check.in/i })).toBeDefined();
  });

  it('event card links to /events', () => {
    render(<HomePage />);
    const eventsLink = screen.getByRole('link', { name: /events/i });
    expect(eventsLink.getAttribute('href')).toBe('/events');
  });

  it('check-in card links to /check-in', () => {
    render(<HomePage />);
    const checkInLink = screen.getByRole('link', { name: /check.in/i });
    expect(checkInLink.getAttribute('href')).toBe('/check-in');
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

```sh
cd apps/portal && pnpm test
```

Expected: FAIL — `Cannot find module '../page'` or similar.

- [ ] **Step 4: Implement `apps/portal/src/app/page.tsx`**

```tsx
import Image from 'next/image';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@cmt/ui';

interface FeatureCard {
  href: '/events' | '/check-in';
  title: string;
  description: string;
  cta: string;
}

const cards: FeatureCard[] = [
  {
    href: '/events',
    title: 'Events',
    description: 'Register for upcoming events at the Ashram and across the community.',
    cta: 'Open Events →',
  },
  {
    href: '/check-in',
    title: 'Family Check-in',
    description: 'Sign your family in when you arrive at the Ashram.',
    cta: 'Open Check-in →',
  },
];

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <section className="mb-16 flex flex-col items-center text-center">
        <Image
          src="/cmt-logo.png"
          alt=""
          width={120}
          height={120}
          priority
          className="mb-6"
        />
        <h1 className="mb-4 font-serif text-4xl text-heading sm:text-5xl">
          Chinmaya Mission Toronto
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Bridging knowledge, community, and spiritual practice.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="block transition-transform hover:-translate-y-1"
            aria-label={`${card.title}: ${card.description}`}
          >
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="font-serif text-2xl text-heading">{card.title}</CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm font-medium text-primary">{card.cta}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Run the test, verify it passes**

```sh
pnpm test
```

Expected: PASS — all 4 landing page tests green.

**Note:** The test queries by `name` may need adjustment if the accessible name of the link includes the description. If `getByRole('link', { name: /events/i })` returns multiple matches, narrow with `getAllByRole(...)` and assertion on length, or use a more specific name pattern like `name: /^Events:/i`.

- [ ] **Step 6: Commit**

```sh
cd ../..
git add apps/portal/src/components/coming-soon.tsx apps/portal/src/app/page.tsx apps/portal/src/app/__tests__/page.test.tsx
git commit -m "feat(portal): add landing page with feature cards and ComingSoon component"
```

---

## Task 15: `/events` placeholder route + smoke test

**Files:**
- Create: `apps/portal/src/app/events/page.tsx`
- Test: `apps/portal/src/app/events/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/app/events/__tests__/page.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EventsPage from '../page';

describe('/events placeholder', () => {
  it('renders the ComingSoon component with "Events" label', () => {
    render(<EventsPage />);
    expect(screen.getByRole('heading', { name: 'Events' })).toBeDefined();
  });

  it('renders a back link to the home page', () => {
    render(<EventsPage />);
    const backLink = screen.getByRole('link', { name: /back to portal home/i });
    expect(backLink.getAttribute('href')).toBe('/');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```sh
cd apps/portal && pnpm test -- events
```

Expected: FAIL — `Cannot find module '../page'`.

- [ ] **Step 3: Implement `apps/portal/src/app/events/page.tsx`**

```tsx
import { ComingSoon } from '@/components/coming-soon';

export default function EventsPage() {
  return <ComingSoon feature="Events" />;
}
```

- [ ] **Step 4: Run the test, verify it passes**

```sh
pnpm test -- events
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
cd ../..
git add apps/portal/src/app/events
git commit -m "feat(portal): add /events placeholder route"
```

---

## Task 16: `/check-in` placeholder route + smoke test

**Files:**
- Create: `apps/portal/src/app/check-in/page.tsx`
- Test: `apps/portal/src/app/check-in/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/app/check-in/__tests__/page.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CheckInPage from '../page';

describe('/check-in placeholder', () => {
  it('renders the ComingSoon component with "Family Check-in" label', () => {
    render(<CheckInPage />);
    expect(screen.getByRole('heading', { name: 'Family Check-in' })).toBeDefined();
  });

  it('renders a back link to the home page', () => {
    render(<CheckInPage />);
    const backLink = screen.getByRole('link', { name: /back to portal home/i });
    expect(backLink.getAttribute('href')).toBe('/');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```sh
cd apps/portal && pnpm test -- check-in
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/portal/src/app/check-in/page.tsx`**

```tsx
import { ComingSoon } from '@/components/coming-soon';

export default function CheckInPage() {
  return <ComingSoon feature="Family Check-in" />;
}
```

- [ ] **Step 4: Run the test, verify it passes**

```sh
pnpm test -- check-in
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
cd ../..
git add apps/portal/src/app/check-in
git commit -m "feat(portal): add /check-in placeholder route"
```

---

## Task 17: Error boundaries (per discipline 3)

**Files:**
- Create: `apps/portal/src/app/error.tsx`
- Create: `apps/portal/src/app/global-error.tsx`
- Create: `apps/portal/src/app/not-found.tsx`
- Create: `apps/portal/src/app/events/error.tsx`
- Create: `apps/portal/src/app/check-in/error.tsx`

Five files. Native Next.js App Router pattern. All five use the `<ErrorFallback>` component from `@cmt/ui` so they share visual identity.

- [ ] **Step 1: Create `apps/portal/src/app/error.tsx`**

```tsx
'use client';

import { ErrorFallback } from '@cmt/ui';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} />;
}
```

- [ ] **Step 2: Create `apps/portal/src/app/global-error.tsx`**

```tsx
'use client';

import { ErrorFallback } from '@cmt/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorFallback error={error} reset={reset} />
      </body>
    </html>
  );
}
```

`global-error.tsx` is the last-resort fallback. Unlike `error.tsx` it must include its own `<html>` and `<body>` because it replaces the root layout entirely when an error occurs in the layout itself.

- [ ] **Step 3: Create `apps/portal/src/app/not-found.tsx`**

```tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container mx-auto flex min-h-[40vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="font-serif text-3xl text-heading">Page not found</h1>
      <p className="text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link href="/" className="text-primary underline">
        ← Back to portal home
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/app/events/error.tsx`**

```tsx
'use client';

import { ErrorFallback } from '@cmt/ui';

export default function EventsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Events" />;
}
```

- [ ] **Step 5: Create `apps/portal/src/app/check-in/error.tsx`**

```tsx
'use client';

import { ErrorFallback } from '@cmt/ui';

export default function CheckInError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} feature="Family Check-in" />;
}
```

- [ ] **Step 6: Run typecheck and tests**

```sh
cd apps/portal && pnpm typecheck && pnpm test
```

Expected: PASS for both. The error boundary files are not test-covered in slice A — they are wired up by Next.js automatically.

- [ ] **Step 7: Commit**

```sh
cd ../..
git add apps/portal/src/app/error.tsx apps/portal/src/app/global-error.tsx apps/portal/src/app/not-found.tsx apps/portal/src/app/events/error.tsx apps/portal/src/app/check-in/error.tsx
git commit -m "feat(portal): add per-segment error boundaries (discipline 3)"
```

---

## Task 18: `README.md` and `CLAUDE.md`

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`

Top-level docs. Both kept concise.

- [ ] **Step 1: Create `README.md`**

```markdown
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

This project ships in slices, each with its own design spec and implementation plan. See `docs/superpowers/specs/` for the current state.

- **Slice A** — Monorepo scaffold + portal app shell + 4 shared packages (this slice)
- **Slice B** — Port `chinmaya-family-check-in` into the portal as `apps/portal/src/app/check-in/*`
- **Slice C** — Port `chinmaya-event-registration` into the portal as `apps/portal/src/app/events/*`
- **Slice D** — Unified portal-level auth
- **Slice E+** — Future modules (programs, enrollment, retirement of old portal)

## CI

GitHub Actions runs `typecheck`, `lint`, `test`, `build` on every PR. Branch protection requires the `ci` check to pass before merge.
```

- [ ] **Step 2: Create `CLAUDE.md`**

```markdown
# CLAUDE.md — Agent guidance for cmt-portal

This file orients AI agents (Claude Code, Cursor, etc.) working in this repository. Read before making changes.

## What this is

A Turborepo monorepo for the Chinmaya Mission Toronto unified portal. One Next.js 16 application (`apps/portal`) and four shared workspace packages.

**Spec for the current slice:** `docs/superpowers/specs/2026-04-12-slice-a-portal-scaffold-design.md`

## Architecture in one paragraph

`apps/portal` is a single Next.js 16 monolith. Future features (events, check-in, programs, etc.) are added as **internal route segments** under `apps/portal/src/app/<feature>/`, NOT as sibling apps in the monorepo. Cross-feature dependencies must go through shared packages (`@cmt/shared-domain` or `@cmt/ui`), enforced by `eslint-plugin-boundaries`. The choice to stay monolithic was deliberate — it preserves operational simplicity and gives future mobile apps a single API surface. The structure has been designed so that splitting into Next.js multi-zones later is cheap if needed.

## The 6 disciplines (non-negotiable)

1. **Strict feature boundaries** — Files under `apps/portal/src/features/<a>/` cannot import from `apps/portal/src/features/<b>/`. Lint-enforced via `eslint-plugin-boundaries`.
2. **`@cmt/shared-domain`** is for pure TypeScript that web + mobile can both consume. No React, no Next, no DOM imports — enforced by ESLint `no-restricted-imports`.
3. **Per-segment React error boundaries** — Every top-level route segment under `src/app/` has its own `error.tsx`.
4. **CI gate on `main`** — No PR merges without `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all passing. Branch protection enforces.
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

- **Tests are TDD** — write the failing test, run it to confirm it fails, implement, run it again, commit. See existing tests in `packages/firebase-shared/src/__tests__/` for the pattern.
- **Frequent commits** — Each task in the implementation plan corresponds to one (or a few) commits. Don't bundle unrelated changes.
- **Commit author** — Always `CMT Developer <developer@chinmayatoronto.org>` (set in local `.git/config`, not global).
- **Never bypass `--no-verify`** on commits unless explicitly told.

## Reading the prototype

The original 4-phase product brief is in `docs/superpowers/specs/reference/Chinmaya Setu Prototype.{md,pdf}`. **Phase 1 of that brief is already implemented as the standalone `chinmaya-family-check-in` app and will be ported into this portal in slice B.** The Setu prototype's `chinmaya-setu` repo (a different prior-dev attempt with a Supabase schema and ~83 shadcn components) is REFERENCE ONLY — its data model is intentionally NOT being adopted because it reinvents what production already has. We did salvage the 12 shadcn components in slice A.

## Things not to do

- Don't add a new package to `packages/` without justifying two-or-more consumers (discipline 6).
- Don't import across feature directories — go through `@cmt/shared-domain` or `@cmt/ui`.
- Don't add React/Next imports to `@cmt/shared-domain` — lint will fail and the discipline matters.
- Don't bypass the CI gate. If `pnpm test` fails, fix the test or the code, not the CI config.
- Don't migrate to Tailwind v4, `vercel.ts`, or shadcn v4-only components without a dedicated upgrade slice.
- Don't propose retiring the standalone `chinmaya-event-registration` or `chinmaya-family-check-in` deployments until slices B and C are proven in parallel-run.
```

- [ ] **Step 3: Commit**

```sh
git add README.md CLAUDE.md
git commit -m "docs: add README and CLAUDE.md for repo orientation"
```

---

## Task 19: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

The CI gate that enforces discipline 4.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    name: Typecheck, lint, test, build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9.15.0

      - name: Set up Node 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build
```

The `concurrency` group cancels superseded runs on the same PR — saves CI minutes when you push twice in quick succession.

- [ ] **Step 2: Create the directory if it does not exist and verify**

```sh
mkdir -p .github/workflows
ls .github/workflows/ci.yml
```

Expected: file exists.

- [ ] **Step 3: Commit**

```sh
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for typecheck/lint/test/build"
```

---

## Task 20: Local acceptance verification

**Files:** None (verification only)

Run every command from the spec's 15-item acceptance checklist locally and confirm each passes. This is the moment to find broken assumptions before pushing to GitHub.

- [ ] **Step 1: Fresh `pnpm install`**

```sh
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```

Expected: clean install with no errors.

- [ ] **Step 2: Typecheck across all packages**

```sh
pnpm typecheck
```

Expected: PASS for all workspace members. If a workspace package fails, fix it before continuing.

- [ ] **Step 3: Lint**

```sh
pnpm lint
```

Expected: PASS with no errors. The `eslint-plugin-boundaries` rule will not fire because there are no features yet.

- [ ] **Step 4: Run all tests**

```sh
pnpm test
```

Expected: PASS. Total test count should be **≥ 8** (the 8 smoke tests defined in the spec, possibly more if any task added incidental coverage).

Specifically:
- `packages/shared-domain` — 2 tests (barrel exists, empty)
- `packages/firebase-shared` — 5 tests (env validation 5) + 3 tests (admin) = 8 tests
- `packages/ui` — 5 tests (Button 3, Card 2)
- `apps/portal` — 8 tests (landing 4, /events 2, /check-in 2)

That's ~28 tests. The spec says "~8 smoke tests" which referred to the *minimum surface*; the actual count is higher because each smoke test was naturally written as a small group of related assertions.

- [ ] **Step 5: Build**

```sh
pnpm build
```

Expected: PASS. The Next build for `apps/portal` should produce a successful `.next/` directory with no warnings about deprecated APIs.

- [ ] **Step 6: Run the dev server**

```sh
pnpm dev
```

Expected: Turborepo starts `next dev` for `apps/portal`. Visit <http://localhost:3000> in a browser and verify:

- [ ] Landing page renders with the CMT logo, "Chinmaya Mission Toronto" heading in Merriweather, the lead paragraph in Inter, and two cards
- [ ] Brand colors visible — header has `--background` white background, cards have a border, primary navy/teal is visible on hover/CTA text
- [ ] Click the **Events** card → URL becomes `/events` and the "Events — Coming Soon" placeholder renders
- [ ] Click the back link → returns to `/`
- [ ] Click the **Family Check-in** card → URL becomes `/check-in` and the "Family Check-in — Coming Soon" placeholder renders
- [ ] Visit `http://localhost:3000/nonexistent` → renders the `not-found.tsx` page
- [ ] Stop the dev server with `Ctrl+C`

- [ ] **Step 7: Verify file structure matches spec**

```sh
ls apps/portal/src/app apps/portal/src/components apps/portal/src/lib apps/portal/src/features
ls packages
```

Expected:
- `apps/portal/src/app/` contains `events/`, `check-in/`, `layout.tsx`, `page.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, `globals.css`, `__tests__/`
- `apps/portal/src/components/` contains `chrome/`, `coming-soon.tsx`
- `apps/portal/src/lib/` contains `flags.ts`
- `apps/portal/src/features/` contains `.gitkeep` only
- `packages/` contains `ui/`, `firebase-shared/`, `shared-domain/`, `config/`

- [ ] **Step 8: Verify reference materials are in the right place**

```sh
ls "docs/superpowers/specs/reference/"
```

Expected:
```
Chinmaya Setu Prototype.md
Chinmaya Setu Prototype.pdf
```

- [ ] **Step 9: Verify commit identity**

```sh
git log --pretty=format:'%an <%ae>' | sort -u
```

Expected: only `CMT Developer <developer@chinmayatoronto.org>` appears.

- [ ] **Step 10: No commit needed for this task — it's verification only.**

If any step failed, fix the underlying issue and commit the fix as its own commit before proceeding to Task 21.

---

## Task 21: Push to remote and verify CI passes

**Files:** None (push and observe)

- [ ] **Step 1: Verify the GitHub remote exists**

```sh
git remote -v 2>&1
```

If no remote is configured, add it:

```sh
git remote add origin https://github.com/CMTDeveloper/cmt-portal.git
```

- [ ] **Step 2: Push the slice-a/scaffold branch**

```sh
git push -u origin slice-a/scaffold
```

Expected: push succeeds. If the user has not authenticated with GitHub on this machine, this will prompt for credentials — set up `gh auth login` first or use SSH.

- [ ] **Step 3: Open a pull request**

```sh
gh pr create \
  --base main \
  --head slice-a/scaffold \
  --title "feat: slice A — portal monorepo scaffold" \
  --body "$(cat <<'EOF'
## Summary

Implements slice A of the Chinmaya Mission Toronto Portal program. Scaffolds the Turborepo, the single Next.js 16 app at `apps/portal`, and four shared packages (`@cmt/ui`, `@cmt/firebase-shared`, `@cmt/shared-domain`, `@cmt/config`).

Spec: `docs/superpowers/specs/2026-04-12-slice-a-portal-scaffold-design.md`
Plan: `docs/superpowers/plans/2026-04-12-slice-a-portal-scaffold.md`

## What's in the slice

- Empty Turborepo with pnpm workspaces, Node 22 LTS, Turbo 2
- Next.js 16 + React 19 portal app shell with brand-themed landing page
- 12 lifted shadcn components in `@cmt/ui` (from prior chinmaya-setu work)
- CMT brand tokens (navy/teal palette mined from chinmayatoronto.org)
- Inter + Merriweather fonts via `next/font/google`
- Per-segment error boundaries (discipline 3)
- ESLint boundaries plugin enforcing future feature isolation (discipline 1)
- Env-based feature flags (discipline 5)
- 8+ smoke tests across packages
- GitHub Actions CI: typecheck, lint, test, build

## What's NOT in the slice

Auth, real features, real domain. See spec §4 for the full non-goals list.

## Test plan

- [ ] CI passes (`typecheck`, `lint`, `test`, `build`)
- [ ] Vercel preview deploy succeeds
- [ ] Visit preview URL — landing page renders, both cards navigate, both placeholders show
- [ ] Visit a 404 path — `not-found` renders
EOF
)"
```

- [ ] **Step 4: Watch CI**

```sh
gh pr checks --watch
```

Expected: All CI checks pass (typecheck, lint, test, build).

- [ ] **Step 5: Watch Vercel preview deployment**

The Vercel GitHub integration should post a preview URL on the PR within ~1 minute. Visit the preview URL and verify the same checks from Task 20 Step 6 pass on the deployed version (landing page renders, both cards navigate, brand visible).

- [ ] **Step 6: If CI is green and preview works, merge to main**

```sh
gh pr merge --squash --delete-branch
```

Expected: PR merges, branch deletes, slice A is now on `main`.

- [ ] **Step 7: Pull latest main**

```sh
git checkout main
git pull
```

---

## Task 22: Manual Vercel project setup (for the operator)

**Files:** None (manual platform setup, no code)

This task documents the one-time Vercel setup that must be done in the Vercel dashboard. It is not automatable from this plan.

- [ ] **Step 1: Sign in to Vercel**

Open <https://vercel.com> and sign in with the CMT-owned account. If a CMT Vercel team exists, switch to it.

- [ ] **Step 2: Create a new project**

Click **Add New → Project**. Import from GitHub: `CMTDeveloper/cmt-portal`.

- [ ] **Step 3: Configure project settings**

When prompted:

- **Framework Preset:** Next.js (auto-detected)
- **Root Directory:** `apps/portal` ← important; click "Edit" and set this
- **Build Command:** leave default (Vercel uses `pnpm build` via Turborepo)
- **Output Directory:** leave default (`.next`)
- **Install Command:** leave default (`pnpm install`)

- [ ] **Step 4: Set environment variables**

In the project settings → Environment Variables:

| Variable | Value | Environments |
|---|---|---|
| `NEXT_PUBLIC_FEATURE_EVENTS` | `false` | Production, Preview, Development |
| `NEXT_PUBLIC_FEATURE_CHECK_IN` | `false` | Production, Preview, Development |

No Firebase env vars are needed for slice A. Slices B and C will add them.

- [ ] **Step 5: Set Node version to 22**

In project settings → General → Node.js Version: `22.x`.

- [ ] **Step 6: Trigger first production deploy**

After the project is created, Vercel will queue a production deploy automatically because the PR has been merged to `main`. Wait for it to complete.

- [ ] **Step 7: Verify production URL**

Visit `https://cmt-portal.vercel.app` (the auto-generated default domain). Verify:

- [ ] Landing page renders correctly
- [ ] Both feature cards work
- [ ] Both placeholder routes render
- [ ] Brand colors and fonts load

If anything is broken, the issue is likely in the Vercel project root directory or env vars — recheck Step 3 and Step 4.

---

## Task 23: Manual GitHub branch protection (for the operator)

**Files:** None (manual GitHub setting, no code)

- [ ] **Step 1: Open repo settings**

Open <https://github.com/CMTDeveloper/cmt-portal/settings/branches> in a browser.

- [ ] **Step 2: Add a branch protection rule for `main`**

Click **Add classic branch protection rule** (or **Add ruleset**, depending on the GitHub UI version).

- **Branch name pattern:** `main`
- ✅ **Require a pull request before merging**
  - ✅ Require approvals (set to 0 for solo dev, or 1 if a reviewer is available)
  - ✅ Dismiss stale approvals when new commits are pushed
- ✅ **Require status checks to pass before merging**
  - ✅ Require branches to be up to date before merging
  - **Status checks required:** Search for and select `ci` (the job name from `.github/workflows/ci.yml`). It will only appear in the dropdown after at least one PR has run CI.
- ✅ **Require linear history**
- ✅ **Do not allow force pushes**
- ✅ **Do not allow deletions**

Click **Create** or **Save changes**.

- [ ] **Step 3: Verify the protection is active**

Try a no-op test: from a local branch, attempt `git push --force origin main` (do NOT actually do this — just confirm in the GitHub UI that force-push protection is shown as active under the branch's settings page).

- [ ] **Step 4: Slice A is complete.**

All 15 acceptance criteria from the spec are now met. Slice A is shipped. Begin slice B planning when ready.

---

## Self-review (run before handing off)

After writing this plan, I checked it against the spec with fresh eyes. Findings:

**Spec coverage:**
- ✅ Spec §3 goal 1 (landing page with brand) — Tasks 9, 13, 14
- ✅ Spec §3 goal 2 (placeholder routes) — Tasks 14, 15, 16
- ✅ Spec §3 goal 3 (six disciplines enforced) — Task 2 (lint config), Task 4 (env validation), Task 10 (flags), Task 17 (error boundaries), Task 18 (CLAUDE.md documentation), Task 19 (CI gate)
- ✅ Spec §3 goal 4 (CI pipeline) — Task 19
- ✅ Spec §3 goal 5 (smoke tests) — Tasks 3, 4, 7, 14, 15, 16
- ✅ Spec §6 file tree — every file in the tree maps to a task
- ✅ Spec §7 toolchain versions — Tasks 1, 2, 8 specify exact versions
- ✅ Spec §9 brand tokens — Task 5 (skeleton with tokens.css), Task 2 (Tailwind preset that reads them)
- ✅ Spec §10 landing page IA — Task 14
- ✅ Spec §11 Vercel + branch protection — Tasks 22, 23
- ✅ Spec §12 test surface — Tasks 3, 4, 7, 14, 15, 16 produce the smoke tests
- ✅ Spec §13 acceptance criteria — Task 20 walks through every item
- ✅ Spec §14 commit identity — preflight check + Task 18 README mentions

**Placeholder scan:** No `TBD`, `TODO`, "implement later", "fill in" anywhere in the plan. Two notes flag uncertainties (the eslint-plugin-boundaries v5 API in Task 2 and the next-themes detection in Sonner in Task 6) — both resolved with fallback instructions, not deferred.

**Type consistency:**
- `getAdminApp`, `getAdminFirestore`, `getAdminDatabase` defined in Task 4 Step 10 — referenced consistently in `index.ts` (Step 13).
- `cn` exported from `packages/ui/src/lib/cn.ts` (Task 5 Step 5) — imported by lifted shadcn components in Task 6 (after `@/lib/utils` rewrite).
- `ErrorFallback` interface (Task 5 Step 7) takes `{ error, reset, feature? }` — matches usage in Task 17 error boundary files.
- `ComingSoon` component (Task 14 Step 1) takes `{ feature: string }` — matches usage in Tasks 15, 16.
- `flags` shape (Task 10) matches the spec §5.3 discipline 5 description.

**Scope check:** This plan covers slice A only. No multi-slice work. The plan is large (~70 files, 23 tasks) but each task is self-contained and produces a working commit. Slice A's scope is foundational and atomic — splitting it further would create slices that don't ship working software on their own.

**Ambiguity check:**
- Task 6 component lift relies on `chinmaya-setu` being present at a specific path. The plan states this clearly upfront. If the source repo moves, the implementer will hit an obvious file-not-found error and can adjust.
- Task 11 logo download depends on the upstream chinmayatoronto.org URL being live. Fallback (browser save) is documented.
- Task 22 (Vercel manual) and Task 23 (branch protection) are platform actions, not code — clearly marked as such.

No issues fixed inline (the two `Note:` callouts in Tasks 2 and 6 are deliberate guidance for the implementer, not gaps).

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-04-12-slice-a-portal-scaffold.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
