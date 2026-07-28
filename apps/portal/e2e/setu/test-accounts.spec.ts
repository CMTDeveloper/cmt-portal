import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { TEST_ACCOUNT_EMAILS, TEST_ACCOUNTS_PASSWORD, hasTestAccounts } from '../_helpers';

// Role-persona accounts seeded by `pnpm --filter @cmt/portal seed:test-accounts`
// (see docs/runbooks/test-accounts.md). Each test signs in with a FRESH request
// context (not the shared family.json storageState) so the asserted access is
// exactly the persona's — read-only assertions, no UAT mutations.
// ── NEVER HARDCODE THE SCHOOL YEAR ──────────────────────────────────────────
// These two were pinned to `…-2025-26` and both teacher tests failed on
// 2026-07-28 with `Received: []` once UAT's active year became 2026-27 - which
// reads exactly like "teachers can no longer see their class" and is not that.
// The year is read from the live config below, so the ids follow the database.
let BRAMPTON_LEVEL_1 = '';
let SCARBOROUGH_LEVEL_A = '';

async function signIn(
  baseURL: string,
  email: string,
): Promise<{ ctx: APIRequestContext; redirectTo: string }> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/setu/auth/password-sign-in', {
    data: { email, password: TEST_ACCOUNTS_PASSWORD },
  });
  expect(res.ok(), `password-sign-in failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { redirectTo?: string };
  return { ctx, redirectTo: body.redirectTo ?? '' };
}

/**
 * A teacher with NO levels is the failure this file exists to catch, and its
 * bare `Received: []` diff is uninformative. Teacher→level assignments do NOT
 * carry across a school-year rollover on their own: `POST
 * /api/admin/school-year/copy-teachers` is a deliberate, admin-triggered step.
 * So an empty list almost always means the year advanced and that step was
 * never run - operationally, every teacher opening an empty roster.
 */
const EMPTY_ROSTER_HINT = (expected: string, got: string[]): string =>
  got.length === 0
    ? `this teacher has NO levels. Expected ${expected}. Teacher assignments do not ` +
      `survive a school-year rollover by themselves - run the rollover's ` +
      `copy-teachers step for the live year (or re-run seed:test-accounts), then retry.`
    : `expected exactly [${expected}], got [${got.join(', ')}]`;

async function teacherLevelIds(ctx: APIRequestContext): Promise<string[]> {
  const res = await ctx.get('/api/setu/teacher/levels');
  expect(
    res.status(),
    `teacher levels API returned ${res.status()} — a 404 means NEXT_PUBLIC_FEATURE_SETU_TEACHER ` +
      `is not 'true' on the target deploy (middleware gate), not a seed problem: ${await res.text()}`,
  ).toBe(200);
  const body = (await res.json()) as { levels: Array<{ levelId: string }> };
  return body.levels.map((l) => l.levelId);
}

test.describe('role-persona test accounts', () => {
  test.skip(!hasTestAccounts, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');

  // One admin sign-in for the whole file, to learn which school year is live.
  // The level ids the teacher API returns are year-suffixed, so an assertion
  // written against a fixed year silently becomes an assertion about the
  // calendar rather than about access control.
  test.beforeAll(async ({ baseURL }) => {
    if (!hasTestAccounts) return;
    const { ctx } = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.admin);
    try {
      const res = await ctx.get('/api/admin/school-year');
      expect(res.status(), 'GET /api/admin/school-year').toBe(200);
      const year = ((await res.json()) as { config: { currentYear: string } }).config.currentYear;
      expect(year, 'no currentYear in app_config/school_year').toBeTruthy();
      BRAMPTON_LEVEL_1 = `brampton-level-1-bv-brampton-${year}`;
      SCARBOROUGH_LEVEL_A = `scarborough-level-a-bv-scarborough-${year}`;
    } finally {
      await ctx.dispose();
    }
  });

  test('parent (Brampton) signs in as family-manager and sees their family', async ({ baseURL }) => {
    const { ctx, redirectTo } = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.parentBrampton);
    expect(redirectTo).toBe('/family');
    const res = await ctx.get('/api/setu/family');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('Test Family Brampton');
    await ctx.dispose();
  });

  test('family member (second adult) signs in as family-member', async ({ baseURL }) => {
    const { ctx, redirectTo } = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.memberBrampton);
    expect(redirectTo).toBe('/family');
    const res = await ctx.get('/api/setu/family');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('Test Family Brampton');
    await ctx.dispose();
  });

  test('parent (Scarborough) signs in and sees their family', async ({ baseURL }) => {
    const { ctx, redirectTo } = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.parentScarborough);
    expect(redirectTo).toBe('/family');
    const res = await ctx.get('/api/setu/family');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('Test Family Scarborough');
    await ctx.dispose();
  });

  test('teacher (Brampton) sees Brampton Level 1 and only that', async ({ baseURL }) => {
    const { ctx } = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.teacherBrampton);
    const ids = await teacherLevelIds(ctx);
    expect(ids, EMPTY_ROSTER_HINT(BRAMPTON_LEVEL_1, ids)).toEqual([BRAMPTON_LEVEL_1]);
    await ctx.dispose();
  });

  test('teacher (Scarborough) sees Scarborough Level A and only that', async ({ baseURL }) => {
    const { ctx } = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.teacherScarborough);
    const ids = await teacherLevelIds(ctx);
    expect(ids, EMPTY_ROSTER_HINT(SCARBOROUGH_LEVEL_A, ids)).toEqual([SCARBOROUGH_LEVEL_A]);
    await ctx.dispose();
  });

  test('universal teacher sees every enabled level across both locations', async ({ baseURL }) => {
    const { ctx } = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.teacherUniversal);
    const ids = await teacherLevelIds(ctx);
    expect(ids).toContain(BRAMPTON_LEVEL_1);
    expect(ids).toContain(SCARBOROUGH_LEVEL_A);
    // 18 levels were seeded for 2025-26 (10 Brampton + 8 Scarborough); the
    // rollover added 2026-27 clones. Assert a generous floor, not an exact count.
    expect(ids.length).toBeGreaterThanOrEqual(18);
    await ctx.dispose();
  });

  test('sevak (welcome-team) reaches /welcome APIs but not admin APIs', async ({ baseURL }) => {
    const { ctx, redirectTo } = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.sevak);
    expect(redirectTo).toBe('/welcome');
    const welcome = await ctx.get('/api/welcome/prasad/upcoming');
    expect(welcome.status()).toBe(200);
    // Admin surface stays closed to welcome-team (middleware denies with 401).
    const admin = await ctx.get('/api/admin/users');
    expect(admin.status()).toBe(401);
    await ctx.dispose();
  });

  test('standalone admin reaches the admin APIs', async ({ baseURL }) => {
    const { ctx, redirectTo } = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.admin);
    expect(redirectTo).toBe('/admin');
    const res = await ctx.get('/api/admin/users');
    expect(res.status()).toBe(200);
    await ctx.dispose();
  });
});
