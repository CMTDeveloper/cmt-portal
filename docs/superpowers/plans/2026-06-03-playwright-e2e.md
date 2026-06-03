# Playwright E2E for Setu Family/Admin Flows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-level regression net over the new Setu family/admin flows (dashboard attendance, enroll wording, programs state, admin calendar), authenticating without OTP via the existing password-sign-in route.

**Architecture:** Reuse the existing `apps/portal/playwright.config.ts`. A UAT-guarded seed script creates one persistent `_test` family (manager + child, a Bala Vihar + a no-donation enrollment, and a few `family-check-ins` so attendance is deterministic) and sets a Firebase Auth password on it. A Playwright `setup` project logs in via `POST /api/setu/auth/password-sign-in` and saves the `__session` cookie to `storageState`; all other specs reuse it. v1 specs are **read/render-only** (no DB mutations, no payment completion). On-demand only — not in the pre-push gate.

**Tech Stack:** Playwright `@playwright/test ^1.50`, Next.js 16 dev server on port 3001, Firebase Admin (UAT `chinmaya-setu-uat`), `tsx` for the seed script.

**Spec:** `docs/superpowers/specs/2026-06-03-playwright-e2e-design.md`

---

## Conventions every task must follow

- **UAT only.** The seed and the running dev server read `.env.local` (`PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat`). Never target prod `715b8`.
- **Mobile+desktop dual-render gotcha.** Family pages render BOTH a mobile block (`block md:hidden`, first in DOM) and a desktop block (`hidden md:block`). At the Desktop-Chrome viewport only the desktop block is visible, but BOTH exist in the DOM — so a plain `getByText(...)` matches 2 nodes (strict-mode error) and `.first()` is the *hidden* mobile one. **Always select the visible instance:** `page.getByText(/…/).filter({ visible: true })`. Define this once (see Task 3 `e2e/_helpers.ts`).
- **Secrets/env.** Required in `apps/portal/.env.local`: UAT `PORTAL_FIREBASE_*`, `NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY`, plus `E2E_FAMILY_EMAIL` and `E2E_FAMILY_PASSWORD`. Setup/specs **self-skip** when these are absent.
- **Commit after each task.** Branch is `main` (solo-dev). Do NOT add any of this to the pre-push gate.

---

## File structure

| File | Responsibility |
|------|----------------|
| `apps/portal/package.json` | rename vitest `test:e2e` → `test:integration`; add `seed:e2e-family` alias |
| `CLAUDE.md` | update the `test:e2e` reference to `test:integration` |
| `.gitignore` | ignore `apps/portal/e2e/.auth/` |
| `apps/portal/e2e/legacy/*.spec.ts` | the moved stale Slice-B specs (kept, skip-guarded) |
| `apps/portal/scripts/seed-e2e-family.ts` | idempotent UAT seed: family + child + 2 enrollments + check-ins + auth password |
| `apps/portal/playwright.config.ts` | add `setup` + `unauthenticated` projects, storageState wiring |
| `apps/portal/e2e/auth.setup.ts` | programmatic password login → `e2e/.auth/family.json` |
| `apps/portal/e2e/_helpers.ts` | shared spec helpers (`visible()`, env guard) |
| `apps/portal/e2e/setu/dashboard.spec.ts` | dashboard attendance + enrolled state |
| `apps/portal/e2e/setu/enroll-wording.spec.ts` | donation vs no-donation wording |
| `apps/portal/e2e/setu/programs.spec.ts` | `/family/programs` enrolled state |
| `apps/portal/e2e/setu/unauth.spec.ts` | `/family` → `/sign-in` redirect (unauthenticated project) |
| `apps/portal/e2e/README.md` | how to seed + run |

---

## Task 1: Housekeeping — fix the `test:e2e` clash, gitignore, move legacy specs

**Files:**
- Modify: `apps/portal/package.json`
- Modify: `CLAUDE.md` (the `pnpm test:e2e` bullet under "Workflow expectations")
- Modify: `.gitignore` (repo root)
- Move: `apps/portal/e2e/b0-auth.spec.ts`, `b1-kiosk.spec.ts`, `b2-family.spec.ts`, `b3-teacher.spec.ts`, `b4-admin.spec.ts`, `b5-notifications.spec.ts` → `apps/portal/e2e/legacy/`

