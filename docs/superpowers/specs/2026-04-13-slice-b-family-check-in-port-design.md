# Slice B — Family Check-in Port + Portal Auth Foundation

| Field | Value |
|---|---|
| **Date** | 2026-04-13 |
| **Status** | Approved (brainstorming complete; pending user spec review) |
| **Sub-project** | Slice B of the Chinmaya Mission Toronto Portal program |
| **Owner** | CMT Developer |
| **Implements** | Port of `chinmaya-family-check-in` into the portal + portal-wide auth foundation (absorbs former slice D) |
| **Predecessors** | Slice A — portal monorepo scaffold (shipped 2026-04-12) |
| **Successors** | Slice C (port `chinmaya-event-registration`), Slice E+ (programs, enrollment, retirement) |
| **Reference materials** | `docs/superpowers/specs/2026-04-12-slice-a-portal-scaffold-design.md`, `docs/superpowers/specs/reference/Chinmaya Setu Prototype.{md,pdf}`, `chinmaya-family-check-in` source tree |

---

## 1. Background

Slice A shipped an empty Turborepo monorepo with one Next.js 16 application (`apps/portal`), four shared workspace packages (`@cmt/ui`, `@cmt/firebase-shared`, `@cmt/shared-domain`, `@cmt/config`), CMT brand identity, and six structural disciplines. The portal renders a landing page and two "Coming Soon" stubs at `/events` and `/check-in`. There is no auth, no real functionality, and no data.

Slice B fills in the `/check-in/*` stub by porting the production `chinmaya-family-check-in` application into the portal, **and** by establishing portal-wide authentication that every future slice reuses. The need for auth inside slice B (teacher login, family login, admin accounts) forces the auth system to exist now, so slice B absorbs what was previously planned as slice D.

### 1.1 What the existing app does

`chinmaya-family-check-in` (Next.js 14.2.35, React 18, no test suite) runs the physical ashram kiosk at the entry door. It has four primary user flows:

| Flow | Who uses it | How they authenticate today |
|---|---|---|
| **Kiosk / self-check-in** | Sevak operator at ashram entrance; families walk up to the terminal | Sevak logs in once via shared `APP_PASSPHRASE` env var; terminal stays logged in all day |
| **Family portal** | Registered families | Passwordless OTP via email or SMS (AWS SES / SNS) |
| **Teacher attendance** | Class teachers | Shared `TEACHER_PASSPHRASE` env var |
| **Admin dashboard** | Sevak / management | Same shared `APP_PASSPHRASE` (conflated with kiosk login) |

