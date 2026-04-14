# Slice B0 — Portal Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portal-wide authentication foundation: dual Firebase Admin apps, server-verified session cookies, dual-mode auth middleware (web cookie + mobile Bearer), role-based route access (`admin`, `teacher`, `family`), login pages for admin and teacher, a scaffolded family login (OTP wiring deferred to B2), an auth-gated `/check-in/admin` stub page, a `pnpm seed:admin` bootstrap CLI, per-segment error boundaries, and the first Playwright e2e flow.

**Architecture:** Two Firebase Admin apps initialized side-by-side — the `portal` app owns Firestore and Auth (UAT project in dev, prod in prod), the `master` app owns RTDB reads only (always prod). Firebase `createSessionCookie`/`verifySessionCookie` is the web session mechanism; `verifyIdToken` is the mobile path. A single `apps/portal/src/middleware.ts` handles both and attaches claims to request headers for server components. Pure auth logic (role, public routes, `canAccessRoute`) lives in `@cmt/shared-domain/auth/*` with zero React/Next imports. Firebase admin service wrappers live in `@cmt/firebase-shared/src/admin/*` with RTDB write helpers intentionally absent and lint-blocked.

**Tech Stack:** Node 22 LTS, pnpm 9.15, Turborepo 2, Next.js 16.2, React 19.2, TypeScript 5 strict, Tailwind v3.4, Vitest 4, Playwright 1.50, ESLint 9 flat config, Zod 3.24, `firebase-admin` 13, `firebase` 12, `eslint-plugin-boundaries` 5.

**Spec:** `docs/superpowers/specs/2026-04-13-slice-b-family-check-in-port-design.md` (§7 B0 detailed architecture, §9 B0 ships, §9.2 B0 acceptance criteria)

**Slice context:** B0 is the first of six sub-slices in slice B (B0 → B2 → B3 → B1 → B4 → B5). It blocks every other sub-slice.

---

## Pre-flight notes

**Working directory for all tasks:** `/Users/dineshmatta/projects/chinmaya-mission-portal`

**Git identity** is already set locally to `CMT Developer <developer@chinmayatoronto.org>`. Verify:

```sh
git config user.name && git config user.email
```

Expected: `CMT Developer` / `developer@chinmayatoronto.org`.

**Branch model — solo-dev main-only.** All commits go directly to `main`. The pre-push hook validates `pnpm typecheck && lint && test && build`. Do **not** create a feature branch for B0.

**Pre-push hook is mandatory.** If it fails, fix the underlying issue — never `--no-verify`.

**B0 ends with a push.** The final task in this plan pushes to `origin/main` after all typecheck/lint/test/build checks pass locally.

**`.env.local` required.** Several tasks in this plan read `.env.local` via the new env schema. Create it now with the UAT + prod RTDB credentials from the existing standalone app's `.env.example` (see `/Users/dineshmatta/projects/chinmaya-family-check-in/.env.example`). Use the PORTAL_* prefix for UAT Firestore/Auth credentials and the MASTER_* prefix for prod RTDB credentials:

```sh
cat > apps/portal/.env.local <<'ENV'
# Portal Firebase (UAT in dev — chinmaya-setu-uat)
PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat
PORTAL_FIREBASE_CLIENT_EMAIL=firebase-adminsdk-41ayt@chinmaya-setu-uat.iam.gserviceaccount.com
PORTAL_FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n"
NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY=AIzaSyBPsl9LszJNK69vqXZ9JDIX6auM4KJSv9U
NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN=chinmaya-setu-uat.firebaseapp.com
NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat
NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET=chinmaya-setu-uat.firebasestorage.app
NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID=1041244422802
NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID=1:1041244422802:web:acaac6d9bf7b30cee3dc4b

# Master Firebase (prod RTDB — chinmaya-setu-715b8, read-only)
MASTER_FIREBASE_PROJECT_ID=chinmaya-setu-715b8
MASTER_FIREBASE_CLIENT_EMAIL=firebase-adminsdk-jq5z2@chinmaya-setu-715b8.iam.gserviceaccount.com
MASTER_FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n"
MASTER_FIREBASE_DATABASE_URL=https://chinmaya-setu-715b8-default-rtdb.firebaseio.com
NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL=https://chinmaya-setu-715b8-default-rtdb.firebaseio.com

# Auth
TEACHER_PASSPHRASE=TeacherOM!
SESSION_COOKIE_EXPIRES_DAYS=5

# AWS (declared now; consumed in B5)
AWS_SES_REGION=ca-central-1
AWS_SNS_REGION=us-east-1
AWS_SES_FROM_EMAIL=bvregistration@chinmayatoronto.org

# Feature flags
NEXT_PUBLIC_FEATURE_CHECK_IN=true
NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=false
NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY=false
NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER=false
NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN=true
NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=false
ENV
```

Replace the two private keys with the real values from the standalone app's `.env.example` (preserving the `\n` escape sequences in the quoted strings). The file is gitignored.

**Tests never touch real Firebase.** Every test in this plan mocks `firebase-admin/*` via `vi.mock`. No task assumes a live Firebase connection unless it's the Playwright flow running against the Firebase emulator.

---

## File structure overview

New and modified files in rough order. Each task below lists its own file set.

```
chinmaya-mission-portal/
├── apps/portal/
│   ├── .env.local                                         [Pre-flight, not committed]
│   ├── playwright.config.ts                               [Task 26]
│   ├── e2e/
│   │   ├── fixtures.ts                                    [Task 26]
│   │   └── b0-auth.spec.ts                                [Task 27]
│   ├── scripts/
│   │   ├── seed-admin.ts                                  [Task 25]
│   │   └── __tests__/seed-admin.test.ts                   [Task 25]
│   ├── src/
│   │   ├── middleware.ts                                  [Task 17]
│   │   ├── lib/
│   │   │   ├── env.ts                                     [Task 3]
│   │   │   ├── flags.ts                                   [Task 15, MODIFIED]
│   │   │   └── __tests__/env.test.ts                      [Task 3]
│   │   ├── features/check-in/auth/
│   │   │   ├── index.ts                                   [Task 18]
│   │   │   ├── login-role-picker.tsx                      [Task 18]
│   │   │   ├── admin-login-form.tsx                       [Task 19]
│   │   │   ├── teacher-login-form.tsx                     [Task 20]
│   │   │   ├── family-login-form.tsx                      [Task 21]
│   │   │   ├── signin-admin.ts                            [Task 22]
│   │   │   ├── signin-teacher.ts                          [Task 23]
│   │   │   ├── signout.ts                                 [Task 24]
│   │   │   └── __tests__/
│   │   │       ├── admin-login-form.test.tsx              [Task 19]
│   │   │       ├── teacher-login-form.test.tsx            [Task 20]
│   │   │       ├── signin-admin.test.ts                   [Task 22]
│   │   │       └── signin-teacher.test.ts                 [Task 23]
│   │   ├── app/
│   │   │   ├── login/
│   │   │   │   ├── page.tsx                               [Task 18]
│   │   │   │   ├── error.tsx                              [Task 18]
│   │   │   │   ├── loading.tsx                            [Task 18]
│   │   │   │   ├── admin/page.tsx                         [Task 19]
│   │   │   │   ├── admin/error.tsx                        [Task 19]
│   │   │   │   ├── teacher/page.tsx                       [Task 20]
│   │   │   │   ├── teacher/error.tsx                      [Task 20]
│   │   │   │   ├── family/page.tsx                        [Task 21]
│   │   │   │   └── family/error.tsx                       [Task 21]
│   │   │   ├── api/auth/
│   │   │   │   ├── admin/signin/route.ts                  [Task 22]
│   │   │   │   ├── teacher/signin/route.ts                [Task 23]
│   │   │   │   └── signout/route.ts                       [Task 24]
│   │   │   └── check-in/admin/
│   │   │       ├── page.tsx                               [Task 28, MODIFIED]
│   │   │       ├── error.tsx                              [Task 28]
│   │   │       └── loading.tsx                            [Task 28]
│   ├── package.json                                       [Tasks 1, 25, 26, MODIFIED]
│   └── eslint.config.js                                   [Task 16, MODIFIED]
│
├── packages/firebase-shared/
│   ├── src/
│   │   ├── env.ts                                         [Task 2, MODIFIED — new schemas]
│   │   ├── admin.ts                                       [Task 4, REMOVED — split into admin/]
│   │   ├── admin/
│   │   │   ├── apps.ts                                    [Task 4]
│   │   │   ├── auth.ts                                    [Task 5]
│   │   │   ├── firestore.ts                               [Task 6]
│   │   │   ├── rtdb.ts                                    [Task 7]
│   │   │   ├── session.ts                                 [Task 8]
│   │   │   └── claims.ts                                  [Task 9]
│   │   ├── client.ts                                      [Task 10, MODIFIED]
│   │   ├── index.ts                                       [Task 10, MODIFIED]
│   │   └── __tests__/
│   │       ├── apps.test.ts                               [Task 4]
│   │       ├── auth.test.ts                               [Task 5]
│   │       ├── firestore.test.ts                          [Task 6]
│   │       ├── rtdb.test.ts                               [Task 7]
│   │       ├── session.test.ts                            [Task 8]
│   │       ├── claims.test.ts                             [Task 9]
│   │       └── env.test.ts                                [Task 2]
│   ├── package.json                                       [Task 10, MODIFIED]
│   └── eslint.config.js                                   [Task 10, MODIFIED — RTDB import lint]
│
├── packages/shared-domain/
│   ├── src/
│   │   ├── auth/
│   │   │   ├── role.ts                                    [Task 11]
│   │   │   ├── session.ts                                 [Task 12]
│   │   │   ├── public-routes.ts                           [Task 13]
│   │   │   ├── can-access-route.ts                        [Task 14]
│   │   │   └── index.ts                                   [Task 14]
│   │   ├── index.ts                                       [Task 14, MODIFIED]
│   │   └── __tests__/
│   │       ├── role.test.ts                               [Task 11]
│   │       ├── public-routes.test.ts                      [Task 13]
│   │       └── can-access-route.test.ts                   [Task 14]
│
├── README.md                                              [Task 29, MODIFIED]
├── CLAUDE.md                                              [Task 29, MODIFIED]
└── package.json                                           [Task 26, MODIFIED — test:e2e script]
```

**Task count:** 29. **Estimated commits:** 29. **Final task pushes.**

---

## Task 1: Install new dependencies

New runtime and test deps are needed across three workspaces.

**Files:**
- Modify: `apps/portal/package.json`
- Modify: `packages/firebase-shared/package.json` (later tasks add more; this adds the emulator runtime helper)

- [ ] **Step 1: Add portal runtime dependency on `@cmt/firebase-shared` subpath exports**

`@cmt/firebase-shared` is already a workspace dependency. No change needed here — just verify:

```sh
jq '.dependencies."@cmt/firebase-shared"' apps/portal/package.json
```

Expected output: `"workspace:*"`

- [ ] **Step 2: Add test-only dependency for API route handler testing**

```sh
pnpm --filter @cmt/portal add -D next-test-api-route-handler@^5.0.0
```

This package wraps Next.js route handlers with fake `Request`/`Response` so we can test them without spinning up a dev server.

- [ ] **Step 3: Run typecheck to confirm the lockfile is consistent**

```sh
pnpm install
pnpm --filter @cmt/portal typecheck
```

Expected: zero errors. `pnpm install` should only update `pnpm-lock.yaml`.

- [ ] **Step 4: Commit**

```sh
git add apps/portal/package.json pnpm-lock.yaml
git commit -m "chore(portal): add next-test-api-route-handler for API handler tests"
```

---

## Task 2: Rewrite `@cmt/firebase-shared/src/env.ts` for dual-project schema

The existing `env.ts` has a single flat `FIREBASE_*` schema. Slice B0 replaces it with two schemas: `portalAdminEnvSchema` (Firestore + Auth) and `masterAdminEnvSchema` (RTDB read-only), plus updated client schemas.