- [ ] **Step 1: Rename the vitest e2e script + add the seed alias** in `apps/portal/package.json`

Change the line `"test:e2e": "vitest run --config vitest.e2e.config.ts",` to:

```json
    "test:integration": "vitest run --config vitest.e2e.config.ts",
    "seed:e2e-family": "tsx --env-file=.env.local scripts/seed-e2e-family.ts",
```

(Leave the root `package.json` `test:e2e` = Playwright untouched.)

- [ ] **Step 2: Update the CLAUDE.md reference**

In `CLAUDE.md`, the bullet that documents `**`pnpm test:e2e`**` as the vitest UAT suite: change the command name to `**`pnpm --filter @cmt/portal test:integration`**` and add a sentence: "Browser E2E (Playwright) is the separate root `pnpm test:e2e` — see `apps/portal/e2e/README.md`."

- [ ] **Step 3: Ignore the auth storageState dir**

Append to `.gitignore`:

```
# Playwright auth storageState (contains a session cookie)
apps/portal/e2e/.auth/
```

- [ ] **Step 4: Move the stale Slice-B specs into `e2e/legacy/`**

```bash
cd apps/portal
mkdir -p e2e/legacy
git mv e2e/b0-auth.spec.ts e2e/b1-kiosk.spec.ts e2e/b2-family.spec.ts e2e/b3-teacher.spec.ts e2e/b4-admin.spec.ts e2e/b5-notifications.spec.ts e2e/legacy/
```

Each moved file imports `from './fixtures'`. Update those imports to `from '../fixtures'` (the `fixtures.ts` stub stays at `e2e/fixtures.ts`). Use a search to confirm none remain:

```bash
grep -rn "from './fixtures'" e2e/legacy/ && echo "FIX THESE" || echo "ok"
```
Expected after fixing: `ok`.

- [ ] **Step 5: Sanity-check Playwright still discovers tests**

