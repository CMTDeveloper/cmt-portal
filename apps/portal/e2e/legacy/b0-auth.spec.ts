import { test, expect } from '../fixtures';

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
