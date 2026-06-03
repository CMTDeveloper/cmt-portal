import { test, expect } from '../fixtures';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

async function signInAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login/admin');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/check-in/admin');
}

test.describe('B4 — admin dashboard', () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set',
  );

  test('admin dashboard shows stat cards', async ({ page }) => {
    await signInAsAdmin(page);
    await expect(page.getByText(/check-ins today/i)).toBeVisible();
    await expect(page.getByText(/this week/i)).toBeVisible();
    await expect(page.getByText(/guests today/i)).toBeVisible();
    await expect(page.getByText(/unpaid/i).first()).toBeVisible();
  });

  test('admin users page renders list and form', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('link', { name: /users/i }).click();
    await expect(page).toHaveURL('/check-in/admin/users');
    await expect(page.getByRole('heading', { name: /admin users/i })).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
  });

  test('guests page renders', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('link', { name: /guests/i }).click();
    await expect(page).toHaveURL('/check-in/admin/guests');
  });

  test('unpaid page renders', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('link', { name: /unpaid/i }).click();
    await expect(page).toHaveURL('/check-in/admin/unpaid');
    await expect(page.getByRole('heading', { name: /unpaid families/i })).toBeVisible();
  });

  test('reports page renders with export buttons', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('link', { name: /reports/i }).click();
    await expect(page).toHaveURL('/check-in/admin/reports');
    await expect(page.getByRole('button', { name: /check-ins csv/i })).toBeVisible();
  });

  test('unauthenticated /check-in/admin redirects to login', async ({ page }) => {
    await page.goto('/check-in/admin');
    await expect(page).toHaveURL(/\/login/);
  });
});