Run: `pnpm --filter @cmt/portal exec playwright test --list 2>&1 | tail -20`
Expected: it lists the `e2e/legacy/*` specs without import errors (the new setu specs don't exist yet — fine).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/package.json CLAUDE.md .gitignore apps/portal/e2e/
git commit -m "chore(e2e): rename vitest test:e2e→test:integration, move legacy specs to e2e/legacy/"
```

---

## Task 2: Seed script — one persistent `_test` family with attendance

**Files:**
- Create: `apps/portal/scripts/seed-e2e-family.ts`
- (alias already added in Task 1)

**Read first (authoritative shapes — do not guess):**
- `apps/portal/src/__tests__/e2e/helpers/fixtures.ts` — `createTestFamily({name,email,phone,location})` → `{fid,mid}` (uses `registerFamily`, tags `_test:true`).
- `apps/portal/src/features/setu/auth/build-session-claims.ts:60-70` — how the family **uid** is derived: `sha256Hex(canonicalContact)` where `canonicalContact = normalizeContact('email', value)` (no type prefix). Reuse the SAME normalization + `sha256Hex` import (`@/features/check-in/shared`).
- `apps/portal/src/features/setu/auth/find-family-by-contact.ts` — to look up an existing family for the email (idempotency).
- `apps/portal/src/features/setu/enrollment/enroll-family.ts:1-40` — `EnrollFamilyParams` shape for `enrollFamily(params)`.
- `packages/shared-domain/src/setu/schemas/member.ts` (or wherever `MemberDoc` lives) — the child member doc shape.
- Existing offerings in UAT (confirmed present): BV `bv-brampton-2025-26` (window 2025-09-07→2026-06-15, enabled), no-donation `om-chanting-all-2026-summer-om-chanting`.

- [ ] **Step 1: Write the seed script**

Create `apps/portal/scripts/seed-e2e-family.ts`:

```ts
/**
 * UAT-only, idempotent seed for the Playwright E2E family.
 * Creates a _test family (manager + 1 child), a Bala Vihar enrollment + a
 * no-donation (om-chanting) enrollment, a Firebase Auth password (for
 * password-sign-in), and a few family-check-ins inside the BV window so the
 * dashboard attendance assertion is deterministic.
 *
 * Run: pnpm --filter @cmt/portal seed:e2e-family
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { normalizeContact, sha256Hex } from '@/features/check-in/shared';
import { createTestFamily } from '@/__tests__/e2e/helpers/fixtures';
import { findFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import { enrollFamily } from '@/features/setu/enrollment/enroll-family';

const EMAIL = process.env['E2E_FAMILY_EMAIL'];
const PASSWORD = process.env['E2E_FAMILY_PASSWORD'];
const PHONE = process.env['E2E_FAMILY_PHONE'] ?? '+15195550100';
const LEGACY_FID = 'E2E-ATT-1';            // synthetic; check-ins are keyed by this
const CHILD_SID = 'E2E-SID-1';
const BV_OID = 'bv-brampton-2025-26';
const NODON_OID = 'om-chanting-all-2026-summer-om-chanting';
const CHECKIN_DATES = ['2025-10-05', '2026-01-11', '2026-03-08']; // inside BV window

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  console.log(`\n=== seed-e2e-family — project: ${projectId} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat.');
    process.exit(1);
  }
  if (!EMAIL || !PASSWORD) {
    console.error('Set E2E_FAMILY_EMAIL and E2E_FAMILY_PASSWORD in .env.local.');
    process.exit(1);
  }

  const db = portalFirestore();
  const auth = portalAuth();

  // 1) Family (idempotent: reuse if the email already maps to a family).
  let fid: string;
  let managerMid: string;
  const existing = await findFamilyByContact('email', EMAIL);
  if (existing?.fid) {
    fid = existing.fid;
    // manager mid: first member doc (or re-derive). Read members:
    const members = await db.collection('families').doc(fid).collection('members').get();
    managerMid = members.docs.find((d) => d.data()['manager'] === true)?.id ?? members.docs[0]!.id;
    console.log(`reusing existing family ${fid}`);
  } else {
    const res = await createTestFamily({
      name: 'E2E Test Family',
      email: EMAIL,
      phone: PHONE,
      location: 'Brampton',
      managerFirstName: 'E2E',
      managerLastName: 'Tester',
    });
    fid = res.fid;
    managerMid = res.mid;
    console.log(`created family ${fid}`);
  }

  // 2) Firebase Auth user with a PASSWORD (so password-sign-in works).
  // uid MUST equal the contact-derived uid (see build-session-claims).
  const canonical = normalizeContact('email', EMAIL);
  const uid = sha256Hex(canonical);
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { email: canonical, password: PASSWORD, emailVerified: true });
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, email: canonical, password: PASSWORD, emailVerified: true });
    } else {
      throw e;
    }
  }
  console.log(`auth user ${uid} password set`);

  // 3) legacyFid on the family (attendance reads family-check-ins/{legacyFid}).
  await db.collection('families').doc(fid).set({ legacyFid: LEGACY_FID, _test: true }, { merge: true });

  // 4) A child member (BV eligibility = child). Idempotent by a fixed mid.
  const childMid = `${fid}-E2E-CHILD`;
  await db.collection('families').doc(fid).collection('members').doc(childMid).set(
    {
      mid: childMid,
      type: 'Child',
      firstName: 'E2E',
      lastName: 'Child',
      birthMonthYear: '2017-03',
      schoolGrade: 'Grade 4',
      gender: 'Male',
      manager: false,
      legacySid: CHILD_SID,
      emergencyContacts: [],
      _test: true,
      // NOTE: confirm required MemberDoc fields against the schema; add any missing.
    },
    { merge: true },
  );
  console.log(`child member ${childMid} ensured`);

  // 5) Enrollments — BV + no-donation. enrollFamily enrolls eligible members
  // into an offering; idempotent if already enrolled (catch + log).
  for (const oid of [BV_OID, NODON_OID]) {
    try {
      await enrollFamily({ fid, oid, enrolledByMid: managerMid /* confirm param names */ });
      console.log(`enrolled ${fid} in ${oid}`);
    } catch (e) {
      console.log(`enroll ${oid}: ${(e as Error).message} (likely already enrolled — ok)`);
    }
  }

  // 6) family-check-ins inside the BV window (family-level attendance).
  for (const date of CHECKIN_DATES) {
    await db
      .collection('family-check-ins')
      .doc(LEGACY_FID)
      .collection('checkIns')
      .doc(date)
      .set(
        { date, checkedInBy: 'seed', students: [{ sid: CHILD_SID, isCheckedIn: true }], _test: true },
        { merge: true },
      );
  }
  console.log(`wrote ${CHECKIN_DATES.length} check-ins under family-check-ins/${LEGACY_FID}`);

  console.log(`\n=== done. fid=${fid} uid=${uid} ===\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

> The executor MUST reconcile three call sites against the real signatures while implementing: `enrollFamily(...)` param names (`enroll-family.ts:1-40`), the `MemberDoc` required fields (member schema), and `findFamilyByContact` return shape. Fix any mismatch the typechecker flags. Do NOT invent fields.

- [ ] **Step 2: Add `E2E_FAMILY_EMAIL` / `E2E_FAMILY_PASSWORD` to `.env.local`**

Use an email already on `SETU_EMAIL_ALLOWLIST` is NOT required (password-sign-in sends no email). Pick a stable test email, e.g. `e2e-family@chinmayatoronto.org`, and any password. Add to `apps/portal/.env.local`:

```
E2E_FAMILY_EMAIL=e2e-family@chinmayatoronto.org
E2E_FAMILY_PASSWORD=<choose-a-strong-password>
```

- [ ] **Step 3: Run the seed against UAT**

Run: `pnpm --filter @cmt/portal seed:e2e-family`
Expected: logs "created family CMT-…", "auth user … password set", "enrolled … in bv-brampton-2025-26", "enrolled … in om-chanting…", "wrote 3 check-ins", "done".

- [ ] **Step 4: Re-run to prove idempotency**

Run: `pnpm --filter @cmt/portal seed:e2e-family`
Expected: "reusing existing family …", enroll lines say "(likely already enrolled — ok)", exit 0. No duplicate family.

- [ ] **Step 5: Verify the data with the existing diagnostic**

Run: `pnpm --filter @cmt/portal check:migrations 2>&1 | grep -iE "E2E Test Family|E2E-|bv-brampton-2025-26|om-chanting"` (or extend the probe). Confirm the family + both enrollments exist.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/scripts/seed-e2e-family.ts
git commit -m "feat(e2e): UAT-only idempotent seed for the Playwright E2E family"
```

(Do NOT commit `.env.local` — it is gitignored.)

---

## Task 3: Playwright config + auth.setup + shared helpers

**Files:**
- Modify: `apps/portal/playwright.config.ts`
- Create: `apps/portal/e2e/auth.setup.ts`
- Create: `apps/portal/e2e/_helpers.ts`

- [ ] **Step 1: Add projects + storageState wiring to `playwright.config.ts`**

Replace the `projects` array (currently a single chromium entry) and keep everything else:

```ts
import { defineConfig, devices } from '@playwright/test';

const STORAGE = 'e2e/.auth/family.json';

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
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'setu',
      testMatch: /e2e\/setu\/.*\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE },
    },
    {
      name: 'unauthenticated',
      testMatch: /e2e\/unauth\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Legacy Slice-B specs (kept, skip-guarded). Run them with their own project.
    { name: 'legacy', testMatch: /e2e\/legacy\/.*\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm --filter @cmt/portal dev -- --port=3001',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
```

> `unauth.spec.ts` lives at `e2e/unauth.spec.ts` (NOT under `e2e/setu/`), so the `setu` project's `/e2e\/setu\/.*\.spec\.ts$/` won't pick it up and the `unauthenticated` project matches it exclusively. Task 7 creates it at that path.

- [ ] **Step 2: Write `e2e/_helpers.ts`**

```ts
import type { Locator, Page } from '@playwright/test';

/** The family pages render mobile + desktop blocks both in the DOM; pick the
 *  visible one to avoid strict-mode multi-match. */
export function visibleText(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).filter({ visible: true });
}

export const E2E_FAMILY_EMAIL = process.env.E2E_FAMILY_EMAIL;
export const E2E_FAMILY_PASSWORD = process.env.E2E_FAMILY_PASSWORD;
export const hasFamilyCreds = Boolean(E2E_FAMILY_EMAIL && E2E_FAMILY_PASSWORD);
```

- [ ] **Step 3: Write `e2e/auth.setup.ts`**

```ts
import { test as setup, expect } from '@playwright/test';
import { E2E_FAMILY_EMAIL, E2E_FAMILY_PASSWORD, hasFamilyCreds } from './_helpers';

const STORAGE = 'e2e/.auth/family.json';

setup('authenticate family via password-sign-in', async ({ request }) => {
  setup.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  const res = await request.post('/api/setu/auth/password-sign-in', {
    data: { email: E2E_FAMILY_EMAIL, password: E2E_FAMILY_PASSWORD },
  });
  expect(res.ok(), `password-sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  // The __session cookie is now in the request context; persist it.
  await request.storageState({ path: STORAGE });
});
```

- [ ] **Step 4: Run the setup project end-to-end**

Run: `pnpm --filter @cmt/portal exec playwright test --project=setup`
Expected: 1 passed (or skipped if creds missing). Confirm the cookie file exists and carries `__session`:

```bash
test -f apps/portal/e2e/.auth/family.json && grep -q "__session" apps/portal/e2e/.auth/family.json && echo "storageState OK"
```
Expected: `storageState OK`.

> If `password-sign-in` returns 401, re-run the Task 2 seed (password not set) or verify `NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY` is present in `.env.local`. If it returns `{redirectTo:'/register'}` (no family), the contact didn't resolve to the seeded family — recheck the seed email matches `E2E_FAMILY_EMAIL`.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/playwright.config.ts apps/portal/e2e/auth.setup.ts apps/portal/e2e/_helpers.ts
git commit -m "feat(e2e): playwright projects + password-sign-in auth setup (storageState)"
```

