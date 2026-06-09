import { test, expect, type Locator } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Phase 2 (Users & Roles). The screen renders desktop + mobile blocks both into
// the DOM, so locators are filtered to the visible (desktop) one to avoid
// strict-mode multi-match. The add-form + roles reference live in collapsed
// DesktopDisclosure panels (buttons), and revoke uses a native confirm().
const vis = (loc: Locator): Locator => loc.filter({ visible: true });

const TARGET = 'e2e-grant-target@cmt-portal.test';

test.describe('admin Users & Roles', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('renders the staff list with the seeded admin user', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: /users & roles/i }).first()).toBeVisible();
    // The seeded E2E user (family-manager + admin) shows up as staff by name.
    await expect(vis(page.getByText('E2E Tester')).first()).toBeVisible();
    // The collapsed add-staff + roles-reference disclosures are present.
    await expect(vis(page.getByRole('button', { name: /add staff role/i }))).toBeVisible();
    await expect(vis(page.getByRole('button', { name: /roles reference/i }))).toBeVisible();
  });

  test('grant then revoke welcome-team for a throwaway contact (with cleanup)', async ({ page }) => {
    // Revoke triggers a native confirm() — auto-accept it.
    page.on('dialog', (d) => d.accept().catch(() => undefined));
    await page.goto('/admin/users');

    try {
      // Expand the collapsed add-staff disclosure, then grant welcome-team.
      await vis(page.getByRole('button', { name: /add staff role/i })).click();
      await vis(page.getByPlaceholder('person@example.com or +1…')).fill(TARGET);
      await vis(page.getByRole('combobox')).selectOption('welcome-team');
      await vis(page.getByRole('button', { name: /grant role/i })).click();

      // It appears in the list. Filter the list to the target to isolate its row.
      await vis(page.getByPlaceholder('Search name or contact…')).fill(TARGET);
      await expect(vis(page.getByText(TARGET)).first()).toBeVisible({ timeout: 15_000 });

      // Revoke welcome-team — filtered list leaves only the target's button.
      await vis(page.getByRole('button', { name: /revoke welcome team/i })).first().click();
      await expect(vis(page.getByText(TARGET))).toHaveCount(0, { timeout: 15_000 });
    } finally {
      // Best-effort cleanup so a mid-test failure can't leave a stray grant in UAT.
      // page.request carries the authenticated session cookie → admin-gated DELETE.
      await page.request
        .delete('/api/admin/users/roles', { data: { contact: TARGET, role: 'welcome-team' } })
        .catch(() => undefined);
    }
  });
});
