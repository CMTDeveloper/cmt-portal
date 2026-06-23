import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, request, type APIRequestContext } from '@playwright/test';
import {
  JR_MANAGER_EMAIL,
  JR_MEMBER_EMAIL,
  JR_PASSWORD,
  hasJoinRequestCreds,
} from '../../_helpers';

/**
 * E2E for the gated co-manager "family lookup classification + join-request"
 * flow (design: docs/superpowers/specs/2026-06-22-family-lookup-manager-
 * member-join-request-design.md), shipped 2026-06-22. Verified against deployed
 * UAT (https://cmt-setu.vercel.app), backed by chinmaya-setu-uat Firestore.
 *
 * The flow is INHERENTLY SEQUENTIAL and MUTATING — approving the request
 * permanently promotes the gated member to co-manager. So unlike the read-only
 * specs (which rely on a manual pre-seed), this one RE-SEEDS in beforeAll to
 * reset the fixture to its pre-approval state (member back to manager:false /
 * portalAccess:'pending', any prior joinRequest deleted) so the suite is
 * repeatable. Serial mode keeps the five steps ordered and avoids parallel
 * workers racing the same shared fixture / blowing the OTP rate limit with
 * concurrent sign-ins of the same email.
 *
 * Auth is password sign-in (never OTP), the standing project rule. The seeded
 * MANAGER classifies as matchAction:'sign-in'; the GATED member as
 * 'request-to-join' (portalAccess:'pending') and cannot sign in until approved.
 *
 * Assertions use the live API/UI as the source of truth (no firebase-admin in
 * the runner): the manager's GET /api/setu/join-request proves the joinRequest
 * doc exists; the member's post-approval GET /api/setu/family (manager:true +
 * membership in family.managers + a real session, not pendingApproval) proves
 * the promotion. (approve-request also writes portalAccess:'active' server-side,
 * but the family read API does not echo that optional field — absent ⇒ active —
 * so manager:true + managers membership is the observable contract.)
 */
