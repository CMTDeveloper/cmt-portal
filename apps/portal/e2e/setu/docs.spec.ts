import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { TEST_ACCOUNT_EMAILS, TEST_ACCOUNTS_PASSWORD, hasTestAccounts } from '../_helpers';

// /docs — staff documentation hub. Read-only feature, no UAT mutations.
// Browser assertions use the shared storage state (family-manager + admin
// user → sees everything); role-visibility assertions use fresh API contexts
// per persona, same pattern as test-accounts.spec.ts. Serial: each test does
// its own password sign-in and the limiter is shared per contact.
test.describe.configure({ mode: 'serial' });

async function signIn(baseURL: string, email: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/setu/auth/password-sign-in', {
    data: { email, password: TEST_ACCOUNTS_PASSWORD },
  });
  expect(res.ok(), `password-sign-in failed for ${email}: ${res.status()}`).toBeTruthy();
  return ctx;
}

test.describe('/docs — staff documentation hub', () => {
  test('admin sees the index grouped by category with all guide cards', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.getByRole('heading', { name: 'Portal guides' })).toBeVisible({ timeout: 20_000 });
    for (const slug of ['admin', 'rollover', 'teacher', 'prasad', 'programs', 'donations', 'seva', 'test-accounts']) {
      await expect(page.getByTestId(`doc-card-${slug}`)).toBeVisible();
    }
  });

  test('a guide page renders the markdown as HTML (headings + tables)', async ({ page }) => {
    await page.goto('/docs/prasad');
    const article = page.getByTestId('doc-article');
    await expect(article).toBeVisible({ timeout: 20_000 });
    await expect(article.getByRole('heading', { level: 1 })).toContainText('Prasad module');
    await expect(article.locator('table').first()).toBeVisible();
    // cross-guide links rewritten to portal routes
    await page.goto('/docs/admin');
    const href = await page
      .getByTestId('doc-article')
      .locator('a[href^="/docs/"]')
      .first()
      .getAttribute('href');
    expect(href).toMatch(/^\/docs\/[a-z-]+/);
  });

  // cacheComponents/PPR: the layout shell streams with HTTP 200 before the
  // page's notFound() runs, so unknown slugs can't produce a literal 404
  // status — assert on the streamed not-found digest marker instead.
  test('unknown slug renders not-found (no article)', async ({ page }) => {
    const res = await page.request.get('/docs/not-a-guide');
    const html = await res.text();
    expect(html).toContain('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(html).not.toContain('doc-article');
  });

  test('teacher persona sees only teacher-tagged guides; admin-only guides 404', async ({ baseURL }) => {
    test.skip(!hasTestAccounts, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');
    const ctx = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.teacherBrampton);
    const index = await ctx.get('/docs');
    expect(index.status()).toBe(200);
    const html = await index.text();
    expect(html).toContain('doc-card-teacher');
    expect(html).not.toContain('doc-card-admin');
    expect(html).not.toContain('doc-card-rollover');
    // out-of-audience guide streams the not-found UI (status stays 200 — PPR)
    const denied = await ctx.get('/docs/admin');
    const deniedHtml = await denied.text();
    expect(deniedHtml).toContain('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(deniedHtml).not.toContain('doc-article');
    const allowed = await ctx.get('/docs/teacher');
    expect(allowed.status()).toBe(200);
    expect(await allowed.text()).toContain('doc-article');
    await ctx.dispose();
  });

  test('plain family-manager is denied (redirected to sign-in)', async ({ baseURL }) => {
    test.skip(!hasTestAccounts, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');
    const ctx = await signIn(baseURL!, TEST_ACCOUNT_EMAILS.parentBrampton);
    const res = await ctx.get('/docs', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain('/sign-in');
    expect(res.headers()['location']).toContain('error=unauthorized');
    await ctx.dispose();
  });
});
