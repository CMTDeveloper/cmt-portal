import { test, expect, type Page } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Slice 3 · Workstreams A + B — Level management (/admin/levels), deployed UAT.
// The single seeded UAT user is family-manager + admin, so family.json reaches
// /admin/levels (admin-only). Screens render desktop + mobile blocks both in the
// DOM; getByRole('row') naturally scopes to the DESKTOP <table> (the mobile cards
// are <div>s), so row-scoped locators key off it (the `setu` project is Desktop
// Chrome). Every level this spec creates is torn down in afterAll via the admin
// SDK (there is no level DELETE API — only PATCH). A bespoke, unique name per run
// means a failed cleanup never blocks a re-run (the levelId slug stays unique).

const RUN = Date.now();
const NAME_A = `E2E Level A ${RUN}`;
const NAME_B = `E2E Level B ${RUN}`;
const NAME_C = `E2E Level C ${RUN}`;

// levelIds captured from the create POST responses (module scope so afterAll and
// both tests share them).
const createdLevelIds: string[] = [];

async function currentSchoolYear(page: Page): Promise<string> {
  const res = await page.request.get('/api/admin/school-year');
  expect(res.status(), 'GET /api/admin/school-year').toBe(200);
  return (await res.json()).config.currentYear as string;
}

/**
 * Open "+ New level", select a WRITABLE (live-year) donation period so the create
 * isn't rejected as a past-year write, fill the form, tick the given grade-band
 * checkboxes (Kind defaults to 'level' → the boxes are enabled), submit, and
 * return the created levelId. All created levels are recorded for teardown.
 */
async function createLevel(
  page: Page,
  currentYear: string,
  name: string,
  grades: string[],
): Promise<string> {
  await page.getByRole('button', { name: /new level/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Period is the first of the modal's two <select>s (the second is Kind). Pick
  // the first option whose label carries the live school year.
  const periodSelect = dialog.locator('select').first();
  const periodValue = await periodSelect.locator('option').evaluateAll((opts, yr) => {
    const match = (opts as HTMLOptionElement[]).find((o) => (o.textContent ?? '').includes(yr as string));
    return match ? match.value : '';
  }, currentYear);
  expect(periodValue, `no enabled ${currentYear} donation period in UAT`).not.toBe('');
  await periodSelect.selectOption(periodValue);

  await dialog.getByPlaceholder('Level 2').fill(name);
  await dialog.getByPlaceholder('Hanuman').fill('E2E Curriculum');
  for (const g of grades) {
    await dialog.getByRole('checkbox', { name: g, exact: true }).check();
  }

  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/admin/levels') && r.request().method() === 'POST'),
    dialog.getByRole('button', { name: /create level/i }).click(),
  ]);
  expect(resp.status(), await resp.text()).toBe(201);
  const levelId = ((await resp.json()) as { levelId: string }).levelId;
  createdLevelIds.push(levelId);
  return levelId;
}