Internally, it uses:
- **Firebase Realtime Database** for family/student master data (read-only from the app; populated by Webber's external Excel → RTDB sync pipeline from the old WordPress portal)
- **Firebase Firestore** for check-in events, guest check-ins, attendance records, verification codes
- **Firebase Auth** for custom-token-based sessions with synthetic UIDs (`admin-<timestamp>`, `teacher-<timestamp>`)
- **AWS SES** (`ca-central-1`) for verification emails and payment reminders
- **AWS SNS** (`us-east-1`) for verification SMS
- **Redis** (`redis` npm pkg) for classlist and family lookup caching
- **xlsx** for admin report exports
- **headlessui + hand-rolled components** for forms and modals
- **react-hot-toast**, `react-datepicker`, `react-phone-number-input` as UI deps
- A **client-side middleware** that reads Firebase cookies and decodes the JWT with `atob()` — no signature verification

The app's middleware does JWT decoding on the client (`atob` + `split('.')[1]`) to read `role` claims without verifying the signature. This is the security smell that slice B's full modernization replaces.

### 1.2 Where slice B fits in the program

Per slice A's roadmap (`docs/superpowers/specs/2026-04-12-slice-a-portal-scaffold-design.md` §2), the overall program is sliced as:

| Slice | Scope | Status |
|---|---|---|
| A | Monorepo scaffold + portal app shell + 4 shared packages | Shipped 2026-04-12 |
| **B** | **Port `chinmaya-family-check-in` into `/check-in/*`; Next 14 → 16 upgrade; full test coverage; portal-wide auth foundation** | **This spec** |
| C | Port `chinmaya-event-registration` into `/events/*` | Future |
| ~~D~~ | ~~Unified portal-level auth~~ → **absorbed into slice B** | Removed |
| E+ | Programs, enrollment, retirement of old portal | Future |

Slice B is the largest slice in the program because it ships both a full feature port *and* the auth foundation. It is decomposed into six sub-slices (B0–B5) below so each sub-slice can be executed by a fresh agent team in isolation.

---

## 2. Goals

Deliver a fully ported `/check-in/*` feature in the portal with portal-wide auth, such that:

1. The portal can authenticate **admin** (real Firebase accounts via email + password), **teacher** (shared passphrase, temporary), and **family** (passwordless OTP via AWS SES/SNS) users, with server-verified session cookies (web) and Bearer tokens (mobile).
2. Every family-check-in flow from the existing app has a 1:1 working equivalent under `/check-in/*`: kiosk, guest check-in, family lookup, family self-service portal, teacher attendance, admin dashboard, reports, notifications.
3. Every piece of ported code has unit + integration tests in Vitest, with at least one Playwright e2e critical-flow test per sub-slice. **Zero** untested code paths ship. Current family-check-in app has **no tests** — slice B is its first test suite.
4. Every protected API endpoint at `/api/check-in/*` works in both auth modes (session cookie for web, `Authorization: Bearer <id-token>` for mobile), preparing for a future native mobile app that consumes the same API surface.
5. Code is fully modernized relative to the original: server-verified sessions (no client-side JWT decode), shadcn primitives (not headlessui), Next 16 `"use cache"` (not Redis), eliminated Node-only imports leaking into client bundles, Inter font (not Geist), native phone inputs (not `react-phone-number-input`), server-side CSV/exceljs (not client `xlsx`).
6. **AWS SES + SNS are kept** as the email/SMS transport per project-wide decision, isolated in `apps/portal/src/lib/aws/` as server-only modules.
7. The parent `@cmt/firebase-shared` package supports two simultaneous Firebase Admin apps — one for the **portal** project (Firestore + Auth; UAT in dev, prod in prod) and one for the **master** project (RTDB read-only; always prod).
8. The standalone `chinmaya-family-check-in` app continues to run in production unchanged. Slice B is an additive build — no retirement work.
9. Every feature behind a feature flag, dark-launch-able sub-slice-by-sub-slice, master kill-switch preserved.
10. CLAUDE.md and README are updated to reflect slice B shipped and slice D removed from the roadmap.

---

## 3. Non-goals

Slice B explicitly does NOT deliver any of the following. Each is either deferred to a named future slice or an explicit decision not to implement.

1. **Modifying or retiring the standalone `chinmaya-family-check-in` app.** It continues to run in production, serving the physical ashram kiosk, untouched. Slice B does not change its env vars, deploy pipeline, or code.
2. **Touching Webber's Excel → RTDB sync pipeline.** Slice B treats RTDB master data as read-only and externally maintained. Any data quality issues are out of scope.
3. **Migrating RTDB data to Firestore.** RTDB remains the master data store for families and students in production. A future slice can design a migration deliberately if/when it's needed.
4. **Moving teachers to real accounts.** Teachers keep the shared `TEACHER_PASSPHRASE` model. Conversion to real accounts is deferred until after an explicit ashram-team discussion. Called out as a known limitation in slice B's public API surface.
5. **Kiosk device provisioning / POS-style long-lived tokens.** The portal kiosk routes (`/check-in`, `/check-in/guest`, `/check-in/lookup`) are fully **public** in the portal (Option 1 of the kiosk auth brainstorm). Physical ashram kiosk continues to run on the standalone app until an explicit cutover decision (future slice).
6. **Tailwind v4, shadcn v4-only components, or any other dependency major upgrade** outside what B0-B5 strictly need. `vercel.ts` config is introduced **only** for cron declaration in B5 — not for anything else.
7. **Building slice C (events) auth.** Slice B's auth foundation is designed so slice C can trivially reuse it, but slice B does not build any event-specific code.
8. **Publishing `@cmt/shared-domain` to npm.** Types remain workspace-only. When the mobile app is built (future slice), publishing is a one-line decision.
9. **API versioning or an OpenAPI schema.** The URL prefix is `/api/check-in/*` without versioning. Future breaking changes can introduce `/api/v1/check-in/*` if needed.
10. **Building the mobile app itself.** Slice B makes the APIs mobile-consumable — it does not ship any mobile client.
11. **Credentials rotation.** Real credentials currently in `chinmaya-family-check-in/.env.example` (Firebase service account keys, AWS access keys, passphrase values) must be rotated **after** slice B deploys, as a separate cleanup slice. Slice B does not perform rotation.
12. **CORS, rate limiting (except OTP send-code), or CSP hardening** beyond Next.js defaults.
13. **Replacing Firebase with any other backend.**
14. **Adding Playwright to the pre-push hook.** Playwright runs on demand via `pnpm test:e2e` and before every production promotion, not on every commit.
15. **Shipping the kiosk route with `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=true` in production.** It's dark by default until a cutover decision.

---

## 4. Architecture decision: Slice B subsumes former slice D

### 4.1 The problem

Slice A's original roadmap ordered slices as A → B → C → D → E, with slice D being the unified portal-wide auth layer. That ordering worked when slice B was "port kiosk only, no login needed" — the kiosk is public and doesn't require auth.

After brainstorming, slice B's real priority turned out to be the **login-gated** flows: teacher login, family login, admin accounts. Those require auth to exist before the flows can be built.

### 4.2 The choice

Three options were considered:

- **Option 1 — Slice B subsumes slice D.** Slice B builds portal-wide auth as sub-slice B0 (the first sub-slice, blocks all others). Slice D is removed from the roadmap.
- **Option 2 — Slice B builds feature-local auth.** Check-in gets its own quarantined auth; slice D later rebuilds it and migrates.
- **Option 3 — Promote slice D ahead of slice B.** Build a thin auth system against the empty `/check-in` stub first, then start slice B on top of it.

**Option 1 was selected.** Rationale:

1. It's architecturally cleanest — no rework when slice C (events) arrives; it just reuses the same auth.
2. It avoids the "build auth twice" cost of Option 2.
3. It matches how a greenfield portal is typically built — auth is foundational.
4. Option 3's sequencing savings are small because slice B's B0 work would still exist as a distinct sub-slice; moving it to "its own slice" doesn't change the total work.

### 4.3 The consequence

The program roadmap is updated:

| Slice | Scope |
|---|---|
| A | ✅ Shipped |
| **B** | **Portal auth foundation + family-check-in port** (this spec) |
| C | Port `chinmaya-event-registration` (unchanged) |
| ~~D~~ | ~~Unified auth~~ — absorbed into slice B |
| E+ | Programs, enrollment, retirement |

CLAUDE.md and README updates are part of slice B acceptance criteria (AC-15, AC-16).

---

## 5. Sub-slice decomposition

Slice B is decomposed into six sub-slices. Each sub-slice is one implementation plan, executed by one agent team, with its own TDD task list, acceptance criteria, and e2e flow.

| # | Sub-slice | Role in the system | Task estimate | Depends on |
|---|---|---|---|---|
| **B0** | Portal auth foundation | Login pages, session cookies, middleware, role claims, bootstrap CLI, dual Firebase Admin apps, typed env schema | ~18 | — |
| **B2** | Family portal | Family OTP login, family dashboard, family self-check-in | ~14 | B0 |
| **B3** | Teacher portal | Teacher passphrase login, class roster, attendance marking, reports, uninformed-student list | ~16 | B0 |
| **B1** | Kiosk 1:1 port | Public `/check-in`, guest check-in, family lookup | ~12 | B0 |
| **B4** | Admin dashboard + provisioning | Admin login, dashboard stats, admin user CRUD, guest/unpaid lists, CSV/xlsx reports | ~18 | B0, (B1 for guest write path) |
| **B5** | Notifications & cron | AWS SES/SNS senders, email templates, Vercel Cron for cache reset and payment reminders | ~10 | B1, B2, B4 |

**Total:** ~88 TDD task items across six plans (≈ 4× slice A's 23 tasks).

### 5.1 Delivery order

**Recommended order: B0 → B2 → B3 → B1 → B4 → B5.**

Rationale:

1. **B0 unblocks everything.** Without auth, no other sub-slice can run end-to-end.
2. **B2 + B3 next** because teacher and family login are the stated user priority for slice B.
3. **B1 (kiosk) after** because the standalone `chinmaya-family-check-in` app still serves the production kiosk — there is no production urgency for the portal's kiosk route to be live. B1 ships the code dark-launched (feature flag off in production).
4. **B4 before B5** because B5's notification API needs real consumers (B4's "send donation email" button, B1/B2's payment-reminder hook) to be testable end-to-end.
5. **B5 last** because B1/B2/B3/B4 can use an in-process noop notification client during their own sub-slice execution, and B5 swaps it for real AWS SDK calls.

The order is recommended, not mandatory — a future decision (e.g., "we need the kiosk in the portal by X date") can reshuffle B1 earlier.

---

## 6. Cross-cutting architecture

This section locks decisions that apply to every sub-slice. Every sub-slice's plan inherits these decisions without re-deciding them.

### 6.1 Data layer

Slice B keeps both Firebase products the standalone app already uses:

- **Firebase Realtime Database (RTDB)** is the master data store for families, students, contact info, class rosters, and payment status. It is populated exclusively by Webber's external Excel export process from the legacy WordPress portal. **The portal reads from RTDB; the portal never writes to RTDB.**
- **Firebase Firestore** is the write path for check-in events, guest check-ins, teacher attendance records, admin audit logs, verification codes, and any new collections slice B needs.

Both are Firebase products; both share the same Firebase Auth user database. No data migration is performed.

#### 6.1.1 Dual Firebase project model

Development and production use Firebase projects differently:

| Environment | Portal app (Firestore, Auth) | Master app (RTDB reads) |
|---|---|---|
| **Local dev** | `chinmaya-setu-uat` (a UAT Firebase project) | `chinmaya-setu-715b8` (prod) |
| **Preview deploys (Vercel)** | `chinmaya-setu-uat` | `chinmaya-setu-715b8` |
| **Production (Vercel)** | `chinmaya-setu-715b8` (prod) | `chinmaya-setu-715b8` (prod) |

In dev and preview, the portal writes check-ins to a UAT Firestore (free from prod contamination) while still reading real family data from prod RTDB (because seeding a UAT RTDB with fake families would create maintenance overhead and the data is not especially sensitive).

In production, both apps point at the same Firebase project. Two Admin SDK apps still initialize — the code path is identical — but they happen to reference the same project.

This is implemented as a two-app initializer in `@cmt/firebase-shared/admin/apps.ts`:

```ts
// packages/firebase-shared/src/admin/apps.ts
import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { portalEnv } from './env';

export function getPortalApp() {
  if (getApps().find(a => a.name === 'portal')) return getApp('portal');
  return initializeApp({
    credential: cert({
      projectId:  portalEnv.PORTAL_FIREBASE_PROJECT_ID,
      clientEmail: portalEnv.PORTAL_FIREBASE_CLIENT_EMAIL,
      privateKey: portalEnv.PORTAL_FIREBASE_PRIVATE_KEY,
    }),
    // portal app never touches RTDB
  }, 'portal');
}

export function getMasterApp() {
  if (getApps().find(a => a.name === 'master')) return getApp('master');
  return initializeApp({
    credential: cert({
      projectId:  portalEnv.MASTER_FIREBASE_PROJECT_ID,
      clientEmail: portalEnv.MASTER_FIREBASE_CLIENT_EMAIL,
      privateKey: portalEnv.MASTER_FIREBASE_PRIVATE_KEY,
    }),
    databaseURL: portalEnv.MASTER_FIREBASE_DATABASE_URL,
  }, 'master');
}
```

Admin-scoped service wrappers use the appropriate app:

```ts
// packages/firebase-shared/src/admin/firestore.ts
import { getFirestore } from 'firebase-admin/firestore';
import { getPortalApp } from './apps';
export function portalFirestore() { return getFirestore(getPortalApp()); }

// packages/firebase-shared/src/admin/auth.ts
import { getAuth } from 'firebase-admin/auth';
import { getPortalApp } from './apps';
export function portalAuth() { return getAuth(getPortalApp()); }

// packages/firebase-shared/src/admin/rtdb.ts
import { getDatabase, type Reference } from 'firebase-admin/database';
import { getMasterApp } from './apps';
export function masterRtdb() { return getDatabase(getMasterApp()); }

export async function readRtdb<T>(path: string): Promise<T | null> {
  const snap = await masterRtdb().ref(path).once('value');
  return (snap.val() as T) ?? null;
}

// Intentionally: NO `writeRtdb`, NO `updateRtdb`, NO `pushRtdb`, NO `removeRtdb`.
// RTDB is read-only by convention and by absence of helpers.
```

#### 6.1.2 RTDB read-only enforcement

Read-only status is enforced three ways:

1. **Helper absence** — `@cmt/firebase-shared/admin/rtdb.ts` exports only `masterRtdb()` and `readRtdb()`. No write helpers exist.
2. **Lint rule** — a `no-restricted-syntax` rule in `packages/firebase-shared/eslint.config.js` blocks any file outside `packages/firebase-shared/src/admin/rtdb.ts` from importing `firebase-admin/database` directly.
3. **Code review** — discipline 1 (feature boundaries) means cross-feature imports are already flagged; RTDB write attempts would stand out.

The enforcement is not runtime (the Admin SDK can't be monkey-patched at runtime) — but combined, the three layers make "write to RTDB" a visible, intentional act that a reviewer would catch.

#### 6.1.3 `@cmt/firebase-shared` evolution

Slice A's package structure was minimal. Slice B evolves it to:

```
packages/firebase-shared/src/
  admin/
    apps.ts         (NEW — dual-app initializer)
    auth.ts         (NEW — portalAuth wrapper)
    firestore.ts    (NEW — portalFirestore wrapper)
    rtdb.ts         (NEW — masterRtdb + readRtdb, read-only)
    session.ts      (NEW — createSessionCookie, verifySessionCookie wrappers)
    claims.ts       (NEW — setCustomUserClaims, getUserWithClaims)
    env.ts          (NEW — Zod schema for portal-side env vars)
    index.ts
  client/
    config.ts       (evolved — two configs: portal + master, for client-side use)
    firestore.ts    (NEW — client-side Firestore wrapper)
    rtdb.ts         (NEW — client-side RTDB reader, used by family portal)
    auth.ts         (NEW — client-side Firebase Auth setup — used by mobile sign-in flows only)
    index.ts
  __tests__/
    apps.test.ts, session.test.ts, claims.test.ts, rtdb.test.ts, firestore.test.ts, env.test.ts
  index.ts            (re-exports)
```

All Admin SDK modules are mocked with `vi.mock('firebase-admin/*')` in tests — no real Firebase project required for unit tests.

### 6.2 `@cmt/shared-domain` evolution

Slice B adds check-in domain types and auth types:

```
packages/shared-domain/src/
  check-in/
    family.ts       (Family, Student, ContactInfo, PaymentStatus — read models from RTDB)
    check-in.ts     (CheckInEvent, CheckInStatus — write models to Firestore)
    guest.ts        (GuestCheckIn — write model)
    attendance.ts   (AttendanceRecord, ClassRoster, AttendanceStatus — teacher models)
    api.ts          (request/response types for every /api/check-in/* endpoint)
    index.ts
  auth/
    role.ts         (Role union: 'admin' | 'teacher' | 'family'; role predicates)
    session.ts      (SessionClaims type — the shape stored in custom claims)
    public-routes.ts (PUBLIC_ROUTES array — data, not regex)
    can-access-route.ts (pure function: (claims, path) => boolean)
    index.ts
  index.ts            (re-exports)
```

**Discipline 2 is preserved:** zero imports of React, Next, Node, DOM, or any runtime dependency. Pure TypeScript and pure functions only. Enforced by existing ESLint `no-restricted-imports`.

**All request and response body types live in `check-in/api.ts`.** This is the single source of truth for the portal's HTTP contract. Route handlers import these types; when the mobile app exists, it imports them from the same package (or a published version). No duplicated type definitions across the monorepo.

### 6.3 Feature boundaries inside `/check-in`

All slice B feature code lives under `apps/portal/src/features/check-in/`:

```
apps/portal/src/features/check-in/
  auth/                  (B0 — login pages + session handlers)
  kiosk/                 (B1 — public check-in)
  family/                (B2 — family self-service)
  teacher/               (B3 — teacher attendance)
  admin/                 (B4 — admin dashboard + user provisioning)
  notifications/         (B5 — SES/SNS senders; server-only)
  shared/                (cross-sub-slice components: StudentList, CheckInForm, etc.)
```

**Boundary rule (lint-enforced):** files under `features/check-in/<a>/` cannot import from `features/check-in/<b>/` except through `features/check-in/shared/`. This lets B0–B5 teams work independently. The existing `eslint-plugin-boundaries` configuration from slice A is extended with sub-feature boundaries:

```js
// apps/portal/eslint.config.js (extended)
{
  settings: {
    'boundaries/elements': [
      // existing slice A feature boundary
      { type: 'feature', pattern: 'features/*' },
      // new sub-feature boundary inside check-in
      { type: 'check-in-sub', pattern: 'features/check-in/*' },
    ],
  },
  rules: {
    'boundaries/element-types': ['error', {
      default: 'disallow',
      rules: [
        { from: 'check-in-sub', allow: [{ type: 'check-in-sub', element: 'shared' }] },
      ],
    }],
  },
}
```

**App-router segment wiring:** `apps/portal/src/app/check-in/<segment>/page.tsx` files are thin; each imports a `<Page>` component from `features/check-in/<name>/`. Per-segment `error.tsx` + `loading.tsx` live alongside the `page.tsx` per discipline 3. Same pattern for `/login/*`.

### 6.4 Feature flags

Slice A defined one flag: `NEXT_PUBLIC_FEATURE_CHECK_IN`. Slice B extends `apps/portal/src/lib/flags.ts`:

```ts
export const flags = {
  checkIn:         getFlag('NEXT_PUBLIC_FEATURE_CHECK_IN'),         // master kill-switch
  checkInKiosk:    getFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK'),   // B1
  checkInFamily:   getFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY'),  // B2
  checkInTeacher:  getFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER'), // B3
  checkInAdmin:    getFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN'),   // B4
  checkInNotify:   getFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY'),  // B5
} as const;
```

Every sub-flag is AND-gated with the master `checkIn` flag. When a sub-flag is off, the corresponding routes return `notFound()` (404) rather than rendering. Tests cover both on and off states.

**Production flag defaults when slice B ships:**

| Flag | Default |
|---|---|
| `NEXT_PUBLIC_FEATURE_CHECK_IN` | `true` (master on) |
| `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK` | `false` (kiosk dark; standalone app still serves production) |
| `NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY` | `true` |
| `NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER` | `true` |
| `NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN` | `true` |
| `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY` | `true` (real SES/SNS calls enabled) |

### 6.5 Test strategy

#### 6.5.1 Testing pyramid

```
Unit (Vitest)          ~70%   Pure logic: role predicates, validators, formatters,
                              Firebase helper wrappers with mocked admin SDK,
                              AWS senders with mocked @aws-sdk/client-ses/sns
Integration (Vitest)   ~25%   Next.js route handlers tested via next-test-api-route-handler,
                              middleware tested via mocked NextRequest,
                              feature components tested with React Testing Library against mocked service layer
E2E (Playwright)        ~5%   One critical flow per sub-slice (6 total)
```

#### 6.5.2 TDD discipline

Every task in every sub-slice plan follows the slice-A pattern:

1. Write the failing test.
2. Run it to confirm it fails with the expected message.
3. Write the minimal implementation.
4. Run the test to confirm it passes.
5. Commit.

This is repeated in the header of every sub-slice plan. Teams that skip TDD are directed back to the plan.

#### 6.5.3 Mocks

- **Firebase Admin SDK** → `vi.mock('firebase-admin/auth')`, `vi.mock('firebase-admin/firestore')`, `vi.mock('firebase-admin/database')` at the module boundary, with typed fakes. The dual-app initializer is mocked so tests don't actually connect to Firebase.
- **AWS SES** → `@aws-sdk/client-mock` with `SESClient` mocks. Tests assert the `SendEmailCommand` input shape.
- **AWS SNS** → `@aws-sdk/client-mock` with `SNSClient` mocks. Same pattern.
- **`next/navigation`** → RTL helper from slice A's `@cmt/ui` test setup, extended with `useSearchParams` mocks for OTP flows.
- **Identity Toolkit REST** (`signInWithCustomToken` call in session minting) → intercepted with `vi.spyOn(global, 'fetch')` and returned with fixture ID tokens.

#### 6.5.4 Coverage targets

**Soft targets** (not CI-enforced):

- `≥ 80%` lines across `apps/portal/src/features/check-in/`
- `≥ 80%` lines across `packages/firebase-shared/src/admin/`
- `≥ 75%` branches across both

Coverage is reported but does not fail the build. Discipline, not a gate.

#### 6.5.5 Playwright e2e

**Configuration:**

- `apps/portal/playwright.config.ts` — Chromium only (no Firefox/Safari — the portal is not a public marketing site)
- `apps/portal/e2e/` directory, excluded from Next.js build via `next.config.ts` `outputFileTracingExcludes`
- Runs against `pnpm dev` on a random port
- Test Firebase connection: **emulator mode** via `FIREBASE_AUTH_EMULATOR_HOST` and `FIRESTORE_EMULATOR_HOST` environment variables
- AWS calls: mocked at the handler layer (the notification module detects `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=false` and returns success without calling SDK)
- Trace: recorded on failure only
- Retries: 1 on CI, 0 locally

**Emulator setup** happens in B0 as a one-time script (`pnpm firebase:emulate`) documented in README.

**Critical e2e flows (one per sub-slice):**

| Sub-slice | Flow |
|---|---|
| **B0** | Visit `/check-in/admin` → redirected to `/login` → log in as bootstrapped admin → land on `/check-in/admin` stub |
| **B1** | Visit `/check-in` → enter family ID → see student list → check in → success toast |
| **B2** | Visit `/login/family` → enter email → mocked OTP `000000` → land on `/check-in/family` → see kids |
| **B3** | Visit `/login/teacher` → enter passphrase → land on `/check-in/teacher` → open a class roster → mark 3 students → submit |
| **B4** | Log in as admin → `/check-in/admin/users` → fill form → see new admin in list → delete → see removed |
| **B5** | Trigger payment-reminder endpoint manually → assert mock SES was called with expected `to` + `template` |

**Playwright is NOT on the pre-push hook.** It runs via `pnpm test:e2e` on demand (developer discretion) and before every production promotion (manual step documented in the deployment checklist).

### 6.6 Pre-push hook (unchanged from slice A)

```
pnpm typecheck
pnpm lint
pnpm test        # Vitest only — fast
pnpm build
```

No changes from slice A. Pre-push is gated on Vitest + build success; Playwright is separate.

---

## 7. B0 — Portal auth foundation (detailed architecture)

B0 is the most load-bearing sub-slice. All other sub-slices depend on it. This section is the deep architecture for B0; the sub-slice sections (8–13) reference it.

### 7.1 Auth flows

Three sign-in entry points converge to one session-cookie mechanism:

```
                     ┌─ /login           → role picker (family / teacher / admin)
                     │
                     ├─ /login/admin     → email + password
                     │   POST /api/auth/admin/signin
                     │     1. Validate zod shape { email, password }
                     │     2. Call Identity Toolkit REST signInWithPassword
                     │     3. Receive Firebase ID token
                     │     4. getUser(uid); verify custom claim { role: 'admin' }
                     │        (if no admin claim on this user → 403)
                     │     5. portalAuth().createSessionCookie(idToken, { expiresIn: 5 days })
                     │     6. Set HttpOnly Secure SameSite=Lax cookie `__session`
                     │     7. Return 200 { redirectTo: '/check-in/admin' }
                     │
                     ├─ /login/teacher   → passphrase only
                     │   POST /api/auth/teacher/signin
                     │     1. Validate zod shape { passphrase }
                     │     2. timingSafeEqual(passphrase, env.TEACHER_PASSPHRASE) → 401 if mismatch
                     │     3. getOrCreate Firebase user with deterministic UID `teacher-shared-v1`
                     │     4. setCustomUserClaims(uid, { role: 'teacher' })
                     │     5. createCustomToken(uid, { role: 'teacher' })
                     │     6. Exchange custom token → ID token via Identity Toolkit REST
                     │        POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken
                     │     7. createSessionCookie(idToken, { expiresIn: 5 days })
                     │     8. Set HttpOnly cookie; return 200 { redirectTo: '/check-in/teacher' }
                     │
                     └─ /login/family    → email or phone → OTP
                         POST /api/auth/family/send-code
                           1. Validate zod shape { type: 'email'|'phone', value }
                           2. findFamilyByContact(value) in RTDB → 404 if not found
                           3. Generate 6-digit code (crypto.randomInt)
                           4. Store in Firestore verification_codes/{sha256(value)}
                              with { code, type, expiresAt: now + 10 min }
                           5. Rate-limit check: ≥ 5 sends in 15 min window → 429
                           6. Send code via AWS SES (email) or SNS (phone)
                              → in B0/B2: noop mock sender (logs code)
                              → in B5: real AWS SDK call
                           7. Return 200 { success: true, throttleResetAt }

                         POST /api/auth/family/verify-code
                           1. Validate zod shape { type, value, code }
                           2. Load verification_codes/{sha256(value)} from Firestore
                           3. Verify code matches and not expired
                           4. Delete the verification record (one-shot)
                           5. getOrCreate Firebase user with UID sha256(value)
                           6. setCustomUserClaims(uid, { role: 'family', familyId: family.fid })
                           7. createCustomToken(uid, { role: 'family', familyId })
                           8. Exchange → ID token
                           9. createSessionCookie → HttpOnly cookie (web mode)
                              OR return { customToken } (mobile mode — see §7.5)
                          10. Return 200 { redirectTo: '/check-in/family' }  (or customToken for mobile)
```

**Password for admin accounts is never in env vars.** Admins are provisioned via `pnpm seed:admin` (§7.4) or via the B4 `/check-in/admin/users` UI. Firebase Auth stores the password hash.

### 7.2 Session cookies

**Cookie shape:**

```
Set-Cookie: __session=<opaque-session-token>;
            HttpOnly;
            Secure;
            SameSite=Lax;
            Path=/;
            Max-Age=432000   (5 days)
```

**Creation:** `portalAuth().createSessionCookie(idToken, { expiresIn: env.SESSION_COOKIE_EXPIRES_DAYS * 24 * 60 * 60 * 1000 })`. Returns an opaque session token that Firebase encodes and signs. The mechanism is Firebase's own session-cookie feature — documented at <https://firebase.google.com/docs/auth/admin/manage-cookies>.

**Verification** (every request, via middleware):

```ts
const claims = await portalAuth().verifySessionCookie(sessionCookie, /* checkRevoked */ true);
// claims: { uid, role, familyId?, email?, iat, exp, ... }
```

`checkRevoked: true` means revoked sessions (admin deleted, claims changed) invalidate within ~1 minute. Cost: extra Firebase Admin call per request. Acceptable for expected traffic volume (~dozens of requests/minute at peak).

### 7.3 Middleware

`apps/portal/src/middleware.ts` (new in B0):

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { canAccessRoute, PUBLIC_ROUTES } from '@cmt/shared-domain/auth';
import type { SessionClaims } from '@cmt/shared-domain/auth';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip static, images, Next internals
  if (pathname.startsWith('/_next/') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  // Public routes (data, not regex)
  if (PUBLIC_ROUTES.some(p => matchRoute(p, pathname))) {
    return NextResponse.next();
  }

  // Try Bearer first (mobile), then cookie (web)
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const cookie = req.cookies.get('__session')?.value;

  let claims: SessionClaims | null = null;
  try {
    if (bearer) {
      claims = await portalAuth().verifyIdToken(bearer, true) as unknown as SessionClaims;
    } else if (cookie) {
      claims = await portalAuth().verifySessionCookie(cookie, true) as unknown as SessionClaims;
    }
  } catch {
    claims = null;
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
  const redirect = new URL('/login', req.url);
  redirect.searchParams.set('from', req.nextUrl.pathname);
  if (reason === 'unauthorized') redirect.searchParams.set('error', 'unauthorized');
  if (reason === 'no-session')  redirect.searchParams.set('error', 'session-expired');
  return NextResponse.redirect(redirect);
}

export const config = {
  matcher: [
    // Run on all routes except static asset requests
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
```

**Runtime:** Node.js (Fluid Compute), not Edge. Firebase Admin requires full Node.js. Declared explicitly via `export const runtime = 'nodejs'` in each API route handler; Next.js 16 middleware on Node.js is the default in Fluid Compute.

**Public route whitelist** (`packages/shared-domain/src/auth/public-routes.ts`):

```ts
export const PUBLIC_ROUTES = [
  '/',                    // slice A portal landing
  '/events',              // slice A stub
  '/login',               // role picker
  '/login/admin',
  '/login/teacher',
  '/login/family',
  '/check-in',            // kiosk landing (feature-flagged)
  '/check-in/guest',      // kiosk guest flow (feature-flagged)
  '/check-in/lookup',     // kiosk family lookup (feature-flagged)
  '/api/auth/admin/signin',
  '/api/auth/teacher/signin',
  '/api/auth/family/send-code',
  '/api/auth/family/verify-code',
  '/api/auth/signout',
  // public check-in APIs (kiosk)
  '/api/check-in/families/:familyId',
  '/api/check-in/families/:familyId/check-in',
  '/api/check-in/lookup',
  '/api/check-in/guests',  // POST only (GET is admin-gated, handled by canAccessRoute)
] as const;
```

New routes default to private. Adding a route to this list is a deliberate, code-reviewed act.

### 7.4 Role model

```
Role         Landing route         Inherits from      Allowed route patterns
─────        ────────────────      ──────────────     ────────────────────────
admin        /check-in/admin       teacher            /check-in/admin/**, /check-in/teacher/**, /check-in (public)
teacher      /check-in/teacher     —                  /check-in/teacher/**, /check-in (public)
family       /check-in/family      —                  /check-in/family/**, /check-in (public)
(none)       /check-in              —                 /check-in, /check-in/guest, /check-in/lookup (public)
                                                       /login/**, / (portal landing), /events
```

**Hierarchy is flat except admin inherits teacher.** Pragmatic choice — an admin testing the teacher flow shouldn't need two accounts. Encoded in a single pure function:

```ts
// packages/shared-domain/src/auth/can-access-route.ts
import { PUBLIC_ROUTES } from './public-routes';
import type { SessionClaims, Role } from './session';

export function canAccessRoute(claims: SessionClaims, pathname: string): boolean {
  if (PUBLIC_ROUTES.some(p => matchRoute(p, pathname))) return true;

  if (pathname.startsWith('/check-in/admin'))   return claims.role === 'admin';
  if (pathname.startsWith('/check-in/teacher')) return claims.role === 'admin' || claims.role === 'teacher';
  if (pathname.startsWith('/check-in/family'))  return claims.role === 'family';

  // API surface mirrors page surface
  if (pathname.startsWith('/api/check-in/admin'))   return claims.role === 'admin';
  if (pathname.startsWith('/api/check-in/teacher')) return claims.role === 'admin' || claims.role === 'teacher';
  if (pathname.startsWith('/api/check-in/family'))  return claims.role === 'family';

  // unknown protected route → deny
  return false;
}
```

Unit-tested with ~30 cases spanning every role × every route × public vs private.

### 7.5 Bootstrap CLI

B0 ships a CLI script to seed the first admin (required — without it you can't log in to test anything):

```
pnpm --filter @cmt/portal seed:admin --email=developer@chinmayatoronto.org
```

Implementation: `apps/portal/scripts/seed-admin.ts`:

1. Reads `PORTAL_FIREBASE_*` env vars (fails loud if missing).
2. Prompts for password interactively (not a CLI arg — avoids shell history leakage).
3. Initializes Admin SDK via `getPortalApp()`.
4. Calls `getAuth().getUserByEmail(email)`; if found, updates password and claims; if not, creates user.
5. Calls `setCustomUserClaims(uid, { role: 'admin' })`.
6. Prints `✅ Admin seeded: <uid> <email>` on success.
7. Exits 0 on success, 1 on failure with descriptive error.

Idempotent. Run once after the first deploy to each environment. Documented in README with exact commands.

### 7.6 Env schema

`apps/portal/src/lib/env.ts` (extended from slice A's flags-only version to cover all of slice B):

```ts
import { z } from 'zod';

const portalEnvSchema = z.object({
  // Portal Firebase (Firestore + Auth — UAT in dev, prod in prod)
  PORTAL_FIREBASE_PROJECT_ID:    z.string().min(1),
  PORTAL_FIREBASE_CLIENT_EMAIL:  z.string().email(),
  PORTAL_FIREBASE_PRIVATE_KEY:   z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY:            z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN:        z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID:         z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET:     z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID:             z.string().min(1),

  // Master Firebase (RTDB — always prod)
  MASTER_FIREBASE_PROJECT_ID:    z.string().min(1),
  MASTER_FIREBASE_CLIENT_EMAIL:  z.string().email(),
  MASTER_FIREBASE_PRIVATE_KEY:   z.string().min(1),
  MASTER_FIREBASE_DATABASE_URL:  z.string().url(),
  NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL: z.string().url(),

  // Auth
  TEACHER_PASSPHRASE:            z.string().min(6),
  SESSION_COOKIE_EXPIRES_DAYS:   z.coerce.number().int().min(1).max(14).default(5),

  // AWS (declared in B0 schema; consumed in B5)
  AWS_SES_REGION:                z.string().default('ca-central-1'),
  AWS_SNS_REGION:                z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID:             z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY:         z.string().min(1).optional(),
  AWS_SES_FROM_EMAIL:            z.string().email().optional(),
  AWS_SNS_TOPIC_ARN:             z.string().optional(),

  // Cron auth (slice B5)
  CRON_SECRET:                   z.string().min(16).optional(),

  // Feature flags
  NEXT_PUBLIC_FEATURE_CHECK_IN:            z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK:      z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY:     z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER:    z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN:      z.enum(['true', 'false']).default('false'),
  NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY:     z.enum(['true', 'false']).default('false'),
});

export const portalEnv = portalEnvSchema.parse(process.env);
```

**Startup fails loudly** if any required var is missing, with the exact zod error path. Tested with "missing `PORTAL_FIREBASE_PRIVATE_KEY` → app refuses to boot with a clear error."

AWS vars are optional in the schema (to allow local dev without AWS) but required at runtime when `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=true`. B5 enforces this runtime check in the notification module.

### 7.7 Error boundaries

Per discipline 3, B0 adds:

```
apps/portal/src/app/login/error.tsx              (generic auth error)
apps/portal/src/app/login/loading.tsx
apps/portal/src/app/login/admin/error.tsx
apps/portal/src/app/login/teacher/error.tsx
apps/portal/src/app/login/family/error.tsx       (OTP-specific)
apps/portal/src/app/check-in/admin/error.tsx     (stub — real dashboard in B4)
apps/portal/src/app/check-in/admin/loading.tsx
```

All use the `ErrorFallback` primitive from `@cmt/ui` that slice A already exposes. Minimal content — they exist so the discipline holds from day one and later sub-slices don't forget to add them.

---

## 8. Mobile API readiness

Every protected API under `/api/check-in/*` must accept **two equivalent auth modes** so that a future mobile app can consume the same backend. This section formalizes the contract.

### 8.1 Two auth modes

**Web browser:**
- Signs in via `POST /api/auth/{admin,teacher,family}/signin` → receives HttpOnly `__session` cookie
- All subsequent requests carry the cookie automatically
- Middleware reads cookie → `verifySessionCookie` → claims

**Mobile app (future):**
- Signs in **directly with the Firebase client SDK** on device (no `/api/auth/*/signin` calls for admin/teacher)
- Every request carries `Authorization: Bearer <firebase-id-token>`
- Middleware reads header → `verifyIdToken` → claims
- ID tokens auto-refresh on device via Firebase client SDK

The middleware code in §7.3 handles both modes. Downstream handlers are mode-agnostic.

### 8.2 Auth response shapes

The family OTP endpoint returns different response shapes based on a `mode` query parameter:

- `POST /api/auth/family/verify-code?mode=web` → sets cookie, returns `{ redirectTo: '/check-in/family' }`
- `POST /api/auth/family/verify-code?mode=mobile` → returns `{ customToken: '...' }` for the mobile app to exchange locally via `signInWithCustomToken`

Admin and teacher mobile sign-in is handled entirely on-device using the Firebase client SDK directly:
- **Admin (mobile):** `signInWithEmailAndPassword(auth, email, password)` → ID token
- **Teacher (mobile):** deferred; teachers are a web-only flow in slice B (the shared passphrase is not a natural fit for a mobile app; when teachers move to real accounts in a future slice, mobile auth becomes trivial)
- **Family (mobile):** `POST /api/auth/family/send-code` + `POST /api/auth/family/verify-code?mode=mobile` → custom token → `signInWithCustomToken` on device

### 8.3 API surface

Slice B's first-pass API surface (expanded in sub-slice plans):

```
POST /api/auth/admin/signin                          web only (cookie)
POST /api/auth/teacher/signin                        web only (cookie)
POST /api/auth/family/send-code                      web + mobile (public, rate-limited)
POST /api/auth/family/verify-code                    web + mobile (mode= param)
POST /api/auth/signout                               web only (clears cookie)

GET  /api/check-in/families/:familyId                both auth modes, public
POST /api/check-in/families/:familyId/check-in       both, public (kiosk write)
GET  /api/check-in/lookup?type=&value=               both, public
POST /api/check-in/guests                            both, public
GET  /api/check-in/guests                            both, admin-only

GET  /api/check-in/teacher/classlist                 both, teacher
GET  /api/check-in/teacher/roster/:classId           both, teacher
POST /api/check-in/teacher/attendance                both, teacher
GET  /api/check-in/teacher/report                    both, teacher
GET  /api/check-in/teacher/uninformed                both, teacher

GET  /api/check-in/family/dashboard                  both, family
POST /api/check-in/family/self-check-in              both, family

GET  /api/check-in/admin/users                       both, admin
POST /api/check-in/admin/users                       both, admin
DELETE /api/check-in/admin/users/:uid                both, admin
GET  /api/check-in/admin/stats                       both, admin
GET  /api/check-in/admin/unpaid                      both, admin
POST /api/check-in/admin/reports/:kind               both, admin (CSV or xlsx response)

POST /api/check-in/notifications/send-email          both, admin-or-system
POST /api/check-in/notifications/payment-reminder    both, admin-or-system
POST /api/cron/reset-cache                           cron (CRON_SECRET header)
POST /api/cron/send-weekly-payment-reminders         cron (CRON_SECRET header)
```

### 8.4 Request/response types

Every request and response body type is defined in `packages/shared-domain/src/check-in/api.ts`. Route handlers import types; no duplication.

Example:

```ts
// packages/shared-domain/src/check-in/api.ts
import type { Student, Family } from './family';
import type { CheckInEvent } from './check-in';

export interface CheckInSubmitRequest {
  students: Record<string, boolean>;  // studentId -> isPresent
  checkedInBy: 'sevak' | 'family' | 'teacher';
}
export interface CheckInSubmitResponse {
  success: boolean;
  checkInId: string;
  event: CheckInEvent;
}

export interface FamilyLookupRequest {
  type: 'email' | 'phone';
  value: string;
}
export interface FamilyLookupResponse {
  familyId: string;
  students: Student[];
}

// ... one type per endpoint
```

When the mobile app is built, it imports these types from `@cmt/shared-domain` (workspace) or from a published version of the package. Compile-time contract matching with the portal backend.

### 8.5 Response format conventions

- **Success:** `200 { ...payload }` or `201` for creates.
- **Client error:** `4xx { error: string, details?: unknown }`.
- **Server error:** `500 { error: 'internal-error' }` (never leak internal error messages).
- **Auth error:** `401 { error: 'no-session' | 'session-expired' | 'unauthorized' }`.
- **Rate limit:** `429 { error: 'rate-limited', resetAt: string }`.

### 8.6 Non-goals for mobile in slice B

1. Slice B does **not** build the mobile app itself.
2. Slice B does **not** publish `@cmt/shared-domain` to npm.
3. Slice B does **not** implement API versioning (`/api/v1/...`).
4. Slice B does **not** add CORS.
5. Slice B does **not** add rate limiting beyond the OTP send-code endpoint.

---

## 9. Sub-slice B0 — Portal auth foundation

**Delivered:** 1st. **Depends on:** nothing (slice A is prerequisite; all slice-B sub-slices depend on B0).

### 9.1 What B0 ships

1. `@cmt/firebase-shared` dual-app initializer (§6.1.1) + admin service wrappers.
2. `@cmt/shared-domain/auth/*` pure module — role, session, public-routes, can-access-route.
3. `apps/portal/src/lib/env.ts` Zod schema (§7.6).
4. `apps/portal/src/middleware.ts` dual-mode auth middleware (§7.3).
5. `apps/portal/src/app/login/page.tsx` — role picker landing.
6. `apps/portal/src/app/login/admin/page.tsx` — email + password form.
7. `apps/portal/src/app/login/teacher/page.tsx` — passphrase form.
8. `apps/portal/src/app/login/family/page.tsx` — email/phone + OTP form (infrastructure only; real OTP send is mocked in B0 and real in B2's AWS wiring).
9. `apps/portal/src/app/api/auth/admin/signin/route.ts`.
10. `apps/portal/src/app/api/auth/teacher/signin/route.ts`.
11. `apps/portal/src/app/api/auth/signout/route.ts`.
12. `apps/portal/src/app/check-in/admin/page.tsx` — auth-gate stub. Displays "Admin dashboard — coming in B4" behind auth.
13. `apps/portal/scripts/seed-admin.ts` — bootstrap CLI (§7.5).
14. Per-segment `error.tsx` for `/login/*` and `/check-in/admin/*`.
15. `apps/portal/playwright.config.ts` + `apps/portal/e2e/b0-auth.spec.ts`.
16. Firebase emulator setup docs + `pnpm firebase:emulate` script.
17. `features/check-in/auth/` feature directory with login form components, session helpers, role guards.
18. Extension of `apps/portal/eslint.config.js` with sub-feature boundaries.

### 9.2 B0 acceptance criteria

- **B0-AC-1** `pnpm seed:admin --email=developer@chinmayatoronto.org` creates an admin user in `chinmaya-setu-uat`.
- **B0-AC-2** `curl -X POST /api/auth/admin/signin` with correct email+password returns 200 and `Set-Cookie: __session=...; HttpOnly; Secure; SameSite=Lax`.
- **B0-AC-3** Wrong password returns 401 with `{ error: 'unauthorized' }`.
- **B0-AC-4** `curl /check-in/admin` without a cookie returns 302 to `/login?from=/check-in/admin&error=session-expired`.
- **B0-AC-5** `curl /check-in/admin` with a valid admin cookie returns 200 and the admin-stub page.
- **B0-AC-6** `curl /check-in/admin` with a valid *teacher* cookie returns 302 to `/login?error=unauthorized`.
- **B0-AC-7** `curl /api/check-in/admin/stats` without auth returns **401 JSON** (not redirect, because it's an API route).
- **B0-AC-8** Bearer token path: `curl -H "Authorization: Bearer <idToken>" /api/check-in/admin/stats` with a valid admin ID token returns 200.
- **B0-AC-9** Unit tests green for `canAccessRoute` (≥30 cases), `portalSession.createSessionCookie`, `portalSession.verifySessionCookie`, `claims.setCustomUserClaims`, `rtdb.readRtdb`, `firestore.portalFirestore`, `env.portalEnv` validation, `apps.getPortalApp`, `apps.getMasterApp`.
- **B0-AC-10** Integration tests green for: `POST /api/auth/admin/signin` happy path and error paths, `POST /api/auth/teacher/signin` happy path and wrong-passphrase, `POST /api/auth/signout`, middleware happy/redirect/401 paths.
- **B0-AC-11** Playwright e2e green for: "unauthenticated → `/check-in/admin` → redirect → admin login form → submit → land on `/check-in/admin` stub."
- **B0-AC-12** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green on the sub-slice branch (or main, given solo-dev workflow).
- **B0-AC-13** Pre-push hook passes.
- **B0-AC-14** Env schema test: deleting `PORTAL_FIREBASE_PRIVATE_KEY` from `.env.local` causes `pnpm dev` and `pnpm test` to fail with a clear zod error mentioning the missing variable.
- **B0-AC-15** Sub-feature boundary lint test: a test file that imports from `features/check-in/kiosk/` inside `features/check-in/auth/` fails lint.
- **B0-AC-16** `@cmt/firebase-shared/admin/rtdb.ts` exports exactly `masterRtdb` and `readRtdb` — no write helpers present (grep test).
- **B0-AC-17** Lint rule blocks `import 'firebase-admin/database'` outside of `packages/firebase-shared/src/admin/rtdb.ts`.
- **B0-AC-18** README updated with bootstrap CLI instructions and env var list.

---

## 10. Sub-slice B2 — Family portal

**Delivered:** 2nd. **Depends on:** B0.

### 10.1 Pages

- `apps/portal/src/app/login/family/page.tsx` — already scaffolded in B0; B2 wires the real OTP flow.
- `apps/portal/src/app/check-in/family/page.tsx` — family dashboard: student list with latest check-in status, payment status banner, "check in my kids" CTA.
- `apps/portal/src/app/check-in/family/check-in/page.tsx` — family self-service check-in: student roster, toggle present/absent, submit.
- Per-segment `error.tsx` and `loading.tsx` for every page.

### 10.2 APIs

- `POST /api/auth/family/send-code` — accepts `{ type: 'email'|'phone', value }`. Validates family exists in RTDB. Generates 6-digit code. Stores in Firestore `verification_codes/{sha256}` with 10-min TTL. Sends via noop mock (B5 replaces with real SES/SNS). Rate-limited to 5 requests per contact per 15-min window.
- `POST /api/auth/family/verify-code` — verifies code, one-shot deletes it, gets-or-creates Firebase user, sets claims `{ role: 'family', familyId }`, returns cookie (web) or custom token (mobile).
- `GET /api/check-in/family/dashboard` — reads family's kids from RTDB + recent check-in history from Firestore + payment status, returns combined payload.
- `POST /api/check-in/family/self-check-in` — writes check-in event to Firestore with `checkedInBy: 'family'`. Does NOT trigger payment reminder (family is looking at the payment banner already).

### 10.3 Components

`features/check-in/family/`:

- `FamilyDashboard.tsx` — server component, reads auth from headers.
- `StudentCheckInList.tsx` — client component, manages toggle state.
- `PaymentStatusBanner.tsx` — shows "paid" / "unpaid" / "partial" from RTDB.

Lifted from `features/check-in/shared/`:

- `CheckInForm.tsx` — shared with B1 kiosk.
- `OtpCodeInput.tsx` — 6-digit input built from `@cmt/ui` primitives.

### 10.4 Key decisions

- **Family user UID** is `sha256(value)` where `value` is the normalized contact (lowercased email or digits-only phone). Ensures two lookup paths (same contact via email vs phone) converge to the same Firebase user.
- **`react-phone-number-input` is dropped.** Replaced with a native `<input type="tel">` + a small country-code dropdown (`@cmt/ui` primitive added in B2).
- **`headlessui` is dropped** for form controls — replaced with `@cmt/ui` shadcn primitives (`Input`, `Button`, `Form`, `Toast`).
- **OTP noop sender** in B2: the `SendCodeViaMock` service logs the code and returns success. Real AWS sender arrives in B5.
- **Family dashboard is greenfield UX** — the standalone app's home page is a kiosk, not a family dashboard. B2 designs a minimal family dashboard; future slices can enrich it.

### 10.5 Acceptance criteria (selected)

- **B2-AC-1** Sending an OTP to an unknown email returns 404.
- **B2-AC-2** Sending an OTP to a known email stores the code in Firestore and logs via mock sender.
- **B2-AC-3** Rate limit: the 6th send-code request within 15 minutes returns 429.
- **B2-AC-4** Verifying a wrong code returns 401.
- **B2-AC-5** Verifying a correct code creates the user, sets claims, and returns a session cookie.
- **B2-AC-6** `/check-in/family` renders the family's kids from RTDB and check-in history from Firestore.
- **B2-AC-7** `/check-in/family/check-in` writes a `CheckInEvent` with `checkedInBy: 'family'`.
- **B2-AC-8** Playwright e2e green: login flow + dashboard + self-check-in.
- **B2-AC-9** Bearer token mode works for `/api/check-in/family/dashboard` and `/api/check-in/family/self-check-in`.
- **B2-AC-10** All new pages have `error.tsx`.
- **B2-AC-11** No `react-phone-number-input`, no `headlessui` dep added to `package.json`.
- **B2-AC-12** Unit + integration tests ≥ 80% line coverage under `features/check-in/family/`.
- **B2-AC-13** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.
- **B2-AC-14** Feature flag `NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY` toggles the family routes on/off (tests cover both).

---

## 11. Sub-slice B3 — Teacher portal

**Delivered:** 3rd. **Depends on:** B0.

### 11.1 Pages

- `apps/portal/src/app/login/teacher/page.tsx` — scaffolded in B0; B3 makes the dashboard real.
- `apps/portal/src/app/check-in/teacher/page.tsx` — teacher dashboard: class list, links to attendance/report/uninformed.
- `apps/portal/src/app/check-in/teacher/attendance/page.tsx` — class picker → roster → mark present/absent/late/uninformed → submit.
- `apps/portal/src/app/check-in/teacher/report/page.tsx` — attendance history by class, date range, student. CSV export button.
- `apps/portal/src/app/check-in/teacher/uninformed/page.tsx` — uninformed absent list across classes.
- Per-segment `error.tsx` and `loading.tsx`.

### 11.2 APIs

- `GET /api/check-in/teacher/classlist` — reads class list from RTDB.
- `GET /api/check-in/teacher/roster?classId=X` — reads student roster for a class from RTDB.
- `POST /api/check-in/teacher/attendance` — writes attendance records to Firestore `attendance/{date}/{classId}/{studentId}`.
- `GET /api/check-in/teacher/report?classId=&from=&to=` — reads attendance from Firestore, returns aggregated JSON. If `Accept: text/csv`, returns CSV stream.
- `GET /api/check-in/teacher/uninformed?from=&to=` — queries Firestore for attendance entries with `status: 'uninformed'`.

### 11.3 Components

`features/check-in/teacher/`:

- `TeacherDashboard.tsx` — entry page.
- `ClassListCard.tsx` — displays available classes.
- `AttendanceMarker.tsx` — interactive roster with status toggles.
- `AttendanceStatusBadge.tsx` — `{ present, absent, late, uninformed }` visual indicator.
- `AttendanceReportTable.tsx` — historical view.
- `CsvExportButton.tsx` — triggers the CSV endpoint and downloads.

### 11.4 Key decisions

- **`teacher-shared-v1` deterministic UID** is explicitly called out as a known limitation: every teacher session uses the same Firebase user, so there is no per-teacher audit trail. The limitation is acceptable because the shared passphrase approach is temporary. A comment in the login handler links to this document.
- **No per-class teacher assignment.** Every teacher sees every class in B3. A future slice can add `assigned_classes` when teachers become real accounts.
- **Attendance status enum** is standardized to `{ present, absent, late, uninformed }` — matches the standalone app's `/teacher/uninformed-students` naming.
- **CSV export is server-side.** The CSV serializer is a pure function in `features/check-in/teacher/csv.ts` and unit-tested.
- **No `react-datepicker`.** Date range uses shadcn `Calendar` + `DateRangePicker` composed from `@cmt/ui`.

### 11.5 Acceptance criteria (selected)

- **B3-AC-1** Wrong teacher passphrase returns 401, and no Firebase user is created.
- **B3-AC-2** Correct passphrase returns session cookie and redirects to `/check-in/teacher`.
- **B3-AC-3** `/check-in/teacher` lists classes from RTDB.
- **B3-AC-4** `/check-in/teacher/attendance` writes attendance records to Firestore with the correct shape.
- **B3-AC-5** `/check-in/teacher/report?Accept=text/csv` returns a CSV response with the correct `Content-Disposition` header.
- **B3-AC-6** `/check-in/teacher/uninformed` lists only entries with `status: 'uninformed'`.
- **B3-AC-7** Playwright e2e green: login + class pick + mark 3 students + submit + verify in report.
- **B3-AC-8** Bearer token mode works for every `/api/check-in/teacher/*` endpoint.
- **B3-AC-9** Unit + integration tests ≥ 80% line coverage under `features/check-in/teacher/`.
- **B3-AC-10** No `react-datepicker` or `headlessui` added.
- **B3-AC-11** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.
- **B3-AC-12** Feature flag `NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER` toggles the teacher routes on/off.

---

## 12. Sub-slice B1 — Kiosk 1:1 port

**Delivered:** 4th. **Depends on:** B0.

### 12.1 Pages (all public, no auth)

- `apps/portal/src/app/check-in/page.tsx` — kiosk landing: family-ID input → student roster → check-in.
- `apps/portal/src/app/check-in/guest/page.tsx` — guest check-in form for first-time visitors.
- `apps/portal/src/app/check-in/lookup/page.tsx` — family lookup by phone or email.
- Per-segment `error.tsx` and `loading.tsx`.

### 12.2 APIs (public)

- `GET /api/check-in/families/:familyId` — RTDB read, returns family + kids.
- `POST /api/check-in/families/:familyId/check-in` — writes check-in event to Firestore with `checkedInBy: 'sevak'`. Triggers payment reminder hook via the notification module (noop in B1, real in B5).
- `POST /api/check-in/lookup` — takes phone or email, RTDB read, returns family ID or 404.
- `POST /api/check-in/guests` — writes guest check-in to Firestore with a guest record.

### 12.3 Components

`features/check-in/kiosk/`:

- `KioskHome.tsx` — landing with family-ID lookup.
- `StudentRoster.tsx` — shared with `features/check-in/shared/StudentList.tsx`.
- `GuestCheckInForm.tsx` — new-visitor form.
- `FamilyLookupForm.tsx` — phone/email lookup.

### 12.4 Key decisions

- **Shadcn primitives replace `headlessui`.** Components are rebuilt using `@cmt/ui` primitives. Components that are shared with B2 (family self-check-in) live in `features/check-in/shared/`.
- **Feature flag default OFF in production.** `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=false` in prod env. The standalone app still serves the physical kiosk until an explicit cutover decision.
- **No webpack fallback for Node modules.** B1 audits and eliminates any client-side imports of `stream`, `crypto`, `net`, `tls`, `http2`, `dns`. All Node-only code moves to server components or route handlers.
- **Remove `react-datepicker`.** Kiosk check-in is always "now" — no date picking needed.
- **Remove `react-hot-toast`.** Replaced with `@cmt/ui` `Toast` primitive (added in B0 for login feedback).
- **Kill `xlsx` from the client bundle.** Any import of `xlsx` moves to `features/check-in/admin/exports.ts` (B4) which runs server-side only.

### 12.5 Acceptance criteria (selected)

- **B1-AC-1** `/check-in` with a valid family ID shows the student roster from RTDB.
- **B1-AC-2** `/check-in` with an invalid family ID shows a clear error message.
- **B1-AC-3** Submitting the check-in writes a Firestore record with `checkedInBy: 'sevak'`.
- **B1-AC-4** `/check-in/guest` writes a guest record to Firestore.
- **B1-AC-5** `/check-in/lookup` with a known email/phone returns a family ID.
- **B1-AC-6** Playwright e2e green: family-ID entry → roster → check-in → success toast.
- **B1-AC-7** `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=false` causes `/check-in` to return 404. Tests cover both flag states.
- **B1-AC-8** Bundle analyzer confirms: no `xlsx`, no `react-datepicker`, no `react-phone-number-input`, no `headlessui`, no `react-hot-toast`, no `redis` in the client bundle.
- **B1-AC-9** `next.config.ts` has no `webpack` fallback for `stream`/`crypto`/`net`/`tls` — any Node-only code is in route handlers.
- **B1-AC-10** Unit + integration tests ≥ 80% line coverage under `features/check-in/kiosk/` and `features/check-in/shared/`.
- **B1-AC-11** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.

---

## 13. Sub-slice B4 — Admin dashboard + provisioning

**Delivered:** 5th. **Depends on:** B0, B1 (guest write endpoint must exist before B4 adds the admin read).

### 13.1 Pages (all admin-gated)

- `apps/portal/src/app/check-in/admin/page.tsx` — dashboard home with stats cards (today's check-ins, guest count, unpaid families, week-over-week).
- `apps/portal/src/app/check-in/admin/users/page.tsx` — admin user list + add form + delete button.
- `apps/portal/src/app/check-in/admin/guests/page.tsx` — paginated guest list with date-range filter.
- `apps/portal/src/app/check-in/admin/unpaid/page.tsx` — unpaid-family list with "send donation email" button (hits B5 notification API).
- `apps/portal/src/app/check-in/admin/reports/page.tsx` — report export UI (CSV preferred; xlsx optional).
- Per-segment `error.tsx` and `loading.tsx`.

### 13.2 APIs

- `GET /api/check-in/admin/users` — lists users with `role: 'admin'` (Firebase Admin `listUsers` + filter).
- `POST /api/check-in/admin/users` — creates user, sets claims, returns `{ uid, email }`. Validates with zod.
- `DELETE /api/check-in/admin/users/:uid` — clears claims + disables user. Rejects self-delete with 400.
- `GET /api/check-in/admin/stats` — aggregated counts for dashboard cards.
- `GET /api/check-in/admin/guests?cursor=&limit=` — paginated guest list.
- `GET /api/check-in/admin/unpaid` — unpaid-family list (RTDB payment status + Firestore overrides).
- `POST /api/check-in/admin/reports/attendance.csv` — streams attendance CSV with `Content-Disposition: attachment`.
- `POST /api/check-in/admin/reports/check-ins.csv` — streams check-in CSV.

### 13.3 Components

`features/check-in/admin/`:

- `AdminDashboard.tsx` — stats cards layout.
- `AdminUserList.tsx`, `AddAdminForm.tsx`, `DeleteAdminButton.tsx`.
- `GuestList.tsx`, `GuestFilters.tsx`, `CursorPagination.tsx`.
- `UnpaidFamilyList.tsx`, `SendDonationEmailButton.tsx`.
- `ReportExportButton.tsx`.

### 13.4 Key decisions

- **Self-delete guard.** An admin cannot delete their own account — the route returns 400 with `{ error: 'cannot-self-delete' }`. Tested explicitly.
- **CSV preferred over xlsx.** B4 ships CSV exports by default. If an explicit user need for xlsx exists, the spec's deferred-questions list it. `exceljs` (not `xlsx`) is used if xlsx is needed — server-side only, no client bundle impact.
- **No invite email flow.** Adding an admin means "create user with a temporary password; admin emails them out-of-band." A future slice can add invite emails if needed.
- **Pagination via Firestore cursor.** Guest list uses `startAfter(cursor).limit(pageSize)`; `limit=20` default.
- **Admin provisioning UI calls Firebase Admin SDK directly** through `/api/check-in/admin/users` — no client-side Firebase Admin (which would leak service-account creds).

### 13.5 Acceptance criteria (selected)

- **B4-AC-1** `GET /api/check-in/admin/users` returns only users with `role: 'admin'`.
- **B4-AC-2** `POST /api/check-in/admin/users` creates a Firebase user and sets custom claims.
- **B4-AC-3** `DELETE /api/check-in/admin/users/:uid` where `uid` matches the caller's UID returns 400.
- **B4-AC-4** `DELETE` on another admin clears claims and disables the user.
- **B4-AC-5** `/check-in/admin` dashboard renders today's check-in count from Firestore.
- **B4-AC-6** `/check-in/admin/guests` pagination works with cursor + limit.
- **B4-AC-7** `/check-in/admin/reports/attendance.csv` returns a CSV with correct headers.
- **B4-AC-8** Playwright e2e green: admin login → add admin → verify in list → delete admin → verify removed.
- **B4-AC-9** Unit test: self-delete guard.
- **B4-AC-10** Unit + integration tests ≥ 80% line coverage under `features/check-in/admin/`.
- **B4-AC-11** No `xlsx` in client bundle (bundle analyzer assertion).
- **B4-AC-12** Feature flag `NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN` toggles admin routes on/off.
- **B4-AC-13** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.

---

## 14. Sub-slice B5 — Notifications & cron

**Delivered:** 6th (last). **Depends on:** B1, B2, B4.

### 14.1 Server-only modules

- `apps/portal/src/lib/aws/ses.ts` — `sendEmail({ to, subject, html, text })` wrapping `@aws-sdk/client-ses`. First line: `import 'server-only'`.
- `apps/portal/src/lib/aws/sns.ts` — `sendSMS({ phone, message })` wrapping `@aws-sdk/client-sns`. First line: `import 'server-only'`.
- `apps/portal/src/lib/aws/region.ts` — resolves SES region (`ca-central-1`) and SNS region (`us-east-1`) from env.
- `apps/portal/src/lib/aws/templates/` — email templates as TSX components, rendered via `@react-email/render` or equivalent:
  - `OtpCodeEmail.tsx` — family OTP code.
  - `PaymentReminderEmail.tsx` — unpaid family reminder.
  - `DonationThankYouEmail.tsx` — donation confirmation (admin sends).
  - `GuestWelcomeEmail.tsx` — first-time guest welcome.

### 14.2 APIs

- `POST /api/check-in/notifications/send-email` — internal (admin-only or system with CRON_SECRET). Accepts `{ template, to, props }`. Renders TSX → HTML → sends via SES.
- `POST /api/check-in/notifications/send-sms` — internal. Accepts `{ phone, message }`. Sends via SNS.
- `POST /api/check-in/notifications/payment-reminder` — callable by cron or by admin. Fetches the unpaid family, renders `PaymentReminderEmail`, sends via SES. Updates `families/{fid}/lastReminderSentAt` in Firestore for idempotency.

### 14.3 Cron (Vercel Cron via `vercel.ts`)

`vercel.ts` at the repo root is introduced **only** for cron declaration. Nothing else migrates from `package.json` / `next.config.ts` to `vercel.ts` in slice B (targeted exception to slice A's "no `vercel.ts`" non-goal).

```ts
// vercel.ts
import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  crons: [
    { path: '/api/cron/reset-cache',                   schedule: '0 0 * * *'   },  // daily 00:00 UTC
    { path: '/api/cron/send-weekly-payment-reminders', schedule: '0 14 * * 0' },  // Sundays 14:00 UTC
  ],
};
```

**Cron handler auth:** Vercel Cron sets an `authorization: Bearer <CRON_SECRET>` header. Handlers check `env.CRON_SECRET === token`, else return 401.

### 14.4 Mock wiring removal

B5 removes the noop notification mocks that B1/B2/B4 used. The mock file stays in the test setup (`apps/portal/test-setup.ts`) for unit tests but the runtime path calls real AWS SDK. The `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY` flag still exists — when `false`, the production code logs instead of sending. Tests cover both paths.

### 14.5 Key decisions

- **Templates as TSX components.** Type-safe, maintainable, reusable. Rendered server-side only.
- **Payment reminder is idempotent.** `families/{fid}/lastReminderSentAt` prevents double-sends.
- **SES + SNS clients are singleton-per-region.** Stored in module scope to reuse across requests under Fluid Compute.
- **Email `from` address** is `env.AWS_SES_FROM_EMAIL` (verified in SES sandbox for UAT, production-verified in prod).
- **SMS topic ARN** is `env.AWS_SNS_TOPIC_ARN`.

### 14.6 Acceptance criteria (selected)

- **B5-AC-1** `sendEmail` calls `SESClient.send(SendEmailCommand)` with the correct `to`, `subject`, and rendered HTML (mocked).
- **B5-AC-2** `sendSMS` calls `SNSClient.send(PublishCommand)` with the correct phone and message (mocked).
- **B5-AC-3** `POST /api/check-in/notifications/payment-reminder` updates `lastReminderSentAt` and sends exactly one email.
- **B5-AC-4** Calling the same reminder endpoint twice within the idempotency window sends only one email.
- **B5-AC-5** Cron endpoints return 401 if `CRON_SECRET` header is missing or wrong.
- **B5-AC-6** `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=false` causes all `sendEmail`/`sendSMS` calls to log and return success without touching AWS SDK. Verified by `vi.spyOn(console, 'log')` + `expect(SESClient).not.toHaveBeenCalled()`.
- **B5-AC-7** `vercel.ts` validates against the `@vercel/config` type.
- **B5-AC-8** Playwright e2e green: trigger payment-reminder endpoint → assert mock SES was called with expected `to` + `template`.
- **B5-AC-9** Unit tests green for every template's snapshot.
- **B5-AC-10** Unit + integration tests ≥ 80% line coverage under `features/check-in/notifications/` and `apps/portal/src/lib/aws/`.
- **B5-AC-11** No `@aws-sdk/*` import anywhere in client bundles (bundle analyzer assertion).
- **B5-AC-12** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.

---

## 15. Environment & deployment

### 15.1 Environments

| Environment | Portal app | Master app | AWS | Flags | Admin seed |
|---|---|---|---|---|---|
| **Local dev** | `chinmaya-setu-uat` | `chinmaya-setu-715b8` (prod, read-only) | Mocked (handler noop) | Dev-friendly defaults | Run `pnpm seed:admin` once |
| **Playwright e2e** | Emulator | Emulator | Mocked | All flags on | Seeded by test setup |
| **Vitest unit/integration** | Fully mocked | Fully mocked | Mocked | N/A | N/A |
| **Vercel preview** | `chinmaya-setu-uat` | `chinmaya-setu-715b8` | Real UAT creds; `NOTIFY=false` | Matches dev | Run `pnpm seed:admin` once per preview env |
| **Vercel production** | `chinmaya-setu-715b8` | `chinmaya-setu-715b8` | Real prod creds; `NOTIFY=true` | Kiosk off; others on | Run `pnpm seed:admin` once post-first-deploy |

### 15.2 Vercel env var setup commands

Documented in the slice B parent spec (here) and in each sub-slice plan. Example for the admin Firebase project:

```sh
# Preview environment
vercel env add PORTAL_FIREBASE_PROJECT_ID preview     # chinmaya-setu-uat
vercel env add PORTAL_FIREBASE_CLIENT_EMAIL preview
vercel env add PORTAL_FIREBASE_PRIVATE_KEY preview    # paste the multi-line PEM
vercel env add MASTER_FIREBASE_PROJECT_ID preview     # chinmaya-setu-715b8
vercel env add MASTER_FIREBASE_CLIENT_EMAIL preview
vercel env add MASTER_FIREBASE_PRIVATE_KEY preview
vercel env add MASTER_FIREBASE_DATABASE_URL preview
vercel env add TEACHER_PASSPHRASE preview
# ... repeat for all PORTAL_*, MASTER_*, AWS_*, NEXT_PUBLIC_FEATURE_* vars

# Production environment — same vars with prod values
vercel env add PORTAL_FIREBASE_PROJECT_ID production  # chinmaya-setu-715b8
# ...
```

The slice B parent plan's first task is "document and run this checklist."

### 15.3 First-deploy checklist

After slice B merges:

1. `vercel env add` all vars for preview and production (one-time per environment).
2. `vercel deploy` to preview. Verify `/login/admin` renders.
3. `pnpm --filter @cmt/portal seed:admin --email=developer@chinmayatoronto.org` against preview.
4. Manually test: log in as admin, log in as teacher, log in as family (with a known UAT family record). Document any issues.
5. Run Playwright e2e against the preview deploy (`PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app pnpm test:e2e`).
6. Promote to production.
7. Re-run `pnpm seed:admin` against production with the real admin email.
8. Enable sub-slice feature flags one at a time, verifying each in production before moving on.

### 15.4 Pre-push hook

Unchanged from slice A. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Playwright is separate.

---

## 16. Risks & caveats

Each risk is called out in the sub-slice plan that introduces it.

1. **Identity Toolkit REST dependency.** Firebase does not provide an Admin SDK method to exchange a custom token for an ID token. Slice B calls `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken` directly. This endpoint is stable but undocumented as part of the Admin SDK. If Google deprecates it, signin breaks. Mitigation: the call is isolated to one helper (`@cmt/firebase-shared/admin/session.ts`) so a future slice can swap implementations. **Acceptable risk.**

2. **RTDB read-only enforcement is lint-based, not runtime.** A determined engineer could still import `firebase-admin/database` directly. Team discipline + lint + code review covers it. **Acceptable risk.**

3. **Teacher shared passphrase is a known weakness.** Called out in spec non-goals, B3's plan header, and a comment in the teacher signin handler. A future slice replaces it with real teacher accounts after ashram-team discussion. **Accepted by design.**

4. **Dev reads from prod RTDB.** Developers can read production family/student data during development. The alternative (seeding UAT RTDB with fake families) creates maintenance overhead. Data is not especially sensitive (names, contact info, class rosters — no financial or medical data). **Acceptable risk.**

5. **Identity Toolkit calls count against Firebase quota** for every login. Expected traffic is ~dozens/day. Negligible. **Acceptable risk.**

6. **Session cookies are tied to the portal domain only.** A future mobile-web wrapper hitting a non-portal domain would break cookie auth. Mitigation: mobile uses Bearer tokens, not cookies, per §8. **Non-issue for mobile.**

7. **Webber's Excel→RTDB pipeline is the single source of truth for families.** If Webber's process breaks, the portal has no family data. Not slice B's problem — slice B treats RTDB as given and adds a monitoring note for future consideration. **Accepted external dependency.**

8. **Credentials in `chinmaya-family-check-in/.env.example` are real.** Firebase service account private keys, AWS access keys, and passphrase values (`HariOM!`, `TeacherOM!`, `AdminDashboard2024!`) are committed. Slice B does not rotate them. **After slice B ships, a separate cleanup slice must rotate all secrets** and update both the standalone app's env and the portal's env.

9. **Rate limiting is only on the OTP send-code endpoint.** The portal has no general rate limiting. A future slice adds Vercel BotID or equivalent. **Acceptable for slice B traffic volume.**

10. **Next 16 → React 19 compatibility gotchas.** The current family-check-in app uses React 18 patterns. During porting, some patterns may need updating (form `action`, Suspense boundaries, `useFormState` → `useActionState`). Each sub-slice plan notes any React 19 migration touchpoints found during exploration.

---

## 17. Slice-wide acceptance criteria

Slice B as a whole is "done" when all of these are green. Each sub-slice has additional acceptance criteria documented in its own plan.

- **AC-1** All six sub-slice plans are written, reviewed, executed, and each sub-slice's acceptance criteria are green.
- **AC-2** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green on `main` with all B0–B5 code merged.
- **AC-3** Pre-push hook passes for every commit in slice B.
- **AC-4** Playwright e2e suite has one critical-flow test per sub-slice (6 total), all green.
- **AC-5** Feature-boundary lint prevents cross-feature imports under `features/check-in/<sub-slice>/*`.
- **AC-6** `@cmt/firebase-shared` exposes read-only RTDB helpers (no write methods present) and dual-app Admin SDK initialization.
- **AC-7** `@cmt/shared-domain/check-in/api.ts` defines every request/response type consumed by the portal route handlers — no duplicated type definitions.
- **AC-8** Middleware accepts both `__session` cookie (web) and `Authorization: Bearer` (mobile) for every protected API route.
- **AC-9** `/api/*` auth failures return 401 JSON; page auth failures redirect to `/login`.
- **AC-10** Every route segment under `/check-in/*` and `/login/*` has its own `error.tsx`.
- **AC-11** Zod env schema fails startup on missing required vars with a clear error.
- **AC-12** `pnpm seed:admin` creates an admin against UAT Firebase (tested manually, documented in README).
- **AC-13** Vercel preview deploy renders `/login` correctly against UAT Firebase after merging each sub-slice.
- **AC-14** Every slice-wide non-goal in §3 is demonstrably not-done.
- **AC-15** CLAUDE.md is updated to mark slice B shipped and slice D struck from the roadmap.
- **AC-16** README is updated to document the new env vars, `pnpm seed:admin`, feature flags, and Playwright usage.
- **AC-17** Bundle analyzer shows no `xlsx`, `headlessui`, `react-datepicker`, `react-phone-number-input`, `redis`, `react-hot-toast`, or `@aws-sdk/*` in any client bundle.
- **AC-18** No `atob(` or client-side JWT decoding anywhere in `apps/portal/src/` (grep test).
- **AC-19** No `import 'firebase-admin/database'` outside `packages/firebase-shared/src/admin/rtdb.ts` (lint + grep test).
- **AC-20** Coverage: `≥ 80%` lines across `apps/portal/src/features/check-in/` and `packages/firebase-shared/src/admin/` — soft target, not CI-enforced.

---

## 18. Test file layout (consolidated)

```
packages/firebase-shared/src/__tests__/
  apps.test.ts
  auth.test.ts
  firestore.test.ts
  rtdb.test.ts
  session.test.ts
  claims.test.ts
  env.test.ts

packages/shared-domain/src/__tests__/
  check-in-types.test.ts
  role.test.ts
  public-routes.test.ts
  can-access-route.test.ts
  api-types.test.ts

apps/portal/src/features/check-in/auth/__tests__/
apps/portal/src/features/check-in/kiosk/__tests__/
apps/portal/src/features/check-in/family/__tests__/
apps/portal/src/features/check-in/teacher/__tests__/
apps/portal/src/features/check-in/admin/__tests__/
apps/portal/src/features/check-in/notifications/__tests__/
apps/portal/src/features/check-in/shared/__tests__/

apps/portal/src/app/login/__tests__/
apps/portal/src/app/check-in/**/__tests__/
  (page tests with auth header stubs)

apps/portal/src/lib/aws/__tests__/
  ses.test.ts
  sns.test.ts
  region.test.ts
  templates/*.test.tsx

apps/portal/scripts/__tests__/
  seed-admin.test.ts

apps/portal/e2e/
  b0-auth.spec.ts
  b1-kiosk.spec.ts
  b2-family.spec.ts
  b3-teacher.spec.ts
  b4-admin.spec.ts
  b5-notifications.spec.ts
```

---

## 19. Deferred questions

Tracked in this spec so later slices can pick them up. Each is explicitly **not** slice B's work.

1. **When does the standalone `chinmaya-family-check-in` app retire?** Requires a parallel-run validation period + explicit cutover decision (DNS, data reconciliation, rollback plan). Future slice.
2. **Do teachers get real accounts?** Requires ashram-team discussion. Future slice after slice B ships.
3. **Should `@cmt/shared-domain` be published to npm so a native mobile app can consume it?** Deferred until the mobile app is actually being built.
4. **Do we need a formal API versioning strategy?** Deferred until the first breaking change is needed.
5. **Should we migrate RTDB master data to Firestore?** Depends on whether Webber's pipeline can change. Requires infrastructure discussion. Deferred.
6. **Kiosk cutover auth model.** When slice B's kiosk becomes production, does it stay public or get device provisioning? Separate slice.
7. **Sub-accounts / multi-family users.** A user with multiple families (e.g., two separate family IDs across generations)? Current app doesn't support; slice B doesn't add it.
8. **xlsx support in exports.** Slice B ships CSV only. If users need xlsx, future slice adds `exceljs` server-side.
9. **Invite email flow for admin provisioning.** Slice B uses "create with temp password, email out-of-band." Future slice can add real invite emails.
10. **Rate limiting beyond OTP.** The portal has no general rate limiting. Future slice adds BotID or equivalent.
11. **Credentials rotation.** Secrets in the standalone app's `.env.example` must be rotated post-slice-B. Separate cleanup slice.

---

## 20. References

- Slice A spec: `docs/superpowers/specs/2026-04-12-slice-a-portal-scaffold-design.md`
- Slice A plan: `docs/superpowers/plans/2026-04-12-slice-a-portal-scaffold.md`
- CLAUDE.md: project agent guidance
- Chinmaya Setu Prototype: `docs/superpowers/specs/reference/Chinmaya Setu Prototype.{md,pdf}`
- Source of truth for the existing app: `/Users/dineshmatta/projects/chinmaya-family-check-in/`
- Firebase session cookies: <https://firebase.google.com/docs/auth/admin/manage-cookies>
- Firebase custom claims: <https://firebase.google.com/docs/auth/admin/custom-claims>
- Identity Toolkit REST: <https://firebase.google.com/docs/reference/rest/auth>
- Vercel Cron: <https://vercel.com/docs/cron-jobs>
- `@aws-sdk/client-ses`: <https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/sdk-ses.html>
- `@aws-sdk/client-sns`: <https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/sdk-sns.html>

---

**End of slice B parent design spec.** Next step: six sub-slice implementation plans under `docs/superpowers/plans/`, one per sub-slice, written via the `superpowers:writing-plans` skill.
