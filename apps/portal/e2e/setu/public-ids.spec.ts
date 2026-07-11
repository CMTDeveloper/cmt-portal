/**
 * ⚠️ UNRUN — deployed-UAT verification for the public FID/MID renumber (issue #4).
 *
 * This spec was authored but NEVER executed (the owner held a DO-NOT-DEPLOY on
 * this slice). Before it can go green it requires, in order:
 *   1. This branch DEPLOYED to UAT (https://cmt-setu.vercel.app) — publicFid /
 *      publicMid must be read by the dashboard + profile routes and rendered by
 *      the family/member UI. The deployed code is the system-under-test.
 *   2. The seeded fixture refreshed so it carries the deterministic public ids:
 *        pnpm --filter @cmt/portal seed:e2e-family
 *      (scripts/seed-e2e-family.ts pins publicFid='1042' on the family and
 *      publicMid '50001'/'50002' on its two members — manager then child, in
 *      joinedAt order). Running the real backfill instead —
 *        pnpm --filter @cmt/portal migrate:public-ids
 *      — would assign DIFFERENT counter-driven ids (1001+, 50001+) to the whole
 *      UAT roster, so the literal-'1042' assertions below would NOT hold; this
 *      spec deliberately leans on the SEED, not the live migration.
 *
 * Run (against the deployed UAT app, the repo's standing E2E target):
 *   PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app \
 *     pnpm --filter @cmt/portal exec playwright test --project=setu public-ids
 *
 * Coverage:
 *   • API   — GET /api/setu/dashboard (Bearer) exposes family.publicFid==='1042'
 *             and members[].publicMid (5-digit, non-null); the join keys fid/mid
 *             are unchanged and still present.
 *   • UI    — the family chrome shows the 4-digit FID (1042), not the raw CMT- id.
 *   • UI    — a member-detail page shows the 5-digit Member ID.
 *   • Search (admin/welcome) — searching the roster by '1042' lands on the family.
 *
 * Read-only — no UAT mutations.
 */
import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { E2E_FAMILY_EMAIL, E2E_FAMILY_PASSWORD, hasFamilyCreds } from '../_helpers';

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY;

// The deterministic public ids the seed (scripts/seed-e2e-family.ts) pins on the
// fixture. Keep these in lock-step with PUBLIC_FID / PUBLIC_MIDS over there.
const EXPECTED_PUBLIC_FID = '1042';
const PUBLIC_MID_RE = /^\d{5}$/; // 5-digit shape; the exact value is 50001/50002

// ── Bearer (mobile-style) auth helpers — mirrors mobile-bearer.spec.ts ──────────

/** Exchange a Firebase custom token for an ID token (what the RN SDK does). */
async function customTokenToIdToken(apiKey: string, customToken: string): Promise<string> {
  const ctx = await request.newContext();
  const res = await ctx.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    { data: { token: customToken, returnSecureToken: true } },
  );
  expect(res.ok(), `custom-token exchange failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { idToken?: string };
  expect(body.idToken, 'no idToken in exchange response').toBeTruthy();
  await ctx.dispose();
  return body.idToken!;
}

/** Sign in mobile-style: password-sign-in?mode=mobile → customToken → idToken. */
async function mobileSignIn(
  baseURL: string,
  apiKey: string,
  email: string,
  password: string,
): Promise<string> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/setu/auth/password-sign-in?mode=mobile', {
    data: { email, password },
  });
  expect(res.ok(), `password-sign-in?mode=mobile failed for ${email}: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { customToken?: string };
  expect(body.customToken, 'mobile sign-in did not return a customToken').toBeTruthy();
  await ctx.dispose();
  return customTokenToIdToken(apiKey, body.customToken!);
}

/** A request context that sends Bearer auth and NEVER a cookie. */
async function bearerContext(baseURL: string, idToken: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${idToken}` },
  });
}

type DashboardBody = {
  family: { fid: string; publicFid: string | null; name: string };
  members: { mid: string; publicMid: string | null; type: 'Adult' | 'Child' }[];
};

// ── API: dashboard exposes publicFid + publicMid (Bearer) ───────────────────────
// This block authenticates the seeded family's manager mobile-style; the same
// fixture the cookie UI tests below sign into, so the literal '1042' is shared.
test.describe('public FID/MID over the dashboard API (deployed UAT) — UNRUN', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required (seed:e2e-family)');
  test.skip(!FIREBASE_API_KEY, 'NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY required for the token exchange');

  let token = '';

  test.beforeAll(async ({ baseURL }) => {
    // The seeded family's own login (E2E_FAMILY_*) — the account that carries
    // publicFid '1042'. (The role-persona accounts are a different family that
    // does NOT.) hasFamilyCreds above guarantees both env vars are set.
    token = await mobileSignIn(baseURL!, FIREBASE_API_KEY!, E2E_FAMILY_EMAIL!, E2E_FAMILY_PASSWORD!);
  });

  test('GET /api/setu/dashboard returns family.publicFid + 5-digit members[].publicMid', async ({ baseURL }) => {
    const ctx = await bearerContext(baseURL!, token);
    const res = await ctx.get('/api/setu/dashboard');
    expect(res.status(), `dashboard GET: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as DashboardBody;

    // Family: publicFid is the seeded 4-digit value; the CMT- join key fid is
    // unchanged and still present (publicFid never replaces it).
    expect(body.family.publicFid).toBe(EXPECTED_PUBLIC_FID);
    expect(body.family.fid).toBeTruthy();
    expect(body.family.fid).not.toBe(EXPECTED_PUBLIC_FID); // join key ≠ public id
    expect(body.family.fid).toMatch(/^CMT-/);

    // Members: each carries a 5-digit publicMid (not null) and its join-key mid.
    expect(body.members.length).toBeGreaterThanOrEqual(2); // N≥2 fixture invariant
    for (const m of body.members) {
      expect(m.mid, 'mid join key missing').toBeTruthy();
      expect(m.publicMid, `publicMid null for ${m.mid}`).not.toBeNull();
      expect(m.publicMid).toMatch(PUBLIC_MID_RE);
      expect(m.publicMid).not.toBe(m.mid); // public id ≠ join key
    }
    await ctx.dispose();
  });
});

