import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Slice "admin-managed locations + levels redesign" — the master-detail Level
// management screen (/admin/levels), deployed UAT. The single seeded UAT user is
// family-manager + admin, so family.json reaches the admin-only screen. This spec
// is SELF-CONTAINED and SELF-CLEANING: beforeAll creates its OWN levels (2 at
// Brampton, 1 at Scarborough) for the LIVE school year via the admin level API so
// the flow never mutates a real family's levels, and afterAll unwinds any
// teacherAssignments then deletes the created levels with the admin SDK (there is
// no level DELETE API — only PATCH). Unique names (per-run timestamp) keep the
// levelId slugs unique so a failed cleanup never blocks a re-run.
//
// The redesign renders desktop + mobile blocks both in the DOM. The `setu`
// project is Desktop Chrome (>= md), so getByRole('row') scopes to the DESKTOP
// <table> (mobile cards are <div>s), and the detail panel is the desktop one
// (data-testid="level-detail-desktop"); the md:hidden mobile drawer is scoped
// out by keying every panel query off that testid.

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
const STORAGE = 'e2e/.auth/family.json';

const RUN = Date.now();
const NAME_B1 = `E2E RD Brampton A ${RUN}`;
const NAME_B2 = `E2E RD Brampton B ${RUN}`;
const NAME_S1 = `E2E RD Scarborough ${RUN}`;

// levelIds captured from the create POSTs (module scope so afterAll + the test
// share them).
const createdLevelIds: string[] = [];

// Resolved in beforeAll so the test body reads them.
let levelIdS1 = '';