---

## Task 4: `dashboard.spec.ts` — attendance + enrolled state (guards the hijack bug)

**Files:**
- Create: `apps/portal/e2e/setu/dashboard.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

test.describe('family dashboard', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  test('shows Bala Vihar enrolled + real attendance (not the hijack empty state)', async ({ page }) => {
    await page.goto('/family');

    // Greeting (lands on the dashboard, authenticated).
    await expect(visibleText(page, /Hari OM/i)).toBeVisible();

    // Bala Vihar bespoke section is Enrolled.
    await expect(visibleText(page, /Bala Vihar/i).first()).toBeVisible();
    await expect(visibleText(page, /Enrolled/i).first()).toBeVisible();

    // Attendance rendered from the seeded check-ins — the regression guard.
    // The bespoke BV card reads "Attended X of N class Sundays this year."
    await expect(visibleText(page, /Attended \d+ of \d+ class Sundays/i)).toBeVisible();
    // And the empty state must NOT be shown.
    await expect(page.getByText(/Attendance will appear here once Sunday classes begin/i)).toHaveCount(0);
  });

  test('renders a card for the non-BV enrolled program', async ({ page }) => {
    await page.goto('/family');
    // The no-donation program (om chanting) shows its own "View enrollment" card.
    await expect(visibleText(page, /View enrollment/i).first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @cmt/portal exec playwright test --project=setu dashboard`