test.describe('Admin — Level management', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test.afterAll(async () => {
    if (!hasFamilyCreds || createdLevelIds.length === 0) return;
    // No HTTP DELETE for a level — clean up directly with the SAME admin SDK the
    // seed uses (playwright.config loads .env.local, so the portal creds are in
    // process.env). Also unwind any teacherAssignments so no dangling refs remain.
    const { portalFirestore, FieldValue } = await import('@cmt/firebase-shared/admin/firestore');
    const db = portalFirestore();
    for (const levelId of createdLevelIds) {
      try {
        const snap = await db.collection('levels').doc(levelId).get();
        const refs = (snap.data()?.teacherRefs ?? []) as string[];
        for (const ref of refs) {
          await db
            .collection('teacherAssignments')
            .doc(ref)
            .set({ levelIds: FieldValue.arrayRemove(levelId) }, { merge: true });
        }
        await db.collection('levels').doc(levelId).delete();
      } catch (err) {
        console.warn(`level-management cleanup failed for ${levelId}:`, err);
      }
    }
  });

  test('create via grade dropdown (no age field); derived grade label; rename → conflict', async ({ page }) => {
    const currentYear = await currentSchoolYear(page);

    await page.goto('/admin/levels');
    await expect(page.getByRole('heading', { name: /level management/i }).first()).toBeVisible({ timeout: 20_000 });

    // ── Create level A via the grade DROPDOWN ────────────────────────────────
    await page.getByRole('button', { name: /new level/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Slice 3 retired the free-text age field for the grade band: NO age control,
    // but the grade-band checkboxes are present.
    await expect(dialog.getByLabel(/age/i)).toHaveCount(0);
    await expect(dialog.getByRole('checkbox', { name: 'Grade 2', exact: true })).toBeVisible();

    const periodSelect = dialog.locator('select').first();
    const periodValue = await periodSelect.locator('option').evaluateAll((opts, yr) => {
      const match = (opts as HTMLOptionElement[]).find((o) => (o.textContent ?? '').includes(yr as string));
      return match ? match.value : '';
    }, currentYear);
    expect(periodValue, `no enabled ${currentYear} donation period in UAT`).not.toBe('');
    await periodSelect.selectOption(periodValue);

    await dialog.getByPlaceholder('Level 2').fill(NAME_A);
    await dialog.getByPlaceholder('Hanuman').fill('E2E Curriculum');
    // Tick Grade 2 + Grade 3 via the dropdown checkboxes (no numeric age input).
    await dialog.getByRole('checkbox', { name: 'Grade 2', exact: true }).check();
    await dialog.getByRole('checkbox', { name: 'Grade 3', exact: true }).check();

    const [createAResp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/admin/levels') && r.request().method() === 'POST'),
      dialog.getByRole('button', { name: /create level/i }).click(),
    ]);
    expect(createAResp.status(), await createAResp.text()).toBe(201);
    const levelIdA = ((await createAResp.json()) as { levelId: string }).levelId;
    createdLevelIds.push(levelIdA);

    // The new row appears (optimistic append) with the derived grade-band label "2, 3".
    const rowA = page.getByRole('row').filter({ hasText: NAME_A });
    await expect(rowA).toBeVisible({ timeout: 15_000 });
    await expect(rowA).toContainText('2, 3');

    // ── Create level B in the SAME (live-year) period, rename it → CONFLICT ───
    // createLevel picks the same first live-year option, so B is a sibling of A
    // in the same (location, period) — the conflict scope.
    const levelIdB = await createLevel(page, currentYear, NAME_B, ['Grade 5']);
    const rowB = page.getByRole('row').filter({ hasText: NAME_B });
    await expect(rowB).toBeVisible({ timeout: 15_000 });

    await rowB.getByRole('button', { name: /^Edit$/i }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByPlaceholder('Level 2').fill(NAME_A);
    const [patchResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/admin/levels/${levelIdB}`) && r.request().method() === 'PATCH'),
      editDialog.getByRole('button', { name: /save changes/i }).click(),
    ]);
    expect(patchResp.status()).toBe(409);
    expect(((await patchResp.json()) as { error?: string }).error).toBe('level-conflict');
    await expect(
      page.getByText(/already exists for this period/i).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Close the still-open edit modal (a conflict toast does NOT auto-close it).
    await editDialog.getByRole('button', { name: /close|cancel/i }).first().click();
  });

  test('inline per-level teacher assign → name pill → remove', async ({ page }) => {
    const currentYear = await currentSchoolYear(page);
    await page.goto('/admin/levels');
    await expect(page.getByRole('heading', { name: /level management/i }).first()).toBeVisible({ timeout: 20_000 });

    // Own, independent level to assign to (no reliance on the other test's state).
    await createLevel(page, currentYear, NAME_C, ['Grade 2']);
    const rowC = page.getByRole('row').filter({ hasText: NAME_C });
    await expect(rowC).toBeVisible({ timeout: 15_000 });

    // Open the inline assign popover and search a teacher by name. Teacher search
    // reuses family search (searchKeys array-contains, EXACT match), so query the
    // shared family's full name; its adult manager "E2E Tester" surfaces as a hit.
    await rowC.getByRole('button', { name: /assign teacher/i }).click();
    await rowC.getByPlaceholder('Search name or email').fill('E2E Test Family');
    const hit = rowC.getByRole('button', { name: /E2E Tester/i });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();

    // The name PILL (with its remove button) appears on level C's row.
    const removeBtn = rowC.getByRole('button', { name: 'Remove E2E Tester' });
    await expect(removeBtn).toBeVisible({ timeout: 15_000 });

    // Remove the pill → gone.
    await removeBtn.click();
    await expect(rowC.getByRole('button', { name: 'Remove E2E Tester' })).toHaveCount(0, { timeout: 15_000 });
  });
});