async function createLevelViaApi(
  api: APIRequestContext,
  input: { location: string; pid: string; name: string; grades: string[] },
): Promise<string> {
  const res = await api.post('/api/admin/levels', {
    data: {
      programKey: 'bala-vihar',
      location: input.location,
      pid: input.pid,
      levelName: input.name,
      levelKind: 'level',
      gradeBand: input.grades,
      curriculum: 'E2E RD Curriculum',
      enabled: true,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const levelId = ((await res.json()) as { levelId: string }).levelId;
  createdLevelIds.push(levelId);
  return levelId;
}

test.describe('Admin — Level management redesign', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test.beforeAll(async () => {
    if (!hasFamilyCreds) return;

    // Authenticated API context off the shared storageState (the setup project
    // wrote it before this hook runs). Used to create the fixture levels.
    const api = await pwRequest.newContext({ baseURL: BASE_URL, storageState: STORAGE });
    try {
      // Live school year — the /admin/levels page shows only levels whose
      // periodLabel === the live year, so the fixture must target that year.
      const syRes = await api.get('/api/admin/school-year');
      expect(syRes.status(), 'GET /api/admin/school-year').toBe(200);
      const currentYear = ((await syRes.json()) as { config: { currentYear: string } }).config
        .currentYear;

      // Discover the enabled donation period per centre for the live year (the
      // level's periodLabel is snapshotted from it). Admin SDK read — the config
      // creds are in process.env because playwright.config loads .env.local.
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();
      const dpSnap = await db.collection('donationPeriods').where('enabled', '==', true).get();
      const pidFor = (location: string): string => {
        const hit = dpSnap.docs
          .map((d) => d.data() as { pid?: string; periodLabel?: string; location?: string })
          .find((p) => p.location === location && p.periodLabel === currentYear);
        expect(hit?.pid, `no enabled ${currentYear} donation period at ${location} in UAT`).toBeTruthy();
        return hit!.pid!;
      };
      const bramptonPid = pidFor('Brampton');
      const scarboroughPid = pidFor('Scarborough');

      await createLevelViaApi(api, { location: 'Brampton', pid: bramptonPid, name: NAME_B1, grades: ['2'] });
      await createLevelViaApi(api, { location: 'Brampton', pid: bramptonPid, name: NAME_B2, grades: ['3'] });
      levelIdS1 = await createLevelViaApi(api, {
        location: 'Scarborough',
        pid: scarboroughPid,
        name: NAME_S1,
        grades: ['4'],
      });
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async () => {
    if (!hasFamilyCreds || createdLevelIds.length === 0) return;
    // No HTTP DELETE for a level — clean up directly with the admin SDK. Unwind
    // any teacherAssignments (arrayRemove) so no dangling refs remain, then
    // delete the level doc. Mirrors level-management.spec.ts.
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
        console.warn(`level-management-redesign cleanup failed for ${levelId}:`, err);
      }
    }
  });

  test('location tablist filters the list; master-detail teacher add → lead → remove', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto('/admin/levels');
    await expect(page.getByRole('heading', { name: /level management/i }).first()).toBeVisible({
      timeout: 20_000,
    });

    // ── Location tablist defaults to the first centre (Brampton) ──────────────
    const tablist = page.getByRole('tablist', { name: 'Location' });
    await expect(tablist).toBeVisible({ timeout: 15_000 });
    await expect(tablist.getByRole('tab', { selected: true })).toHaveText('Brampton');

    // Stat cards are part of the redesign; total counts the current (Brampton)
    // list, which includes the 2 fixture Brampton levels (>= 2). The admin
    // layout renders the page in BOTH a mobile (block md:hidden) and a desktop
    // (hidden md:flex) chrome, so testid/text locators match a hidden copy too;
    // filter to the visible (desktop) one. Role/heading locators below are
    // already scoped to the accessibility tree (display:none copies excluded).
    const statTotal = page.getByTestId('stat-total').filter({ visible: true });
    await expect(statTotal).toBeVisible();
    await expect(page.getByTestId('stat-with-teachers').filter({ visible: true })).toBeVisible();
    await expect(page.getByTestId('stat-needing-teachers').filter({ visible: true })).toBeVisible();
    expect(Number(await statTotal.innerText())).toBeGreaterThanOrEqual(2);

    // Brampton tab shows only Brampton levels: both fixtures visible, the
    // Scarborough fixture NOT in the list.
    await expect(page.getByRole('row').filter({ hasText: NAME_B1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('row').filter({ hasText: NAME_B2 })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: NAME_S1 })).toHaveCount(0);

    // ── Clicking the Scarborough tab swaps the list ───────────────────────────
    await tablist.getByRole('tab', { name: 'Scarborough' }).click();
    await expect(page.getByRole('row').filter({ hasText: NAME_S1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('row').filter({ hasText: NAME_B1 })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: NAME_B2 })).toHaveCount(0);

    // ── Click the level row → the desktop detail panel opens for that level ────
    // The desktop detail panel wrapper (data-testid="level-detail-desktop") is
    // present; its content is display:contents (boxless), so assert the panel is
    // open via its visible "Selected level" label + the level-name heading (the
    // panel heading is a role=heading, distinct from the row's role=cell).
    const rowS1 = page.getByRole('row').filter({ hasText: NAME_S1 });
    await rowS1.getByText(NAME_S1).click();

    await expect(page.getByTestId('level-detail-desktop').first()).toBeAttached();
    await expect(page.getByText('Selected level').filter({ visible: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: NAME_S1 })).toBeVisible();

    // ── Add a teacher: search a known assignable teacher and pick from results ─
    // Teacher search reuses family search (searchKeys array-contains, EXACT
    // match on family-name keywords), then surfaces the family's ADULT members.
    // The shared E2E family's adult "E2E Tester" is the reliable, always-present
    // pick (it is the session user's own family). Role/textbox locators resolve
    // to the single visible (desktop-panel) control; the md:hidden mobile drawer
    // and the display:none mobile-chrome copy are excluded from the a11y tree.
    await page.getByRole('button', { name: /add teacher/i }).click();
    await page.getByRole('textbox', { name: 'Search teacher' }).fill('E2E Test Family');
    const hit = page.getByRole('button', { name: /E2E Tester/i }).first();
    await expect(hit).toBeVisible({ timeout: 15_000 });

    const [addResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/admin/levels/${levelIdS1}/teachers`) &&
          r.request().method() === 'POST',
      ),
      hit.click(),
    ]);
    expect(addResp.status(), await addResp.text()).toBe(200);

    // The pill appears with the "Assistant Teacher" badge (a freshly-added
    // teacher is not the lead). Use exact text so the transient Sonner toasts
    // ("Assigned E2E Tester…", "Lead teacher updated.") are not matched as
    // substrings.
    await expect(
      page.getByText('E2E Tester', { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('Assistant Teacher', { exact: true }).filter({ visible: true }),
    ).toBeVisible();

    // ── Make Lead → badge flips to "Lead Teacher"; PATCH leadTeacherRef is 200 ─
    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/admin/levels/${levelIdS1}`) &&
          !r.url().includes('/teachers') &&
          r.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: 'Make Lead' }).click(),
    ]);
    expect(patchResp.status(), await patchResp.text()).toBe(200);
    await expect(page.getByText('Lead Teacher', { exact: true }).filter({ visible: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText('Assistant Teacher', { exact: true }).filter({ visible: true }),
    ).toHaveCount(0);

    // ── Remove the teacher → the pill disappears; DELETE is 200 ───────────────
    const [delResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/admin/levels/${levelIdS1}/teachers`) &&
          r.request().method() === 'DELETE',
      ),
      page.getByRole('button', { name: /Remove E2E Tester/i }).click(),
    ]);
    expect(delResp.status(), await delResp.text()).toBe(200);
    await expect(page.getByRole('button', { name: /Remove E2E Tester/i })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