test.describe('registration — gated co-manager join-request', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!hasJoinRequestCreds, 'E2E_JR_PASSWORD / E2E_FAMILY_PASSWORD required (run seed:join-request-family first)');

  // Per-actor request contexts so sessions never bleed between manager + member.
  // CRITICAL: pass an EMPTY storageState. A bare request.newContext() inside the
  // `setu` project inherits that project's storageState (the admin family's
  // __session), which would silently authenticate every actor as the admin
  // family — so the gated-member context would wrongly read a family (200, not
  // 401). An explicit empty jar isolates each actor.
  const EMPTY_STATE = { cookies: [], origins: [] };
  let memberCtx: APIRequestContext;
  let managerCtx: APIRequestContext;
  let baseURL: string;

  test.beforeAll(async ({ baseURL: bu }) => {
    baseURL = bu!;
    // Re-seed to reset the fixture (idempotent, UAT-only). This is what makes
    // the mutating approve step repeatable across runs.
    execSync('pnpm --filter @cmt/portal seed:join-request-family', {
      cwd: resolve(process.cwd(), '..', '..'),
      stdio: 'pipe',
      timeout: 120_000,
    });
    memberCtx = await request.newContext({ baseURL, storageState: EMPTY_STATE });
    managerCtx = await request.newContext({ baseURL, storageState: EMPTY_STATE });
  });

  test.afterAll(async () => {
    await memberCtx?.dispose();
    await managerCtx?.dispose();
  });

  // ── 1. Manager lookup → sign-in panel (NOT the request panel) ──────────────
  // /register is an AUTH_ENTRY_ROUTE: an authed user is bounced to /family, so
  // the UI lookup steps MUST run in a CLEAN, unauthenticated browser context
  // (the `setu` project's storageState is a different, admin family).
  test('manager email lookup classifies as sign-in (UI + API)', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL, storageState: undefined });
    const page = await ctx.newPage();
    try {
      // API contract.
      const res = await ctx.request.post('/api/setu/family-lookup', {
        data: { emails: [JR_MANAGER_EMAIL] },
      });
      expect(res.status()).toBe(200);
      const { match } = (await res.json()) as { match: { matchAction?: string } | null };
      expect(match?.matchAction).toBe('sign-in');

      // UI: the register screen shows the sign-in CTA, not the request panel.
      await fillLookup(page, JR_MANAGER_EMAIL);
      const signInCta = page
        .getByRole('link', { name: /Sign in to access my family/i })
        .filter({ visible: true });
      await expect(signInCta.first()).toBeVisible({ timeout: 20_000 });
      // The request-to-join CTA must NOT appear for a manager.
      await expect(
        page.getByRole('button', { name: /Send a request to your manager/i }).filter({ visible: true }),
      ).toHaveCount(0);
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── 2. Gated member lookup → request panel; send → confirmation ────────────
  test('gated member email lookup classifies as request-to-join and sends a request', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL, storageState: undefined });
    const page = await ctx.newPage();
    try {
      const res = await ctx.request.post('/api/setu/family-lookup', {
        data: { emails: [JR_MEMBER_EMAIL] },
      });
      expect(res.status()).toBe(200);
      const { match } = (await res.json()) as { match: { matchAction?: string } | null };
      expect(match?.matchAction).toBe('request-to-join');

      await fillLookup(page, JR_MEMBER_EMAIL);
      // "We found your family — send a request to your manager" panel.
      const sendBtn = page
        .getByRole('button', { name: /Send a request to your manager/i })
        .filter({ visible: true });
      await expect(sendBtn.first()).toBeVisible({ timeout: 20_000 });

      await sendBtn.first().click();

      // The "request sent" confirmation (role=status) replaces the button.
      await expect(
        page.getByText(/Request sent — your manager will review it/i).filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── 3. Before approval: gated member sign-in lands on pending-approval ─────
  test('gated member password sign-in returns pendingApproval with no session', async () => {
    const res = await memberCtx.post('/api/setu/auth/password-sign-in', {
      data: { email: JR_MEMBER_EMAIL, password: JR_PASSWORD },
    });
    failOnRateLimit(res.status(), 'gated member pre-approval sign-in');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      pendingApproval?: boolean;
      redirectTo?: string;
      pendingFid?: string;
    };
    expect(body.pendingApproval).toBe(true);
    expect(body.pendingFid).toBeTruthy();
    expect(body.redirectTo).toBeUndefined(); // no family session minted

    // The gated session grants no family access: /api/setu/family is 401.
    const fam = await memberCtx.get('/api/setu/family');
    expect(fam.status()).toBe(401);
  });

  // ── 4. Manager signs in, sees the pending-requests panel, approves ─────────
  test('manager sees the pending request on /family and approves it', async ({ browser }) => {
    // Sign the manager in via API, persist the cookie into a fresh browser
    // context (this spec does not use the shared storageState — that's a
    // different, admin family).
    const signIn = await managerCtx.post('/api/setu/auth/password-sign-in', {
      data: { email: JR_MANAGER_EMAIL, password: JR_PASSWORD },
    });
    failOnRateLimit(signIn.status(), 'manager sign-in');
    expect(signIn.ok(), `manager sign-in failed: ${signIn.status()}`).toBeTruthy();
    const state = await managerCtx.storageState();

    const ctx = await browser.newContext({ baseURL, storageState: state });
    const page = await ctx.newPage();
    try {
      // The pending-requests panel lists the open request.
      const listed = await managerCtx.get('/api/setu/join-request');
      expect(listed.status()).toBe(200);
      const { requests } = (await listed.json()) as {
        requests: Array<{ token: string; requesterEmail: string }>;
      };
      const reqRow = requests.find((r) => r.requesterEmail === JR_MEMBER_EMAIL.toLowerCase());
      expect(reqRow, 'expected an open join request for the gated member').toBeTruthy();

      // UI: the panel renders on /family and shows an Approve control.
      await page.goto('/family');
      const panel = page.getByTestId('pending-join-requests').filter({ visible: true });
      await expect(panel.first()).toBeVisible({ timeout: 30_000 });
      const row = page.getByTestId('join-request-row').filter({ visible: true });
      await expect(row.first()).toBeVisible({ timeout: 20_000 });
      await expect(row.first().getByText(JR_MEMBER_EMAIL.toLowerCase())).toBeVisible();

      // The emailed "Review request" link target — /join-request/{token} — is a
      // PUBLIC page whose client GETs the (manager-only) request and renders
      // Approve/Decline. Regression guard for the bug where the page was missing
      // from PUBLIC_ROUTES, so a signed-in manager was denied 'unauthorized' and
      // bounced to the legacy /login instead of seeing the approve UI.
      await page.goto(`/join-request/${reqRow!.token}`);
      await expect(
        page.getByRole('button', { name: /approve & add as co-manager/i }).filter({ visible: true }),
      ).toBeVisible({ timeout: 20_000 });
      expect(page.url()).not.toContain('/login');

      // Approve via the API (the same call the panel button fires) for a
      // deterministic, race-free assertion of the promotion.
      const approve = await managerCtx.post('/api/setu/join-request/approve', {
        data: { token: reqRow!.token },
      });
      expect(approve.status()).toBe(200);
      expect((await approve.json()) as { ok?: boolean }).toEqual({ ok: true });
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  // ── 5. After approval: member is a co-manager and can sign in ──────────────
  test('approved member becomes a co-manager and signs in with family access', async () => {
    // Fresh, ISOLATED context — a clean session for the now-approved member
    // (empty jar so it doesn't inherit the project storageState; see beforeAll).
    const ctx = await request.newContext({ baseURL, storageState: EMPTY_STATE });
    try {
      const signIn = await ctx.post('/api/setu/auth/password-sign-in', {
        data: { email: JR_MEMBER_EMAIL, password: JR_PASSWORD },
      });
      failOnRateLimit(signIn.status(), 'approved member sign-in');
      expect(signIn.status()).toBe(200);
      const body = (await signIn.json()) as { redirectTo?: string; pendingApproval?: boolean };
      // No longer pending — a real family session is minted.
      expect(body.pendingApproval).toBeUndefined();
      expect(body.redirectTo).toBe('/family');

      // The promotion is observable on /family: the member is now manager:true
      // and is listed in family.managers.
      const fam = await ctx.get('/api/setu/family');
      expect(fam.status()).toBe(200);
      const data = (await fam.json()) as {
        currentMid: string;
        isManager: boolean;
        family: { managers: string[] };
        members: Array<{ mid: string; manager: boolean }>;
      };
      expect(data.isManager).toBe(true);
      const me = data.members.find((m) => m.mid === data.currentMid);
      expect(me?.manager).toBe(true);
      expect(data.family.managers).toContain(data.currentMid);
    } finally {
      await ctx.dispose();
    }
  });

  // ── 6. Emergency / no-match email → register (matchAction null) ────────────
  test('an email not in contactKeys returns no match (continue to register)', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL, storageState: undefined });
    const page = await ctx.newPage();
    try {
      // API: an email that was never indexed (e.g. an emergency-only contact)
      // produces no contactKey → no match.
      const res = await ctx.request.post('/api/setu/family-lookup', {
        data: { emails: ['e2e-jr-emergency-nomatch@chinmayatoronto.org'] },
      });
      expect(res.status()).toBe(200);
      const { match } = (await res.json()) as { match: unknown };
      expect(match).toBeNull();

      // UI: the no-match branch offers the "continue to register" path.
      await fillLookup(page, 'e2e-jr-emergency-nomatch@chinmayatoronto.org');
      await expect(
        page.getByRole('link', { name: /Continue to family details/i }).filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await page.close();
      await ctx.close();
    }
  });
});