**Files:**
- Modify: `packages/firebase-shared/src/env.ts`
- Test: `packages/firebase-shared/src/__tests__/env.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/firebase-shared/src/__tests__/env.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  portalAdminEnvSchema,
  masterAdminEnvSchema,
  portalClientEnvSchema,
  masterClientEnvSchema,
  readPortalAdminEnv,
  readMasterAdminEnv,
} from '../env';

describe('portalAdminEnvSchema', () => {
  it('parses valid portal admin env', () => {
    const result = portalAdminEnvSchema.safeParse({
      PORTAL_FIREBASE_PROJECT_ID: 'chinmaya-setu-uat',
      PORTAL_FIREBASE_CLIENT_EMAIL: 'sa@chinmaya-setu-uat.iam.gserviceaccount.com',
      PORTAL_FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing private key', () => {
    const result = portalAdminEnvSchema.safeParse({
      PORTAL_FIREBASE_PROJECT_ID: 'chinmaya-setu-uat',
      PORTAL_FIREBASE_CLIENT_EMAIL: 'sa@chinmaya-setu-uat.iam.gserviceaccount.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid client email', () => {
    const result = portalAdminEnvSchema.safeParse({
      PORTAL_FIREBASE_PROJECT_ID: 'chinmaya-setu-uat',
      PORTAL_FIREBASE_CLIENT_EMAIL: 'not-an-email',
      PORTAL_FIREBASE_PRIVATE_KEY: 'key',
    });
    expect(result.success).toBe(false);
  });
});

describe('masterAdminEnvSchema', () => {
  it('parses valid master admin env with database URL', () => {
    const result = masterAdminEnvSchema.safeParse({
      MASTER_FIREBASE_PROJECT_ID: 'chinmaya-setu-715b8',
      MASTER_FIREBASE_CLIENT_EMAIL: 'sa@chinmaya-setu-715b8.iam.gserviceaccount.com',
      MASTER_FIREBASE_PRIVATE_KEY: 'key',
      MASTER_FIREBASE_DATABASE_URL: 'https://chinmaya-setu-715b8-default-rtdb.firebaseio.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing database URL', () => {
    const result = masterAdminEnvSchema.safeParse({
      MASTER_FIREBASE_PROJECT_ID: 'chinmaya-setu-715b8',
      MASTER_FIREBASE_CLIENT_EMAIL: 'sa@chinmaya-setu-715b8.iam.gserviceaccount.com',
      MASTER_FIREBASE_PRIVATE_KEY: 'key',
    });
    expect(result.success).toBe(false);
  });
});

describe('readPortalAdminEnv', () => {
  beforeEach(() => {
    delete process.env.PORTAL_FIREBASE_PROJECT_ID;
    delete process.env.PORTAL_FIREBASE_CLIENT_EMAIL;
    delete process.env.PORTAL_FIREBASE_PRIVATE_KEY;
  });

  it('throws a clear error when PRIVATE_KEY is missing', () => {
    process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
    process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
    expect(() => readPortalAdminEnv()).toThrow(/PORTAL_FIREBASE_PRIVATE_KEY/);
  });

  it('returns parsed env when all vars are present', () => {
    process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
    process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
    process.env.PORTAL_FIREBASE_PRIVATE_KEY = 'key';
    const env = readPortalAdminEnv();
    expect(env.PORTAL_FIREBASE_PROJECT_ID).toBe('p');
  });
});

describe('portalClientEnvSchema', () => {
  it('parses public portal firebase env', () => {
    const result = portalClientEnvSchema.safeParse({
      NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY: 'AIza...',
      NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN: 'p.firebaseapp.com',
      NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID: 'p',
      NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET: 'p.firebasestorage.app',
      NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID: '123',
      NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID: '1:123:web:abc',
    });
    expect(result.success).toBe(true);
  });
});

describe('masterClientEnvSchema', () => {
  it('parses master firebase db url', () => {
    const result = masterClientEnvSchema.safeParse({
      NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL: 'https://m-default-rtdb.firebaseio.com',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/firebase-shared test
```

Expected: test file cannot resolve `portalAdminEnvSchema`, `masterAdminEnvSchema`, etc. — module export error.

- [ ] **Step 3: Rewrite `packages/firebase-shared/src/env.ts`**

Replace the entire file:

```ts
import { z } from 'zod';

// Portal Firebase project (Firestore + Auth — UAT in dev, prod in prod)
export const portalAdminEnvSchema = z.object({
  PORTAL_FIREBASE_PROJECT_ID: z.string().min(1),
  PORTAL_FIREBASE_CLIENT_EMAIL: z.string().email(),
  PORTAL_FIREBASE_PRIVATE_KEY: z.string().min(1),
});
export type PortalAdminEnv = z.infer<typeof portalAdminEnvSchema>;

export const portalClientEnvSchema = z.object({
  NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID: z.string().min(1),
});
export type PortalClientEnv = z.infer<typeof portalClientEnvSchema>;

// Master Firebase project (RTDB reads — always prod)
export const masterAdminEnvSchema = z.object({
  MASTER_FIREBASE_PROJECT_ID: z.string().min(1),
  MASTER_FIREBASE_CLIENT_EMAIL: z.string().email(),
  MASTER_FIREBASE_PRIVATE_KEY: z.string().min(1),
  MASTER_FIREBASE_DATABASE_URL: z.string().url(),
});
export type MasterAdminEnv = z.infer<typeof masterAdminEnvSchema>;

export const masterClientEnvSchema = z.object({
  NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL: z.string().url(),
});
export type MasterClientEnv = z.infer<typeof masterClientEnvSchema>;

export function readPortalAdminEnv(): PortalAdminEnv {
  const parsed = portalAdminEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.errors.map((e) => e.path.join('.')).join(', ');
    throw new Error(
      `[firebase-shared] Missing or invalid portal admin env vars: ${missing}. ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export function readMasterAdminEnv(): MasterAdminEnv {
  const parsed = masterAdminEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.errors.map((e) => e.path.join('.')).join(', ');
    throw new Error(
      `[firebase-shared] Missing or invalid master admin env vars: ${missing}. ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/firebase-shared test
```

Expected: all tests in `env.test.ts` pass. The existing `admin.test.ts` will fail because `admin.ts` still imports the old `readAdminEnv` — that's fixed in Task 4.

- [ ] **Step 5: Commit**

```sh
git add packages/firebase-shared/src/env.ts packages/firebase-shared/src/__tests__/env.test.ts
git commit -m "feat(firebase-shared): split env schema into portal (Firestore+Auth) and master (RTDB) projects"
```

---

## Task 3: Create `apps/portal/src/lib/env.ts` — portal-wide Zod schema

Portal-level env schema that validates *everything* the portal needs at startup (Firebase, auth, AWS, feature flags, cron). Extends the narrow firebase-shared schemas with AWS + auth + flags.

**Files:**
- Create: `apps/portal/src/lib/env.ts`
- Test: `apps/portal/src/lib/__tests__/env.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/lib/__tests__/env.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { portalEnvSchema } from '../env';

const base = {
  PORTAL_FIREBASE_PROJECT_ID: 'p',
  PORTAL_FIREBASE_CLIENT_EMAIL: 'sa@p.iam.gserviceaccount.com',
  PORTAL_FIREBASE_PRIVATE_KEY: 'key',
  NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY: 'AIza',
  NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN: 'p.firebaseapp.com',
  NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID: 'p',
  NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET: 'p.firebasestorage.app',
  NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID: '123',
  NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID: '1:123:web:abc',
  MASTER_FIREBASE_PROJECT_ID: 'm',
  MASTER_FIREBASE_CLIENT_EMAIL: 'sa@m.iam.gserviceaccount.com',
  MASTER_FIREBASE_PRIVATE_KEY: 'key',
  MASTER_FIREBASE_DATABASE_URL: 'https://m-default-rtdb.firebaseio.com',
  NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL: 'https://m-default-rtdb.firebaseio.com',
  TEACHER_PASSPHRASE: 'TeacherOM!',
};

describe('portalEnvSchema', () => {
  it('parses a complete valid env', () => {
    const result = portalEnvSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('defaults SESSION_COOKIE_EXPIRES_DAYS to 5', () => {
    const result = portalEnvSchema.parse(base);
    expect(result.SESSION_COOKIE_EXPIRES_DAYS).toBe(5);
  });

  it('coerces SESSION_COOKIE_EXPIRES_DAYS from string', () => {
    const result = portalEnvSchema.parse({ ...base, SESSION_COOKIE_EXPIRES_DAYS: '7' });
    expect(result.SESSION_COOKIE_EXPIRES_DAYS).toBe(7);
  });

  it('rejects SESSION_COOKIE_EXPIRES_DAYS > 14', () => {
    const result = portalEnvSchema.safeParse({ ...base, SESSION_COOKIE_EXPIRES_DAYS: '30' });
    expect(result.success).toBe(false);
  });

  it('rejects TEACHER_PASSPHRASE shorter than 6 chars', () => {
    const result = portalEnvSchema.safeParse({ ...base, TEACHER_PASSPHRASE: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects missing PORTAL_FIREBASE_PRIVATE_KEY with a message mentioning the field', () => {
    const { PORTAL_FIREBASE_PRIVATE_KEY: _omit, ...withoutKey } = base;
    const result = portalEnvSchema.safeParse(withoutKey);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('PORTAL_FIREBASE_PRIVATE_KEY'))).toBe(
        true,
      );
    }
  });

  it('defaults feature flags to false', () => {
    const result = portalEnvSchema.parse(base);
    expect(result.NEXT_PUBLIC_FEATURE_CHECK_IN).toBe('false');
    expect(result.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN).toBe('false');
  });

  it('parses feature flag true strings', () => {
    const result = portalEnvSchema.parse({
      ...base,
      NEXT_PUBLIC_FEATURE_CHECK_IN: 'true',
      NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN: 'true',
    });
    expect(result.NEXT_PUBLIC_FEATURE_CHECK_IN).toBe('true');
    expect(result.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN).toBe('true');
  });

  it('defaults AWS_SES_REGION to ca-central-1', () => {
    const result = portalEnvSchema.parse(base);
    expect(result.AWS_SES_REGION).toBe('ca-central-1');
  });

  it('defaults AWS_SNS_REGION to us-east-1', () => {
    const result = portalEnvSchema.parse(base);
    expect(result.AWS_SNS_REGION).toBe('us-east-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/lib/__tests__/env.test.ts
```

Expected: module resolution failure on `../env`.

- [ ] **Step 3: Create `apps/portal/src/lib/env.ts`**

```ts
import { z } from 'zod';

const flagString = z.enum(['true', 'false']).default('false');

export const portalEnvSchema = z.object({
  // Portal Firebase (Firestore + Auth)
  PORTAL_FIREBASE_PROJECT_ID: z.string().min(1),
  PORTAL_FIREBASE_CLIENT_EMAIL: z.string().email(),
  PORTAL_FIREBASE_PRIVATE_KEY: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID: z.string().min(1),

  // Master Firebase (RTDB reads)
  MASTER_FIREBASE_PROJECT_ID: z.string().min(1),
  MASTER_FIREBASE_CLIENT_EMAIL: z.string().email(),
  MASTER_FIREBASE_PRIVATE_KEY: z.string().min(1),
  MASTER_FIREBASE_DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL: z.string().url(),

  // Auth
  TEACHER_PASSPHRASE: z.string().min(6),
  SESSION_COOKIE_EXPIRES_DAYS: z.coerce.number().int().min(1).max(14).default(5),

  // AWS (declared now; real consumers in slice B5)
  AWS_SES_REGION: z.string().default('ca-central-1'),
  AWS_SNS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_SES_FROM_EMAIL: z.string().email().optional(),
  AWS_SNS_TOPIC_ARN: z.string().optional(),

  // Cron auth (slice B5)
  CRON_SECRET: z.string().min(16).optional(),

  // Feature flags
  NEXT_PUBLIC_FEATURE_CHECK_IN: flagString,
  NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK: flagString,
  NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY: flagString,
  NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER: flagString,
  NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN: flagString,
  NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY: flagString,
});

export type PortalEnv = z.infer<typeof portalEnvSchema>;

let cached: PortalEnv | undefined;
export function portalEnv(): PortalEnv {
  if (cached) return cached;
  const parsed = portalEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`[portal] Invalid env vars: ${missing}\n${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/lib/__tests__/env.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/lib/env.ts apps/portal/src/lib/__tests__/env.test.ts
git commit -m "feat(portal): add portal-wide zod env schema covering Firebase, auth, AWS, cron, flags"
```

---

## Task 4: Create `@cmt/firebase-shared/src/admin/apps.ts` dual-app initializer

Replace the single `getAdminApp()` with two named apps: `portal` (Firestore + Auth) and `master` (RTDB).

**Files:**
- Create: `packages/firebase-shared/src/admin/apps.ts`
- Test: `packages/firebase-shared/src/__tests__/apps.test.ts`
- Delete (later in Task 10): `packages/firebase-shared/src/admin.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/firebase-shared/src/__tests__/apps.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase-admin/app', () => {
  const apps: Array<{ name: string }> = [];
  return {
    initializeApp: vi.fn((_config, name: string) => {
      const app = { name };
      apps.push(app);
      return app;
    }),
    cert: vi.fn((c) => c),
    getApp: vi.fn((name: string) => apps.find((a) => a.name === name)),
    getApps: vi.fn(() => apps),
  };
});

import { initializeApp, getApps } from 'firebase-admin/app';
import { getPortalApp, getMasterApp } from '../admin/apps';

beforeEach(() => {
  vi.clearAllMocks();
  (getApps as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
  process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
  process.env.PORTAL_FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n';
  process.env.MASTER_FIREBASE_PROJECT_ID = 'm';
  process.env.MASTER_FIREBASE_CLIENT_EMAIL = 'sa@m.iam.gserviceaccount.com';
  process.env.MASTER_FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nxyz\\n-----END PRIVATE KEY-----\\n';
  process.env.MASTER_FIREBASE_DATABASE_URL = 'https://m-default-rtdb.firebaseio.com';
});

afterEach(() => {
  vi.resetModules();
});

describe('getPortalApp', () => {
  it('initializes a portal-named Firebase Admin app', () => {
    const app = getPortalApp();
    expect(app.name).toBe('portal');
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: expect.objectContaining({ projectId: 'p' }),
      }),
      'portal',
    );
  });

  it('returns the existing app on subsequent calls', () => {
    const first = getPortalApp();
    const second = getPortalApp();
    expect(first).toBe(second);
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it('restores escaped newlines in the private key', () => {
    getPortalApp();
    const call = (initializeApp as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.credential.privateKey).toContain('\n');
    expect(call.credential.privateKey).not.toContain('\\n');
  });
});

describe('getMasterApp', () => {
  it('initializes a master-named Firebase Admin app with databaseURL', () => {
    const app = getMasterApp();
    expect(app.name).toBe('master');
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: expect.objectContaining({ projectId: 'm' }),
        databaseURL: 'https://m-default-rtdb.firebaseio.com',
      }),
      'master',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/apps.test.ts
```

Expected: module not found: `../admin/apps`.

- [ ] **Step 3: Create `packages/firebase-shared/src/admin/apps.ts`**

```ts
import { getApp, getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { readPortalAdminEnv, readMasterAdminEnv } from '../env';

export function getPortalApp(): App {
  const existing = getApps().find((a) => a.name === 'portal');
  if (existing) return existing;

  const env = readPortalAdminEnv();
  return initializeApp(
    {
      credential: cert({
        projectId: env.PORTAL_FIREBASE_PROJECT_ID,
        clientEmail: env.PORTAL_FIREBASE_CLIENT_EMAIL,
        privateKey: env.PORTAL_FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    },
    'portal',
  );
}

export function getMasterApp(): App {
  const existing = getApps().find((a) => a.name === 'master');
  if (existing) return existing;

  const env = readMasterAdminEnv();
  return initializeApp(
    {
      credential: cert({
        projectId: env.MASTER_FIREBASE_PROJECT_ID,
        clientEmail: env.MASTER_FIREBASE_CLIENT_EMAIL,
        privateKey: env.MASTER_FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      databaseURL: env.MASTER_FIREBASE_DATABASE_URL,
    },
    'master',
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/apps.test.ts
```

Expected: all three `getPortalApp` and `getMasterApp` tests pass. The existing `admin.test.ts` still fails — that's fixed in Task 10 when the old `admin.ts` is removed.

- [ ] **Step 5: Commit**

```sh
git add packages/firebase-shared/src/admin/apps.ts packages/firebase-shared/src/__tests__/apps.test.ts
git commit -m "feat(firebase-shared): dual-app Admin SDK initializer (portal + master)"
```

---

## Task 5: Create `admin/auth.ts` — `portalAuth` wrapper

Thin wrapper that returns `Auth` bound to the portal app.

**Files:**
- Create: `packages/firebase-shared/src/admin/auth.ts`
- Test: `packages/firebase-shared/src/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/firebase-shared/src/__tests__/auth.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_c, name) => ({ name })),
  cert: vi.fn((c) => c),
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn((app) => ({ app, type: 'Auth' })),
}));

import { getAuth } from 'firebase-admin/auth';
import { portalAuth } from '../admin/auth';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
  process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
  process.env.PORTAL_FIREBASE_PRIVATE_KEY = 'key';
});

describe('portalAuth', () => {
  it('returns Auth bound to the portal Firebase app', () => {
    const auth = portalAuth();
    expect(getAuth).toHaveBeenCalledWith(expect.objectContaining({ name: 'portal' }));
    expect(auth).toEqual(expect.objectContaining({ type: 'Auth' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/auth.test.ts
```

Expected: cannot resolve `../admin/auth`.

- [ ] **Step 3: Create `packages/firebase-shared/src/admin/auth.ts`**

```ts
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getPortalApp } from './apps';

export function portalAuth(): Auth {
  return getAuth(getPortalApp());
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/auth.test.ts
```

Expected: test passes.

- [ ] **Step 5: Commit**

```sh
git add packages/firebase-shared/src/admin/auth.ts packages/firebase-shared/src/__tests__/auth.test.ts
git commit -m "feat(firebase-shared): portalAuth wrapper bound to portal Admin app"
```

---

## Task 6: Create `admin/firestore.ts` — `portalFirestore` wrapper

**Files:**
- Create: `packages/firebase-shared/src/admin/firestore.ts`
- Test: `packages/firebase-shared/src/__tests__/firestore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/firebase-shared/src/__tests__/firestore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_c, name) => ({ name })),
  cert: vi.fn((c) => c),
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn((app) => ({ app, type: 'Firestore' })),
}));

import { getFirestore } from 'firebase-admin/firestore';
import { portalFirestore } from '../admin/firestore';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
  process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
  process.env.PORTAL_FIREBASE_PRIVATE_KEY = 'key';
});

describe('portalFirestore', () => {
  it('returns Firestore bound to the portal app', () => {
    const fs = portalFirestore();
    expect(getFirestore).toHaveBeenCalledWith(expect.objectContaining({ name: 'portal' }));
    expect(fs).toEqual(expect.objectContaining({ type: 'Firestore' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/firestore.test.ts
```

Expected: cannot resolve `../admin/firestore`.

- [ ] **Step 3: Create `packages/firebase-shared/src/admin/firestore.ts`**

```ts
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getPortalApp } from './apps';

export function portalFirestore(): Firestore {
  return getFirestore(getPortalApp());
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/firestore.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add packages/firebase-shared/src/admin/firestore.ts packages/firebase-shared/src/__tests__/firestore.test.ts
git commit -m "feat(firebase-shared): portalFirestore wrapper bound to portal Admin app"
```

---

## Task 7: Create `admin/rtdb.ts` — read-only RTDB helpers

Exposes `masterRtdb()` and `readRtdb<T>(path)`. **No write helpers exist.** This is the single permitted entry point for `firebase-admin/database` imports in the monorepo (enforced in Task 10).

**Files:**
- Create: `packages/firebase-shared/src/admin/rtdb.ts`
- Test: `packages/firebase-shared/src/__tests__/rtdb.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/firebase-shared/src/__tests__/rtdb.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeSnap = (value: unknown) => ({ val: () => value });

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_c, name) => ({ name })),
  cert: vi.fn((c) => c),
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

const fakeRef = { once: vi.fn() };
const fakeDb = { ref: vi.fn(() => fakeRef) };
vi.mock('firebase-admin/database', () => ({
  getDatabase: vi.fn(() => fakeDb),
}));

import { getDatabase } from 'firebase-admin/database';
import * as rtdbModule from '../admin/rtdb';
import { masterRtdb, readRtdb } from '../admin/rtdb';

beforeEach(() => {
  vi.clearAllMocks();
  fakeRef.once.mockReset();
  process.env.MASTER_FIREBASE_PROJECT_ID = 'm';
  process.env.MASTER_FIREBASE_CLIENT_EMAIL = 'sa@m.iam.gserviceaccount.com';
  process.env.MASTER_FIREBASE_PRIVATE_KEY = 'key';
  process.env.MASTER_FIREBASE_DATABASE_URL = 'https://m-default-rtdb.firebaseio.com';
});

describe('masterRtdb', () => {
  it('returns Database bound to the master app', () => {
    masterRtdb();
    expect(getDatabase).toHaveBeenCalledWith(expect.objectContaining({ name: 'master' }));
  });
});

describe('readRtdb', () => {
  it('reads a path and returns the value', async () => {
    fakeRef.once.mockResolvedValueOnce(fakeSnap({ fid: 42, name: 'Acme' }));
    const data = await readRtdb<{ fid: number; name: string }>('/families/42');
    expect(fakeDb.ref).toHaveBeenCalledWith('/families/42');
    expect(fakeRef.once).toHaveBeenCalledWith('value');
    expect(data).toEqual({ fid: 42, name: 'Acme' });
  });

  it('returns null when path is empty', async () => {
    fakeRef.once.mockResolvedValueOnce(fakeSnap(null));
    const data = await readRtdb('/families/999');
    expect(data).toBeNull();
  });
});

describe('rtdb exports', () => {
  it('does not export any write helpers', () => {
    expect(rtdbModule).not.toHaveProperty('writeRtdb');
    expect(rtdbModule).not.toHaveProperty('updateRtdb');
    expect(rtdbModule).not.toHaveProperty('pushRtdb');
    expect(rtdbModule).not.toHaveProperty('removeRtdb');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/rtdb.test.ts
```

Expected: cannot resolve `../admin/rtdb`.

- [ ] **Step 3: Create `packages/firebase-shared/src/admin/rtdb.ts`**

```ts
import { getDatabase, type Database } from 'firebase-admin/database';
import { getMasterApp } from './apps';

export function masterRtdb(): Database {
  return getDatabase(getMasterApp());
}

export async function readRtdb<T>(path: string): Promise<T | null> {
  const snap = await masterRtdb().ref(path).once('value');
  const value = snap.val();
  return (value as T | null) ?? null;
}

// Intentionally: NO writeRtdb, NO updateRtdb, NO pushRtdb, NO removeRtdb.
// RTDB is read-only by convention and by absence of helpers.
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/rtdb.test.ts
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/firebase-shared/src/admin/rtdb.ts packages/firebase-shared/src/__tests__/rtdb.test.ts
git commit -m "feat(firebase-shared): read-only RTDB helper (masterRtdb, readRtdb) — no write helpers present"
```

---

## Task 8: Create `admin/session.ts` — session cookie + custom-token exchange

This module is the session-cookie implementation. It wraps `createSessionCookie`, `verifySessionCookie`, and `verifyIdToken` from the Admin SDK, plus the Identity Toolkit REST call for exchanging custom tokens → ID tokens. `createPortalSessionCookie` accepts an ID token; `exchangeCustomTokenForIdToken` accepts a custom token and calls the REST endpoint.

**Files:**
- Create: `packages/firebase-shared/src/admin/session.ts`
- Test: `packages/firebase-shared/src/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/firebase-shared/src/__tests__/session.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_c, name) => ({ name })),
  cert: vi.fn((c) => c),
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

const mockAuth = {
  createSessionCookie: vi.fn(),
  verifySessionCookie: vi.fn(),
  verifyIdToken: vi.fn(),
};
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => mockAuth),
}));

import {
  createPortalSessionCookie,
  verifyPortalSessionCookie,
  verifyPortalIdToken,
  exchangeCustomTokenForIdToken,
} from '../admin/session';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.createSessionCookie.mockReset();
  mockAuth.verifySessionCookie.mockReset();
  mockAuth.verifyIdToken.mockReset();
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
  process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
  process.env.PORTAL_FIREBASE_PRIVATE_KEY = 'key';
  process.env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY = 'AIza-fake';
});

describe('createPortalSessionCookie', () => {
  it('creates a session cookie with the configured expiry', async () => {
    mockAuth.createSessionCookie.mockResolvedValueOnce('session-token');
    const result = await createPortalSessionCookie('id-token', 5);
    expect(mockAuth.createSessionCookie).toHaveBeenCalledWith('id-token', {
      expiresIn: 5 * 24 * 60 * 60 * 1000,
    });
    expect(result).toBe('session-token');
  });
});

describe('verifyPortalSessionCookie', () => {
  it('verifies with checkRevoked=true by default', async () => {
    mockAuth.verifySessionCookie.mockResolvedValueOnce({ uid: 'u1', role: 'admin' });
    const claims = await verifyPortalSessionCookie('session-token');
    expect(mockAuth.verifySessionCookie).toHaveBeenCalledWith('session-token', true);
    expect(claims.uid).toBe('u1');
    expect(claims.role).toBe('admin');
  });

  it('returns null when verification throws', async () => {
    mockAuth.verifySessionCookie.mockRejectedValueOnce(new Error('expired'));
    const claims = await verifyPortalSessionCookie('bad-token');
    expect(claims).toBeNull();
  });
});

describe('verifyPortalIdToken', () => {
  it('verifies a bearer ID token with checkRevoked', async () => {
    mockAuth.verifyIdToken.mockResolvedValueOnce({ uid: 'u2', role: 'teacher' });
    const claims = await verifyPortalIdToken('id-token');
    expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('id-token', true);
    expect(claims?.uid).toBe('u2');
  });

  it('returns null when verification throws', async () => {
    mockAuth.verifyIdToken.mockRejectedValueOnce(new Error('invalid'));
    const claims = await verifyPortalIdToken('bad');
    expect(claims).toBeNull();
  });
});

describe('exchangeCustomTokenForIdToken', () => {
  it('calls the Identity Toolkit REST endpoint and returns the idToken', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ idToken: 'the-id-token', refreshToken: 'r', expiresIn: '3600' }),
    } as Response);

    const idToken = await exchangeCustomTokenForIdToken('custom-tok');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIza-fake',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'custom-tok', returnSecureToken: true }),
      }),
    );
    expect(idToken).toBe('the-id-token');
  });

  it('throws a clear error on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'INVALID_CUSTOM_TOKEN' } }),
    } as Response);
    await expect(exchangeCustomTokenForIdToken('bad')).rejects.toThrow(/INVALID_CUSTOM_TOKEN/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/session.test.ts
```

Expected: cannot resolve `../admin/session`.

- [ ] **Step 3: Create `packages/firebase-shared/src/admin/session.ts`**

```ts
import type { DecodedIdToken } from 'firebase-admin/auth';
import { portalAuth } from './auth';

export type PortalSessionClaims = DecodedIdToken & {
  role?: 'admin' | 'teacher' | 'family';
  familyId?: string;
};

export async function createPortalSessionCookie(
  idToken: string,
  expiresInDays: number,
): Promise<string> {
  const expiresIn = expiresInDays * 24 * 60 * 60 * 1000;
  return portalAuth().createSessionCookie(idToken, { expiresIn });
}

export async function verifyPortalSessionCookie(
  sessionCookie: string,
): Promise<PortalSessionClaims | null> {
  try {
    const decoded = await portalAuth().verifySessionCookie(sessionCookie, true);
    return decoded as PortalSessionClaims;
  } catch {
    return null;
  }
}

export async function verifyPortalIdToken(
  idToken: string,
): Promise<PortalSessionClaims | null> {
  try {
    const decoded = await portalAuth().verifyIdToken(idToken, true);
    return decoded as PortalSessionClaims;
  } catch {
    return null;
  }
}

export async function exchangeCustomTokenForIdToken(customToken: string): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[firebase-shared] NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY is required to exchange custom tokens',
    );
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(`[firebase-shared] exchangeCustomTokenForIdToken failed: ${msg}`);
  }
  const json = (await res.json()) as { idToken: string };
  return json.idToken;
}