Expected: 2 passed. (Playwright auto-starts the dev server on :3001.)

> If the attendance assertion fails with the empty state visible, the seeded check-ins aren't inside the active BV offering window, OR the dashboard selected a non-BV active enrollment — confirm `bv-brampton-2025-26` is the seeded BV oid and the check-in dates fall in its window. On failure, inspect `playwright-report/` (trace + screenshot).

- [ ] **Step 3: Commit**

```bash
git add apps/portal/e2e/setu/dashboard.spec.ts
git commit -m "test(e2e): dashboard shows BV enrolled + real attendance"
```

---

## Task 5: `enroll-wording.spec.ts` — donation vs no-donation copy

**Files:**
- Create: `apps/portal/e2e/setu/enroll-wording.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

test.describe('enroll page wording', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  test('Bala Vihar (donation) shows the dakshina block', async ({ page }) => {
    await page.goto('/family/enroll/bala-vihar');
    await expect(visibleText(page, /Dakshina/i).first()).toBeVisible();
    await expect(visibleText(page, /suggested donation/i).first()).toBeVisible();
  });

  test('no-donation program shows "no donation requirement" and never "donation coming soon"', async ({ page }) => {
    await page.goto('/family/enroll/om-chanting');
    await expect(visibleText(page, /no donation requirement/i)).toBeVisible();
    // Already-enrolled banner must NOT push a donation.
    await expect(page.getByText(/Proceed to donate below/i)).toHaveCount(0);
    await expect(page.getByText(/donation coming soon/i)).toHaveCount(0);
    // Enrolled confirmation reads the plain wording.
    await expect(visibleText(page, /Your family is (already )?enrolled/i).first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @cmt/portal exec playwright test --project=setu enroll-wording`
Expected: 2 passed.

