import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Prasad module vs deployed UAT. The seeded family (CMT-FSWEDU2X) carries a
// prasad fixture: prasadConfig/bv-brampton-2025-26 (cap 10) + an assignment on
// 2026-06-14 — deliberately inside the 7-day move-lock window (and later, in
// the past), so the locked state and the 409 'locked' move rejection are
// DETERMINISTIC assertions rather than calendar-dependent conditionals.
// The single seeded UAT user is family-manager + admin (welcome-team inherited).
const PID = 'bv-brampton-2025-26';
const FID = 'CMT-FSWEDU2X';

test.describe('Prasad module', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('admin preview endpoint returns the proposal shape (read-only dry-run)', async ({ page }) => {
    const res = await page.request.post('/api/admin/prasad/preview', { data: { pid: PID } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.cap).toBe('number');
    expect(typeof body.defaultCap).toBe('number');
    expect(typeof body.eligibleSundayCount).toBe('number');
    expect(Array.isArray(body.rows)).toBe(true);
    expect(Array.isArray(body.perSunday)).toBe(true);
    expect(Array.isArray(body.unplaced)).toBe(true);
    expect(typeof body.stats.families).toBe('number');
    expect(typeof body.stats.keptExisting).toBe('number');
  });

  test('admin preview rejects an unknown pid', async ({ page }) => {
    const res = await page.request.post('/api/admin/prasad/preview', { data: { pid: 'nope' } });
    expect(res.status()).toBe(400);
  });

  test('family GET returns the seeded assignment (locked inside the move window)', async ({ page }) => {
    const res = await page.request.get('/api/setu/prasad');
    expect(res.status()).toBe(200);
    const { assignment } = (await res.json()) as {
      assignment: { paid: string; date: string; movable: boolean; reason: string } | null;
    };
    expect(assignment?.paid).toBe(`${PID}-${FID}`);
    expect(assignment?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(assignment?.reason).toBe('birthday-month');
    // Seed date is within MOVE_LOCK_DAYS of seeding (and in the past on later runs).
    expect(assignment?.movable).toBe(false);
  });

  test('family dashboard renders the prasad card with the locked note', async ({ page }) => {
    await page.goto('/family');
    await expect(page.getByText(/your prasad sunday/i).filter({ visible: true }).first())
      .toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/date locked/i).filter({ visible: true }).first()).toBeVisible();
  });

  test('/family/prasad detail page renders', async ({ page }) => {
    await page.goto('/family/prasad');
    await expect(page.getByText(/your prasad sunday/i).filter({ visible: true }).first())
      .toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/how prasad seva works/i).filter({ visible: true }).first()).toBeVisible();
  });

  test('move validates: malformed date 400; locked assignment 409', async ({ page }) => {
    const bad = await page.request.post('/api/setu/prasad/move', { data: { date: 'nope' } });
    expect(bad.status()).toBe(400);

    const optsRes = await page.request.get('/api/setu/prasad/options');
    expect(optsRes.status()).toBe(200);
    const { options } = (await optsRes.json()) as { options: Array<{ date: string }> };
    expect(Array.isArray(options)).toBe(true);

    // Any well-formed move attempt must be rejected: the seeded assignment is
    // locked (409 'locked'); even an open target can't unlock it.
    const target = options[0]?.date ?? '2099-01-03';
    const move = await page.request.post('/api/setu/prasad/move', { data: { date: target } });
    expect(move.status()).toBe(409);
    expect(((await move.json()) as { error?: string }).error).toBe('locked');
  });

  test('welcome upcoming endpoint returns per-location groups', async ({ page }) => {
    const res = await page.request.get('/api/welcome/prasad/upcoming');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { locations: Array<{ location: string; sundays: unknown[] }> };
    expect(Array.isArray(body.locations)).toBe(true);
  });

  test('admin prasad screen renders the preview', async ({ page }) => {
    await page.goto('/admin/prasad');
    await expect(page.getByTestId('prasad-preview').filter({ visible: true }).first())
      .toBeVisible({ timeout: 30_000 });
  });

  test('reminder cron rejects unauthenticated calls', async ({ page }) => {
    const res = await page.request.post('/api/cron/send-prasad-reminders');
    expect(res.status()).toBe(401);
  });
});