export async function signInWithEmailPassword(
  email: string,
  password: string,
): Promise<{ idToken: string; localId: string }> {
  const apiKey = process.env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[firebase-shared] NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY is required for email/password sign-in',
    );
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(`[firebase-shared] signInWithEmailPassword failed: ${msg}`);
  }
  return (await res.json()) as { idToken: string; localId: string };
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/session.test.ts
```

Expected: all session tests pass. (The `signInWithEmailPassword` helper is untested in this task — covered by the admin signin route test in Task 22.)

- [ ] **Step 5: Commit**

```sh
git add packages/firebase-shared/src/admin/session.ts packages/firebase-shared/src/__tests__/session.test.ts
git commit -m "feat(firebase-shared): session cookie + Identity Toolkit REST helpers (createPortalSessionCookie, verify, exchange, signInWithEmailPassword)"
```

---

## Task 9: Create `admin/claims.ts` — custom claims helpers

**Files:**
- Create: `packages/firebase-shared/src/admin/claims.ts`
- Test: `packages/firebase-shared/src/__tests__/claims.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/firebase-shared/src/__tests__/claims.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_c, name) => ({ name })),
  cert: vi.fn((c) => c),
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

const mockAuth = {
  setCustomUserClaims: vi.fn(),
  getUser: vi.fn(),
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  createCustomToken: vi.fn(),
};
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => mockAuth),
}));

import {
  setPortalUserClaims,
  getPortalUserWithClaims,
  getOrCreateSharedTeacherUser,
  createPortalCustomToken,
} from '../admin/claims';

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(mockAuth).forEach((fn) => fn.mockReset());
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
  process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
  process.env.PORTAL_FIREBASE_PRIVATE_KEY = 'key';
});

describe('setPortalUserClaims', () => {
  it('sets custom claims on a user', async () => {
    await setPortalUserClaims('uid-1', { role: 'admin' });
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith('uid-1', { role: 'admin' });
  });
});

describe('getPortalUserWithClaims', () => {
  it('returns the user with custom claims', async () => {
    mockAuth.getUser.mockResolvedValueOnce({
      uid: 'u1',
      email: 'a@b.com',
      customClaims: { role: 'admin' },
    });
    const user = await getPortalUserWithClaims('u1');
    expect(user.claims).toEqual({ role: 'admin' });
    expect(user.uid).toBe('u1');
  });

  it('returns empty claims when none set', async () => {
    mockAuth.getUser.mockResolvedValueOnce({ uid: 'u2', email: 'c@d.com' });
    const user = await getPortalUserWithClaims('u2');
    expect(user.claims).toEqual({});
  });
});

describe('getOrCreateSharedTeacherUser', () => {
  it('returns existing teacher user when it exists', async () => {
    mockAuth.getUser.mockResolvedValueOnce({ uid: 'teacher-shared-v1' });
    const user = await getOrCreateSharedTeacherUser();
    expect(user.uid).toBe('teacher-shared-v1');
    expect(mockAuth.createUser).not.toHaveBeenCalled();
  });

  it('creates the teacher user when it does not exist', async () => {
    mockAuth.getUser.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    mockAuth.createUser.mockResolvedValueOnce({ uid: 'teacher-shared-v1' });
    const user = await getOrCreateSharedTeacherUser();
    expect(mockAuth.createUser).toHaveBeenCalledWith({
      uid: 'teacher-shared-v1',
      disabled: false,
    });
    expect(user.uid).toBe('teacher-shared-v1');
  });

  it('sets the teacher role claim on every call', async () => {
    mockAuth.getUser.mockResolvedValueOnce({ uid: 'teacher-shared-v1' });
    await getOrCreateSharedTeacherUser();
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith('teacher-shared-v1', {
      role: 'teacher',
    });
  });
});

describe('createPortalCustomToken', () => {
  it('delegates to Admin SDK createCustomToken', async () => {
    mockAuth.createCustomToken.mockResolvedValueOnce('custom-tok');
    const token = await createPortalCustomToken('uid-x', { role: 'family', familyId: '42' });
    expect(mockAuth.createCustomToken).toHaveBeenCalledWith('uid-x', {
      role: 'family',
      familyId: '42',
    });
    expect(token).toBe('custom-tok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/claims.test.ts
```

Expected: module resolution failure.

- [ ] **Step 3: Create `packages/firebase-shared/src/admin/claims.ts`**

```ts
import type { UserRecord } from 'firebase-admin/auth';
import { portalAuth } from './auth';

export type PortalRole = 'admin' | 'teacher' | 'family';
export interface PortalClaims {
  role: PortalRole;
  familyId?: string;
  email?: string;
  phone?: string;
}

export async function setPortalUserClaims(uid: string, claims: PortalClaims): Promise<void> {
  await portalAuth().setCustomUserClaims(uid, claims);
}

export interface UserWithClaims {
  uid: string;
  email?: string;
  claims: PortalClaims | Record<string, never>;
}

export async function getPortalUserWithClaims(uid: string): Promise<UserWithClaims> {
  const user = await portalAuth().getUser(uid);
  return {
    uid: user.uid,
    email: user.email,
    claims: (user.customClaims as PortalClaims | undefined) ?? {},
  };
}

export const SHARED_TEACHER_UID = 'teacher-shared-v1';

export async function getOrCreateSharedTeacherUser(): Promise<UserRecord> {
  let user: UserRecord;
  try {
    user = await portalAuth().getUser(SHARED_TEACHER_UID);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      user = await portalAuth().createUser({
        uid: SHARED_TEACHER_UID,
        disabled: false,
      });
    } else {
      throw err;
    }
  }
  await portalAuth().setCustomUserClaims(SHARED_TEACHER_UID, { role: 'teacher' });
  return user;
}

export async function createPortalCustomToken(
  uid: string,
  claims: PortalClaims,
): Promise<string> {
  return portalAuth().createCustomToken(uid, claims);
}

export async function getOrCreateAdminUser(
  email: string,
  password: string,
): Promise<UserRecord> {
  let user: UserRecord;
  try {
    user = await portalAuth().getUserByEmail(email);
    await portalAuth().updateUser(user.uid, { password, disabled: false });
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      user = await portalAuth().createUser({ email, password, disabled: false });
    } else {
      throw err;
    }
  }
  await portalAuth().setCustomUserClaims(user.uid, { role: 'admin', email });
  return user;
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/firebase-shared test -- src/__tests__/claims.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/firebase-shared/src/admin/claims.ts packages/firebase-shared/src/__tests__/claims.test.ts
git commit -m "feat(firebase-shared): custom claims + user provisioning helpers (admin, shared teacher, custom token)"
```

---

## Task 10: Remove old `admin.ts`, update package exports, add RTDB lint rule

Delete the legacy `admin.ts` and point `package.json` exports at the new `admin/` directory. Add a lint rule blocking `firebase-admin/database` imports outside `src/admin/rtdb.ts`.

**Files:**
- Delete: `packages/firebase-shared/src/admin.ts`
- Delete: `packages/firebase-shared/src/__tests__/admin.test.ts` (obsolete; replaced by apps/auth/firestore/rtdb tests)
- Modify: `packages/firebase-shared/src/index.ts`
- Modify: `packages/firebase-shared/package.json`
- Modify: `packages/firebase-shared/eslint.config.js`

- [ ] **Step 1: Delete the old admin entry point and its test**

```sh
rm packages/firebase-shared/src/admin.ts
rm packages/firebase-shared/src/__tests__/admin.test.ts
```

- [ ] **Step 2: Update `packages/firebase-shared/src/index.ts`**

Replace file contents:

```ts
// Type-only re-exports. Runtime imports must use /admin or /client subpaths.
export type { PortalAdminEnv, MasterAdminEnv, PortalClientEnv, MasterClientEnv } from './env';
export type { PortalSessionClaims } from './admin/session';
export type { PortalRole, PortalClaims, UserWithClaims } from './admin/claims';
```

- [ ] **Step 3: Update `packages/firebase-shared/package.json`**

Replace the `exports` block with explicit subpaths for each admin module:

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
    "./admin/apps": {
      "types": "./src/admin/apps.ts",
      "default": "./src/admin/apps.ts"
    },
    "./admin/auth": {
      "types": "./src/admin/auth.ts",
      "default": "./src/admin/auth.ts"
    },
    "./admin/firestore": {
      "types": "./src/admin/firestore.ts",
      "default": "./src/admin/firestore.ts"
    },
    "./admin/rtdb": {
      "types": "./src/admin/rtdb.ts",
      "default": "./src/admin/rtdb.ts"
    },
    "./admin/session": {
      "types": "./src/admin/session.ts",
      "default": "./src/admin/session.ts"
    },
    "./admin/claims": {
      "types": "./src/admin/claims.ts",
      "default": "./src/admin/claims.ts"
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

- [ ] **Step 4: Update `packages/firebase-shared/eslint.config.js` to block `firebase-admin/database` imports outside `rtdb.ts`**

Replace the file contents:

```js
import config from '@cmt/config/eslint';

export default [
  ...config,
  {
    files: ['packages/firebase-shared/src/**/*.ts'],
    ignores: ['packages/firebase-shared/src/admin/rtdb.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'firebase-admin/database',
              message:
                'Import from @cmt/firebase-shared/admin/rtdb instead. RTDB is read-only and access is gated.',
            },
          ],
        },
      ],
    },
  },
];
```

- [ ] **Step 5: Run full firebase-shared suite + typecheck + lint**

```sh
pnpm --filter @cmt/firebase-shared typecheck && pnpm --filter @cmt/firebase-shared lint && pnpm --filter @cmt/firebase-shared test
```

Expected: all three green. Tests: `apps`, `auth`, `firestore`, `rtdb`, `session`, `claims`, `env` all pass (~30+ tests).

- [ ] **Step 6: Commit**

```sh
git add packages/firebase-shared/
git commit -m "refactor(firebase-shared): split admin.ts into admin/{apps,auth,firestore,rtdb,session,claims} with RTDB import lint"
```

---

## Task 11: Create `@cmt/shared-domain/src/auth/role.ts` — role union + predicates

Pure TypeScript. Zero imports.

**Files:**
- Create: `packages/shared-domain/src/auth/role.ts`
- Test: `packages/shared-domain/src/__tests__/role.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared-domain/src/__tests__/role.test.ts
import { describe, it, expect } from 'vitest';
import { isAdmin, isTeacher, isFamily, ROLES, type Role } from '../auth/role';

describe('ROLES', () => {
  it('lists the three known roles', () => {
    expect(ROLES).toEqual(['admin', 'teacher', 'family']);
  });
});

describe('isAdmin', () => {
  it('returns true for admin', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
  });
  it('returns false for teacher', () => {
    expect(isAdmin({ role: 'teacher' })).toBe(false);
  });
  it('returns false for family', () => {
    expect(isAdmin({ role: 'family' })).toBe(false);
  });
  it('returns false for undefined role', () => {
    expect(isAdmin({})).toBe(false);
  });
});

describe('isTeacher', () => {
  it('returns true for teacher', () => {
    expect(isTeacher({ role: 'teacher' })).toBe(true);
  });
  it('returns true for admin (inherits teacher)', () => {
    expect(isTeacher({ role: 'admin' })).toBe(true);
  });
  it('returns false for family', () => {
    expect(isTeacher({ role: 'family' })).toBe(false);
  });
});