/**
 * Fill the /register lookup form enough to trigger the debounced family lookup
 * (it fires when email looks complete AND phone has >=10 digits, or on blur),
 * for a specific email. The page renders mobile + desktop blocks, so the inputs
 * appear twice; target the visible (desktop, the `setu` project is Desktop
 * Chrome) instances.
 */
/**
 * The password-sign-in route shares the per-email OTP rate limit (5 / 15 min).
 * A 429 here is shared-limiter NOISE (e.g. a re-run inside the window or a
 * concurrent manual sign-in), NOT a product bug — turn it into an explicit,
 * actionable failure instead of a confusing status mismatch downstream.
 */
function failOnRateLimit(status: number, label: string): void {
  if (status === 429) {
    throw new Error(
      `${label} hit the shared OTP rate limit (429). This is environmental, not a product bug — ` +
        `wait ~15 min for the per-email window to reset, then re-run.`,
    );
  }
}

async function fillLookup(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/register');
  const emailInput = page.getByPlaceholder('you@example.com').filter({ visible: true });
  const phoneInput = page.getByPlaceholder('(416) 555-0000').filter({ visible: true });
  await emailInput.first().fill(email);
  await phoneInput.first().fill('(416) 555-9999');
  // Blur fires the lookup immediately (no need to wait out the 1500ms debounce).
  await phoneInput.first().blur();
}
