import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { TEST_ACCOUNT_EMAILS, TEST_ACCOUNTS_PASSWORD, hasTestAccounts } from '../_helpers';

// Propose→confirm flow vs deployed UAT. The seeded Scarborough test family
// carries a PROPOSED assignment (re-seed resets it), so:
//  - the proposed state is deterministic right after a seed run;
//  - the in-place confirm test tolerates an already-confirmed rerun (the only
//    state drift possible between seeds).
test.describe('prasad propose→confirm', () => {
  test.skip(!hasTestAccounts, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');

  let ctx: APIRequestContext;
  test.beforeAll(async ({ baseURL }) => {
    ctx = await request.newContext({ baseURL: baseURL! });
    const res = await ctx.post('/api/setu/auth/password-sign-in', {
      data: { email: TEST_ACCOUNT_EMAILS.parentScarborough, password: TEST_ACCOUNTS_PASSWORD },
    });
    expect(res.ok(), `sign-in failed: ${res.status()}`).toBeTruthy();
  });
  test.afterAll(async () => { await ctx.dispose(); });

  test('family GET surfaces the proposed status', async () => {
    const res = await ctx.get('/api/setu/prasad');
    expect(res.status()).toBe(200);
    const { assignment } = (await res.json()) as { assignment: { status: string; date: string } | null };
    expect(assignment).not.toBeNull();
    expect(['proposed', 'assigned']).toContain(assignment!.status); // assigned only if a prior run confirmed
  });

  test('confirm validates: malformed 400, bogus target 409', async () => {
    const bad = await ctx.post('/api/setu/prasad/confirm', { data: { date: 'nope' } });
    expect(bad.status()).toBe(400);
    const bogus = await ctx.post('/api/setu/prasad/confirm', { data: { date: '2099-01-03' } });
    expect(bogus.status()).toBe(409); // invalid-target or already-confirmed — both 409
  });

  test('in-place confirm round-trips (or reports already-confirmed on rerun)', async () => {
    const res = await ctx.post('/api/setu/prasad/confirm', { data: {} });
    if (res.status() === 200) {
      const after = await ctx.get('/api/setu/prasad');
      const { assignment } = (await after.json()) as { assignment: { status: string } };
      expect(assignment.status).toBe('assigned');
    } else {
      expect(res.status()).toBe(409);
      expect(((await res.json()) as { error?: string }).error).toBe('already-confirmed');
    }
  });

  test('admin assign-remaining rejects an unknown pid', async ({ page }) => {
    // page.request carries the storageState admin session (seeded E2E user).
    const res = await page.request.post('/api/admin/prasad/assign-remaining', { data: { pid: 'nope' } });
    expect(res.status()).toBe(400);
  });

  test('admin list rows carry status', async ({ page }) => {
    const res = await page.request.get('/api/admin/prasad?pid=bv-scarborough-2025-26');
    expect(res.status()).toBe(200);
    const { assignments } = (await res.json()) as { assignments: Array<{ status: string }> };
    expect(assignments.length).toBeGreaterThan(0);
    for (const a of assignments) expect(['proposed', 'assigned', 'cancelled']).toContain(a.status);
  });
});
