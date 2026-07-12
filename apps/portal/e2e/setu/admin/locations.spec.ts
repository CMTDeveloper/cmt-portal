import { test, expect, type Page } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Admin-managed centre locations editor (/admin/locations), deployed UAT. The
// single seeded UAT user is family-manager + admin, so family.json reaches the
// admin-only editor. Every mutation goes through the deployed UI/API; the spec
// is SELF-CLEANING — beforeAll captures the pre-test app_config/locations doc
// (whether it existed + its options) and afterAll restores it verbatim (or
// deletes it if it never existed) via the admin SDK, so a partial/failed run
// never leaves UAT dirty or blocks a re-run.
//
// The three centre-list mutations all write the SAME singleton config doc, so
// the tests run serial (one worker, in order) to avoid clobbering each other.

const RUN = Date.now();
const ADD_CENTRE = `E2E-Loc-Add-${RUN}`;
const RM_CENTRE = `E2E-Loc-Rm-${RUN}`;

// Captured pre-test state (module scope so afterAll restores it).
let originalExisted = false;
let originalOptions: string[] | undefined;

async function currentPublicOptions(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/setu/locations');
  expect(res.status(), 'GET /api/setu/locations').toBe(200);
  return ((await res.json()) as { options: string[] }).options;
}

test.describe.configure({ mode: 'serial' });

test.describe('Admin — Locations editor', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test.beforeAll(async () => {
    if (!hasFamilyCreds) return;
    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const snap = await portalFirestore().collection('app_config').doc('locations').get();
    originalExisted = snap.exists;
    const opts = snap.data()?.['options'];
    originalOptions = Array.isArray(opts) ? (opts as string[]) : undefined;
  });

  test.afterAll(async () => {
    if (!hasFamilyCreds) return;
    // Restore the config doc to exactly what we found: rewrite the original
    // options if the doc existed, otherwise delete it (it never existed).
    const { portalFirestore, FieldValue } = await import('@cmt/firebase-shared/admin/firestore');
    const doc = portalFirestore().collection('app_config').doc('locations');
    try {
      if (originalExisted && originalOptions) {
        await doc.set({ options: originalOptions, updatedAt: FieldValue.serverTimestamp() });
      } else {
        await doc.delete();
      }
    } catch (err) {
      console.warn('locations cleanup failed:', err);
    }
  });

  test('adds a centre via the editor; it appears + surfaces in the public picker', async ({
    page,
  }) => {
    await page.goto('/admin/locations');
    await expect(page.getByRole('heading', { name: /^Locations$/i }).first()).toBeVisible({
      timeout: 20_000,
    });

    // The current default centres render. The admin layout renders the page in
    // BOTH a mobile (block md:hidden) and a desktop (hidden md:flex) chrome, so
    // text nodes match a hidden copy too — filter to the visible one.
    await expect(page.getByText('Brampton', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(
      page.getByText('Scarborough', { exact: true }).filter({ visible: true }),
    ).toBeVisible();

    // Add a unique centre through the editor, then Save. (getByRole controls are
    // already scoped to the accessibility tree, i.e. the visible desktop chrome.)
    await page.getByRole('textbox', { name: 'New centre location' }).fill(ADD_CENTRE);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(ADD_CENTRE, { exact: true }).filter({ visible: true })).toBeVisible();

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/admin/locations') && r.request().method() === 'PUT',
      ),
      page.getByRole('button', { name: /save changes/i }).click(),
    ]);
    expect(saveResp.status(), await saveResp.text()).toBe(200);
    await expect(page.getByText('Locations saved').filter({ visible: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // The public picker (pre-auth registration centre list) now returns it.
    expect(await currentPublicOptions(page)).toContain(ADD_CENTRE);
  });

  test('removing an UNUSED centre succeeds', async ({ page }) => {
    await page.goto('/admin/locations');
    await expect(page.getByRole('heading', { name: /^Locations$/i }).first()).toBeVisible({
      timeout: 20_000,
    });

    // Seed an unused centre directly, then remove it — assert on the API result.
    const base = await currentPublicOptions(page);
    const withCentre = [...new Set([...base, RM_CENTRE])];
    const addRes = await page.request.put('/api/admin/locations', {
      data: { options: withCentre },
    });
    expect(addRes.status(), await addRes.text()).toBe(200);
    expect(await currentPublicOptions(page)).toContain(RM_CENTRE);

    // Remove the (unreferenced) centre — the guard must allow it.
    const removeRes = await page.request.put('/api/admin/locations', {
      data: { options: base },
    });
    expect(removeRes.status(), await removeRes.text()).toBe(200);
    expect(await currentPublicOptions(page)).not.toContain(RM_CENTRE);
  });

  test('removing a REFERENCED centre is rejected with 409 location-in-use', async ({ page }) => {
    await page.goto('/admin/locations');
    await expect(page.getByRole('heading', { name: /^Locations$/i }).first()).toBeVisible({
      timeout: 20_000,
    });

    // Brampton is referenced by real families/levels/enrollments in UAT, so the
    // referential-safety guard must refuse to drop it. Assert on the API
    // response (no destructive UI click on a real centre). Build the "next" list
    // from the CURRENT options minus Brampton so we only remove that one centre.
    const current = await currentPublicOptions(page);
    const withoutBrampton = current.filter((c) => c.toLowerCase() !== 'brampton');
    expect(withoutBrampton.length, 'Brampton present in current options').toBeLessThan(
      current.length,
    );

    const res = await page.request.put('/api/admin/locations', {
      data: { options: withoutBrampton },
    });
    expect(res.status(), await res.text()).toBe(409);
    const body = (await res.json()) as { error?: string; location?: string; count?: number };
    expect(body.error).toBe('location-in-use');
    expect(body.location).toBe('Brampton');
    expect(typeof body.count).toBe('number');
    expect(body.count!).toBeGreaterThan(0);
  });
});