// ── UI: FID at family level + MID on member detail (cookie session) ─────────────
// Uses the `setu` project's stored family session (e2e/.auth/family.json). The
// seeded family is family-manager + admin, so the same login also reaches the
// admin/welcome roster used by the search test below.
test.describe('public FID/MID in the family UI (deployed UAT) — UNRUN', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required (seed:e2e-family)');

  test('the family chrome shows the 4-digit FID, not the raw CMT- id', async ({ page }) => {
    await page.goto('/family');
    // The desktop sidebar subtitle renders `… · FID 1042 · Legacy E2E-ATT-1`
    // (displayFid → publicFid when set). Assert the 4-digit FID is visible and the
    // CMT- internal id is NOT surfaced anywhere on the page.
    await expect(page.getByText(new RegExp(`FID\\s+${EXPECTED_PUBLIC_FID}`)).first()).toBeVisible();
    await expect(page.getByText(/FID\s+CMT-/)).toHaveCount(0);

    const dashboardFid = page.getByTestId('family-id-value').filter({ visible: true });
    await expect(dashboardFid).toHaveText(EXPECTED_PUBLIC_FID);
    const fontSize = await dashboardFid.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(32);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDashboardFid = page.getByTestId('family-id-value').filter({ visible: true });
    await expect(mobileDashboardFid).toHaveText(EXPECTED_PUBLIC_FID);
    const mobileFontSize = await mobileDashboardFid.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(mobileFontSize).toBeGreaterThanOrEqual(32);
  });

  test('a member-detail page shows the 5-digit Member ID', async ({ page, request: req }) => {
    // Resolve a concrete member's join-key mid from the dashboard API over the
    // stored cookie session, then open that member's detail page. (Deriving the
    // mid avoids hard-coding the CMT-…-NN doc id, which the seed owns.)
    const dash = await req.get('/api/setu/dashboard');
    expect(dash.status(), `dashboard (cookie) GET: ${await dash.text()}`).toBe(200);
    const body = (await dash.json()) as DashboardBody;
    const child = body.members.find((m) => m.type === 'Child') ?? body.members[0]!;
    expect(child.publicMid).toMatch(PUBLIC_MID_RE);

    await page.goto(`/family/members/${child.mid}`);
    // The detail header renders `Member ID {displayMid(member)}` → the 5-digit
    // publicMid. Match the literal seeded value for this member. The page renders
    // mobile + desktop trees, so filter to the visible copy (a bare .first() can
    // resolve to the hidden mobile node).
    await expect(
      page.getByText(new RegExp(`Member ID\\s+${child.publicMid}`)).filter({ visible: true }).first(),
    ).toBeVisible();
  });
});

// ── Search: roster lookup by the 4-digit FID lands on the family ────────────────
// The single seeded login is admin (inherits welcome-team), so the SAME `setu`
// storageState reaches /welcome/roster. searchFamilies() runs a
// `where('publicFid','==',q)` lookup, so '1042' must resolve to the fixture.
test.describe('roster search by public FID (deployed UAT) — UNRUN', () => {
  test.skip(!hasFamilyCreds, 'E2E family creds required (seed:e2e-family); login must also be admin/welcome-team');

  test("searching the roster for '1042' finds the family", async ({ page }) => {
    await page.goto('/welcome/roster');
    // The page renders mobile + desktop trees, so the testid matches several nodes —
    // target the visible one. Hydrating the 877-family browse is slow, so give the
    // input a generous window to become interactive.
    const input = page.getByTestId('roster-search-input').filter({ visible: true }).first();
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill(EXPECTED_PUBLIC_FID);

    // Search-as-filter is debounced (~300ms) then renders SearchHitCards that show
    // `FID 1042` and link to /welcome/family/{fid}. Assert a visible hit appears.
    const results = page.getByTestId('roster-results').filter({ visible: true }).first();
    await expect(
      results.getByText(new RegExp(`FID\\s+${EXPECTED_PUBLIC_FID}`)).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(results.getByText(/No matching families found/i)).toHaveCount(0);
  });
});
