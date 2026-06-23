import { test, expect, type Locator } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Phase 2 (Users & Roles). The screen renders desktop + mobile blocks both into
// the DOM, so locators are filtered to the visible (desktop) one to avoid
// strict-mode multi-match. The add-form + roles reference live in collapsed
// DesktopDisclosure panels (buttons), and revoke uses a native confirm().
const vis = (loc: Locator): Locator => loc.filter({ visible: true });

// Unique per run so the contact is GUARANTEED to be an unregistered portal user
// — granting a role to it must hit the registered-user-required guard (a fixed
// address could have been auto-registered by a pre-cf25 run and would grant).
const TARGET = `e2e-grant-target-${Date.now()}@cmt-portal.test`;

test.describe('admin Users & Roles', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('renders the sevak list with the seeded admin user', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: /users & roles/i }).first()).toBeVisible();
    // The seeded E2E user (family-manager + admin) shows up as a sevak by name.
    await expect(vis(page.getByText('E2E Tester')).first()).toBeVisible();
    // The collapsed add-sevak + roles-reference disclosures are present.
    await expect(vis(page.getByRole('button', { name: /add sevak role/i }))).toBeVisible();
    await expect(vis(page.getByRole('button', { name: /roles reference/i }))).toBeVisible();
  });

  test('granting an unregistered contact is rejected by the registered-user guard', async ({ page }) => {
    await page.goto('/admin/users');

    // Open the add-sevak dialog (desktop top action), enter an unregistered
    // email, pick welcome-team, and attempt the grant.
    await vis(page.getByRole('button', { name: /add sevak role/i })).click();
    await vis(page.getByPlaceholder('person@example.com')).fill(TARGET);
    // Role is a segmented radio control (not a native select).
    await vis(page.getByRole('radio', { name: 'Welcome team' })).click();
    await vis(page.getByRole('button', { name: /grant role/i })).click();

    // cf25: grantRole now requires an already-registered portal user. An unknown
    // contact returns 409 registered-user-required, surfaced as an error toast —
    // no grant is written, so there is nothing to clean up.
    await expect(
      page.getByText(/not registered in the portal/i).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