> The `om-chanting` programKey must match the seeded program. If `/family/enroll/om-chanting` 404s or shows "not available", confirm the program key + that the family is enrolled (so the already-enrolled banner renders). Adjust the path to the actual no-donation programKey if it differs.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/e2e/setu/enroll-wording.spec.ts
git commit -m "test(e2e): enroll wording — donation vs no-donation program"
```

---

## Task 6: `programs.spec.ts` — `/family/programs` enrolled state

**Files:**
- Create: `apps/portal/e2e/setu/programs.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { visibleText, hasFamilyCreds } from '../_helpers';

test.describe('programs list', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required');

  test('enrolled programs show "Enrolled · View enrollment", not "Enroll"', async ({ page }) => {
    await page.goto('/family/programs');
    // The seeded family is enrolled in BV + om chanting → at least one enrolled CTA.
    await expect(visibleText(page, /Enrolled · View enrollment/i).first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @cmt/portal exec playwright test --project=setu programs`
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/e2e/setu/programs.spec.ts
git commit -m "test(e2e): /family/programs shows enrolled state"
```

---

## Task 7: `unauth.spec.ts` — redirect when not signed in

**Files:**
- Create: `apps/portal/e2e/unauth.spec.ts` (NOT under `e2e/setu/` — see Task 3 Step 1 note)

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

// This project runs WITHOUT storageState (see playwright.config 'unauthenticated').
test('unauthenticated /family redirects to /sign-in', async ({ page }) => {
  await page.goto('/family');
  await expect(page).toHaveURL(/\/sign-in/);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @cmt/portal exec playwright test --project=unauthenticated`
Expected: 1 passed.

> If it lands on `/family` instead of redirecting, the middleware unauth redirect for `/family/*` isn't firing — verify `apps/portal/src/middleware.ts` redirects `/family` → `/sign-in` for no-session. (This is shipped behavior; the spec just guards it.)

- [ ] **Step 3: Commit**

```bash
git add apps/portal/e2e/unauth.spec.ts
git commit -m "test(e2e): unauthenticated /family redirects to /sign-in"
```

---

## Task 8: README + full-suite run

**Files:**
- Create: `apps/portal/e2e/README.md`

- [ ] **Step 1: Write the README**

```markdown
# Setu Playwright E2E

Browser-level regression net for the Setu family/admin flows. On-demand only
(NOT in the pre-push gate). Auth bypasses OTP via the password-sign-in route.

## One-time setup
1. `.env.local` must have UAT creds (`PORTAL_FIREBASE_*`, `NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY`)
   plus `E2E_FAMILY_EMAIL` and `E2E_FAMILY_PASSWORD`.
2. Seed the test family (UAT, idempotent): `pnpm --filter @cmt/portal seed:e2e-family`

## Run
- All: `pnpm test:e2e` (root) — auto-starts `pnpm dev` on :3001.
- Against a deployed UAT/preview URL: `PLAYWRIGHT_BASE_URL=https://… pnpm test:e2e`
- One project: `pnpm --filter @cmt/portal exec playwright test --project=setu dashboard`
- Report on failure: `pnpm --filter @cmt/portal exec playwright show-report`

## Layout
- `auth.setup.ts` — logs in once, saves `e2e/.auth/family.json` (gitignored).
- `setu/*.spec.ts` — authenticated read/render specs.
- `unauth.spec.ts` — redirect spec (no storageState).
- `legacy/*.spec.ts` — stale Slice-B check-in specs (kept, skip-guarded).

v1 is read/render-only — no DB mutations, no payment completion. The vitest
server-integration suite is the separate `pnpm --filter @cmt/portal test:integration`.
```

- [ ] **Step 2: Full suite run**

Run: `pnpm --filter @cmt/portal exec playwright test --project=setup --project=setu --project=unauthenticated`
Expected: setup passes, all setu specs pass, unauth passes. (Total ~6 tests.)

- [ ] **Step 3: Commit**

```bash
git add apps/portal/e2e/README.md
git commit -m "docs(e2e): Playwright setu suite README"
```

---

## Out of scope (future iterations)

- Mutating specs (submit enroll, complete a Stripe-test donation) + `_test` cleanup in a global-teardown.
- `admin-calendar.spec.ts` (2nd-program shared date → no 409; list filters by program) — add once an admin storageState setup is wired.
- CI integration; mobile-viewport variants; reviving the legacy specs.