describe('isFamily', () => {
  it('returns true for family', () => {
    expect(isFamily({ role: 'family' })).toBe(true);
  });
  it('returns false for admin', () => {
    expect(isFamily({ role: 'admin' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/shared-domain test -- src/__tests__/role.test.ts
```

Expected: cannot resolve `../auth/role`.

- [ ] **Step 3: Create `packages/shared-domain/src/auth/role.ts`**

```ts
export const ROLES = ['admin', 'teacher', 'family'] as const;
export type Role = (typeof ROLES)[number];

export interface WithRole {
  role?: Role;
}

export function isAdmin(claims: WithRole): boolean {
  return claims.role === 'admin';
}

export function isTeacher(claims: WithRole): boolean {
  // admin inherits teacher
  return claims.role === 'teacher' || claims.role === 'admin';
}

export function isFamily(claims: WithRole): boolean {
  return claims.role === 'family';
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/shared-domain test -- src/__tests__/role.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/shared-domain/src/auth/role.ts packages/shared-domain/src/__tests__/role.test.ts
git commit -m "feat(shared-domain): add Role union and role predicate helpers (admin inherits teacher)"
```

---

## Task 12: Create `@cmt/shared-domain/src/auth/session.ts` — SessionClaims type

Pure type module for session claims shape.

**Files:**
- Create: `packages/shared-domain/src/auth/session.ts`

- [ ] **Step 1: Create `packages/shared-domain/src/auth/session.ts`**

```ts
import type { Role } from './role';

export interface SessionClaims {
  uid: string;
  role: Role;
  familyId?: string;
  email?: string;
  phone?: string;
  iat?: number;
  exp?: number;
}
```

- [ ] **Step 2: Verify it compiles (no test — types only)**

```sh
pnpm --filter @cmt/shared-domain typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```sh
git add packages/shared-domain/src/auth/session.ts
git commit -m "feat(shared-domain): add SessionClaims type"
```

---

## Task 13: Create `@cmt/shared-domain/src/auth/public-routes.ts`

Public route whitelist as data + a `matchRoute` helper.

**Files:**
- Create: `packages/shared-domain/src/auth/public-routes.ts`
- Test: `packages/shared-domain/src/__tests__/public-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared-domain/src/__tests__/public-routes.test.ts
import { describe, it, expect } from 'vitest';
import { PUBLIC_ROUTES, matchRoute, isPublicRoute } from '../auth/public-routes';

describe('PUBLIC_ROUTES', () => {
  it('includes portal landing and events stub', () => {
    expect(PUBLIC_ROUTES).toContain('/');
    expect(PUBLIC_ROUTES).toContain('/events');
  });
  it('includes /login and its sub-paths', () => {
    expect(PUBLIC_ROUTES).toContain('/login');
    expect(PUBLIC_ROUTES).toContain('/login/admin');
    expect(PUBLIC_ROUTES).toContain('/login/teacher');
    expect(PUBLIC_ROUTES).toContain('/login/family');
  });
  it('includes kiosk routes', () => {
    expect(PUBLIC_ROUTES).toContain('/check-in');
    expect(PUBLIC_ROUTES).toContain('/check-in/guest');
    expect(PUBLIC_ROUTES).toContain('/check-in/lookup');
  });
  it('includes public auth APIs', () => {
    expect(PUBLIC_ROUTES).toContain('/api/auth/admin/signin');
    expect(PUBLIC_ROUTES).toContain('/api/auth/teacher/signin');
    expect(PUBLIC_ROUTES).toContain('/api/auth/family/send-code');
    expect(PUBLIC_ROUTES).toContain('/api/auth/family/verify-code');
    expect(PUBLIC_ROUTES).toContain('/api/auth/signout');
  });
});

describe('matchRoute', () => {
  it('exact match', () => {
    expect(matchRoute('/login', '/login')).toBe(true);
    expect(matchRoute('/login', '/login/admin')).toBe(false);
  });
  it('prefix match with trailing /', () => {
    expect(matchRoute('/login/', '/login/admin')).toBe(true);
    expect(matchRoute('/login/', '/loginz')).toBe(false);
  });
  it(':param placeholder matches one segment', () => {
    expect(matchRoute('/api/check-in/families/:familyId', '/api/check-in/families/42')).toBe(true);
    expect(matchRoute('/api/check-in/families/:familyId', '/api/check-in/families/42/check-in')).toBe(
      false,
    );
  });
});

describe('isPublicRoute', () => {
  it('returns true for a listed public route', () => {
    expect(isPublicRoute('/login')).toBe(true);
    expect(isPublicRoute('/check-in/guest')).toBe(true);
  });
  it('returns false for a protected route', () => {
    expect(isPublicRoute('/check-in/admin')).toBe(false);
    expect(isPublicRoute('/check-in/family')).toBe(false);
  });
  it('returns true for :param route matches', () => {
    expect(isPublicRoute('/api/check-in/families/42')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/shared-domain test -- src/__tests__/public-routes.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `packages/shared-domain/src/auth/public-routes.ts`**

```ts
export const PUBLIC_ROUTES = [
  // Slice A landing + stubs
  '/',
  '/events',

  // Login surface
  '/login',
  '/login/admin',
  '/login/teacher',
  '/login/family',

  // Kiosk (public) — feature-flagged in the app layer
  '/check-in',
  '/check-in/guest',
  '/check-in/lookup',

  // Public auth APIs
  '/api/auth/admin/signin',
  '/api/auth/teacher/signin',
  '/api/auth/family/send-code',
  '/api/auth/family/verify-code',
  '/api/auth/signout',

  // Public kiosk APIs
  '/api/check-in/families/:familyId',
  '/api/check-in/families/:familyId/check-in',
  '/api/check-in/lookup',
  '/api/check-in/guests',
] as const;

export function matchRoute(pattern: string, pathname: string): boolean {
  // Trailing slash = prefix match
  if (pattern.endsWith('/')) {
    return pathname.startsWith(pattern);
  }

  // :param = single segment match
  if (pattern.includes(':')) {
    const patternSegments = pattern.split('/');
    const pathSegments = pathname.split('/');
    if (patternSegments.length !== pathSegments.length) return false;
    for (let i = 0; i < patternSegments.length; i++) {
      const p = patternSegments[i];
      const s = pathSegments[i];
      if (p === undefined || s === undefined) return false;
      if (p.startsWith(':')) continue;
      if (p !== s) return false;
    }
    return true;
  }

  // Exact match
  return pattern === pathname;
}

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((p) => matchRoute(p, pathname));
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/shared-domain test -- src/__tests__/public-routes.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/shared-domain/src/auth/public-routes.ts packages/shared-domain/src/__tests__/public-routes.test.ts
git commit -m "feat(shared-domain): add PUBLIC_ROUTES data + matchRoute helper with :param support"
```

---

## Task 14: Create `@cmt/shared-domain/src/auth/can-access-route.ts` + barrel

The core access-decision function. Unit-tested with a comprehensive matrix.

**Files:**
- Create: `packages/shared-domain/src/auth/can-access-route.ts`
- Create: `packages/shared-domain/src/auth/index.ts`
- Modify: `packages/shared-domain/src/index.ts`
- Test: `packages/shared-domain/src/__tests__/can-access-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared-domain/src/__tests__/can-access-route.test.ts
import { describe, it, expect } from 'vitest';
import { canAccessRoute } from '../auth/can-access-route';
import type { SessionClaims } from '../auth/session';

const admin: SessionClaims = { uid: 'a', role: 'admin' };
const teacher: SessionClaims = { uid: 't', role: 'teacher' };
const family: SessionClaims = { uid: 'f', role: 'family', familyId: '42' };

describe('canAccessRoute — public routes', () => {
  it('allows anyone to access /login', () => {
    expect(canAccessRoute(admin, '/login')).toBe(true);
    expect(canAccessRoute(teacher, '/login')).toBe(true);
    expect(canAccessRoute(family, '/login')).toBe(true);
  });
  it('allows anyone to access /check-in kiosk routes', () => {
    expect(canAccessRoute(family, '/check-in')).toBe(true);
    expect(canAccessRoute(family, '/check-in/guest')).toBe(true);
    expect(canAccessRoute(family, '/check-in/lookup')).toBe(true);
  });
});

describe('canAccessRoute — /check-in/admin', () => {
  it('allows admin', () => {
    expect(canAccessRoute(admin, '/check-in/admin')).toBe(true);
    expect(canAccessRoute(admin, '/check-in/admin/users')).toBe(true);
  });
  it('denies teacher', () => {
    expect(canAccessRoute(teacher, '/check-in/admin')).toBe(false);
  });
  it('denies family', () => {
    expect(canAccessRoute(family, '/check-in/admin')).toBe(false);
  });
});

describe('canAccessRoute — /check-in/teacher', () => {
  it('allows teacher', () => {
    expect(canAccessRoute(teacher, '/check-in/teacher')).toBe(true);
    expect(canAccessRoute(teacher, '/check-in/teacher/attendance')).toBe(true);
  });
  it('allows admin (inherits teacher)', () => {
    expect(canAccessRoute(admin, '/check-in/teacher')).toBe(true);
  });
  it('denies family', () => {
    expect(canAccessRoute(family, '/check-in/teacher')).toBe(false);
  });
});

describe('canAccessRoute — /check-in/family', () => {
  it('allows family', () => {
    expect(canAccessRoute(family, '/check-in/family')).toBe(true);
    expect(canAccessRoute(family, '/check-in/family/check-in')).toBe(true);
  });
  it('denies admin', () => {
    expect(canAccessRoute(admin, '/check-in/family')).toBe(false);
  });
  it('denies teacher', () => {
    expect(canAccessRoute(teacher, '/check-in/family')).toBe(false);
  });
});

describe('canAccessRoute — API surface mirrors pages', () => {
  it('/api/check-in/admin requires admin', () => {
    expect(canAccessRoute(admin, '/api/check-in/admin/users')).toBe(true);
    expect(canAccessRoute(teacher, '/api/check-in/admin/users')).toBe(false);
  });
  it('/api/check-in/teacher requires teacher (admin inherits)', () => {
    expect(canAccessRoute(admin, '/api/check-in/teacher/classlist')).toBe(true);
    expect(canAccessRoute(teacher, '/api/check-in/teacher/classlist')).toBe(true);
    expect(canAccessRoute(family, '/api/check-in/teacher/classlist')).toBe(false);
  });
  it('/api/check-in/family requires family', () => {
    expect(canAccessRoute(family, '/api/check-in/family/dashboard')).toBe(true);
    expect(canAccessRoute(admin, '/api/check-in/family/dashboard')).toBe(false);
  });
});

describe('canAccessRoute — unknown routes default-deny', () => {
  it('denies an unknown protected route', () => {
    expect(canAccessRoute(admin, '/some/unknown/area')).toBe(false);
    expect(canAccessRoute(teacher, '/foo')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/shared-domain test -- src/__tests__/can-access-route.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `packages/shared-domain/src/auth/can-access-route.ts`**

```ts
import type { SessionClaims } from './session';
import { isPublicRoute } from './public-routes';
import { isAdmin, isTeacher, isFamily } from './role';

export function canAccessRoute(claims: SessionClaims, pathname: string): boolean {
  if (isPublicRoute(pathname)) return true;

  // Page surface
  if (pathname === '/check-in/admin' || pathname.startsWith('/check-in/admin/')) {
    return isAdmin(claims);
  }
  if (pathname === '/check-in/teacher' || pathname.startsWith('/check-in/teacher/')) {
    return isTeacher(claims);
  }
  if (pathname === '/check-in/family' || pathname.startsWith('/check-in/family/')) {
    return isFamily(claims);
  }

  // API surface mirrors page surface
  if (pathname.startsWith('/api/check-in/admin/')) return isAdmin(claims);
  if (pathname.startsWith('/api/check-in/teacher/')) return isTeacher(claims);
  if (pathname.startsWith('/api/check-in/family/')) return isFamily(claims);

  // Notifications: admin-gated
  if (pathname.startsWith('/api/check-in/notifications/')) return isAdmin(claims);

  // Unknown protected route → deny
  return false;
}
```

- [ ] **Step 4: Create `packages/shared-domain/src/auth/index.ts`**

```ts
export * from './role';
export * from './session';
export * from './public-routes';
export * from './can-access-route';
```

- [ ] **Step 5: Modify `packages/shared-domain/src/index.ts`**

Current file likely has small re-exports. Add the auth barrel:

```ts
export * from './auth';
```

(Preserve any existing exports in the file.)

- [ ] **Step 6: Run the full shared-domain suite + typecheck + lint**

```sh
pnpm --filter @cmt/shared-domain typecheck && pnpm --filter @cmt/shared-domain lint && pnpm --filter @cmt/shared-domain test
```

Expected: all green. `canAccessRoute` tests pass (~15 assertions). `role` and `public-routes` tests still pass.

- [ ] **Step 7: Commit**

```sh
git add packages/shared-domain/src/auth/ packages/shared-domain/src/index.ts packages/shared-domain/src/__tests__/can-access-route.test.ts
git commit -m "feat(shared-domain): add canAccessRoute with admin-inherits-teacher hierarchy and default-deny"
```

---

## Task 15: Update `apps/portal/src/lib/flags.ts` with sub-feature flags

**Files:**
- Modify: `apps/portal/src/lib/flags.ts`
- Test: `apps/portal/src/lib/__tests__/flags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/lib/__tests__/flags.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

describe('flags', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN;
    delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY;
  });

  it('returns false by default for all check-in sub-flags', async () => {
    const { flags } = await import('../flags');
    expect(flags.checkIn).toBe(false);
    expect(flags.checkInKiosk).toBe(false);
    expect(flags.checkInFamily).toBe(false);
    expect(flags.checkInTeacher).toBe(false);
    expect(flags.checkInAdmin).toBe(false);
    expect(flags.checkInNotify).toBe(false);
  });

  it('AND-gates sub-flags with master checkIn', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN = 'false';
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN = 'true';
    const { flags } = await import('../flags');
    expect(flags.checkInAdmin).toBe(false);
  });

  it('returns true when both master and sub-flag are on', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN = 'true';
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN = 'true';
    const { flags } = await import('../flags');
    expect(flags.checkInAdmin).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/lib/__tests__/flags.test.ts
```

Expected: `flags.checkInKiosk` is undefined.

- [ ] **Step 3: Update `apps/portal/src/lib/flags.ts`**

```ts
function readFlag(name: string): boolean {
  return process.env[name] === 'true';
}

const master = readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN');

export const flags = {
  events: readFlag('NEXT_PUBLIC_FEATURE_EVENTS'),
  checkIn: master,
  checkInKiosk: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK'),
  checkInFamily: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY'),
  checkInTeacher: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER'),
  checkInAdmin: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN'),
  checkInNotify: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY'),
} as const;

export type FeatureFlags = typeof flags;
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/lib/__tests__/flags.test.ts
```

Expected: all flag tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/lib/flags.ts apps/portal/src/lib/__tests__/flags.test.ts
git commit -m "feat(portal): extend flags.ts with check-in sub-feature flags AND-gated with master"
```

---

## Task 16: Extend portal `eslint.config.js` with sub-feature boundaries

Sub-feature isolation: files under `features/check-in/<a>/` cannot import from `features/check-in/<b>/` except via `features/check-in/shared/`.

**Files:**
- Modify: `apps/portal/eslint.config.js`

- [ ] **Step 1: Replace `apps/portal/eslint.config.js`**

```js
import config from '@cmt/config/eslint';

export default [
  ...config,
  {
    files: ['apps/portal/src/features/check-in/**/*.{ts,tsx}'],
    settings: {
      'boundaries/elements': [
        {
          type: 'check-in-auth',
          pattern: 'apps/portal/src/features/check-in/auth',
          mode: 'folder',
        },
        {
          type: 'check-in-kiosk',
          pattern: 'apps/portal/src/features/check-in/kiosk',
          mode: 'folder',
        },
        {
          type: 'check-in-family',
          pattern: 'apps/portal/src/features/check-in/family',
          mode: 'folder',
        },
        {
          type: 'check-in-teacher',
          pattern: 'apps/portal/src/features/check-in/teacher',
          mode: 'folder',
        },
        {
          type: 'check-in-admin',
          pattern: 'apps/portal/src/features/check-in/admin',
          mode: 'folder',
        },
        {
          type: 'check-in-notifications',
          pattern: 'apps/portal/src/features/check-in/notifications',
          mode: 'folder',
        },
        {
          type: 'check-in-shared',
          pattern: 'apps/portal/src/features/check-in/shared',
          mode: 'folder',
        },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: [
                'check-in-auth',
                'check-in-kiosk',
                'check-in-family',
                'check-in-teacher',
                'check-in-admin',
                'check-in-notifications',
              ],
              disallow: [
                'check-in-auth',
                'check-in-kiosk',
                'check-in-family',
                'check-in-teacher',
                'check-in-admin',
                'check-in-notifications',
              ],
              message:
                'Cross-sub-feature imports under features/check-in/** forbidden — go through features/check-in/shared/',
            },
          ],
        },
      ],
    },
  },
];
```

- [ ] **Step 2: Run lint on the portal**

```sh
pnpm --filter @cmt/portal lint
```

Expected: zero errors. Nothing yet under `features/check-in/` so no sub-feature imports exist yet.

- [ ] **Step 3: Commit**

```sh
git add apps/portal/eslint.config.js
git commit -m "feat(portal): extend eslint with sub-feature boundaries under features/check-in/"
```

---

## Task 17: Create `apps/portal/src/middleware.ts` — dual-mode auth middleware

Reads cookie (web) or `Authorization: Bearer` (mobile), verifies via `@cmt/firebase-shared`, attaches claims to request headers, returns 401 JSON for `/api/*` and 302 redirect for pages.

**Files:**
- Create: `apps/portal/src/middleware.ts`
- Test: `apps/portal/src/__tests__/middleware.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/__tests__/middleware.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  verifyPortalSessionCookie: vi.fn(),
  verifyPortalIdToken: vi.fn(),
}));

import {
  verifyPortalSessionCookie,
  verifyPortalIdToken,
} from '@cmt/firebase-shared/admin/session';
import { middleware } from '../middleware';

const makeReq = (url: string, init: { cookie?: string; bearer?: string } = {}) => {
  const headers = new Headers();
  if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`);
  if (init.cookie) headers.set('cookie', `__session=${init.cookie}`);
  return new NextRequest(new URL(url, 'http://localhost'), { headers });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('middleware — public routes', () => {
  it('passes through /login without auth', async () => {
    const res = await middleware(makeReq('http://localhost/login'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('passes through /check-in (kiosk)', async () => {
    const res = await middleware(makeReq('http://localhost/check-in'));
    expect(res.status).toBe(200);
  });
});

describe('middleware — cookie auth', () => {
  it('attaches claims headers when cookie is valid', async () => {
    (verifyPortalSessionCookie as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u1',
      role: 'admin',
    });
    const res = await middleware(makeReq('http://localhost/check-in/admin', { cookie: 'good' }));
    expect(res.status).toBe(200);
    // Claims flow through via request.headers on next()
  });

  it('redirects to /login when no cookie and route is protected', async () => {
    const res = await middleware(makeReq('http://localhost/check-in/admin'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/login\?from=%2Fcheck-in%2Fadmin/);
    expect(res.headers.get('location')).toMatch(/error=session-expired/);
  });

  it('redirects to /login?error=unauthorized when role is wrong', async () => {
    (verifyPortalSessionCookie as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u1',
      role: 'teacher',
    });
    const res = await middleware(makeReq('http://localhost/check-in/admin', { cookie: 'good' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/error=unauthorized/);
  });
});

describe('middleware — bearer auth', () => {
  it('accepts a valid Bearer ID token', async () => {
    (verifyPortalIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u2',
      role: 'admin',
    });
    const res = await middleware(
      makeReq('http://localhost/api/check-in/admin/stats', { bearer: 'tok' }),
    );
    expect(res.status).toBe(200);
  });

  it('returns 401 JSON for /api/* on missing auth', async () => {
    const res = await middleware(makeReq('http://localhost/api/check-in/admin/stats'));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.error).toBe('no-session');
  });

  it('returns 401 JSON for /api/* on role mismatch', async () => {
    (verifyPortalIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u2',
      role: 'family',
    });
    const res = await middleware(
      makeReq('http://localhost/api/check-in/admin/stats', { bearer: 'tok' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('returns 401 on invalid Bearer token', async () => {
    (verifyPortalIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await middleware(
      makeReq('http://localhost/api/check-in/admin/stats', { bearer: 'bad' }),
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/__tests__/middleware.test.ts
```

Expected: module not found (`../middleware`).

- [ ] **Step 3: Create `apps/portal/src/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import {
  verifyPortalSessionCookie,
  verifyPortalIdToken,
} from '@cmt/firebase-shared/admin/session';
import { canAccessRoute, type SessionClaims } from '@cmt/shared-domain/auth';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes short-circuit
  if (canAccessRoute({ uid: '', role: 'family' } as SessionClaims, pathname)) {
    // canAccessRoute returns true for any public route regardless of claims
    // Double-check by calling without claims gate
    const { isPublicRoute } = await import('@cmt/shared-domain/auth/public-routes');
    if (isPublicRoute(pathname)) return NextResponse.next();
  }

  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const cookie = req.cookies.get('__session')?.value;

  let claims: SessionClaims | null = null;
  if (bearer) {
    const decoded = await verifyPortalIdToken(bearer);
    if (decoded && decoded.role) claims = decoded as unknown as SessionClaims;
  } else if (cookie) {
    const decoded = await verifyPortalSessionCookie(cookie);
    if (decoded && decoded.role) claims = decoded as unknown as SessionClaims;
  }

  if (!claims) return deny(req, 'no-session');
  if (!canAccessRoute(claims, pathname)) return deny(req, 'unauthorized');

  // Attach claims to request headers for server components
  const headers = new Headers(req.headers);
  headers.set('x-portal-role', claims.role);
  headers.set('x-portal-uid', claims.uid);
  if (claims.familyId) headers.set('x-portal-family-id', claims.familyId);
  return NextResponse.next({ request: { headers } });
}

function deny(req: NextRequest, reason: 'no-session' | 'unauthorized') {
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  if (isApi) {
    return NextResponse.json({ error: reason }, { status: 401 });
  }
  const redirect = new URL('/login', req.nextUrl.origin);
  redirect.searchParams.set('from', req.nextUrl.pathname);
  redirect.searchParams.set('error', reason === 'no-session' ? 'session-expired' : 'unauthorized');
  return NextResponse.redirect(redirect);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs',
};
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/__tests__/middleware.test.ts
```

Expected: all middleware tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/middleware.ts apps/portal/src/__tests__/middleware.test.ts
git commit -m "feat(portal): add middleware with dual-mode auth (cookie + Bearer) and role-based access"
```

---

## Task 18: Create `/login` role picker page + `features/check-in/auth/` scaffold

The root of the login surface. User lands here, sees three buttons: admin, teacher, family. Routes to the sub-login page. Per-segment `error.tsx` + `loading.tsx`.

**Files:**
- Create: `apps/portal/src/features/check-in/auth/index.ts`
- Create: `apps/portal/src/features/check-in/auth/login-role-picker.tsx`
- Create: `apps/portal/src/app/login/page.tsx`
- Create: `apps/portal/src/app/login/error.tsx`
- Create: `apps/portal/src/app/login/loading.tsx`

- [ ] **Step 1: Create `features/check-in/auth/login-role-picker.tsx`**

```tsx
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cmt/ui';

const options = [
  {
    href: '/login/family',
    title: 'Family',
    description: 'Sign in with your email or phone to see your family\'s check-in history.',
  },
  {
    href: '/login/teacher',
    title: 'Teacher',
    description: 'Sign in to mark attendance for your class.',
  },
  {
    href: '/login/admin',
    title: 'Admin',
    description: 'Manage users, guests, and reports.',
  },
];

export function LoginRolePicker() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold text-[hsl(var(--heading))]">Sign in</h1>
      <p className="text-center text-[hsl(var(--foreground))]">
        Pick the option that matches how you use the portal.
      </p>
      <div className="grid w-full gap-4 sm:grid-cols-3">
        {options.map((o) => (
          <Link key={o.href} href={o.href} className="block focus:outline-none">
            <Card className="h-full transition hover:shadow-md">
              <CardHeader>
                <CardTitle>{o.title}</CardTitle>
                <CardDescription>{o.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create `features/check-in/auth/index.ts`**

```ts
export { LoginRolePicker } from './login-role-picker';
```

- [ ] **Step 3: Create `apps/portal/src/app/login/page.tsx`**

```tsx
import { LoginRolePicker } from '@/features/check-in/auth';

export const metadata = { title: 'Sign in — CMT Portal' };

export default function LoginPage() {
  return <LoginRolePicker />;
}
```

- [ ] **Step 4: Create `apps/portal/src/app/login/error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';

export default function LoginError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Login is having trouble" />;
}
```

- [ ] **Step 5: Create `apps/portal/src/app/login/loading.tsx`**

```tsx
export default function LoginLoading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center p-6">
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}
```

- [ ] **Step 6: Typecheck + lint**

```sh
pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```sh
git add apps/portal/src/features/check-in/auth/ apps/portal/src/app/login/page.tsx apps/portal/src/app/login/error.tsx apps/portal/src/app/login/loading.tsx
git commit -m "feat(portal): add /login role picker + per-segment error/loading boundaries"
```

---

## Task 19: `/login/admin` page + `AdminLoginForm` component

Email + password form. Posts to `/api/auth/admin/signin`. Redirects on success.

**Files:**
- Create: `apps/portal/src/features/check-in/auth/admin-login-form.tsx`
- Create: `apps/portal/src/features/check-in/auth/__tests__/admin-login-form.test.tsx`
- Create: `apps/portal/src/app/login/admin/page.tsx`
- Create: `apps/portal/src/app/login/admin/error.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/auth/__tests__/admin-login-form.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminLoginForm } from '../admin-login-form';

describe('AdminLoginForm', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockReset();
    vi.stubGlobal('location', { assign: vi.fn(), href: '' });
  });

  it('renders email and password fields', () => {
    render(<AdminLoginForm />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('posts to /api/auth/admin/signin with credentials', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectTo: '/check-in/admin' }),
    } as Response);

    render(<AdminLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/admin/signin',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: JSON.stringify({ email: 'admin@example.com', password: 'secret123' }),
      }),
    );
  });

  it('shows an error message on 401', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    } as Response);

    render(<AdminLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid email or password/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/auth/__tests__/admin-login-form.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/features/check-in/auth/admin-login-form.tsx`**

```tsx
'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';

export function AdminLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/auth/admin/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError('Invalid email or password');
        return;
      }
      const data = (await res.json()) as { redirectTo: string };
      window.location.assign(data.redirectTo);
    });
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Admin sign in</h1>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/app/login/admin/page.tsx`**

```tsx
import { AdminLoginForm } from '@/features/check-in/auth/admin-login-form';

export const metadata = { title: 'Admin sign in — CMT Portal' };

export default function AdminLoginPage() {
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))]">
      <AdminLoginForm />
    </main>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/app/login/admin/error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';

export default function AdminLoginError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Admin sign-in error" />;
}
```

- [ ] **Step 6: Update the auth barrel**

Modify `apps/portal/src/features/check-in/auth/index.ts`:

```ts
export { LoginRolePicker } from './login-role-picker';
export { AdminLoginForm } from './admin-login-form';
```

- [ ] **Step 7: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/auth/__tests__/admin-login-form.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 8: Commit**

```sh
git add apps/portal/src/features/check-in/auth/admin-login-form.tsx apps/portal/src/features/check-in/auth/__tests__/admin-login-form.test.tsx apps/portal/src/features/check-in/auth/index.ts apps/portal/src/app/login/admin/
git commit -m "feat(portal): add /login/admin page + AdminLoginForm with error/loading boundaries"
```

---

## Task 20: `/login/teacher` page + `TeacherLoginForm` component

Single passphrase input. Posts to `/api/auth/teacher/signin`.

**Files:**
- Create: `apps/portal/src/features/check-in/auth/teacher-login-form.tsx`
- Create: `apps/portal/src/features/check-in/auth/__tests__/teacher-login-form.test.tsx`
- Create: `apps/portal/src/app/login/teacher/page.tsx`
- Create: `apps/portal/src/app/login/teacher/error.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/auth/__tests__/teacher-login-form.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeacherLoginForm } from '../teacher-login-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('TeacherLoginForm', () => {
  it('renders a single passphrase input', () => {
    render(<TeacherLoginForm />);
    expect(screen.getByLabelText(/passphrase/i)).toBeInTheDocument();
  });

  it('posts passphrase to /api/auth/teacher/signin', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectTo: '/check-in/teacher' }),
    } as Response);

    render(<TeacherLoginForm />);
    await user.type(screen.getByLabelText(/passphrase/i), 'TeacherOM!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/teacher/signin',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ passphrase: 'TeacherOM!' }),
      }),
    );
  });

  it('shows an error on 401', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    } as Response);
    render(<TeacherLoginForm />);
    await user.type(screen.getByLabelText(/passphrase/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/passphrase/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/auth/__tests__/teacher-login-form.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/features/check-in/auth/teacher-login-form.tsx`**

```tsx
'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';

export function TeacherLoginForm() {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/auth/teacher/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        setError('Incorrect teacher passphrase');
        return;
      }
      const data = (await res.json()) as { redirectTo: string };
      window.location.assign(data.redirectTo);
    });
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Teacher sign in</h1>
      <p className="text-sm text-[hsl(var(--foreground))]">
        Enter the shared teacher passphrase to mark attendance.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="passphrase">Passphrase</Label>
        <Input
          id="passphrase"
          type="password"
          required
          autoComplete="off"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/app/login/teacher/page.tsx`**

```tsx
import { TeacherLoginForm } from '@/features/check-in/auth/teacher-login-form';

export const metadata = { title: 'Teacher sign in — CMT Portal' };

export default function TeacherLoginPage() {
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))]">
      <TeacherLoginForm />
    </main>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/app/login/teacher/error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';

export default function TeacherLoginError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Teacher sign-in error" />;
}
```

- [ ] **Step 6: Update barrel + run tests**

```ts
// apps/portal/src/features/check-in/auth/index.ts
export { LoginRolePicker } from './login-role-picker';
export { AdminLoginForm } from './admin-login-form';
export { TeacherLoginForm } from './teacher-login-form';
```

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/auth/__tests__/teacher-login-form.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```sh
git add apps/portal/src/features/check-in/auth/teacher-login-form.tsx apps/portal/src/features/check-in/auth/__tests__/teacher-login-form.test.tsx apps/portal/src/features/check-in/auth/index.ts apps/portal/src/app/login/teacher/
git commit -m "feat(portal): add /login/teacher page + TeacherLoginForm (shared passphrase)"
```

---

## Task 21: `/login/family` page scaffold (OTP wiring deferred to B2)

Creates the route skeleton so `/login/family` exists, but the form displays "Coming in slice B2" rather than a real OTP flow. This keeps slice B2's work contained to replacing this component.

**Files:**
- Create: `apps/portal/src/features/check-in/auth/family-login-form.tsx`
- Create: `apps/portal/src/app/login/family/page.tsx`
- Create: `apps/portal/src/app/login/family/error.tsx`

- [ ] **Step 1: Create `apps/portal/src/features/check-in/auth/family-login-form.tsx`**

```tsx
'use client';

export function FamilyLoginForm() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Family sign in</h1>
      <p className="text-sm text-[hsl(var(--foreground))]">
        The family login flow (email/phone OTP) is shipping in slice B2. For now this page is a
        placeholder.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/portal/src/app/login/family/page.tsx`**

```tsx
import { FamilyLoginForm } from '@/features/check-in/auth/family-login-form';

export const metadata = { title: 'Family sign in — CMT Portal' };

export default function FamilyLoginPage() {
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))]">
      <FamilyLoginForm />
    </main>
  );
}
```

- [ ] **Step 3: Create `apps/portal/src/app/login/family/error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';

export default function FamilyLoginError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Family sign-in error" />;
}
```

- [ ] **Step 4: Update the auth barrel**

```ts
// apps/portal/src/features/check-in/auth/index.ts
export { LoginRolePicker } from './login-role-picker';
export { AdminLoginForm } from './admin-login-form';
export { TeacherLoginForm } from './teacher-login-form';
export { FamilyLoginForm } from './family-login-form';
```

- [ ] **Step 5: Typecheck + lint**

```sh
pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```sh
git add apps/portal/src/features/check-in/auth/family-login-form.tsx apps/portal/src/features/check-in/auth/index.ts apps/portal/src/app/login/family/
git commit -m "feat(portal): scaffold /login/family page (OTP flow deferred to slice B2)"
```

---

## Task 22: `POST /api/auth/admin/signin` — admin signin handler

Validates credentials via Firebase Identity Toolkit REST, verifies the user has the `admin` claim, creates a session cookie, sets it on the response.

**Files:**
- Create: `apps/portal/src/app/api/auth/admin/signin/route.ts`
- Test: `apps/portal/src/app/api/auth/admin/signin/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/auth/admin/signin/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  signInWithEmailPassword: vi.fn(),
  createPortalSessionCookie: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  getPortalUserWithClaims: vi.fn(),
}));

import {
  signInWithEmailPassword,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';
import { getPortalUserWithClaims } from '@cmt/firebase-shared/admin/claims';

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_COOKIE_EXPIRES_DAYS = '5';
});

describe('POST /api/auth/admin/signin', () => {
  it('returns 400 on missing body fields', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 401 on wrong password', async () => {
    (signInWithEmailPassword as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('INVALID_LOGIN_CREDENTIALS'),
    );
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'unauthorized' });
      },
    });
  });

  it('returns 403 when user has no admin claim', async () => {
    (signInWithEmailPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      idToken: 'id-tok',
      localId: 'u1',
    });
    (getPortalUserWithClaims as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u1',
      email: 'a@b.com',
      claims: { role: 'family' },
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com', password: 'right' }),
        });
        expect(res.status).toBe(403);
      },
    });
  });

  it('returns 200 and sets __session cookie on success', async () => {
    (signInWithEmailPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      idToken: 'id-tok',
      localId: 'u1',
    });
    (getPortalUserWithClaims as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'u1',
      email: 'a@b.com',
      claims: { role: 'admin' },
    });
    (createPortalSessionCookie as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'sess-tok',
    );
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com', password: 'right' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.redirectTo).toBe('/check-in/admin');
        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toMatch(/__session=sess-tok/);
        expect(setCookie).toMatch(/HttpOnly/);
        expect(setCookie).toMatch(/SameSite=Lax/);
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/app/api/auth/admin/signin/__tests__/route.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/app/api/auth/admin/signin/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  signInWithEmailPassword,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';
import { getPortalUserWithClaims } from '@cmt/firebase-shared/admin/claims';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  try {
    const { idToken, localId } = await signInWithEmailPassword(
      parsed.data.email,
      parsed.data.password,
    );
    const user = await getPortalUserWithClaims(localId);
    if (user.claims.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '5');
    const session = await createPortalSessionCookie(idToken, expiresInDays);

    const res = NextResponse.json({ redirectTo: '/check-in/admin' }, { status: 200 });
    res.cookies.set('__session', session, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: expiresInDays * 24 * 60 * 60,
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/app/api/auth/admin/signin/__tests__/route.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/auth/admin/signin/
git commit -m "feat(portal): POST /api/auth/admin/signin with zod validation + session cookie"
```

---

## Task 23: `POST /api/auth/teacher/signin` — teacher signin handler

Timing-safe compare on the passphrase, creates/reuses the shared teacher Firebase user, mints custom token → exchanges for ID token → creates session cookie.

**Files:**
- Create: `apps/portal/src/app/api/auth/teacher/signin/route.ts`
- Test: `apps/portal/src/app/api/auth/teacher/signin/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/auth/teacher/signin/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  getOrCreateSharedTeacherUser: vi.fn(),
  createPortalCustomToken: vi.fn(),
  SHARED_TEACHER_UID: 'teacher-shared-v1',
}));
vi.mock('@cmt/firebase-shared/admin/session', () => ({
  exchangeCustomTokenForIdToken: vi.fn(),
  createPortalSessionCookie: vi.fn(),
}));

import {
  getOrCreateSharedTeacherUser,
  createPortalCustomToken,
} from '@cmt/firebase-shared/admin/claims';
import {
  exchangeCustomTokenForIdToken,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TEACHER_PASSPHRASE = 'TeacherOM!';
  process.env.SESSION_COOKIE_EXPIRES_DAYS = '5';
});

describe('POST /api/auth/teacher/signin', () => {
  it('returns 400 on missing passphrase', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 401 on wrong passphrase without creating any user', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ passphrase: 'wrong' }),
        });
        expect(res.status).toBe(401);
      },
    });
    expect(getOrCreateSharedTeacherUser).not.toHaveBeenCalled();
  });

  it('returns 200 + session cookie on correct passphrase', async () => {
    (getOrCreateSharedTeacherUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'teacher-shared-v1',
    });
    (createPortalCustomToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'custom-tok',
    );
    (exchangeCustomTokenForIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'id-tok',
    );
    (createPortalSessionCookie as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'sess-tok',
    );
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ passphrase: 'TeacherOM!' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.redirectTo).toBe('/check-in/teacher');
        expect(res.headers.get('set-cookie')).toMatch(/__session=sess-tok/);
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/app/api/auth/teacher/signin/__tests__/route.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/app/api/auth/teacher/signin/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import {
  getOrCreateSharedTeacherUser,
  createPortalCustomToken,
} from '@cmt/firebase-shared/admin/claims';
import {
  exchangeCustomTokenForIdToken,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ passphrase: z.string().min(1) });

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const expected = process.env.TEACHER_PASSPHRASE;
  if (!expected) {
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  }
  if (!constantTimeEquals(parsed.data.passphrase, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const user = await getOrCreateSharedTeacherUser();
  const customTok = await createPortalCustomToken(user.uid, { role: 'teacher' });
  const idTok = await exchangeCustomTokenForIdToken(customTok);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '5');
  const session = await createPortalSessionCookie(idTok, expiresInDays);

  const res = NextResponse.json({ redirectTo: '/check-in/teacher' }, { status: 200 });
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/app/api/auth/teacher/signin/__tests__/route.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/auth/teacher/signin/
git commit -m "feat(portal): POST /api/auth/teacher/signin with timing-safe passphrase compare"
```

---

## Task 24: `POST /api/auth/signout` — clears the session cookie

**Files:**
- Create: `apps/portal/src/app/api/auth/signout/route.ts`
- Test: `apps/portal/src/app/api/auth/signout/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/auth/signout/__tests__/route.test.ts
import { describe, it, expect } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';
import * as appHandler from '../route';

describe('POST /api/auth/signout', () => {
  it('clears the __session cookie', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(200);
        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toMatch(/__session=/);
        expect(setCookie).toMatch(/Max-Age=0/);
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/app/api/auth/signout/__tests__/route.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/app/api/auth/signout/route.ts`**

```ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ redirectTo: '/login' }, { status: 200 });
  res.cookies.set('__session', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/app/api/auth/signout/__tests__/route.test.ts
```

Expected: test passes.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/auth/signout/
git commit -m "feat(portal): POST /api/auth/signout clears __session cookie"
```

---

## Task 25: Replace `/check-in/admin/page.tsx` with an auth-gated stub

The slice A `/check-in/admin/page.tsx` currently shows a `ComingSoon` placeholder via the route's parent route. B0 makes it a proper admin stub page — served only behind auth, showing "Admin dashboard — coming in B4."

**Files:**
- Modify: `apps/portal/src/app/check-in/admin/page.tsx` (create if missing — slice A may not have added a nested segment)
- Create: `apps/portal/src/app/check-in/admin/error.tsx`
- Create: `apps/portal/src/app/check-in/admin/loading.tsx`

- [ ] **Step 1: Check current state**

```sh
ls apps/portal/src/app/check-in/admin 2>/dev/null || echo "not present"
```

If it prints `not present`, the segment doesn't exist yet and you'll create it below. If it prints files, they're from a pre-existing ComingSoon wiring and will be overwritten.

- [ ] **Step 2: Create `apps/portal/src/app/check-in/admin/page.tsx`**

```tsx
import { headers } from 'next/headers';

export const metadata = { title: 'Admin — Check-in — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function AdminStubPage() {
  const h = await headers();
  const role = h.get('x-portal-role') ?? 'unknown';
  const uid = h.get('x-portal-uid') ?? 'unknown';

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold text-[hsl(var(--heading))]">Admin dashboard</h1>
      <p className="text-[hsl(var(--foreground))]">
        You are signed in as <strong>{role}</strong> (<code>{uid}</code>).
      </p>
      <p className="text-[hsl(var(--foreground))]">
        The full admin dashboard — stats, user provisioning, guest list, reports — is shipping in
        slice B4. This stub confirms the auth gate works.
      </p>
      <form action="/api/auth/signout" method="post">
        <button
          type="submit"
          className="rounded bg-[hsl(var(--primary))] px-4 py-2 text-white hover:opacity-90"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Create `apps/portal/src/app/check-in/admin/error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';

export default function AdminError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Admin dashboard error" />;
}
```

- [ ] **Step 4: Create `apps/portal/src/app/check-in/admin/loading.tsx`**

```tsx
export default function AdminLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}
```

- [ ] **Step 5: Typecheck + lint**

```sh
pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```sh
git add apps/portal/src/app/check-in/admin/
git commit -m "feat(portal): add auth-gated /check-in/admin stub (real dashboard in B4)"
```

---

## Task 26: `seed-admin.ts` CLI — bootstrap the first admin account

**Files:**
- Create: `apps/portal/scripts/seed-admin.ts`
- Create: `apps/portal/scripts/__tests__/seed-admin.test.ts`
- Modify: `apps/portal/package.json` (add script)

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/scripts/__tests__/seed-admin.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  getOrCreateAdminUser: vi.fn(),
}));

import { getOrCreateAdminUser } from '@cmt/firebase-shared/admin/claims';
import { seedAdmin } from '../seed-admin';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('seedAdmin', () => {
  it('delegates to getOrCreateAdminUser with email+password', async () => {
    (getOrCreateAdminUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'new-uid',
      email: 'admin@example.com',
    });
    const result = await seedAdmin({ email: 'admin@example.com', password: 'p@ssword123' });
    expect(getOrCreateAdminUser).toHaveBeenCalledWith('admin@example.com', 'p@ssword123');
    expect(result.uid).toBe('new-uid');
    expect(result.email).toBe('admin@example.com');
  });

  it('throws when email is invalid', async () => {
    await expect(seedAdmin({ email: 'not-email', password: 'x' })).rejects.toThrow(/email/);
  });

  it('throws when password is shorter than 8 chars', async () => {
    await expect(
      seedAdmin({ email: 'admin@example.com', password: 'short' }),
    ).rejects.toThrow(/password/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- scripts/__tests__/seed-admin.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/scripts/seed-admin.ts`**

```ts
import { z } from 'zod';
import { getOrCreateAdminUser } from '@cmt/firebase-shared/admin/claims';

const inputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

export async function seedAdmin(input: { email: string; password: string }) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  }
  const user = await getOrCreateAdminUser(parsed.data.email, parsed.data.password);
  return { uid: user.uid, email: user.email ?? parsed.data.email };
}

async function main() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) args.set(match[1]!, match[2]!);
  }
  const email = args.get('email');
  if (!email) {
    console.error('usage: pnpm seed:admin --email=<email>');
    process.exit(1);
  }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question('Password (min 8 chars): ');
  rl.close();

  try {
    const result = await seedAdmin({ email, password });
    console.log(`✅ Admin seeded: ${result.uid} ${result.email}`);
    process.exit(0);
  } catch (err) {
    console.error(`❌ seed-admin failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

// Only run main() when invoked as a CLI, not when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 4: Add script to `apps/portal/package.json`**

Add to `scripts`:

```json
"seed:admin": "tsx --env-file=.env.local scripts/seed-admin.ts"
```

And add `tsx` as a devDependency:

```sh
pnpm --filter @cmt/portal add -D tsx@^4.19.0
```

- [ ] **Step 5: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- scripts/__tests__/seed-admin.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```sh
git add apps/portal/scripts/ apps/portal/package.json pnpm-lock.yaml
git commit -m "feat(portal): add pnpm seed:admin CLI to bootstrap the first admin account"
```

---

## Task 27: Install Playwright and add `playwright.config.ts`

**Files:**
- Modify: `apps/portal/package.json`
- Create: `apps/portal/playwright.config.ts`
- Create: `apps/portal/e2e/fixtures.ts`
- Create: `.gitignore` entries for `playwright-report/` and `test-results/`
- Modify: `package.json` (root) — add `test:e2e` script

- [ ] **Step 1: Install Playwright**

```sh
pnpm --filter @cmt/portal add -D @playwright/test@^1.50.0
pnpm --filter @cmt/portal exec playwright install chromium
```

- [ ] **Step 2: Create `apps/portal/playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @cmt/portal dev -- --port=3001',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
```

- [ ] **Step 3: Create `apps/portal/e2e/fixtures.ts`**

```ts
import { test as base, expect } from '@playwright/test';

export const test = base.extend({});
export { expect };
```

- [ ] **Step 4: Extend `.gitignore`**

```sh
cat >> .gitignore <<'IGNORE'

# playwright
apps/portal/playwright-report/
apps/portal/test-results/
apps/portal/blob-report/
apps/portal/.playwright/
IGNORE
```

- [ ] **Step 5: Add `test:e2e` script to root `package.json`**

```json
"test:e2e": "pnpm --filter @cmt/portal exec playwright test"
```

- [ ] **Step 6: Typecheck + lint**

```sh
pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint
```

Expected: zero errors. No e2e spec yet — Playwright won't run anything yet.

- [ ] **Step 7: Commit**

```sh
git add apps/portal/playwright.config.ts apps/portal/e2e/fixtures.ts apps/portal/package.json package.json pnpm-lock.yaml .gitignore
git commit -m "feat(portal): install Playwright + baseline config + test:e2e script"
```

---

## Task 28: Write `e2e/b0-auth.spec.ts` — the critical B0 flow

Requires a seeded admin user in UAT Firebase. Documented as a pre-req in the spec.

**Files:**
- Create: `apps/portal/e2e/b0-auth.spec.ts`

- [ ] **Step 1: Create the e2e test**

```ts
// apps/portal/e2e/b0-auth.spec.ts
import { test, expect } from './fixtures';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'developer@chinmayatoronto.org';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'DevPassword!234';

test.describe('B0 — portal auth foundation', () => {
  test('unauthenticated user is redirected from /check-in/admin to /login', async ({ page }) => {
    await page.goto('/check-in/admin');
    await expect(page).toHaveURL(/\/login\?from=%2Fcheck-in%2Fadmin/);
  });

  test('admin can sign in and land on /check-in/admin', async ({ page }) => {
    test.skip(
      !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD,
      'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set — seed an admin first with `pnpm seed:admin`',
    );

    await page.goto('/login/admin');
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL('/check-in/admin');
    await expect(page.getByRole('heading', { name: /admin dashboard/i })).toBeVisible();
  });

  test('role picker page shows three options', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByText(/family/i).first()).toBeVisible();
    await expect(page.getByText(/teacher/i).first()).toBeVisible();
    await expect(page.getByText(/admin/i).first()).toBeVisible();
  });

  test('teacher login form renders at /login/teacher', async ({ page }) => {
    await page.goto('/login/teacher');
    await expect(page.getByRole('heading', { name: /teacher sign in/i })).toBeVisible();
    await expect(page.getByLabel(/passphrase/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify the spec file lints**

```sh
pnpm --filter @cmt/portal lint
```

Expected: zero errors. (We don't run Playwright against a live server in this task — that happens in Task 29 pre-push verification and manually before prod promotion.)

- [ ] **Step 3: Commit**

```sh
git add apps/portal/e2e/b0-auth.spec.ts
git commit -m "test(portal): add Playwright b0-auth.spec.ts covering the critical login flow"
```

---

## Task 29: Update README and CLAUDE.md; run full pre-push acceptance; push

Final task: docs + the full verification sweep + push to `origin/main`.

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `README.md`**

Add new sections (under existing "Quick start"):

```markdown
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
```

- [ ] **Step 2: Update `CLAUDE.md`**

Find the "Slice A status" line and update to reflect slice B progress:

```markdown
**Slice A status:** ✅ Shipped (merged to `main`). Spec: `docs/superpowers/specs/2026-04-12-slice-a-portal-scaffold-design.md`, plan: `docs/superpowers/plans/2026-04-12-slice-a-portal-scaffold.md`.

**Slice B status:** In progress. Spec: `docs/superpowers/specs/2026-04-13-slice-b-family-check-in-port-design.md`. Decomposed into six sub-slices (B0 → B2 → B3 → B1 → B4 → B5); B0 (portal auth foundation) is the first. Slice D (unified auth) is **removed** from the roadmap — B0 absorbs it.
```

Update the "Slice-based development" list in CLAUDE.md and the corresponding list in README.md to strike through slice D:

```markdown
- **Slice A** — ✅ **Shipped** — Monorepo scaffold + portal app shell + 4 shared packages
- **Slice B** — 🚧 In progress — Port `chinmaya-family-check-in` + portal-wide auth foundation (subsumes former slice D)
- **Slice C** — Port `chinmaya-event-registration` into `apps/portal/src/app/events/*`
- **Slice E+** — Future modules (programs, enrollment, retirement of old portal)
```

- [ ] **Step 3: Run the full pre-push suite locally**

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all four green. If any fails, fix the underlying issue and re-run.

- [ ] **Step 4: Commit the doc updates**

```sh
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md for slice B0 (env vars, seed:admin, Playwright)"
```

- [ ] **Step 5: Push to origin**

```sh
git push origin main
```

The pre-push hook re-runs `pnpm typecheck && lint && test && build`. On success, main is updated on GitHub.

- [ ] **Step 6: Manual Vercel verification**

After the push succeeds:

1. Vercel auto-deploys a preview. Wait for green.
2. Visit `https://<preview-url>/login` — the role picker should render.
3. Visit `https://<preview-url>/check-in/admin` — should redirect to `/login`.
4. Set `PORTAL_*`, `MASTER_*`, `TEACHER_PASSPHRASE`, and `NEXT_PUBLIC_FEATURE_CHECK_IN=true` + `NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN=true` in Vercel env for preview.
5. Run `pnpm --filter @cmt/portal seed:admin --email=developer@chinmayatoronto.org` locally against UAT Firebase (the script talks directly to Firebase; no Vercel call needed).
6. Try the admin login flow on the preview deploy. Confirm landing on `/check-in/admin`.

B0 is complete when steps 1–6 are all green. Slice B2 begins next.

---

## B0 acceptance gate summary

Before declaring B0 done, confirm each acceptance criterion from spec §9.2:

| # | Criterion | Verified by |
|---|---|---|
| B0-AC-1 | `pnpm seed:admin` creates an admin in UAT | Task 29 step 6 |
| B0-AC-2 | `/api/auth/admin/signin` with valid creds returns 200 + cookie | Task 22 tests |
| B0-AC-3 | `/api/auth/admin/signin` with wrong password returns 401 | Task 22 tests |
| B0-AC-4 | `/check-in/admin` without cookie → 302 to `/login` | Task 28 e2e |
| B0-AC-5 | `/check-in/admin` with admin cookie → 200 stub page | Task 28 e2e |
| B0-AC-6 | `/check-in/admin` with teacher cookie → 302 `?error=unauthorized` | Task 17 middleware test |
| B0-AC-7 | `/api/check-in/admin/stats` without auth → 401 JSON | Task 17 middleware test |
| B0-AC-8 | Bearer token path for `/api/check-in/admin/*` works | Task 17 middleware test |
| B0-AC-9 | Unit tests green: canAccessRoute, session, claims, rtdb, firestore, env, apps, auth | Tasks 2–14 |
| B0-AC-10 | Integration tests green for all signin and signout handlers | Tasks 22–24 |
| B0-AC-11 | Playwright `b0-auth.spec.ts` green | Task 28 manual run |
| B0-AC-12 | `pnpm typecheck && lint && test && build` all green | Task 29 step 3 |
| B0-AC-13 | Pre-push hook passes | Task 29 step 5 |
| B0-AC-14 | Deleting `PORTAL_FIREBASE_PRIVATE_KEY` causes app to fail with clear error | Task 3 env test |
| B0-AC-15 | Sub-feature boundary lint blocks cross-sub imports | Task 16 lint |
| B0-AC-16 | `rtdb.ts` exports exactly `masterRtdb` + `readRtdb` (no writes) | Task 7 test |
| B0-AC-17 | Lint blocks `firebase-admin/database` outside `rtdb.ts` | Task 10 eslint |
| B0-AC-18 | README updated with CLI + env + Playwright | Task 29 step 1 |

**On green: B0 is shipped. Next: slice B2 plan (family portal).**
